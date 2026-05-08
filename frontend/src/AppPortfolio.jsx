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
const FEEDBACK_URL = `${API_BASE_URL}/api/feedback`;
const HISTORY_STORAGE_KEY = "trash-classification-history";
const MAX_HISTORY_ITEMS = 8;
const FEEDBACK_FETCH_LIMIT = 12;
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

const categoryOptions = [
  "\u53ef\u56de\u6536\u7269",
  "\u6709\u5bb3\u5783\u573e",
  "\u53a8\u4f59\u5783\u573e",
  "\u5176\u4ed6\u5783\u573e"
];

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

function formatFeedbackStatus(userFeedback) {
  return userFeedback === "wrong"
    ? "\u5df2\u4fee\u6b63"
    : "\u8bc6\u522b\u6b63\u786e";
}

function normalizeLookupText(value) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "");
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

const disposalGuideSections = [
  {
    category: "可回收物",
    eyebrow: "循环再生",
    summary: "材质相对单一、具备再利用价值的生活废弃物，适合进入回收体系。",
    requirements: [
      "投放前尽量保持干燥、洁净，避免被厨余和油污污染。",
      "纸箱、塑料瓶、金属罐可压扁或折叠后投放，节省回收空间。",
      "带有不同材质附件的物品，优先拆分后分别处理。"
    ],
    examples: [
      "报纸书本、纸箱、快递纸袋",
      "塑料瓶、饮料罐、洗净玻璃瓶",
      "旧衣物、金属衣架、小家电外壳"
    ],
    cautions: [
      "被严重污染的纸巾、餐盒通常不再按可回收物处理。",
      "陶瓷、镜子、耐热玻璃多数地区不进入普通玻璃回收渠道。"
    ]
  },
  {
    category: "有害垃圾",
    eyebrow: "单独投放",
    summary: "含有重金属、腐蚀性或潜在有毒成分，需要进入专门回收流程。",
    requirements: [
      "尽量保持原包装或做好密封，防止渗漏、挥发和二次污染。",
      "破损灯管、温度计等易碎物应先包裹，再投放到指定点位。",
      "不要与普通生活垃圾混装，更不要投入厨余或可回收桶。"
    ],
    examples: [
      "废旧电池、纽扣电池、充电电池",
      "过期药品、药剂包装、废弃消毒剂",
      "灯管灯泡、油漆桶、杀虫剂容器"
    ],
    cautions: [
      "不同地区对荧光灯、指甲油、染发剂的归类可能略有差异。",
      "发现泄漏时应先做好个人防护，再联系物业或专门回收点处理。"
    ]
  },
  {
    category: "厨余垃圾",
    eyebrow: "湿垃圾处理",
    summary: "容易腐烂的有机废弃物，可用于堆肥、厌氧发酵等资源化利用。",
    requirements: [
      "投放前先沥干明显水分，并去掉塑料袋、餐具等非食材包装。",
      "尽量保持内容纯净，以剩饭剩菜、果皮菜叶等可腐有机物为主。",
      "如果使用专用厨余袋，应确认当地是否允许连袋投放。"
    ],
    examples: [
      "剩饭剩菜、果皮菜叶、茶渣咖啡渣",
      "蛋壳、果核、面包糕点、过期食品",
      "家庭做饭产生的边角料和净菜残渣"
    ],
    cautions: [
      "大棒骨、贝壳、椰子壳等硬质残渣在部分地区按其他垃圾处理。",
      "混入塑料包装和纸巾会明显影响后续资源化处理效果。"
    ]
  },
  {
    category: "其他垃圾",
    eyebrow: "兜底分类",
    summary: "不属于前三类、且暂时难以回收利用的生活废弃物，作为末端兜底处理。",
    requirements: [
      "尽量装袋投放，减少散落和异味扩散，保持投放点整洁。",
      "带尖锐边角的物品先包裹后投放，避免划伤清运人员。",
      "如果物品已被油污、血污或强污染覆盖，通常应按其他垃圾处理。"
    ],
    examples: [
      "纸巾、湿巾、一次性餐具、烟头",
      "陶瓷碎片、灰土、猫砂、尘土",
      "尿不湿、受污染包装袋、难回收复合材料"
    ],
    cautions: [
      "可回收物一旦被污染严重，往往会转入其他垃圾处理。",
      "不同城市对榴莲壳、粽叶、宠物粪便等项目的细分要求可能不同。"
    ]
  }
];

const categoryLookupEntries = [
  {
    name: "塑料瓶",
    aliases: ["矿泉水瓶", "饮料瓶", "瓶子", "pet瓶"],
    category: "可回收物",
    suggestion: "请尽量清空残液、简单压扁后投入可回收物。"
  },
  {
    name: "旧鞋",
    aliases: ["鞋子", "旧运动鞋", "旧皮鞋"],
    category: "可回收物",
    suggestion: "鞋类较完整时可优先考虑捐赠，无法再使用时投入可回收物。"
  },
  {
    name: "纸箱",
    aliases: ["快递箱", "纸盒", "纸板箱"],
    category: "可回收物",
    suggestion: "请压平、保持干燥后投入可回收物，减少占用空间。"
  },
  {
    name: "玻璃瓶",
    aliases: ["酒瓶", "酱油瓶", "罐头瓶"],
    category: "可回收物",
    suggestion: "清洗后投入可回收物，破损时注意包裹防止划伤。"
  },
  {
    name: "旧衣物",
    aliases: ["旧衣服", "衣物", "外套"],
    category: "可回收物",
    suggestion: "干净完整的衣物可优先捐赠或回收，受污染严重时再按其他垃圾处理。"
  },
  {
    name: "电池",
    aliases: ["干电池", "纽扣电池", "充电电池"],
    category: "有害垃圾",
    suggestion: "请单独收集并投放到有害垃圾点位，避免挤压和高温暴晒。"
  },
  {
    name: "过期药品",
    aliases: ["药片", "胶囊", "药物"],
    category: "有害垃圾",
    suggestion: "保持原包装或密封后投入有害垃圾，不要冲入下水道。"
  },
  {
    name: "灯管",
    aliases: ["荧光灯", "节能灯", "日光灯"],
    category: "有害垃圾",
    suggestion: "易碎灯管请先包裹固定，再交由有害垃圾回收点处理。"
  },
  {
    name: "油漆桶",
    aliases: ["涂料桶", "油漆罐"],
    category: "有害垃圾",
    suggestion: "残留油漆和挥发性物质较强，建议密封后按有害垃圾投放。"
  },
  {
    name: "果皮",
    aliases: ["水果皮", "香蕉皮", "苹果皮"],
    category: "厨余垃圾",
    suggestion: "沥干水分并去除塑料袋后投入厨余垃圾。"
  },
  {
    name: "剩饭剩菜",
    aliases: ["剩饭", "剩菜", "饭菜"],
    category: "厨余垃圾",
    suggestion: "请沥干明显汤汁，避免混入餐盒、筷子等杂物。"
  },
  {
    name: "茶叶渣",
    aliases: ["茶渣", "咖啡渣"],
    category: "厨余垃圾",
    suggestion: "这类有机残渣适合投入厨余垃圾，便于后续资源化利用。"
  },
  {
    name: "蛋壳",
    aliases: ["鸡蛋壳", "鸭蛋壳"],
    category: "厨余垃圾",
    suggestion: "蛋壳可作为厨余垃圾处理，投放前简单沥干即可。"
  },
  {
    name: "纸巾",
    aliases: ["餐巾纸", "面巾纸", "卫生纸"],
    category: "其他垃圾",
    suggestion: "使用后的纸巾纤维短且易污染，通常按其他垃圾处理。"
  },
  {
    name: "陶瓷碎片",
    aliases: ["陶瓷", "碗碟碎片", "杯子碎片"],
    category: "其他垃圾",
    suggestion: "请先包裹好尖锐边缘，再投入其他垃圾，避免划伤清运人员。"
  },
  {
    name: "湿巾",
    aliases: ["消毒湿巾", "一次性湿巾"],
    category: "其他垃圾",
    suggestion: "湿巾不宜回收也不适合厨余处理，请投入其他垃圾。"
  },
  {
    name: "尿不湿",
    aliases: ["纸尿裤", "尿布"],
    category: "其他垃圾",
    suggestion: "请装袋密封后投入其他垃圾，减少异味扩散。"
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
  const guideSectionRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const guideCardRefs = useRef({});
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
  const [activeGuideCategory, setActiveGuideCategory] = useState("");
  const [lookupKeyword, setLookupKeyword] = useState("");
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupTouched, setLookupTouched] = useState(false);
  const [currentImageId, setCurrentImageId] = useState("");
  const [feedbackRecords, setFeedbackRecords] = useState([]);
  const [feedbackSummary, setFeedbackSummary] = useState({
    total: 0,
    correct: 0,
    wrong: 0,
    latest_at: ""
  });
  const [feedbackHistoryLoading, setFeedbackHistoryLoading] = useState(false);
  const [feedbackHistoryError, setFeedbackHistoryError] = useState("");
  const [feedbackState, setFeedbackState] = useState({
    status: "idle",
    mode: "",
    correctedCategory: "",
    message: ""
  });

  useEffect(() => {
    void fetchServiceMeta();
    void fetchFeedbackHistory();
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
    if (!result?.category) {
      return;
    }

    focusGuideCategory(result.category, { behavior: "smooth", block: "start" });
  }, [resultCycle]);

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

  async function fetchFeedbackHistory() {
    setFeedbackHistoryLoading(true);
    setFeedbackHistoryError("");

    try {
      const response = await fetch(`${FEEDBACK_URL}?limit=${FEEDBACK_FETCH_LIMIT}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => null);
        throw new Error(errorPayload?.detail || "\u53cd\u9988\u8bb0\u5f55\u52a0\u8f7d\u5931\u8d25");
      }

      const payload = await response.json();
      setFeedbackRecords(Array.isArray(payload?.items) ? payload.items : []);
      setFeedbackSummary({
        total: payload?.summary?.total || 0,
        correct: payload?.summary?.correct || 0,
        wrong: payload?.summary?.wrong || 0,
        latest_at: payload?.summary?.latest_at || ""
      });
    } catch (fetchError) {
      setFeedbackHistoryError(
        fetchError.message || "\u53cd\u9988\u8bb0\u5f55\u52a0\u8f7d\u5931\u8d25"
      );
    } finally {
      setFeedbackHistoryLoading(false);
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

  function registerGuideCard(category, node) {
    if (!category) {
      return;
    }

    if (node) {
      guideCardRefs.current[category] = node;
      return;
    }

    delete guideCardRefs.current[category];
  }

  function focusGuideCategory(category, options = {}) {
    if (!category) {
      return;
    }

    setActiveGuideCategory(category);

    const card = guideCardRefs.current[category];
    const section = guideSectionRef.current;
    const scrollTarget = card || section;

    if (scrollTarget && typeof scrollTarget.scrollIntoView === "function") {
      scrollTarget.scrollIntoView({
        behavior: options.behavior || "smooth",
        block: options.block || "nearest"
      });
    }
  }

  function runCategoryLookup(event) {
    event?.preventDefault?.();

    const normalizedKeyword = normalizeLookupText(lookupKeyword);
    setLookupTouched(true);

    if (!normalizedKeyword) {
      setLookupResult(null);
      return;
    }

    const match = categoryLookupEntries.find((entry) => {
      const candidates = [entry.name, ...(entry.aliases || [])].map(normalizeLookupText);
      return candidates.some(
        (candidate) =>
          candidate.includes(normalizedKeyword) || normalizedKeyword.includes(candidate)
      );
    });

    if (!match) {
      setLookupResult({
        status: "empty",
        keyword: lookupKeyword.trim()
      });
      return;
    }

    const guideDetail =
      disposalGuideSections.find((section) => section.category === match.category) || null;

    setLookupResult({
      status: "match",
      ...match,
      guideDetail
    });
  }

  async function submitFeedback(payload) {
    const response = await fetch(FEEDBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      throw new Error(errorPayload?.detail || "\u53cd\u9988\u63d0\u4ea4\u5931\u8d25");
    }

    return response.json();
  }

  async function handleFeedback(mode) {
    if (!result || !currentImageId) {
      return;
    }

    if (mode === "wrong") {
      setFeedbackState((current) => ({
        ...current,
        mode: "wrong",
        status: "selecting",
        message: ""
      }));
      return;
    }

    setFeedbackState((current) => ({
      ...current,
      status: "submitting",
      mode: "correct",
      message: ""
    }));

    try {
      await submitFeedback({
        image_id: currentImageId,
        original_result: result,
        user_feedback: "correct",
        corrected_category: null,
        capture_source: captureSource || null,
        file_name: activeFileName || null,
        timestamp: new Date().toISOString()
      });

      setFeedbackState({
        status: "success",
        mode: "correct",
        correctedCategory: "",
        message:
          "\u611f\u8c22\u53cd\u9988\uff0c\u7cfb\u7edf\u5df2\u8bb0\u5f55\u8fd9\u6b21\u6b63\u786e\u8bc6\u522b\u3002"
      });
      void fetchFeedbackHistory();
    } catch (feedbackError) {
      setFeedbackState((current) => ({
        ...current,
        status: "error",
        message: feedbackError.message || "\u53cd\u9988\u63d0\u4ea4\u5931\u8d25"
      }));
    }
  }

  async function handleWrongFeedbackSubmit() {
    if (!result || !currentImageId || !feedbackState.correctedCategory) {
      return;
    }

    setFeedbackState((current) => ({
      ...current,
      status: "submitting",
      message: ""
    }));

    try {
      await submitFeedback({
        image_id: currentImageId,
        original_result: result,
        user_feedback: "wrong",
        corrected_category: feedbackState.correctedCategory,
        capture_source: captureSource || null,
        file_name: activeFileName || null,
        timestamp: new Date().toISOString()
      });

      setFeedbackState({
        status: "success",
        mode: "wrong",
        correctedCategory: "",
        message:
          "\u611f\u8c22\u53cd\u9988\uff0c\u7cfb\u7edf\u5df2\u8bb0\u5f55\u4f60\u63d0\u4f9b\u7684\u6b63\u786e\u7c7b\u522b\u3002"
      });
      void fetchFeedbackHistory();
    } catch (feedbackError) {
      setFeedbackState((current) => ({
        ...current,
        status: "error",
        message: feedbackError.message || "\u53cd\u9988\u63d0\u4ea4\u5931\u8d25"
      }));
    }
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
    setCurrentImageId("");
    setFeedbackState({
      status: "idle",
      mode: "",
      correctedCategory: "",
      message: ""
    });
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
      setCurrentImageId(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      setFeedbackState({
        status: "idle",
        mode: "",
        correctedCategory: "",
        message: ""
      });
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
              <button
                type="button"
                className="guide-link-btn"
                onClick={() => focusGuideCategory(result.category, { behavior: "smooth", block: "start" })}
              >
                查看详细投放指南
              </button>
              <div className="feedback-panel">
                <div className="feedback-panel-copy">
                  <small>\u8bc6\u522b\u7ed3\u679c\u53cd\u9988</small>
                  <p>
                    {
                      "\u544a\u8bc9\u7cfb\u7edf\u8fd9\u6b21\u8bc6\u522b\u662f\u5426\u6b63\u786e\uff0c\u4e3a\u540e\u7eed\u4f18\u5316\u79ef\u7d2f\u771f\u5b9e\u53cd\u9988\u6570\u636e\u3002"
                    }
                  </p>
                </div>
                <div className="feedback-action-row">
                  <button
                    type="button"
                    className="feedback-btn positive"
                    onClick={() => handleFeedback("correct")}
                    disabled={!currentImageId || feedbackState.status === "submitting"}
                  >
                    {"\u6b63\u786e"}
                  </button>
                  <button
                    type="button"
                    className="feedback-btn negative"
                    onClick={() => handleFeedback("wrong")}
                    disabled={!currentImageId || feedbackState.status === "submitting"}
                  >
                    {"\u9519\u8bef"}
                  </button>
                </div>

                {feedbackState.mode === "wrong" && feedbackState.status !== "success" && (
                  <div className="feedback-correction-box">
                    <label className="feedback-select-field">
                      <span>{"\u8bf7\u9009\u62e9\u6b63\u786e\u7c7b\u522b"}</span>
                      <select
                        value={feedbackState.correctedCategory}
                        onChange={(event) =>
                          setFeedbackState((current) => ({
                            ...current,
                            correctedCategory: event.target.value,
                            message: ""
                          }))
                        }
                      >
                        <option value="">{"\u8bf7\u9009\u62e9"}</option>
                        {categoryOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="feedback-submit-row">
                      <button
                        type="button"
                        className="feedback-submit-btn"
                        onClick={handleWrongFeedbackSubmit}
                        disabled={
                          feedbackState.status === "submitting" ||
                          !feedbackState.correctedCategory
                        }
                      >
                        {"\u63d0\u4ea4\u4fee\u6b63\u7c7b\u522b"}
                      </button>
                    </div>
                  </div>
                )}

                {feedbackState.message && (
                  <div className={`feedback-status ${feedbackState.status}`}>
                    {feedbackState.message}
                  </div>
                )}
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
                  categoryMeta[item.result.category] || categoryMeta["其他垃圾"];
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

      <section className="feedback-board-panel reveal reveal-2">
        <div className="section-head feedback-board-head">
          <div>
            <p className="section-kicker">Feedback</p>
            <h2>识别反馈记录</h2>
          </div>
          <button
            type="button"
            className="feedback-board-refresh-btn"
            onClick={() => void fetchFeedbackHistory()}
            disabled={feedbackHistoryLoading}
          >
            {feedbackHistoryLoading ? "\u5237\u65b0\u4e2d" : "\u5237\u65b0\u8bb0\u5f55"}
          </button>
        </div>

        <p className="feedback-board-intro">
          {
            "\u628a\u6bcf\u6b21\u201c\u6b63\u786e\u201d\u6216\u201c\u9519\u8bef\u4fee\u6b63\u201d\u7684\u53cd\u9988\u6c89\u6dc0\u4e0b\u6765\uff0c\u65b9\u4fbf\u540e\u7eed\u68c0\u67e5\u8bc6\u522b\u8868\u73b0\uff0c\u4e5f\u4e3a\u6a21\u578b\u4f18\u5316\u79ef\u7d2f\u771f\u5b9e\u6570\u636e\u3002"
          }
        </p>

        <div className="feedback-summary-grid">
          <article className="feedback-summary-card">
            <small>{"\u7d2f\u8ba1\u53cd\u9988"}</small>
            <strong>{feedbackSummary.total}</strong>
            <span>{"\u5df2\u8bb0\u5f55\u5230\u672c\u5730\u53cd\u9988\u5e93"}</span>
          </article>
          <article className="feedback-summary-card">
            <small>{"\u786e\u8ba4\u6b63\u786e"}</small>
            <strong>{feedbackSummary.correct}</strong>
            <span>{"\u8bf4\u660e\u7cfb\u7edf\u7ed3\u679c\u88ab\u7528\u6237\u76f4\u63a5\u63a5\u53d7"}</span>
          </article>
          <article className="feedback-summary-card">
            <small>{"\u9519\u8bef\u4fee\u6b63"}</small>
            <strong>{feedbackSummary.wrong}</strong>
            <span>{"\u8fd9\u4e9b\u8bb0\u5f55\u53ef\u7528\u4e8e\u540e\u7eed\u7cbe\u8c03\u548c\u6807\u6ce8"}</span>
          </article>
          <article className="feedback-summary-card wide">
            <small>{"\u6700\u65b0\u53cd\u9988"}</small>
            <strong>
              {feedbackSummary.latest_at
                ? formatHistoryTime(feedbackSummary.latest_at)
                : "\u6682\u65e0\u8bb0\u5f55"}
            </strong>
            <span>{"\u6700\u65b0\u4e00\u6761\u53cd\u9988\u5199\u5165\u7684\u65f6\u95f4"}</span>
          </article>
        </div>

        {feedbackHistoryError && (
          <div
            className={`feedback-record-empty ${feedbackRecords.length ? "compact" : ""}`.trim()}
          >
            <strong>{"\u53cd\u9988\u8bb0\u5f55\u6682\u65f6\u6ca1\u52a0\u8f7d\u6210\u529f"}</strong>
            <p>{feedbackHistoryError}</p>
          </div>
        )}

        {feedbackHistoryLoading && (
          <div
            className={`feedback-record-empty ${feedbackRecords.length ? "compact" : ""}`.trim()}
          >
            <strong>{"\u6b63\u5728\u8bfb\u53d6\u6700\u8fd1\u7684\u53cd\u9988\u8bb0\u5f55"}</strong>
            <p>
              {
                "\u7cfb\u7edf\u6b63\u5728\u4ece\u672c\u5730\u53cd\u9988\u5b58\u50a8\u4e2d\u6574\u7406\u6700\u65b0\u6570\u636e\u3002"
              }
            </p>
          </div>
        )}

        {feedbackRecords.length > 0 && (
          <div className="feedback-record-list">
            {feedbackRecords.map((item) => {
              const targetCategory = item.corrected_category || item.original_result.category;
              const itemStyle =
                categoryMeta[targetCategory] || categoryMeta["其他垃圾"];
              const itemStatusClass = item.user_feedback === "wrong" ? "wrong" : "correct";

              return (
                <article
                  key={item.feedback_id}
                  className={`feedback-record-card ${itemStyle.className}`}
                >
                  <div className="feedback-record-topline">
                    <span className={`feedback-record-status ${itemStatusClass}`}>
                      {formatFeedbackStatus(item.user_feedback)}
                    </span>
                    <strong>{formatHistoryTime(item.saved_at || item.timestamp)}</strong>
                  </div>

                  <div className="feedback-record-main">
                    <div>
                      <h3>{item.original_result.item_name}</h3>
                      <p>
                        {item.file_name ||
                          item.capture_source ||
                          "\u672c\u6b21\u8bc6\u522b\u53cd\u9988"}
                      </p>
                    </div>
                    <span className={`result-badge ${itemStyle.className}`}>
                      <i />
                      {itemStyle.badge || targetCategory}
                    </span>
                  </div>

                  <div className="feedback-record-flow">
                    <span>
                      {"\u539f\u8bc6\u522b\uff1a"}
                      {item.original_result.category}
                    </span>
                    <span>
                      {item.user_feedback === "wrong"
                        ? `\u4fee\u6b63\u4e3a\uff1a${item.corrected_category}`
                        : "\u7528\u6237\u5df2\u786e\u8ba4\u8be5\u7ed3\u679c\u6b63\u786e"}
                    </span>
                  </div>

                  <div className="feedback-record-note">
                    <small>{"\u6295\u653e\u5efa\u8bae"}</small>
                    <p>{item.original_result.suggestion}</p>
                  </div>

                  <div className="feedback-record-actions">
                    <span>
                      {(item.capture_source || "\u4e0a\u4f20\u8bc6\u522b") +
                        " · " +
                        formatSourceLabel(item.original_result.source)}
                    </span>
                    <button
                      type="button"
                      className="feedback-guide-btn"
                      onClick={() =>
                        focusGuideCategory(targetCategory, {
                          behavior: "smooth",
                          block: "start"
                        })
                      }
                    >
                      {"\u8054\u52a8\u67e5\u770b\u6295\u653e\u6307\u5357"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!feedbackHistoryLoading && !feedbackHistoryError && feedbackRecords.length === 0 && (
          <div className="feedback-record-empty">
            <strong>{"\u8fd8\u6ca1\u6709\u53cd\u9988\u8bb0\u5f55"}</strong>
            <p>
              {
                "\u5b8c\u6210\u4e00\u6b21\u8bc6\u522b\u540e\uff0c\u70b9\u51fb\u201c\u6b63\u786e\u201d\u6216\u201c\u9519\u8bef\u201d\u63d0\u4ea4\u53cd\u9988\uff0c\u8fd9\u91cc\u5c31\u4f1a\u5f00\u59cb\u7d2f\u79ef\u53ef\u56de\u770b\u7684\u6570\u636e\u3002"
              }
            </p>
          </div>
        )}
      </section>

      <section ref={guideSectionRef} className="guide-library-panel reveal reveal-1">
        <div className="section-head guide-library-head">
          <div>
            <p className="section-kicker">Guide</p>
            <h2>投放指南知识库</h2>
          </div>
          <p className="guide-library-intro">围绕四类垃圾整理投放要求、常见物品和注意事项，既能配合识别结果讲清楚，也方便单独查阅。</p>
        </div>

        <section className="guide-search-shell">
          <div className="guide-search-copy">
            <p className="section-kicker">Lookup</p>
            <h3>垃圾分类查询</h3>
            <p>输入物品名称或常见叫法，系统会直接从本地知识库返回垃圾类别与投放建议。</p>
          </div>

          <form className="guide-search-form" onSubmit={runCategoryLookup}>
            <label className="guide-search-field">
              <span>关键词</span>
              <input
                type="text"
                value={lookupKeyword}
                onChange={(event) => setLookupKeyword(event.target.value)}
                placeholder="例如：电池、纸箱、果皮、旧鞋"
              />
            </label>
            <button type="submit" className="guide-search-btn">
              立即查询
            </button>
          </form>

          {lookupResult?.status === "match" && (
            <div className={`lookup-result-card ${categoryMeta[lookupResult.category]?.className || "other"}`}>
              <div className="lookup-result-topline">
                <span>查询结果</span>
                <span className={`result-badge ${categoryMeta[lookupResult.category]?.className || "other"}`}>
                  <i />
                  {categoryMeta[lookupResult.category]?.badge || lookupResult.category}
                </span>
              </div>
              <div className="lookup-result-main">
                <div>
                  <small>名称</small>
                  <strong>{lookupResult.name}</strong>
                </div>
                <div>
                  <small>类别</small>
                  <strong>{lookupResult.category}</strong>
                </div>
              </div>
              <div className="lookup-result-suggestion">
                <small>投放建议</small>
                <p>{lookupResult.suggestion}</p>
              </div>
              <div className="lookup-result-actions">
                <button
                  type="button"
                  className="lookup-guide-btn"
                  onClick={() => focusGuideCategory(lookupResult.category, { behavior: "smooth", block: "start" })}
                >
                  联动查看投放指南
                </button>
                {lookupResult.guideDetail && (
                  <span>常见物品：{lookupResult.guideDetail.examples.slice(0, 2).join("、")}</span>
                )}
              </div>
            </div>
          )}

          {lookupResult?.status === "empty" && (
            <div className="lookup-empty-state">
              <strong>暂时没有查到这个关键词</strong>
              <p>你可以换个更常见的叫法试试，例如“饮料瓶”“纸箱”“电池”“果皮”。</p>
            </div>
          )}

          {!lookupResult && lookupTouched && !normalizeLookupText(lookupKeyword) && (
            <div className="lookup-empty-state subtle">
              <strong>先输入一个关键词再查询</strong>
              <p>这个查询功能走的是本地知识库，不依赖识别模型，所以适合快速查规则。</p>
            </div>
          )}
        </section>

        <div className="guide-library-grid">
          {disposalGuideSections.map((section, index) => {
            const guideStyle = categoryMeta[section.category] || categoryMeta["其他垃圾"];
            const isActive = activeGuideCategory === section.category;

            return (
              <article
                key={section.category}
                ref={(node) => registerGuideCard(section.category, node)}
                className={`guide-card ${guideStyle.className} ${isActive ? "active" : ""} reveal reveal-${(index % 3) + 1}`.trim()}
              >
                <div className="guide-card-topline">
                  <span>{section.eyebrow}</span>
                  <span className={`result-badge ${guideStyle.className}`}>
                    <i />
                    {guideStyle.badge || section.category}
                  </span>
                </div>
                <h3>{section.category}</h3>
                <p className="guide-card-summary">{section.summary}</p>

                <div className="guide-card-block">
                  <small>投放要求</small>
                  <ul className="guide-list">
                    {section.requirements.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="guide-card-block">
                  <small>常见物品</small>
                  <div className="guide-chip-row">
                    {section.examples.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </div>

                <div className="guide-card-block caution">
                  <small>注意事项</small>
                  <ul className="guide-list compact">
                    {section.cautions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </article>
            );
          })}
        </div>
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
