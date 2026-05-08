# 数据集准备说明

这份说明对应当前项目推荐的 10 类 YOLO 垃圾识别方案。

## 推荐类别

```text
plastic_bottle
can
carton
glass_bottle
battery
expired_medicine
banana_peel
vegetable_leaf
napkin
cigarette_butt
```

## 推荐目录结构

```text
backend/
  dataset/
    images/
      train/
      val/
    labels/
      train/
      val/
```

## 文件对应关系

YOLO 检测任务要求图片和标注文件一一对应。

例如：

```text
dataset/images/train/001.jpg
dataset/labels/train/001.txt
```

```text
dataset/images/val/010.jpg
dataset/labels/val/010.txt
```

## 标注格式

如果你使用 YOLO 检测格式，每个 `.txt` 文件里每一行表示一个目标：

```text
class_id x_center y_center width height
```

例如：

```text
0 0.512 0.468 0.325 0.611
```

其中：

- `class_id`：类别编号
- `x_center`：目标框中心点横坐标，已归一化
- `y_center`：目标框中心点纵坐标，已归一化
- `width`：目标框宽度，已归一化
- `height`：目标框高度，已归一化

## 类别编号对应表

```text
0  plastic_bottle
1  can
2  carton
3  glass_bottle
4  battery
5  expired_medicine
6  banana_peel
7  vegetable_leaf
8  napkin
9  cigarette_butt
```

## 图片数量建议

前期最简版本建议：

- 每类至少 80 到 120 张
- 总量建议 800 到 1200 张

如果时间有限，也可以先做一版小样本：

- 每类 40 到 60 张
- 先完成标注和训练流程跑通
- 后面再补图提升效果

## 图片采集建议

每个类别尽量覆盖这些变化：

- 不同角度
- 不同背景
- 不同光线
- 远近变化
- 轻度遮挡
- 单目标和多目标混合

例如 `plastic_bottle` 不要只采集白底整瓶，尽量包括：

- 桌面上的瓶子
- 地面上的瓶子
- 垃圾桶旁的瓶子
- 压扁的瓶子
- 不同颜色和大小的瓶子

## 训练配置文件

当前项目已经提供好训练用配置：

- `backend/data.yaml`

你训练时可以直接使用这个文件。

## 训练命令示例

在安装好 `ultralytics` 之后，可以用类似下面的方式训练：

```bash
yolo detect train data=data.yaml model=yolov8n.pt epochs=100 imgsz=640
```

如果你后面训练的是分类模型，目录结构和 `data.yaml` 会不一样，到时候再单独调整。

## 训练完成后

训练完成后，你通常会得到：

```text
runs/detect/train/weights/best.pt
```

把它复制到：

```text
backend/weights/best.pt
```

然后再配合：

- `backend/label_mapping.json`

就可以接到当前项目的后端接口里。
