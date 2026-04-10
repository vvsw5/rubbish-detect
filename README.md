# 实时垃圾分类毕业设计

这是一个适合毕业设计展示的前后端分离项目骨架，目标是实现：

- 前端页面上传图片或调用摄像头
- 后端接收图片并返回垃圾分类结果
- 后续可无缝接入 YOLO、TensorFlow、PyTorch 或 OpenCV 模型

## 推荐技术栈

- 前端：React + Vite
- 后端：FastAPI
- 模型接入：Python 推理服务

## 项目结构

```text
frontend/   前端页面
backend/    后端接口与分类逻辑
```

## 当前功能

- 图片上传识别
- 摄像头画面抓拍识别
- 返回垃圾类别、置信度、处理建议
- 内置占位分类器，方便先完成系统联调

## 四类垃圾分类

- 可回收物
- 有害垃圾
- 厨余垃圾
- 其他垃圾

## 运行方式

### 1. 启动后端

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set MODEL_PROVIDER=mock
uvicorn app.server_clean:app --host 0.0.0.0 --port 8000 --reload
```

后端默认地址：`http://127.0.0.1:8000`

### 2. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端默认地址：`http://127.0.0.1:5173`

## 后续如何接入真实模型

现在的演示后端入口是：

- `backend/app/server_clean.py`

如果后面要接入真实模型，可以切换到可配置版本，或继续在当前入口中替换推理逻辑。

## 公网访问说明

如果你希望不同网络、不同地方的人都能直接打开，请不要只在本地运行。

推荐部署方式：

- 前端：Vercel
- 后端：Render

详细步骤见：

- `DEPLOY_GUIDE.md`

## 后续如何接入真实模型

你后面只需要：

1. 在后端预测逻辑里加载你的训练模型
2. 将图片预处理后送入模型
3. 把预测类别映射到四类垃圾之一
4. 返回类别、置信度和说明信息

## 毕业设计建议

- 第一阶段：先把前后端流程跑通
- 第二阶段：接入真实训练模型
- 第三阶段：补充数据库、识别历史、统计图表
- 第四阶段：完善论文中的系统架构图、流程图、用例图
