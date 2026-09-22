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

export type EditorFontSize = "sm" | "md" | "lg";

export const EDITOR_FONT_SIZES: readonly EditorFontSize[] = ["sm", "md", "lg"] as const;

export const FONT_SIZE_KEY = "crab-md.editor-font-size";

export const DEFAULT_FONT_SIZE: EditorFontSize = "md";

/** 每档对应的实际像素值。落在 §7 字号刻度内。 */
export const FONT_SIZE_PX: Record<EditorFontSize, number> = {
  sm: 13,
  md: 14,
  lg: 16,
};

/** 校验并读取已存储的字号；非法或缺失时回退默认值。 */
export function readStoredFontSize(raw: string | null): EditorFontSize {
  return raw === "sm" || raw === "md" || raw === "lg" ? raw : DEFAULT_FONT_SIZE;
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
// 字体族
// ---------------------------------------------------------------------------

/**
 * 「正文用什么字体」比「字号多大」更影响长时间阅读的舒适度，
 * 因此单列一项。选项按**阅读场景**划分，而不是罗列字体名：
 * 用户不关心 "Noto Serif SC" 叫什么，只关心「适合读」还是「适合写」。
 */
export type EditorFontFamily = "sans" | "serif" | "mono";

export const EDITOR_FONT_FAMILIES: readonly EditorFontFamily[] = [
  "sans",
  "serif",
  "mono",
] as const;

export const FONT_FAMILY_KEY = "crab-md.editor-font-family";

export const DEFAULT_FONT_FAMILY: EditorFontFamily = "sans";

/**
 * 字体栈。中文必须单独列出字体名 —— 只写 `serif` 时中文会回退到系统默认
 * 宋体/黑体，衬线与无衬线的区别在中文上几乎看不出来，等于设置无效。
 * 故每个栈都显式包含常见中文字体，再以通用族兜底。
 */
export const FONT_FAMILY_STACK: Record<EditorFontFamily, string> = {
  sans:
    'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Noto Sans SC", Roboto, sans-serif',
  serif:
    'Georgia, "Songti SC", "SimSun", "Noto Serif SC", "Source Han Serif SC", "Times New Roman", serif',
  mono:
    '"Cascadia Mono", "JetBrains Mono", Consolas, "Sarasa Mono SC", "Microsoft YaHei Mono", "Courier New", monospace',
};

/** 校验并读取已存储的字体族；非法或缺失时回退默认值。 */
export function readStoredFontFamily(raw: string | null): EditorFontFamily {
  return raw === "sans" || raw === "serif" || raw === "mono" ? raw : DEFAULT_FONT_FAMILY;
}

/** 把字体栈写到 `<html>` 上的 CSS 变量。 */
export function applyFontFamily(family: EditorFontFamily): void {
  if (typeof document === "undefined") return;
  const stack = FONT_FAMILY_STACK[family] ?? FONT_FAMILY_STACK[DEFAULT_FONT_FAMILY];
  document.documentElement.style.setProperty("--editor-font-family", stack);
}
