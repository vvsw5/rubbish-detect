# 模型接入说明

推荐统一使用当前线上也在用的入口：

```bash
uvicorn app.server_clean:app --reload
```

## 默认模式

默认使用 `mock` 模式，不依赖真实权重文件，适合毕业设计演示。

```bash
set MODEL_PROVIDER=mock
uvicorn app.server_clean:app --reload
```

## YOLO 模式

如果你已经训练好了 `best.pt`，可以切换到 YOLO：

```bash
set MODEL_PROVIDER=yolo
set MODEL_PATH=weights\\best.pt
set LABEL_MAPPING_PATH=label_mapping.json
set YOLO_CONF=0.25
set YOLO_IMGSZ=640
pip install -r requirements-yolo.txt
uvicorn app.server_clean:app --reload
```

如果你需要指定设备，也可以补：

```bash
set YOLO_DEVICE=cpu
```

当前这套运行时已经支持两类 YOLO 输出：

- 目标检测模型：读取 `boxes`
- 图像分类模型：读取 `probs`

如果你当前用的是 `backend/data/` 里这批“整图标注”数据，更建议走：

- `backend/CLASSIFICATION_GUIDE.md`

## 你需要改的地方

如果你的训练标签和示例不完全一样，优先修改：

- `backend/label_mapping.json`
- `backend/label_mapping.example.json`

例如你的 YOLO 标签是 `plastic_bottle`、`used_battery`、`banana_peel`，就把这些键改成你训练时的真实类别名。

现在映射读取时会自动兼容：

- 下划线：`plastic_bottle`
- 连字符：`plastic-bottle`
- 空格：`plastic bottle`

所以你的标签名不必强行改成一种固定写法。

## 建议的数据流

1. 前端上传图片
2. FastAPI 接收图片
3. YOLO 返回检测标签和置信度
4. 后端读取标签映射配置
5. 系统把标签映射成四类垃圾
6. 前端展示识别结果和投放建议

## 推荐你下一步准备的文件

1. 训练好的权重文件：`backend/weights/best.pt`
2. 你的真实标签映射文件：`backend/label_mapping.json`
3. 训练配置文件：`backend/data.yaml`
4. 数据集整理说明：`backend/DATASET_GUIDE.md`
5. 分类训练说明：`backend/CLASSIFICATION_GUIDE.md`

准备好以后，本地启动示例：

```bash
cd backend
pip install -r requirements-yolo.txt
set MODEL_PROVIDER=yolo
set MODEL_PATH=weights\\best.pt
set LABEL_MAPPING_PATH=label_mapping.json
uvicorn app.server_clean:app --reload
```
