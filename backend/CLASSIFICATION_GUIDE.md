# 当前数据集的训练建议

你现在放在 `backend/data/` 下的这批数据：

- 每个类别单独一个文件夹
- 每张图都带一个 YOLO `.txt`
- 但标注框基本都是整张图：`0.5 0.5 1.0 1.0`

这类数据可以训练，但更适合：

- YOLO 图像分类模型

而不是严格意义上的：

- YOLO 目标检测模型

## 为什么更适合分类

因为这些标注文件本质上是在表达：

```text
整张图属于这个类别
```

而不是：

```text
垃圾目标具体出现在图像的哪个位置
```

所以继续做检测训练虽然不是完全不行，但效果通常不如直接按分类任务来训练。

## 当前项目已经帮你准备好的内容

1. 分类训练源数据目录：`backend/data/`
2. 一键切分脚本：`backend/scripts/prepare_classification_dataset.py`
3. 运行时标签映射：`backend/label_mapping.json`
4. 后端推理入口：`backend/app/server_clean.py`

## 先整理成训练集

运行：

```bash
cd backend
python scripts/prepare_classification_dataset.py
```

脚本会自动生成：

```text
backend/dataset_classify/
  train/
  val/
  split_summary.txt
```

## 分类训练命令示例

```bash
cd backend
pip install -r requirements-yolo.txt
yolo classify train model=yolov8n-cls.pt data=dataset_classify imgsz=224 epochs=50
```

## 训练完成后

训练完成后通常会得到：

```text
runs/classify/train/weights/best.pt
```

把它复制到：

```text
backend/weights/best.pt
```

然后本地启动：

```bash
set MODEL_PROVIDER=yolo
set MODEL_PATH=weights\\best.pt
set LABEL_MAPPING_PATH=label_mapping.json
uvicorn app.server_clean:app --reload
```

当前后端已经兼容 YOLO 分类输出 `probs`，所以这条路线可以直接接到你现有的前端页面。
