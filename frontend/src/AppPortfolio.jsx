import { useEffect, useRef, useState } from "react";

function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }

  return "http://127.0.0.1:8000";
}

const API_BASE_URL = resolveApiBaseUrl();
const API_URL = `${API_BASE_URL}/api/classify`;
const META_URL = `${API_BASE_URL}/api/meta`;
const MAX_UPLOAD_DIMENSION = 960;
const MAX_CAMERA_DIMENSION = 960;
const OPTIMIZED_JPEG_QUALITY = 0.82;
const LARGE_IMAGE_THRESHOLD = 900 * 1024;

function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function getScaledSize(width, height, maxDimension) {
  const longestSide = Math.max(width, height);
  if (!longestSide || longestSide <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / longestSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image."));
    };

    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to export image."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

async function optimizeImageFile(file, options = {}) {
  if (!file.type.startsWith("image/") || typeof document === "undefined") {
    return file;
  }

  const {
    maxDimension = MAX_UPLOAD_DIMENSION,
    quality = OPTIMIZED_JPEG_QUALITY
  } = options;

  const image = await loadImageElement(file);
  const scaledSize = getScaledSize(
    image.naturalWidth,
    image.naturalHeight,
    maxDimension
  );
  const shouldResize =
    scaledSize.width !== image.naturalWidth ||
    scaledSize.height !== image.naturalHeight;
  const shouldCompress =
    shouldResize ||
    file.size > LARGE_IMAGE_THRESHOLD ||
    file.type !== "image/jpeg";

  if (!shouldCompress) {
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = scaledSize.width;
  canvas.height = scaledSize.height;

  const context = canvas.getContext("2d");
  if (!context) {
    return file;
  }

  context.drawImage(image, 0, 0, scaledSize.width, scaledSize.height);
  const blob = await canvasToBlob(canvas, "image/jpeg", quality);
  const baseName = file.name.replace(/\.[^.]+$/, "") || "upload";

  return new File([blob], `${baseName}-optimized.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now()
  });
}

const categoryMeta = {
  可回收物: {
    className: "recyclable",
    tone: "回收建议",
    badge: "可回收"
  },
  有害垃圾: {
    className: "hazardous",
    tone: "单独投放",
    badge: "有害"
  },
  厨余垃圾: {
    className: "kitchen",
    tone: "湿垃圾处理",
    badge: "厨余"
  },
  其他垃圾: {
    className: "other",
    tone: "人工复核",
    badge: "其他"
  }
};

const loadingStageMeta = {
  idle: {
    eyebrow: "Ready",
    title: "等待新的识别请求",
    description: "选择图片或抓拍之后，系统会在这里展示当前进度。"
  },
  optimizing: {
    eyebrow: "Preparing",
    title: "正在压缩并整理图片",
    description: "先把过大的图片处理到更适合识别的尺寸，减少上传和解码时间。"
  },
  uploading: {
    eyebrow: "Uploading",
    title: "正在发送到识别服务",
    description: "图片已经准备好，正在传给后端服务。"
  },
  analyzing: {
    eyebrow: "Analyzing",
    title: "模型正在分析图像",
    description: "系统正在提取图像特征并组织这次分类结果。"
  },
  warming: {
    eyebrow: "Waking",
    title: "正在连接在线模型服务",
    description: "如果这是服务休眠后的第一次识别，这一步会比平时稍慢一点。"
  }
};

const loadingStageOrder = ["optimizing", "uploading", "analyzing", "warming"];

const quickNotes = [
  {
    title: "流程是完整的",
    description: "上传、抓拍、返回结果，这条线现在已经能顺畅演示。"
  },
  {
    title: "摄像头是可控的",
    description: "可以打开、抓拍、关闭，不会一直占着设备。"
  },
  {
    title: "后面还能接着做",
    description: "等你开始训练模型时，这套前后端还能继续往里接。"
  }
];

const systemBlocks = [
  {
    title: "界面层",
    text: "负责接收图片、调起摄像头和展示结果。"
  },
  {
    title: "服务层",
    text: "负责接收请求，统一返回前端需要的数据格式。"
  },
  {
    title: "模型层",
    text: "当前先用演示分类器，后面可以替换成 YOLO 或自己的模型。"
  }
];

const authorInfo = [
  "学校名称：江苏第二师范学院",
  "所属学院：计算机工程学院",
  "毕业设计题目：基于图像识别的实时垃圾分类检测系统",
  "作者姓名：赵文杰",
  "专业班级：22计科普本",
  "指导教师：钟丽娜"
];

function AppPortfolio() {
  const shellRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const loadingTimersRef = useRef([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState("idle");
  const [error, setError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [serviceMeta, setServiceMeta] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [captureSource, setCaptureSource] = useState("等待输入");
  const [activeFileName, setActiveFileName] = useState("");
  const [lastActionTime, setLastActionTime] = useState("");
  const [resultCycle, setResultCycle] = useState(0);

  useEffect(() => {
    void fetchServiceMeta();
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      releaseCamera(false);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        loadingTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      }
      loadingTimersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frameId = 0;

    function applyDefaults() {
      shell.style.setProperty("--pointer-x", "50%");
      shell.style.setProperty("--pointer-y", "24%");
      shell.style.setProperty("--tilt-x", "0deg");
      shell.style.setProperty("--tilt-y", "0deg");
      shell.style.setProperty("--shift-x", "0px");
      shell.style.setProperty("--shift-y", "0px");
    }

    function updateFromPointer(event) {
      if (!media.matches) {
        return;
      }

      cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        const rect = shell.getBoundingClientRect();
        const relativeX = (event.clientX - rect.left) / rect.width;
        const relativeY = (event.clientY - rect.top) / rect.height;
        const clampedX = Math.min(Math.max(relativeX, 0), 1);
        const clampedY = Math.min(Math.max(relativeY, 0), 1);

        shell.style.setProperty("--pointer-x", `${(clampedX * 100).toFixed(2)}%`);
        shell.style.setProperty("--pointer-y", `${(clampedY * 100).toFixed(2)}%`);
        shell.style.setProperty("--tilt-x", `${((0.5 - clampedY) * 5).toFixed(2)}deg`);
        shell.style.setProperty("--tilt-y", `${((clampedX - 0.5) * 6).toFixed(2)}deg`);
        shell.style.setProperty("--shift-x", `${((clampedX - 0.5) * 14).toFixed(2)}px`);
        shell.style.setProperty("--shift-y", `${((clampedY - 0.5) * 10).toFixed(2)}px`);
      });
    }

    function handleMediaChange() {
      applyDefaults();
    }

    applyDefaults();
    shell.addEventListener("pointermove", updateFromPointer);
    shell.addEventListener("pointerleave", applyDefaults);
    media.addEventListener?.("change", handleMediaChange);

    return () => {
      cancelAnimationFrame(frameId);
      shell.removeEventListener("pointermove", updateFromPointer);
      shell.removeEventListener("pointerleave", applyDefaults);
      media.removeEventListener?.("change", handleMediaChange);
    };
  }, []);

  async function fetchServiceMeta() {
    try {
      const response = await fetch(META_URL);
      if (!response.ok) {
        return;
      }
      setServiceMeta(await response.json());
    } catch {
      setServiceMeta(null);
    }
  }

  function releaseCamera(updateState = true) {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (updateState) {
      setCameraReady(false);
    }
  }

  function stopCamera() {
    releaseCamera(true);
  }

  function recordCaptureMeta(file, sourceLabel) {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setPreviewUrl(URL.createObjectURL(file));
    setCaptureSource(sourceLabel);
    setActiveFileName(file.name);
    setLastActionTime(
      new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(new Date())
    );
  }

  function clearLoadingTimers() {
    if (typeof window !== "undefined") {
      loadingTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    }
    loadingTimersRef.current = [];
  }

  async function sendFile(file) {
    setLoading(true);
    setLoadingStage("uploading");
    setError("");
    setResult(null);
    clearLoadingTimers();

    if (typeof window !== "undefined") {
      loadingTimersRef.current = [
        window.setTimeout(() => {
          setLoadingStage("analyzing");
        }, 320),
        window.setTimeout(() => {
          setLoadingStage("warming");
        }, 2800)
      ];
    }

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(API_URL, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.detail || "识别请求失败，请确认后端是否启动。");
      }

      const payload = await response.json();
      setResult(payload);
      setResultCycle((value) => value + 1);
      void fetchServiceMeta();
    } catch (requestError) {
      setError(requestError.message || "请求异常");
    } finally {
      clearLoadingTimers();
      setLoading(false);
      setLoadingStage("idle");
    }
  }

  async function handleSelectedFile(file, sourceLabel) {
    recordCaptureMeta(file, sourceLabel);
    setLoading(true);
    setLoadingStage("optimizing");
    setError("");
    setResult(null);

    try {
      const optimizedFile = await optimizeImageFile(file);
      await sendFile(optimizedFile);
    } catch {
      await sendFile(file);
    }
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    return void handleSelectedFile(file, "图片上传");
  }

  function handleDragOver(event) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    setDragActive(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }

    return void handleSelectedFile(file, "拖拽上传");
  }

  async function openCamera() {
    setError("");
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "environment"
        },
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraReady(true);
      setCaptureSource("实时摄像头");
    } catch {
      setError("无法打开摄像头，请检查浏览器权限设置。");
    }
  }

  async function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      setError("摄像头画面尚未准备完成。");
      return;
    }

    const scaledSize = getScaledSize(width, height, MAX_CAMERA_DIMENSION);
    canvas.width = scaledSize.width;
    canvas.height = scaledSize.height;

    const context = canvas.getContext("2d");
    if (!context) {
      setError("无法读取摄像头画面。");
      return;
    }

    context.drawImage(video, 0, 0, scaledSize.width, scaledSize.height);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", OPTIMIZED_JPEG_QUALITY)
    );

    if (!blob) {
      setError("抓拍失败，请重试。");
      return;
    }

    const imageFile = new File([blob], "camera-capture-bottle.jpg", {
      type: "image/jpeg"
    });

    recordCaptureMeta(imageFile, "摄像头抓拍");
    return void handleSelectedFile(imageFile, "摄像头抓拍");
  }

  const resultStyle = result ? categoryMeta[result.category] || categoryMeta.其他垃圾 : null;
  const confidencePercent = result ? Math.round(result.confidence * 100) : 0;
  const previewStateClass = loading ? "processing" : result ? "resolved" : "";
  const currentLoadingMeta = loadingStageMeta[loadingStage] || loadingStageMeta.idle;
  const visibleLoadingStages =
    loadingStage === "warming" ? loadingStageOrder : loadingStageOrder.slice(0, 3);
  const currentHost = typeof window !== "undefined" ? window.location.hostname : "";
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const accessHint = currentHost
    ? isLoopbackHost(currentHost)
      ? "同一网络下，其他手机可通过这台电脑的局域网地址访问。"
      : `同一网络下可直接访问 ${currentOrigin}`
    : "";

  return (
    <main ref={shellRef} className="portfolio-shell interactive-shell">
      <div className="ambient-stage" aria-hidden="true">
        <span className="ambient-orb orb-a" />
        <span className="ambient-orb orb-b" />
        <span className="ambient-orb orb-c" />
      </div>

      <header className="portfolio-topbar reveal reveal-1">
        <div className="brand-lockup">
          <span className="brand-mark">GC</span>
          <div>
            <strong>垃圾分类实时检测系统</strong>
            <small>图像识别成果展示页</small>
          </div>
        </div>
        <div className="topbar-note">江苏第二师范学院 · 计算机工程学院</div>
      </header>

      <section className="hero-grid">
        <section className="hero-copy reveal reveal-2">
          <p className="hero-kicker">Waste Sorting Demo</p>
          <h1>把识别过程，放到眼前。</h1>
          <p className="hero-description">
            这版页面更像一块正在工作的展示台。你可以上传图片，也可以临时打开摄像头，
            结果会直接落到界面里，不用堆很多说明，也能把系统状态讲清楚。
          </p>
          <p className="hero-subline">先把演示做漂亮，再把真实模型接进来。</p>

          <div className="hero-tags">
            <span>图片上传</span>
            <span>实时取景</span>
            <span>结果展示</span>
            <span>后续可接 YOLO</span>
          </div>

          {serviceMeta && (
            <div className="meta-board">
              <div>
                <strong>当前模式</strong>
                <span>{serviceMeta.provider}</span>
              </div>
              <div>
                <strong>模型名称</strong>
                <span>{serviceMeta.model_name}</span>
              </div>
              <div>
                <strong>系统状态</strong>
                <span>{serviceMeta.ready ? "已就绪" : "待配置"}</span>
              </div>
            </div>
          )}

          {accessHint && (
            <div className="access-strip">
              <strong>移动端访问</strong>
              <span>{accessHint}</span>
            </div>
          )}
        </section>

        <section className="hero-side reveal reveal-3">
          <div className="hero-panel floating-card">
            <span className="panel-label">现在能演示什么</span>
            <h2>上传、取景、识别、落屏</h2>
            <p>重点不是堆信息，而是让操作和结果都显得自然。</p>
          </div>
          <div className="hero-orbit-card" aria-hidden="true">
            <div className="orbit-core">
              <span>Live</span>
            </div>
            <div className="orbit-labels">
              <span>Upload</span>
              <span>Camera</span>
              <span>Result</span>
            </div>
          </div>
          <div className="hero-mini-grid">
            <div className="hero-mini-card">
              <span className="metric">4 类</span>
              <p>四类垃圾分类结果已经接通展示逻辑</p>
            </div>
            <div className="hero-mini-card highlight">
              <span className="metric">Live</span>
              <p>现场打开摄像头就能直接做抓拍演示</p>
            </div>
          </div>
        </section>
      </section>

      <section className="note-grid">
        {quickNotes.map((card, index) => (
          <article key={card.title} className={`soft-card reveal reveal-${index + 1}`}>
            <span className="soft-card-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3>{card.title}</h3>
            <p>{card.description}</p>
          </article>
        ))}
      </section>

      <section className="workspace-grid">
        <article className="workspace-card input-stage reveal reveal-1">
          <div className="section-head">
            <p className="section-kicker">Input</p>
            <h2>识别输入</h2>
          </div>

          <label
            className={`upload-panel ${dragActive ? "drag-active" : ""}`}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="upload-panel-copy">
              <em className="upload-badge">Drop / Select</em>
              <span>上传垃圾图片</span>
              <small>支持点击选择，也支持把图片直接拖进来。</small>
            </div>
            <div className="upload-panel-orbit" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <input type="file" accept="image/*" onChange={handleFileChange} />
          </label>

          <div className="status-ribbon">
            <span className={`signal-dot ${cameraReady ? "live" : ""}`} />
            <div className="status-ribbon-copy">
              <strong>{cameraReady ? "摄像头已连接" : "当前使用静态图片输入"}</strong>
              <small>{cameraReady ? "可直接抓拍并实时关闭" : "上传图片或打开摄像头开始演示"}</small>
            </div>
            <div className={`status-wave ${cameraReady ? "live" : ""}`} aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>

          <div className="camera-toolbar">
            <button type="button" className="action-btn solid" onClick={openCamera}>
              打开摄像头
            </button>
            <button
              type="button"
              className="action-btn outline"
              onClick={captureFrame}
              disabled={!cameraReady}
            >
              抓拍识别
            </button>
            <button
              type="button"
              className="action-btn ghost"
              onClick={stopCamera}
              disabled={!cameraReady}
            >
              关闭摄像头
            </button>
          </div>

          <div className={`camera-frame ${cameraReady ? "active" : ""}`}>
            <video ref={videoRef} autoPlay playsInline muted />
            {!cameraReady && (
              <div className="camera-placeholder">
                <strong>摄像头未开启</strong>
                <span>打开之后可以直接抓拍，再一键关闭，不会一直占用设备。</span>
              </div>
            )}
            <canvas ref={canvasRef} hidden />
          </div>
        </article>

        <article className="workspace-card preview-stage-panel reveal reveal-2">
          <div className="section-head">
            <p className="section-kicker">Preview</p>
            <h2>图像预览</h2>
          </div>

          {previewUrl ? (
            <div className={`preview-stage ${previewStateClass}`}>
              <img className="preview-image" src={previewUrl} alt="待识别图像" />
              {loading && (
                <div className="processing-hud" data-stage={loadingStage} data-eyebrow={currentLoadingMeta.eyebrow}>
                  <div className="loading-summary">
                    <span>{currentLoadingMeta.eyebrow}</span>
                    <strong>{currentLoadingMeta.title}</strong>
                    <p>{currentLoadingMeta.description}</p>
                  </div>
                  <div className="stage-pill-row">
                    {visibleLoadingStages.map((stage) => {
                      const stageIndex = loadingStageOrder.indexOf(stage);
                      const currentIndex = loadingStageOrder.indexOf(loadingStage);
                      const status =
                        currentIndex > stageIndex ? "done" : currentIndex === stageIndex ? "active" : "";

                      return (
                        <span key={stage} className={`stage-pill ${status}`.trim()}>
                          {loadingStageMeta[stage].eyebrow}
                        </span>
                      );
                    })}
                  </div>
                  <span>正在分析图像</span>
                  <strong>请稍候，系统正在提取分类结果</strong>
                </div>
              )}
              <div className="preview-overlay">
                <span>{captureSource}</span>
                {activeFileName && <strong>{activeFileName}</strong>}
                {lastActionTime && <small>最近更新 {lastActionTime}</small>}
              </div>
            </div>
          ) : (
            <div className="placeholder-panel preview-empty">
              <div className="placeholder-art">
                <div className="placeholder-rings" aria-hidden="true">
                  <span />
                  <span />
                </div>
                <strong>等待一张图像落进画面</strong>
                <p>上传图片或抓拍之后，这里会显示这次输入的内容。</p>
              </div>
            </div>
          )}
        </article>

        <article className="workspace-card result-stage-panel reveal reveal-3">
          <div className="section-head">
            <p className="section-kicker">Result</p>
            <h2>识别结果</h2>
          </div>

          {loading && (
            <div className="placeholder-panel loading-panel" data-stage={loadingStage}>
              <div className="placeholder-art loading-art">
                <div className="loading-summary centered">
                  <span>{currentLoadingMeta.eyebrow}</span>
                  <strong>{currentLoadingMeta.title}</strong>
                  <p>{currentLoadingMeta.description}</p>
                </div>
                <div className="loading-bars" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="stage-pill-row center">
                  {visibleLoadingStages.map((stage) => {
                    const stageIndex = loadingStageOrder.indexOf(stage);
                    const currentIndex = loadingStageOrder.indexOf(loadingStage);
                    const status =
                      currentIndex > stageIndex ? "done" : currentIndex === stageIndex ? "active" : "";

                    return (
                      <span key={stage} className={`stage-pill ${status}`.trim()}>
                        {loadingStageMeta[stage].eyebrow}
                      </span>
                    );
                  })}
                </div>
                <strong>正在识别中</strong>
                <p>系统正在提取图像特征，并组织本次分类结果。</p>
              </div>
            </div>
          )}
          {error && (
            <div className="placeholder-panel error-panel">
              <div className="placeholder-art">
                <strong>这次请求没有成功</strong>
                <p>{error}</p>
              </div>
            </div>
          )}
          {!loading && !error && !result && (
            <div className="placeholder-panel result-empty">
              <div className="placeholder-art">
                <div className="result-empty-badge">Result Pending</div>
                <strong>结果会在这里出现</strong>
                <p>识别完成后，分类类别、置信度和投放建议会一起展示出来。</p>
              </div>
            </div>
          )}

          {result && (
            <div
              key={`${result.item_name}-${resultCycle}`}
              className={`analysis-card fresh ${resultStyle?.className || "other"}`}
            >
              <div className="analysis-aura" aria-hidden="true">
                <span />
                <span />
              </div>
              <div className="analysis-topline">
                <span>识别完成</span>
                <span className={`result-badge ${resultStyle?.className || "other"}`}>
                  <i />
                  {resultStyle?.badge || "默认"}
                </span>
              </div>
              <div className="analysis-chip-row">
                <span>{captureSource}</span>
                <span>{result.source}</span>
                <span>{result.model_name}</span>
              </div>
              <h3>{result.item_name}</h3>
              <div className="analysis-signal">
                <span>{resultStyle?.tone || "默认模式"}</span>
                <strong>{result.category}</strong>
              </div>
              <div className="analysis-metrics">
                <div>
                  <small>垃圾类别</small>
                  <strong>{result.category}</strong>
                </div>
                <div>
                  <small>置信度</small>
                  <strong>{confidencePercent}%</strong>
                </div>
              </div>
              <div className="confidence-meter">
                <div className="confidence-meter-head">
                  <small>识别可信度</small>
                  <span>{confidencePercent}%</span>
                </div>
                <div className="confidence-track">
                  <div
                    className={`confidence-fill ${resultStyle?.className || "other"}`}
                    style={{ width: `${confidencePercent}%` }}
                  />
                </div>
              </div>
              <div className="analysis-block">
                <small>投放建议</small>
                <p>{result.suggestion}</p>
              </div>
              <div className="analysis-footer">
                <span>来源：{result.source}</span>
                <span>模型：{result.model_name}</span>
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="middle-grid">
        <article className="soft-panel structure-panel reveal reveal-1">
          <div className="section-head">
            <p className="section-kicker">Structure</p>
            <h2>现在这个版本已经搭好的部分</h2>
          </div>

          <div className="block-grid">
            {systemBlocks.map((item) => (
              <div key={item.title} className="block-card">
                <strong>{item.title}</strong>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="soft-panel author-panel reveal reveal-2">
          <div className="section-head">
            <p className="section-kicker">Author</p>
            <h2>项目信息</h2>
          </div>

          <ul className="profile-list">
            {authorInfo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <footer className="portfolio-footer reveal reveal-3">
        <div>
          <strong>当前阶段</strong>
          <span>这一版已经适合做过程演示和成果展示，交互也比较完整。</span>
        </div>
        <div>
          <strong>下一步</strong>
          <span>等数据集和模型准备好，我们再把真实识别能力接进来。</span>
        </div>
        <div className="footer-signature">
          <span>Realtime Waste Sorting Demo</span>
          <small>赵文杰 · 江苏第二师范学院</small>
        </div>
      </footer>
    </main>
  );
}

export default AppPortfolio;
