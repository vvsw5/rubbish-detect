from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.model_runtime import build_service_meta, get_allowed_origins, predict


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
    mapping_path: str = Field(..., description="标签映射配置文件路径")


app = FastAPI(
    title="垃圾分类识别系统",
    description="毕业设计演示版后端接口",
    version="2.3.0",
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
    return ServiceMeta(**build_service_meta())


@app.post("/api/classify", response_model=ClassificationResult)
async def classify(file: UploadFile = File(...)) -> ClassificationResult:
    image_bytes = await file.read()
    try:
        result = predict(file.filename or "unknown", image_bytes)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return ClassificationResult(**result)
