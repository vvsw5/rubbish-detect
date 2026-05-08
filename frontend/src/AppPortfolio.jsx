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
const HISTORY_STORAGE_KEY = "trash-classification-history";
const MAX_HISTORY_ITEMS = 8;
const HISTORY_THUMBNAIL_DIMENSION = 220;
const HISTORY_THUMBNAIL_QUALITY = 0.76;
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

function shouldRevokePreviewUrl(url) {
  return typeof url === "string" && url.startsWith("blob:");
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

function loadImageElementFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve(image);
    };

    image.onerror = () => {
      reject(new Error("Failed to load preview image."));
    };

    image.src = url;
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

async function createHistoryThumbnail(file, options = {}) {
  if (!file.type.startsWith("image/") || typeof document === "undefined") {
    return "";
  }

  const {
    maxDimension = HISTORY_THUMBNAIL_DIMENSION,
    quality = HISTORY_THUMBNAIL_QUALITY
  } = options;

  const image = await loadImageElement(file);
  const scaledSize = getScaledSize(
    image.naturalWidth,
    image.naturalHeight,
    maxDimension
  );

  const canvas = document.createElement("canvas");
  canvas.width = scaledSize.width;
  canvas.height = scaledSize.height;

  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }

  context.drawImage(image, 0, 0, scaledSize.width, scaledSize.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function createHistoryThumbnailFromUrl(url, options = {}) {
  if (!url || typeof document === "undefined") {
    return "";
  }

  const {
    maxDimension = HISTORY_THUMBNAIL_DIMENSION,
    quality = HISTORY_THUMBNAIL_QUALITY
  } = options;

  const image = await loadImageElementFromUrl(url);
  const scaledSize = getScaledSize(
    image.naturalWidth,
    image.naturalHeight,
    maxDimension
  );

  const canvas = document.createElement("canvas");
  canvas.width = scaledSize.width;
  canvas.height = scaledSize.height;

  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }

  context.drawImage(image, 0, 0, scaledSize.width, scaledSize.height);
  return canvas.toDataURL("image/jpeg", quality);
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
    eyebrow: "待命",
    title: "等待新的识别请求",
    description: "选择一张图片，或者打开摄像头抓拍，结果会在这里更新。"
  },
  optimizing: {
    eyebrow: "整理图片",
    title: "正在准备图片",
    description: "系统会先把图片调整到更适合识别的尺寸，让整个过程更顺畅。"
  },
  uploading: {
    eyebrow: "发送中",
    title: "正在提交识别请求",
    description: "图片已经准备完成，正在发送到后端服务。"
  },
  analyzing: {
    eyebrow: "识别中",
    title: "模型正在判断内容",
    description: "系统正在提取图像特征，并生成这次识别结果。"
  },
  warming: {
    eyebrow: "连接中",
    title: "正在唤醒在线服务",
    description: "如果这是久未访问后的第一次识别，等待时间会略长一些。"
  }
};

const loadingStageOrder = ["optimizing", "uploading", "analyzing", "warming"];

const providerLabelMap = {
  yolo: "YOLO 模型",
  mock: "演示模式"
};

const sourceLabelMap = {
  "yolo-inference": "模型识别",
  "mock-rule-engine": "演示规则"
};

function formatProviderLabel(provider) {
  return providerLabelMap[provider] || provider || "未设置";
}

function formatSourceLabel(source) {
  return sourceLabelMap[source] || source || "未知来源";
}

function formatHistoryTime(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

const quickNotes = [
  {
    title: "识别链路已打通",
    description: "上传、抓拍、推理和结果展示已经连成一条完整流程。"
  },
  {
    title: "摄像头按需启用",
    description: "需要时打开，不用时关闭，演示过程会轻松很多。"
  },
  {
    title: "页面还能继续扩展",
    description: "后续替换模型、补充类别或增加历史记录，都可以在这版基础上继续做。"
  }
];

const systemBlocks = [
  {
    title: "交互界面",
    text: "负责图片输入、摄像头调用和结果展示。"
  },
  {
    title: "识别服务",
    text: "负责接收请求，并把模型结果整理成统一的数据格式。"
  },
  {
    title: "模型推理",
    text: "当前已接入 YOLO，后续可以继续替换权重和映射配置。"
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
  const [historyItems, setHistoryItems] = useState([]);

  useEffect(() => {
    void fetchServiceMeta();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setHistoryItems(
          parsed.filter(
            (item) =>
              item &&
              typeof item === "object" &&
              item.result &&
              typeof item.result === "object"
          )
        );
      }
    } catch {
      setHistoryItems([]);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (shouldRevokePreviewUrl(previewUrl)) {
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
    if (shouldRevokePreviewUrl(previewUrl)) {
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

  function persistHistory(nextItems) {
    setHistoryItems(nextItems);

    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextItems));
  }

  function appendHistoryItem(payload, context) {
    if (!context.previewUrl && typeof console !== "undefined") {
      console.warn("History thumbnail missing for entry:", context.fileName);
    }

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      captureSource: context.captureSource,
      fileName: context.fileName,
      previewUrl: context.previewUrl || "",
      result: payload
    };

    setHistoryItems((current) => {
      const nextItems = [entry, ...current].slice(0, MAX_HISTORY_ITEMS);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextItems));
      }

      return nextItems;
    });
  }

  function clearHistory() {
    persistHistory([]);
  }

  function restoreHistoryItem(item) {
    if (item.previewUrl) {
      if (shouldRevokePreviewUrl(previewUrl)) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(item.previewUrl);
    }

    setResult(item.result);
    setCaptureSource(item.captureSource || "历史记录");
    setActiveFileName(item.fileName || "");
    setLastActionTime(formatHistoryTime(item.timestamp));
    setError("");
    setResultCycle((value) => value + 1);
  }

  async function sendFile(file, context) {
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
      appendHistoryItem(payload, context);
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

    let historyPreviewUrl = "";

    const submitContext = {
      captureSource: sourceLabel,
      fileName: file.name,
      previewUrl: historyPreviewUrl
    };

    try {
      const optimizedFile = await optimizeImageFile(file);
      try {
        historyPreviewUrl = await createHistoryThumbnailFromUrl(previewUrl);
      } catch {
        historyPreviewUrl = await createHistoryThumbnail(optimizedFile).catch(() => "");
      }
      submitContext.previewUrl = historyPreviewUrl;
      await sendFile(optimizedFile, submitContext);
    } catch {
      try {
        historyPreviewUrl = await createHistoryThumbnailFromUrl(previewUrl);
      } catch {
        historyPreviewUrl = await createHistoryThumbnail(file).catch(() => "");
      }
      submitContext.previewUrl = historyPreviewUrl;
      await sendFile(file, submitContext);
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
            <small>图像识别交互展示</small>
          </div>
        </div>
        <div className="topbar-note">江苏第二师范学院 · 计算机工程学院</div>
      </header>

      <section className="hero-grid">
        <section className="hero-copy reveal reveal-2">
          <p className="hero-kicker">Image-Based Waste Sorting</p>
          <h1>让识别结果更直观地出现。</h1>
          <p className="hero-description">
            上传图片或打开摄像头之后，系统会在同一界面完成预览、识别和结果反馈。

          </p>
          <p className="hero-subline">当前版本已经接入真实模型，可以直接用于成果展示。</p>

          <div className="hero-copy-refresh">
            <p className="hero-kicker hero-kicker-refresh">Image-Based Waste Sorting</p>
            <h1 className="hero-title-refresh">让识别结果更自然地落下来。</h1>
            <p className="hero-description hero-description-refresh">
              上传图片或打开摄像头之后，画面、结果和提示会顺着同一条节奏展开，不需要再用很多说明去打断它。
            </p>
            <p className="hero-subline hero-subline-refresh">它更像一个会回应你的展示页，而不只是一个功能页面。</p>
          </div>

          <div className="hero-tags">
            <span>图片上传</span>
            <span>摄像头抓拍</span>
            <span>实时反馈</span>
            <span>YOLO 推理</span>
          </div>

          {serviceMeta && (
            <div className="meta-board">
              <div>
                <strong>当前模式</strong>
                <span>{formatProviderLabel(serviceMeta.provider)}</span>
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
            <span className="panel-label">当前体验</span>
            <h2>从输入到结果，一屏完成</h2>
            <p>把操作、状态和识别结果放在同一个节奏里，展示时更直接，也更好讲清楚。</p>
          </div>
          <div className="hero-orbit-card" aria-hidden="true">
            <div className="orbit-core">
              <span>实时</span>
            </div>
            <div className="orbit-labels">
              <span>上传</span>
              <span>抓拍</span>
              <span>结果</span>
            </div>
          </div>
          <div className="hero-mini-grid">
            <div className="hero-mini-card">
              <span className="metric">4 类</span>
              <p>结果会落在可回收物、有害垃圾、厨余垃圾和其他垃圾四类中</p>
            </div>
            <div className="hero-mini-card highlight">
              <span className="metric">抓拍</span>
              <p>现场打开摄像头后，就能立即完成一次识别演示</p>
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
              <em className="upload-badge">点击上传 / 拖拽</em>
              <span>上传待识别图片</span>
              <small>支持点击选择，也支持直接拖入图片。</small>
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
              <strong>{cameraReady ? "摄像头已连接" : "当前使用图片输入"}</strong>
              <small>{cameraReady ? "可以直接抓拍，结束后也能随时关闭" : "上传图片或打开摄像头开始识别"}</small>
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
                <span>打开后可以直接抓拍识别，结束后再一键关闭。</span>
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
                <div className="result-empty-badge">等待结果</div>
                <strong>结果会在这里更新</strong>
                <p>识别完成后，类别、置信度和投放建议会一起显示。</p>
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
                <span>{formatSourceLabel(result.source)}</span>
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
                <span>来源：{formatSourceLabel(result.source)}</span>
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
            <h2>这一版已经完成的部分</h2>
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

        <article className="soft-panel history-panel reveal reveal-2">
          <div className="section-head">
            <p className="section-kicker">History</p>
            <div className="history-heading-row">
              <h2>识别历史记录</h2>
              <button
                type="button"
                className="history-clear-btn"
                onClick={clearHistory}
                disabled={historyItems.length === 0}
              >
                清空记录
              </button>
            </div>
          </div>

          {historyItems.length > 0 ? (
            <div className="history-list">
              {historyItems.map((item) => {
                const itemStyle =
                  categoryMeta[item.result.category] || categoryMeta.鍏朵粬鍨冨溇;
                const itemConfidence = Math.round((item.result.confidence || 0) * 100);

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`history-card ${itemStyle.className}`}
                    onClick={() => restoreHistoryItem(item)}
                  >
                    {item.previewUrl ? (
                      <div className="history-card-preview">
                        <img src={item.previewUrl} alt={item.fileName || item.result.item_name} />
                      </div>
                    ) : (
                      <div className="history-card-preview placeholder" aria-hidden="true">
                        <span>{itemStyle.badge || "记录"}</span>
                      </div>
                    )}
                    <div className="history-card-top">
                      <span>{item.captureSource || "历史记录"}</span>
                      <strong>{formatHistoryTime(item.timestamp)}</strong>
                    </div>
                    <div className="history-card-main">
                      <h3>{item.result.item_name}</h3>
                      <span className={`result-badge ${itemStyle.className}`}>
                        <i />
                        {itemStyle.badge || "默认"}
                      </span>
                    </div>
                    <div className="history-card-meta">
                      <span>{item.result.category}</span>
                      <span>{itemConfidence}%</span>
                      <span>{formatSourceLabel(item.result.source)}</span>
                    </div>
                    {item.fileName && <p>{item.fileName}</p>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="history-empty">
              <strong>还没有识别记录</strong>
              <p>完成一次识别后，结果会自动保留在这里，方便回看和展示。</p>
            </div>
          )}
        </article>

        <article className="soft-panel author-panel reveal reveal-3">
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
          <strong>当前状态</strong>
          <span>这一版已经可以稳定完成识别演示，适合用于成果展示。</span>
        </div>
        <div>
          <strong>后续方向</strong>
          <span>后面还可以继续补充类别、优化模型和完善历史记录。</span>
        </div>
        <div className="footer-copy-card">
          <strong>当前状态</strong>
          <span>这一版已经可以把识别过程完整地呈现出来，安静但清楚，适合直接拿来展示。</span>
        </div>
        <div className="footer-copy-card">
          <strong>后续方向</strong>
          <span>接下来会继续把细节磨得更顺一点，让它看起来更轻松，也更耐看。</span>
        </div>
        <div className="footer-signature">
          <span>Image-Based Waste Sorting</span>
          <small>赵文杰 · 江苏第二师范学院</small>
        </div>
      </footer>
    </main>
  );
}

export default AppPortfolio;
