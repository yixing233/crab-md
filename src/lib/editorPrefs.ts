/**
 * 编辑器展示偏好（UI_DESIGN_SYSTEM.md §34「编辑器」分组）。
 *
 * 与 `theme.ts` / `viewMode.ts` 同样放 localStorage：这些是**纯客户端展示偏好**，
 * 同步读写可避免主题/字体闪烁；而数据目录必须放后端 settings.json，
 * 因为后端启动时就要知道去哪个目录开库。
 *
 * 本模块只负责「值 + 校验 + 写入」。持有状态的是 App（见 App.tsx）——
 * 若由设置页自持，就必须先打开过设置页才生效，重启即回到默认值。
 */

// ---------------------------------------------------------------------------
// 字号
// ---------------------------------------------------------------------------

export type EditorFontSize = "sm" | "md" | "lg" | "xl";

export const EDITOR_FONT_SIZES: readonly EditorFontSize[] = ["sm", "md", "lg", "xl"] as const;

export const FONT_SIZE_KEY = "crab-md.editor-font-size";

export const DEFAULT_FONT_SIZE: EditorFontSize = "md";

/**
 * 每档对应的实际像素值。落在 §7 字号刻度内。
 *
 * 最大档给到 18px：汉字笔画密度远高于拉丁字母，同样字号下中文更「小」，
 * 只到 16px 时大屏用户普遍会觉得偏小。
 */
export const FONT_SIZE_PX: Record<EditorFontSize, number> = {
  sm: 13,
  md: 14,
  lg: 16,
  xl: 18,
};

/** 校验并读取已存储的字号；非法或缺失时回退默认值。 */
export function readStoredFontSize(raw: string | null): EditorFontSize {
  return raw === "sm" || raw === "md" || raw === "lg" || raw === "xl" ? raw : DEFAULT_FONT_SIZE;
}

/**
 * 把字号写到 `<html>` 上的 CSS 变量。
 *
 * 用变量而不是直接改样式：CodeMirror 的 theme 已经读 `var(--editor-font-size)`，
 * 因此切换字号不需要重建编辑器实例（重建会丢光标与撤销历史）。
 */
export function applyFontSize(size: EditorFontSize): void {
  if (typeof document === "undefined") return;
  // 非法值回退默认，绝不让 undefined/NaN 写进 CSS 变量。
  const px = FONT_SIZE_PX[size] ?? FONT_SIZE_PX[DEFAULT_FONT_SIZE];
  document.documentElement.style.setProperty("--editor-font-size", `${px}px`);
}

// ---------------------------------------------------------------------------
// 字体
// ---------------------------------------------------------------------------

/**
 * 可选的**具体字体**。
 *
 * 早先这里是三个抽象类别（无衬线 / 衬线 / 等宽），但那对中文用户没有意义：
 * 中文的「衬线/无衬线」差别远不如换一款字体直观，用户想的是
 * 「我要用宋体」而不是「我要用衬线体」。
 *
 * 因此改为按字体名列出，与用户在 Word / 记事本里看到的一致。
 */
export type EditorFontFamily =
  | "system"
  | "yahei"
  | "simhei"
  | "simsun"
  | "kaiti"
  | "fangsong"
  | "times"
  | "mono";

export const EDITOR_FONT_FAMILIES: readonly EditorFontFamily[] = [
  "system",
  "yahei",
  "simhei",
  "simsun",
  "kaiti",
  "fangsong",
  "times",
  "mono",
] as const;

export const FONT_FAMILY_KEY = "crab-md.editor-font-family";

export const DEFAULT_FONT_FAMILY: EditorFontFamily = "system";

/**
 * 字体栈。
 *
 * §34.6 要求每个栈都显式命名 CJK 字体：只写 `serif` / `sans-serif` 时中文会
 * 回退到系统默认字体，用户看到的「没变化」其实是设置失效。因此每个栈都
 * 把具体字体名写在前面，再以通用族兜底。
 *
 * 字体缺失时**不需要**检测：CSS 会沿栈继续找下一个可用字体，
 * 这是浏览器原生行为，比拼字体可用性更可靠。
 * （实测 `System.Drawing` 的字体枚举会漏报 SimSun/SimHei，不可作为依据。）
 */
export const FONT_FAMILY_STACK: Record<EditorFontFamily, string> = {
  /** 跟随系统 UI 字体，不指定具体字体。 */
  system:
    'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", Roboto, sans-serif',

  /** 微软雅黑：Windows 默认中文界面字体，屏幕显示最清晰。 */
  yahei:
    '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", sans-serif',

  /** 黑体：笔画粗细均匀，适合标题与需要突出显示的正文。 */
  simhei:
    'SimHei, "Heiti SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei UI", sans-serif',

  /** 宋体：正文衬线体，长文阅读最常用。放在最前，Latin 也走宋体自带的字形。 */
  simsun: 'SimSun, NSimSun, "Songti SC", "Noto Serif SC", "Source Han Serif SC", serif',

  /** 楷体：手写笔意，适合散文、引用等需要「温和」语气的段落。 */
  kaiti: 'KaiTi, "Kaiti SC", STKaiti, "Noto Serif SC", serif',

  /** 仿宋：公文与正式文稿的常用字体。 */
  fangsong: 'FangSong, "FangSong_GB2312", STFangsong, "Noto Serif SC", serif',

  /**
   * 新罗马（Times New Roman）：西文衬线体。
   * 中文不在它的字形范围内，会沿栈回退到中文衬线体 —— 这是预期行为，
   * 因为 Times New Roman 本来就没有汉字。
   */
  times: '"Times New Roman", Times, "Nimbus Roman", "Songti SC", "Noto Serif SC", serif',

  /** 等宽：写代码 / 对齐表格时用。中文用等宽字体可保持列对齐。 */
  mono:
    '"Cascadia Mono", "JetBrains Mono", Consolas, "Sarasa Mono SC", "Microsoft YaHei Mono", "Courier New", monospace',
};

/**
 * 旧版本存的抽象类别 → 映射到最接近的具体字体。
 *
 * 不做迁移的话，老用户重启后会看到字体被重置成默认值，
 * 体感就是「我的设置丢了」。这类静默回退要避免。
 */
const LEGACY_FONT_FAMILY: Record<string, EditorFontFamily> = {
  sans: "system",
  serif: "simsun",
  mono: "mono",
};

/** 校验并读取已存储的字体；含旧值迁移，非法或缺失时回退默认值。 */
export function readStoredFontFamily(raw: string | null): EditorFontFamily {
  if (raw !== null && Object.prototype.hasOwnProperty.call(FONT_FAMILY_STACK, raw)) {
    return raw as EditorFontFamily;
  }
  return (raw !== null ? LEGACY_FONT_FAMILY[raw] : undefined) ?? DEFAULT_FONT_FAMILY;
}

/** 把字体栈写到 `<html>` 上的 CSS 变量。 */
export function applyFontFamily(family: EditorFontFamily): void {
  if (typeof document === "undefined") return;
  const stack = FONT_FAMILY_STACK[family] ?? FONT_FAMILY_STACK[DEFAULT_FONT_FAMILY];
  document.documentElement.style.setProperty("--editor-font-family", stack);
}
