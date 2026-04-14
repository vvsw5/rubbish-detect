# YOLO 公网部署说明

这份说明针对当前这套项目状态：

- 前端已经部署在 Vercel
- 后端已经部署在 Render
- 本地已经成功切到真实 YOLO 模型

当前和真实模型部署直接相关的文件有：

- `frontend/`
- `backend/app/server_clean.py`
- `backend/app/model_runtime.py`
- `backend/weights/best.pt`
- `backend/label_mapping.json`

## 推荐方案

- 前端：Vercel
- 后端：Render

这套方案和你现在的工程结构最匹配，也已经被当前项目验证过。

## 部署真实 YOLO 前先确认什么

先确认这 2 个文件已经准备好：

1. `backend/weights/best.pt`
2. `backend/label_mapping.json`

然后确认这些训练数据和中间产物不要推到 GitHub：

- `backend/data/`
- `backend/dataset_classify/`
- `backend/runs/`
- `backend/yolov8n-cls.pt`

这些路径已经写进 `.gitignore`。

## 一、先把真实模型和必要代码提交到 GitHub

当前你的 `best.pt` 大约只有 3 MB，可以直接和代码一起提交，不需要 Git LFS。

建议只提交和上线有关的内容：

```powershell
cd "F:\New project"
git add .gitignore
git add DEPLOY_YOLO.md
git add backend/.env.example
git add backend/MODEL_GUIDE.md
git add backend/requirements-yolo.txt
git add backend/app/model_runtime.py
git add backend/app/server.py
git add backend/app/server_clean.py
git add backend/app/server_configurable.py
git add backend/label_mapping.json
git add backend/weights/best.pt
git commit -m "feat: deploy yolo model"
git push
```

如果当前网络连不上 GitHub，就换一个能访问 GitHub 的网络后再执行 `git push`。

## 二、Render 后端切换到 YOLO

打开 Render 后端服务，进入 `Environment`，把环境变量改成下面这样：

```text
MODEL_PROVIDER=yolo
MODEL_PATH=weights/best.pt
LABEL_MAPPING_PATH=label_mapping.json
YOLO_CONF=0.25
YOLO_IMGSZ=224
PYTHON_VERSION=3.12.13
FRONTEND_ORIGINS=https://rubbish-detect-frontend.vercel.app
```

如果你的前端域名不是上面这个，就把 `FRONTEND_ORIGINS` 换成你自己的 Vercel 域名。

## 三、Render 的构建命令要改成 YOLO 依赖

当前 `render.yaml` 里的构建命令还是演示版用的：

```text
pip install -r requirements.txt
```

真实 YOLO 模型上线时，Render 后端的 Build Command 要改成：

```text
pip install -r requirements-yolo.txt
```

Start Command 保持不变：

```text
uvicorn app.server_clean:app --host 0.0.0.0 --port $PORT
```

## 四、Vercel 前端通常不用再改

如果你当前前端还是：

```text
https://rubbish-detect-frontend.vercel.app
```

并且环境变量还是：

```text
VITE_API_BASE_URL=https://rubbish-detect-backend.onrender.com
```

那前端一般不需要重新配，只要 Render 成功切到 YOLO 模式即可。

## 五、上线后怎么验证

先看后端模型状态：

```text
https://rubbish-detect-backend.onrender.com/api/meta
```

如果部署成功，返回里应该能看到：

```json
{
  "provider": "yolo",
  "model_name": "best.pt",
  "ready": true
}
```

再看健康检查：

```text
https://rubbish-detect-backend.onrender.com/health
```

正常返回：

```json
{"status":"ok"}
```

最后打开前端公网地址，上传一张你训练过的类别图片，确认结果来源已经不是 `mock-rule-engine`，而是 `yolo-inference`。

## 六、这次部署和之前 mock 版有什么区别

之前演示版只需要：

```text
MODEL_PROVIDER=mock
```

现在真实 YOLO 上线多了两个关键条件：

1. Render 必须能读到 `backend/weights/best.pt`
2. Render 必须安装 `ultralytics`，所以 Build Command 不能只用 `requirements.txt`

这两点缺一个，公网后端就不会真正跑到 YOLO。

## 七、最推荐的上线顺序

1. 先把 `best.pt` 和后端 YOLO 相关代码提交到 GitHub
2. 再去 Render 改 Build Command 为 `pip install -r requirements-yolo.txt`
3. 在 Render 改环境变量为 YOLO 模式
4. 重新部署 Render
5. 打开 `/api/meta` 确认 `provider` 已经变成 `yolo`
6. 再去前端页面测试真实识别结果
