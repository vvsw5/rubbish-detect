from datetime import datetime, timezone
import json
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.model_runtime import build_service_meta, get_allowed_origins, predict


BASE_DIR = Path(__file__).resolve().parents[1]
FEEDBACK_STORE_PATH = BASE_DIR / "feedback_store.jsonl"


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


app = FastAPI(
    title="Waste Classification API",
    description="Backend API for the waste classification demo",
    version="2.4.0",
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


@app.post("/api/classify", response_model=ClassificationResult)
async def classify(file: UploadFile = File(...)) -> ClassificationResult:
    image_bytes = await file.read()
    try:
        result = predict(file.filename or "unknown", image_bytes)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ClassificationResult(**result)


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
    return FeedbackResponse(status="ok", feedback_id=feedback_id, saved_at=saved_at)
