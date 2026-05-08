from datetime import datetime, timezone
import json
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError

from app.model_runtime import build_service_meta, get_allowed_origins, predict


BASE_DIR = Path(__file__).resolve().parents[1]
FEEDBACK_STORE_PATH = BASE_DIR / "feedback_store.jsonl"
CORRECTION_STORE_PATH = BASE_DIR / "feedback_corrections.json"
FEEDBACK_CORRECTION_MIN_VOTES = 1
DEFAULT_CORRECTION_SUGGESTION = (
    "Please review the disposal guide before placing this item."
)
CATEGORY_SUGGESTIONS = {
    "可回收物": (
        "建议保持干燥清洁，尽量分拆或压扁后投放入可回收物。"
    ),
    "有害垃圾": (
        "请单独密封投放到有害垃圾回收点，避免渗漏和混投。"
    ),
    "厨余垃圾": (
        "建议沥干水分并去除包装后再投入厨余垃圾。"
    ),
    "其他垃圾": (
        "请装袋后投入其他垃圾，并注意与可回收物、厨余垃圾分开处理。"
    ),
}


class ClassificationResult(BaseModel):
    item_name: str = Field(..., description="recognized item name")
    category: str = Field(..., description="waste category")
    confidence: float = Field(..., ge=0, le=1, description="classification confidence")
    suggestion: str = Field(..., description="disposal suggestion")
    source: str = Field(..., description="result source")
    model_name: str = Field(..., description="model name")
    provider: str = Field(..., description="runtime provider")


class ServiceMeta(BaseModel):
    provider: str = Field(..., description="active inference provider")
    model_name: str = Field(..., description="active model name")
    ready: bool = Field(..., description="service readiness flag")
    mapping_path: str = Field(..., description="label mapping file path")


class FeedbackPayload(BaseModel):
    image_id: str = Field(..., description="client-generated image identifier")
    original_result: ClassificationResult
    user_feedback: str = Field(..., description="correct or wrong")
    corrected_category: str | None = Field(
        default=None,
        description="corrected waste category when feedback is wrong",
    )
    capture_source: str | None = Field(default=None, description="image source label")
    file_name: str | None = Field(default=None, description="uploaded file name")
    timestamp: str | None = Field(default=None, description="feedback timestamp from client")


class FeedbackResponse(BaseModel):
    status: str
    feedback_id: str
    saved_at: str


class FeedbackRecord(FeedbackPayload):
    feedback_id: str
    saved_at: str


class FeedbackSummary(BaseModel):
    total: int
    correct: int
    wrong: int
    latest_at: str | None = None


class FeedbackListResponse(BaseModel):
    items: list[FeedbackRecord]
    summary: FeedbackSummary


app = FastAPI(
    title="Waste Classification API",
    description="Backend API for the waste classification demo",
    version="2.5.0",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_origin_regex=(
        r"^https?://((localhost|127\.0\.0\.1)|(\d{1,3}\.){3}\d{1,3})(:\d+)?$|"
        r"^https://.*\.(vercel\.app|onrender\.com)$"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def append_feedback_record(record: dict) -> None:
    FEEDBACK_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with FEEDBACK_STORE_PATH.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=False) + "\n")


def normalize_feedback_text(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def normalize_feedback_source(value: str | None) -> str:
    normalized = normalize_feedback_text(value)
    return normalized.replace("+feedback-correction", "")


def build_feedback_key(item_name: str | None, source: str | None) -> str:
    normalized_item_name = normalize_feedback_text(item_name)
    normalized_source = normalize_feedback_source(source)
    if not normalized_item_name:
        return ""
    return f"{normalized_source}::{normalized_item_name}".strip(":")


def read_feedback_records() -> list[FeedbackRecord]:
    if not FEEDBACK_STORE_PATH.exists():
        return []

    records: list[FeedbackRecord] = []

    with FEEDBACK_STORE_PATH.open("r", encoding="utf-8") as file:
        for raw_line in file:
            line = raw_line.strip()
            if not line:
                continue

            try:
                payload = json.loads(line)
                records.append(FeedbackRecord(**payload))
            except (json.JSONDecodeError, ValidationError, TypeError, ValueError):
                continue

    return records


def build_feedback_correction_index(records: list[FeedbackRecord]) -> dict[str, dict]:
    correction_index: dict[str, dict] = {}

    for record in records:
        correction_key = build_feedback_key(
            record.original_result.item_name,
            record.original_result.source,
        )
        if not correction_key:
            continue

        voted_category = (
            record.corrected_category
            if record.user_feedback == "wrong" and record.corrected_category
            else record.original_result.category
        )
        if not voted_category:
            continue

        entry = correction_index.setdefault(
            correction_key,
            {
                "key": correction_key,
                "item_name": record.original_result.item_name,
                "source": record.original_result.source,
                "category_votes": {},
                "effective_category": None,
                "effective_votes": 0,
                "total_votes": 0,
                "updated_at": record.saved_at,
            },
        )
        entry["category_votes"][voted_category] = entry["category_votes"].get(voted_category, 0) + 1
        entry["total_votes"] += 1
        entry["updated_at"] = record.saved_at

    for entry in correction_index.values():
        ordered_votes = sorted(
            entry["category_votes"].items(),
            key=lambda item: (-item[1], item[0]),
        )
        if not ordered_votes:
            continue

        top_category, top_votes = ordered_votes[0]
        has_tie = len(ordered_votes) > 1 and ordered_votes[1][1] == top_votes
        if has_tie:
            continue

        entry["effective_category"] = top_category
        entry["effective_votes"] = top_votes

    return correction_index


def rebuild_feedback_correction_store() -> dict[str, dict]:
    correction_index = build_feedback_correction_index(read_feedback_records())
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "min_votes": FEEDBACK_CORRECTION_MIN_VOTES,
        "items": list(correction_index.values()),
    }
    CORRECTION_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CORRECTION_STORE_PATH.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    return correction_index


def is_correction_store_stale() -> bool:
    if not FEEDBACK_STORE_PATH.exists():
        return False
    if not CORRECTION_STORE_PATH.exists():
        return True
    return FEEDBACK_STORE_PATH.stat().st_mtime_ns > CORRECTION_STORE_PATH.stat().st_mtime_ns


def load_feedback_correction_index() -> dict[str, dict]:
    if is_correction_store_stale() or not CORRECTION_STORE_PATH.exists():
        return rebuild_feedback_correction_store()

    try:
        with CORRECTION_STORE_PATH.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (json.JSONDecodeError, OSError, TypeError, ValueError):
        return rebuild_feedback_correction_store()

    items = payload.get("items")
    if not isinstance(items, list):
        return rebuild_feedback_correction_store()

    correction_index: dict[str, dict] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        correction_key = str(item.get("key") or "").strip()
        if not correction_key:
            continue
        correction_index[correction_key] = item
    return correction_index


def get_category_suggestion(category: str, fallback: str | None = None) -> str:
    return CATEGORY_SUGGESTIONS.get(category, fallback or DEFAULT_CORRECTION_SUGGESTION)


def apply_feedback_correction(result: dict) -> dict:
    correction_key = build_feedback_key(result.get("item_name"), result.get("source"))
    if not correction_key:
        return result

    correction = load_feedback_correction_index().get(correction_key)
    if not correction:
        return result

    corrected_category = correction.get("effective_category")
    corrected_votes = int(correction.get("effective_votes") or 0)
    if not corrected_category or corrected_votes < FEEDBACK_CORRECTION_MIN_VOTES:
        return result

    if corrected_category == result.get("category"):
        return result

    next_result = dict(result)
    next_result["category"] = corrected_category
    next_result["suggestion"] = get_category_suggestion(
        corrected_category,
        fallback=result.get("suggestion"),
    )
    next_result["source"] = f'{result.get("source", "feedback-corrected")}+feedback-correction'
    return next_result


@app.get("/")
def read_root() -> dict:
    return {
        "message": "Waste classification backend is running",
        "docs": "/docs",
    }


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


@app.get("/api/meta", response_model=ServiceMeta)
def service_meta() -> ServiceMeta:
    return ServiceMeta(**build_service_meta())


@app.get("/api/feedback", response_model=FeedbackListResponse)
def list_feedback(limit: int = Query(default=12, ge=1, le=60)) -> FeedbackListResponse:
    records = read_feedback_records()
    summary = FeedbackSummary(
        total=len(records),
        correct=sum(1 for item in records if item.user_feedback == "correct"),
        wrong=sum(1 for item in records if item.user_feedback == "wrong"),
        latest_at=records[-1].saved_at if records else None,
    )
    items = list(reversed(records))[:limit]
    return FeedbackListResponse(items=items, summary=summary)


@app.post("/api/classify", response_model=ClassificationResult)
async def classify(file: UploadFile = File(...)) -> ClassificationResult:
    image_bytes = await file.read()
    try:
        result = predict(file.filename or "unknown", image_bytes)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ClassificationResult(**apply_feedback_correction(result))


@app.post("/api/feedback", response_model=FeedbackResponse)
def submit_feedback(payload: FeedbackPayload) -> FeedbackResponse:
    if payload.user_feedback not in {"correct", "wrong"}:
        raise HTTPException(status_code=400, detail="user_feedback must be correct or wrong")

    if payload.user_feedback == "wrong" and not payload.corrected_category:
        raise HTTPException(status_code=400, detail="corrected_category is required when feedback is wrong")

    saved_at = datetime.now(timezone.utc).isoformat()
    feedback_id = str(uuid4())
    record = {
        "feedback_id": feedback_id,
        "saved_at": saved_at,
        **payload.model_dump(),
    }
    append_feedback_record(record)
    rebuild_feedback_correction_store()
    return FeedbackResponse(status="ok", feedback_id=feedback_id, saved_at=saved_at)
