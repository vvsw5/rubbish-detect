# 公网部署说明

如果你要求“不同网络、不同地方的人都能打开”，就不能只在本地电脑运行。
你需要把前端和后端部署到公网服务上。

这套项目已经整理成适合部署的结构：

- 前端：`frontend/`
- 后端：`backend/`
- Render 后端部署配置：`render.yaml`

## 推荐方案

推荐你用：

- 前端：Vercel
- 后端：Render

这样做的好处是：

- React + Vite 前端部署简单
- FastAPI 后端部署直接
- 适合毕业设计演示和给别人远程访问

## 一、部署后端到 Render

1. 把项目推到 GitHub。
2. 打开 Render，选择从 GitHub 导入项目。
3. 让 Render 读取根目录下的 `render.yaml`。
4. 部署完成后，你会得到一个公网地址，例如：

```text
https://your-backend-service.onrender.com
```

5. 在 Render 环境变量里确认或补充：

```text
MODEL_PROVIDER=mock
FRONTEND_ORIGINS=https://your-frontend-domain.vercel.app
```

如果以后切换 YOLO，再补：

```text
MODEL_PROVIDER=yolo
MODEL_PATH=weights/best.pt
LABEL_MAPPING_PATH=label_mapping.example.json
```

## 二、部署前端到 Vercel

1. 打开 Vercel，导入同一个 GitHub 仓库。
2. Root Directory 选择 `frontend`。
3. Build Command 保持 `npm run build`。
4. Output Directory 保持 `dist`。
5. 添加环境变量：

```text
VITE_API_BASE_URL=https://your-backend-service.onrender.com
```

6. 部署完成后，你会得到一个公网地址，例如：

```text
https://your-frontend-domain.vercel.app
```

## 三、把前后端连起来

当前端地址确定之后，把这个地址填回 Render 的：

```text
FRONTEND_ORIGINS=https://your-frontend-domain.vercel.app
```

然后重新部署后端。

## 四、部署完成后如何验证

1. 打开前端公网地址。
2. 上传一张图片，看是否返回分类结果。
3. 直接访问后端健康检查：

```text
https://your-backend-service.onrender.com/health
```

如果返回：

```json
{"status":"ok"}
```

说明后端正常。

## 五、当前项目已经为公网部署做好的改动

- 前端接口地址不再写死 `127.0.0.1`
- 前端会根据当前访问域名自动请求对应主机的 `8000` 端口
- 后端支持通过 `FRONTEND_ORIGINS` 配置公网前端域名
- 本地开发脚本会显示局域网访问地址

## 六、什么时候还需要额外处理

如果你要的是：

- 真正长期稳定可访问
- 给老师、同学、答辩现场直接打开

推荐走“Vercel + Render”这种公网部署。

如果你只是临时演示几分钟，也可以用内网穿透工具，但它不适合作为正式交付方案。
