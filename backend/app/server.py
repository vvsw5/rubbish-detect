from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


class ClassificationResult(BaseModel):
    item_name: str = Field(..., description="识别到的物品名称")
    category: str = Field(..., description="垃圾类别")
    confidence: float = Field(..., ge=0, le=1, description="置信度")
    suggestion: str = Field(..., description="投放建议")
    source: str = Field(..., description="结果来源")
    model_name: str = Field(..., description="当前模型名称")
    provider: str = Field(..., description="当前模型模式")


class ServiceMeta(BaseModel):
    provider: str = Field(..., description="当前后端启用的模型模式")
    model_name: str = Field(..., description="当前模型名称")
    ready: bool = Field(..., description="模型是否就绪")


app = FastAPI(
    title="垃圾分类识别系统",
    description="毕业设计演示版后端接口",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _mock_predict(filename: str) -> dict:
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


def _yolo_predict(filename: str, image_bytes: bytes) -> dict:
    model_path = __import__("os").getenv("MODEL_PATH", "").strip()
    if not model_path:
        raise RuntimeError("MODEL_PATH 未配置，无法加载 YOLO 权重。")

    try:
        from io import BytesIO

        from PIL import Image
        from ultralytics import YOLO
    except ImportError as exc:
        raise RuntimeError(
            "YOLO 模式需要安装 ultralytics 和 pillow。"
        ) from exc

    label_mapping = {
        "battery": ("废旧电池", "有害垃圾", "请单独投放到有害垃圾回收点。"),
        "can": ("易拉罐", "可回收物", "清空内容物后投放到可回收物。"),
        "plastic bottle": ("塑料瓶", "可回收物", "清洗后压扁投放，便于回收处理。"),
        "bottle": ("塑料瓶", "可回收物", "清洗后压扁投放，便于回收处理。"),
        "banana peel": ("香蕉皮", "厨余垃圾", "请投放到厨余垃圾桶。"),
        "vegetable": ("菜叶", "厨余垃圾", "沥干水分后投入厨余垃圾桶。"),
        "napkin": ("纸巾", "其他垃圾", "受污染纸巾不可回收，请投入其他垃圾。"),
    }

    model = YOLO(model_path)
    image = Image.open(BytesIO(image_bytes)).convert("RGB")
    results = model.predict(image, verbose=False)

    if not results or not results[0].boxes:
        return {
            "item_name": filename or "未知物体",
            "category": "其他垃圾",
            "confidence": 0.0,
            "suggestion": "未检测到目标，请调整图片角度或补充训练数据。",
            "source": "yolo-inference",
            "model_name": "YOLO Custom Model",
            "provider": "yolo",
        }

    first_result = results[0]
    best_index = int(first_result.boxes.conf.argmax().item())
    class_id = int(first_result.boxes.cls[best_index].item())
    confidence = float(first_result.boxes.conf[best_index].item())
    label = str(first_result.names[class_id]).strip().lower()
    item_name, category, suggestion = label_mapping.get(
        label,
        ("未知物体", "其他垃圾", "未命中映射表，请根据训练标签调整类别映射。"),
    )
    return {
        "item_name": item_name,
        "category": category,
        "confidence": confidence,
        "suggestion": suggestion,
        "source": "yolo-inference",
        "model_name": "YOLO Custom Model",
        "provider": "yolo",
    }


def _get_provider() -> str:
    return __import__("os").getenv("MODEL_PROVIDER", "mock").strip().lower()


def _predict(filename: str, image_bytes: bytes) -> dict:
    provider = _get_provider()
    if provider == "yolo":
        return _yolo_predict(filename=filename, image_bytes=image_bytes)
    return _mock_predict(filename=filename)


@app.get("/")
def read_root() -> dict:
    return {
        "message": "垃圾分类识别后端已启动",
        "docs": "/docs",
    }


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


@app.get("/api/meta", response_model=ServiceMeta)
def service_meta() -> ServiceMeta:
    provider = _get_provider()
    if provider == "yolo":
        model_path = __import__("os").getenv("MODEL_PATH", "").strip()
        meta = {
            "provider": "yolo",
            "model_name": "YOLO Custom Model",
            "ready": bool(model_path),
        }
    else:
        meta = {
            "provider": "mock",
            "model_name": "Keyword Demo Classifier",
            "ready": True,
        }
    return ServiceMeta(**meta)


@app.post("/api/classify", response_model=ClassificationResult)
async def classify(file: UploadFile = File(...)) -> ClassificationResult:
    image_bytes = await file.read()
    try:
        result = _predict(file.filename or "unknown", image_bytes)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ClassificationResult(**result)
