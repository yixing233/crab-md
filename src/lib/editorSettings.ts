/**
 * 编辑器行为偏好（UI_DESIGN_SYSTEM.md §34「编辑器」分组）。
 *
 * 与 `editorPrefs.ts`（字号/字体）同类：纯客户端展示/行为偏好，放 localStorage。
 * 持有状态的是 App（见 App.tsx）—— 若由设置页自持，就必须先打开过设置页
 * 才生效，重启即回到默认值。
 *
 * 自动保存的「关闭」档仍然安全：崩溃恢复草稿（recovery.ts）独立于自动保存，
 * 每次编辑都会立即写入，进程崩溃后依然可以恢复。
 */

// ---------------------------------------------------------------------------
// 行号
// ---------------------------------------------------------------------------

export const LINE_NUMBERS_KEY = "crab-md.editor-line-numbers";

/** 行号默认关闭：Markdown 写作以段落为单位，行号是代码编辑器的习惯。 */
export const DEFAULT_LINE_NUMBERS = false;

/** 校验并读取行号开关；缺失或非法时回退默认。 */
export function readStoredLineNumbers(raw: string | null): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return DEFAULT_LINE_NUMBERS;
}

// ---------------------------------------------------------------------------
// 自动换行
// ---------------------------------------------------------------------------

export const LINE_WRAP_KEY = "crab-md.editor-line-wrap";

/** 自动换行默认开启：默认文档是散文，横向滚动阅读体验差。 */
export const DEFAULT_LINE_WRAP = true;

/** 校验并读取自动换行开关；缺失或非法时回退默认。 */
export function readStoredLineWrap(raw: string | null): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return DEFAULT_LINE_WRAP;
}

// ---------------------------------------------------------------------------
// 自动保存档位
// ---------------------------------------------------------------------------

export type AutosaveMode = "off" | "1s" | "3s" | "5s";

export const AUTOSAVE_MODES: readonly AutosaveMode[] = ["off", "1s", "3s", "5s"] as const;

export const AUTOSAVE_KEY = "crab-md.autosave-mode";

export const DEFAULT_AUTOSAVE_MODE: AutosaveMode = "1s";

/** 每档对应的去抖毫秒数。「关闭」不在其中 —— 由 store 按 mode 分支处理。 */
export const AUTOSAVE_DELAY_MS: Record<Exclude<AutosaveMode, "off">, number> = {
  "1s": 1000,
  "3s": 3000,
  "5s": 5000,
};

/** 校验并读取自动保存档位；缺失或非法时回退默认（现状行为：1 秒）。 */
export function readStoredAutosaveMode(raw: string | null): AutosaveMode {
  return (AUTOSAVE_MODES as readonly string[]).includes(raw ?? "")
    ? (raw as AutosaveMode)
    : DEFAULT_AUTOSAVE_MODE;
}
