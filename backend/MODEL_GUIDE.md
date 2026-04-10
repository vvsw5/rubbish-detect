# 模型接入说明

推荐使用新的可配置入口：

```bash
uvicorn app.server_configurable:app --reload
```

## 默认模式

默认使用 `mock` 模式，不依赖真实权重文件，适合毕业设计演示。

```bash
set MODEL_PROVIDER=mock
uvicorn app.server_configurable:app --reload
```

## YOLO 模式

如果你已经训练好了 `best.pt`，可以切换到 YOLO：

```bash
set MODEL_PROVIDER=yolo
set MODEL_PATH=weights\\best.pt
set LABEL_MAPPING_PATH=label_mapping.example.json
pip install ultralytics pillow
uvicorn app.server_configurable:app --reload
```

## 你需要改的地方

如果你的训练标签和示例不完全一样，优先修改：

- `backend/label_mapping.example.json`

例如你的 YOLO 标签是 `plastic_bottle`、`used_battery`、`banana_peel`，就把这些键改成你训练时的真实类别名。

## 建议的数据流

1. 前端上传图片
2. FastAPI 接收图片
3. YOLO 返回检测标签和置信度
4. 后端读取标签映射配置
5. 系统把标签映射成四类垃圾
6. 前端展示识别结果和投放建议
