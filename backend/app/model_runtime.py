from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_MAPPING_PATH = BASE_DIR / "label_mapping.example.json"


def get_allowed_origins() -> list[str]:
    default_origins = [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ]
    configured = [
        origin.strip()
        for origin in os.getenv("FRONTEND_ORIGINS", "").split(",")
        if origin.strip()
    ]
    return list(dict.fromkeys([*default_origins, *configured]))


def get_provider() -> str:
    return os.getenv("MODEL_PROVIDER", "mock").strip().lower()


def resolve_backend_path(configured: str, *, default: Path | None = None) -> Path:
    if configured:
        candidate = Path(configured)
        if not candidate.is_absolute():
            candidate = BASE_DIR / candidate
        return candidate.resolve()
    if default is None:
        raise RuntimeError("缺少必要的路径配置。")
    return default.resolve()


def get_model_path() -> Path:
    return resolve_backend_path(os.getenv("MODEL_PATH", "").strip())


def get_mapping_path() -> Path:
    return resolve_backend_path(
        os.getenv("LABEL_MAPPING_PATH", "").strip(),
        default=DEFAULT_MAPPING_PATH,
    )


def get_yolo_confidence() -> float:
    raw = os.getenv("YOLO_CONF", "0.25").strip()
    try:
        value = float(raw)
    except ValueError:
        return 0.25
    return min(max(value, 0.0), 1.0)


def get_yolo_image_size() -> int | None:
    raw = os.getenv("YOLO_IMGSZ", "").strip()
    if not raw:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def get_yolo_device() -> str | None:
    value = os.getenv("YOLO_DEVICE", "").strip()
    return value or None


def normalize_label(label: str) -> str:
    normalized = label.strip().lower()
    normalized = normalized.replace("_", " ").replace("-", " ")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized


def humanize_label(label: str) -> str:
    cleaned = normalize_label(label)
    return cleaned if cleaned else "未知物体"


def load_label_mapping(mapping_path: Path) -> dict[str, dict[str, str]]:
    if not mapping_path.exists():
        raise RuntimeError(f"标签映射文件不存在: {mapping_path}")

    with mapping_path.open("r", encoding="utf-8") as file:
        raw = json.load(file)

    normalized_mapping: dict[str, dict[str, str]] = {}
    for key, value in raw.items():
        normalized_mapping[normalize_label(key)] = value
    return normalized_mapping


def mock_predict(filename: str) -> dict[str, Any]:
    lowered = filename.lower()
    rules = [
        ("battery", "废旧电池", "有害垃圾", "请单独投放到有害垃圾回收点。"),
        ("can", "易拉罐", "可回收物", "清空内容物后投放到可回收物。"),
        ("bottle", "塑料瓶", "可回收物", "清洗后压扁投放，便于回收处理。"),
        ("vegetable", "菜叶", "厨余垃圾", "沥干水分后投入厨余垃圾桶。"),
        ("banana", "香蕉皮", "厨余垃圾", "请投放到厨余垃圾桶。"),
        ("napkin", "纸巾", "其他垃圾", "受污染纸巾不可回收，请投入其他垃圾。"),
    ]

    for keyword, item_name, category, suggestion in rules:
        if keyword in lowered:
            return {
                "item_name": item_name,
                "category": category,
                "confidence": 0.91,
                "suggestion": suggestion,
                "source": "mock-rule-engine",
                "model_name": "Keyword Demo Classifier",
                "provider": "mock",
            }

    return {
        "item_name": "未明确识别物体",
        "category": "其他垃圾",
        "confidence": 0.56,
        "suggestion": "建议人工二次确认，当前结果来自演示版占位分类器。",
        "source": "mock-rule-engine",
        "model_name": "Keyword Demo Classifier",
        "provider": "mock",
    }


class YoloRuntime:
    def __init__(self, model_path: Path, mapping_path: Path):
        if not model_path.exists():
            raise RuntimeError(f"YOLO 权重文件不存在: {model_path}")

        try:
            from PIL import Image
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError("YOLO 模式需要安装 ultralytics 和 pillow。") from exc

        self._image_module = Image
        self._model = YOLO(str(model_path))
        self._label_mapping = load_label_mapping(mapping_path)
        self.model_path = model_path
        self.mapping_path = mapping_path
        self.model_name = model_path.name

    def predict(self, filename: str, image_bytes: bytes) -> dict[str, Any]:
        image = self._image_module.open(BytesIO(image_bytes)).convert("RGB")
        predict_options: dict[str, Any] = {
            "verbose": False,
            "conf": get_yolo_confidence(),
        }

        image_size = get_yolo_image_size()
        if image_size:
            predict_options["imgsz"] = image_size

        device = get_yolo_device()
        if device:
            predict_options["device"] = device

        results = self._model.predict(image, **predict_options)
        best_candidate = self._extract_best_candidate(results)

        if best_candidate is None:
            return {
                "item_name": filename or "未知物体",
                "category": "其他垃圾",
                "confidence": 0.0,
                "suggestion": "未检测到目标，请调整图片角度或补充训练数据。",
                "source": "yolo-inference",
                "model_name": self.model_name,
                "provider": "yolo",
            }

        raw_label, confidence = best_candidate
        mapped = self._label_mapping.get(normalize_label(raw_label))

        if not mapped:
            return {
                "item_name": humanize_label(raw_label),
                "category": "其他垃圾",
                "confidence": confidence,
                "suggestion": "未命中映射表，请根据训练标签调整标签映射配置。",
                "source": "yolo-inference",
                "model_name": self.model_name,
                "provider": "yolo",
            }

        return {
            "item_name": mapped["item_name"],
            "category": mapped["category"],
            "confidence": confidence,
            "suggestion": mapped["suggestion"],
            "source": "yolo-inference",
            "model_name": self.model_name,
            "provider": "yolo",
        }

    def _extract_best_candidate(self, results: Any) -> tuple[str, float] | None:
        if not results:
            return None

        first_result = results[0]
        probs = getattr(first_result, "probs", None)
        if probs is not None and getattr(probs, "top1", None) is not None:
            class_id = int(probs.top1)
            confidence_value = getattr(probs, "top1conf", 0.0)
            confidence = float(
                confidence_value.item()
                if hasattr(confidence_value, "item")
                else confidence_value
            )
            label = str(first_result.names[class_id]).strip()
            return label, confidence

        boxes = getattr(first_result, "boxes", None)
        if boxes is None:
            return None

        try:
            box_count = len(boxes)
        except TypeError:
            box_count = 0

        if box_count == 0:
            return None

        best_index = int(boxes.conf.argmax().item())
        class_id = int(boxes.cls[best_index].item())
        confidence = float(boxes.conf[best_index].item())
        label = str(first_result.names[class_id]).strip()
        return label, confidence


@lru_cache(maxsize=None)
def get_yolo_runtime(model_path: str, mapping_path: str) -> YoloRuntime:
    return YoloRuntime(Path(model_path), Path(mapping_path))


def build_service_meta() -> dict[str, Any]:
    provider = get_provider()
    if provider != "yolo":
        return {
            "provider": "mock",
            "model_name": "Keyword Demo Classifier",
            "ready": True,
            "mapping_path": str(get_mapping_path()),
        }

    try:
        model_path = get_model_path()
    except RuntimeError:
        model_path = Path("未配置")

    mapping_path = get_mapping_path()
    return {
        "provider": "yolo",
        "model_name": model_path.name if model_path.exists() else "YOLO Custom Model",
        "ready": model_path.exists() and mapping_path.exists(),
        "mapping_path": str(mapping_path),
    }


def predict(filename: str, image_bytes: bytes) -> dict[str, Any]:
    provider = get_provider()
    if provider == "yolo":
        runtime = get_yolo_runtime(str(get_model_path()), str(get_mapping_path()))
        return runtime.predict(filename=filename, image_bytes=image_bytes)
    return mock_predict(filename=filename)
