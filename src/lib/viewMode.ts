/**
 * 编辑器视图模式（UI_DESIGN_SYSTEM.md §11）。
 *
 * 规范给出的是三栏 baseline，并要求「编辑区 MUST remain the dominant pane」。
 * 三档模式是这条约束的自然延伸：窄窗口或纯阅读时要能收起某一栏，
 * 而不是被迫接受固定三栏。
 *
 * 纯函数、不依赖 DOM，便于单测与持久化。
 */

export type ViewMode = "edit" | "split" | "preview";

/** 三档的固定顺序；循环切换与分段控件都以此为准。 */
export const VIEW_MODES: readonly ViewMode[] = ["edit", "split", "preview"] as const;

/** localStorage 键。 */
export const VIEW_MODE_KEY = "crab-md.view-mode";

/** 默认分栏：规范 §11 的 baseline 就是这个。 */
export const DEFAULT_VIEW_MODE: ViewMode = "split";

/** 校验并读取已存储的视图模式；非法或缺失时回退到默认值。 */
export function readStoredViewMode(raw: string | null): ViewMode {
  return raw === "edit" || raw === "split" || raw === "preview" ? raw : DEFAULT_VIEW_MODE;
}

/** 循环到下一个模式，顺序 edit → split → preview → edit。 */
export function nextViewMode(current: ViewMode): ViewMode {
  const i = VIEW_MODES.indexOf(current);
  return VIEW_MODES[(i + 1) % VIEW_MODES.length];
}

/** 该模式是否显示源码编辑器。 */
export function showsEditor(mode: ViewMode): boolean {
  return mode !== "preview";
}

/** 该模式是否显示预览。 */
export function showsPreview(mode: ViewMode): boolean {
  return mode !== "edit";
}
