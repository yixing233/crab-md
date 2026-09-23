/**
 * 预览排版：分元素的字体与字号（UI_DESIGN_SYSTEM.md §34.6）。
 *
 * 与 `editorPrefs`（编辑区自己的字体/字号）分开：
 * - 编辑区是**书写面**，通篇一种字体最省心；
 * - 预览是**阅读面**，按元素区分才符合阅读习惯 ——
 *   标题要醒目、代码要等宽、引用要收敛、公式要能看清上下标。
 *
 * 拉丁字符**全局一个设置**，中文按元素分别设置：
 * 中文用户换字体的动机几乎都在汉字（宋/黑/楷/仿宋），
 * 而英文通常只需要「衬线还是无衬线」一次决定。
 *
 * ## 为什么拉丁栈里绝不能出现 `system-ui`
 *
 * 实测（canvas 像素哈希，真实浏览器）：
 * ```
 * 栈 = system-ui, ..., KaiTi   ->  拉丁走 Helvetica Neue，汉字走 Segoe UI/Arial
 * 栈 = "Segoe UI", ..., KaiTi  ->  拉丁走 Segoe UI，     汉字走 KaiTi
 * ```
 * `system-ui` 在 Windows 上即微软雅黑，**自带拉丁与汉字两套字形**，
 * 排在栈首会把两边一起吃掉 —— 用户选什么都不会变（这就是之前那个缺陷）。
 * 因此拉丁侧只列**纯拉丁**字体，汉字自然穿透到后面的中文字体。
 */
import type { EditorCjkFont, EditorLatinFont } from "./editorPrefs";

/**
 * 可独立设置排版的预览元素。
 *
 * 标题按层级分开（用户明确要求）：大标题常用黑体、小标题常用宋体，
 * 共用一个设置就表达不了。
 */
export type PreviewElementId =
  | "body"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "code"
  | "quote"
  | "table"
  | "math";

/** 顺序即设置页的展示顺序：正文在首，标题依次，其后是各结构元素。 */
export const PREVIEW_ELEMENTS: readonly PreviewElementId[] = [
  "body",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "code",
  "quote",
  "table",
  "math",
] as const;

/**
 * 拉丁字体栈。
 *
 * **每个栈都刻意不含 `system-ui`** —— 见文件头注释：它是唯一会同时抢走
 * 汉字字形的候选。`system` 因此落到 `Segoe UI`（Windows 的拉丁 UI 字体），
 * 而不是 `system-ui`。
 */
export const PREVIEW_LATIN_STACK: Record<EditorLatinFont, string> = {
  system: '"Segoe UI", -apple-system, Roboto, "Helvetica Neue", Arial',
  times: '"Times New Roman", Times, "Nimbus Roman"',
  georgia: "Georgia, Cambria",
  arial: "Arial, Helvetica",
  calibri: "Calibri, Candara",
  mono: '"Cascadia Mono", "JetBrains Mono", Consolas, "Courier New"',
};

/** 每类元素的通用族兜底，顺序与中文字体选择一致。 */
const GENERIC_BY_CJK: Record<EditorCjkFont, string> = {
  system: "sans-serif",
  yahei: "sans-serif",
  simhei: "sans-serif",
  simsun: "serif",
  kaiti: "serif",
  fangsong: "serif",
};

/** 单个元素的排版设置。 */
export interface ElementTypography {
  /** 汉字使用的中文字体（拉丁字符由全局设置决定）。 */
  cjkFont: EditorCjkFont;
  /** 字号，单位为 px。 */
  sizePx: number;
}

/** 一类元素的默认值，其中字号同时充当下限（用户可在此基础上调大调小）。 */
export const PREVIEW_DEFAULT_TYPOGRAPHY: Record<PreviewElementId, ElementTypography> = {
  body: { cjkFont: "system", sizePx: 16 },
  // 标题字号逐级递减，形成清晰的层级差（约 1.25 倍递减）。
  h1: { cjkFont: "system", sizePx: 30 },
  h2: { cjkFont: "system", sizePx: 24 },
  h3: { cjkFont: "system", sizePx: 20 },
  h4: { cjkFont: "system", sizePx: 18 },
  h5: { cjkFont: "system", sizePx: 17 },
  h6: { cjkFont: "system", sizePx: 16 },
  // 代码用等宽，且比正文略小 —— 等宽字体视觉上偏大。
  code: { cjkFont: "system", sizePx: 14 },
  quote: { cjkFont: "system", sizePx: 16 },
  table: { cjkFont: "system", sizePx: 15 },
  math: { cjkFont: "system", sizePx: 18 },
};

/**
 * 可选的字号阶梯（px）。
 *
 * 用有限阶梯而不是自由输入：一是避免用户填出 3px / 900px 这类不可用值，
 * 二是让「调大一号」有确定含义（相邻档位），符合设置页的操作直觉。
 */
export const PREVIEW_SIZE_STEPS: readonly number[] = [
  10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 30, 34, 38, 42,
] as const;

/** 各类元素的字号上下限：标题可以很大，正文不该被压到看不见。 */
export const PREVIEW_SIZE_RANGE: Record<PreviewElementId, { min: number; max: number }> = {
  body: { min: 12, max: 24 },
  h1: { min: 20, max: 42 },
  h2: { min: 18, max: 38 },
  h3: { min: 16, max: 34 },
  h4: { min: 14, max: 30 },
  h5: { min: 13, max: 26 },
  h6: { min: 12, max: 24 },
  code: { min: 10, max: 22 },
  quote: { min: 12, max: 24 },
  table: { min: 11, max: 22 },
  math: { min: 12, max: 30 },
};

/** 某个元素是否是可识别的预览元素。 */
export function isPreviewElement(v: string): v is PreviewElementId {
  return (PREVIEW_ELEMENTS as readonly string[]).includes(v);
}

/**
 * 把任意值归一成合法的排版设置。
 *
 * 用于读取已存储的偏好：用户可能手改 localStorage，或从旧版本升级上来，
 * 绝不能把这些值直接写进 CSS（`font-size: NaNpx` 会让整块排版崩掉）。
 */
export function normalizeTypography(
  id: PreviewElementId,
  raw: Partial<ElementTypography> | null | undefined,
): ElementTypography {
  const fallback = PREVIEW_DEFAULT_TYPOGRAPHY[id];
  if (!raw) return { ...fallback };

  const cjkFont =
    typeof raw.cjkFont === "string" &&
    Object.prototype.hasOwnProperty.call(GENERIC_BY_CJK, raw.cjkFont)
      ? (raw.cjkFont as EditorCjkFont)
      : fallback.cjkFont;

  return { cjkFont, sizePx: clampSize(id, raw.sizePx) };
}

/**
 * 把字号夹进该元素的合法区间，并对齐到最近的阶梯值。
 *
 * 两件事合成一步：**只在区间内的档位里挑**。先前写成「先 Math.min/max 夹取、
 * 再对齐到阶梯」，但那个夹取是死代码 —— 对齐循环本来就跳过了区间外的档位，
 * 删掉它测试依然全绿（变异测试发现的）。改成单点约束后，
 * 把区间过滤去掉就会被「返回值必须落在区间内」的测试抓住。
 */
export function clampSize(id: PreviewElementId, size: unknown): number {
  const { min, max } = PREVIEW_SIZE_RANGE[id];
  const n =
    typeof size === "number" && Number.isFinite(size)
      ? size
      : PREVIEW_DEFAULT_TYPOGRAPHY[id].sizePx;

  const candidates = PREVIEW_SIZE_STEPS.filter((s) => s >= min && s <= max);
  // 每个元素的区间都至少含一个档位（有测试保证）。兜底分支只为
  // 万一有人把区间改窄到不含任何档位时不至于返回 undefined。
  let best = candidates[0] ?? Math.min(max, Math.max(min, n));
  let bestDist = Infinity;
  // 同距离时取较小者（`<` 而非 `<=`），结果才确定。
  for (const step of candidates) {
    const d = Math.abs(step - n);
    if (d < bestDist) {
      bestDist = d;
      best = step;
    }
  }
  return best;
}

/** 在当前值基础上调大一档；已在最大档时返回原值。 */
export function stepSizeUp(id: PreviewElementId, size: number): number {
  const { max } = PREVIEW_SIZE_RANGE[id];
  const next = PREVIEW_SIZE_STEPS.find((s) => s > size && s <= max);
  return next ?? clampSize(id, size);
}

/** 在当前值基础上调小一档；已在最小档时返回原值。 */
export function stepSizeDown(id: PreviewElementId, size: number): number {
  const { min } = PREVIEW_SIZE_RANGE[id];
  const smaller = PREVIEW_SIZE_STEPS.filter((s) => s < size && s >= min);
  return smaller.length > 0 ? smaller[smaller.length - 1] : clampSize(id, size);
}

/**
 * 合成某个预览元素的 CSS 字体栈。
 *
 * 顺序**拉丁在前、中文在后**：实测证明这样两边都能生效（见文件头）。
 * 前提是拉丁栈里没有 `system-ui` —— 由 `PREVIEW_LATIN_STACK` 保证。
 */
export function composePreviewFontStack(
  latin: EditorLatinFont,
  cjk: EditorCjkFont,
): string {
  const latinFaces = PREVIEW_LATIN_STACK[latin] ?? PREVIEW_LATIN_STACK.system;
  const cjkFaces =
    // 中文侧复用 editorPrefs 的具名字形表，避免两处清单发散。
    CJK_NAME[cjk] ?? CJK_NAME.system;
  const generic = GENERIC_BY_CJK[cjk] ?? "sans-serif";
  return `${latinFaces}, ${cjkFaces}, ${generic}`;
}

/** 中文字体的具名字形（与 editorPrefs.CJK_FACES 保持同名，此处只取首个具名）。 */
const CJK_NAME: Record<EditorCjkFont, string> = {
  system: '"Microsoft YaHei UI", "PingFang SC", "Noto Sans SC"',
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC"',
  simhei: 'SimHei, "Heiti SC"',
  simsun: 'SimSun, NSimSun, "Songti SC"',
  kaiti: 'KaiTi, "Kaiti SC", STKaiti',
  fangsong: 'FangSong, "FangSong_GB2312", STFangsong',
};

/** 全部元素的排版设置。 */
export type PreviewTypography = Record<PreviewElementId, ElementTypography>;

/** 默认的整套排版。 */
export function defaultPreviewTypography(): PreviewTypography {
  const out = {} as PreviewTypography;
  for (const id of PREVIEW_ELEMENTS) out[id] = { ...PREVIEW_DEFAULT_TYPOGRAPHY[id] };
  return out;
}

export const PREVIEW_LATIN_KEY = "crab-md.preview-latin-font";
export const PREVIEW_TYPE_KEY = "crab-md.preview-typography";

/**
 * 从已存储的 JSON 还原整套排版。
 *
 * 逐元素归一，任何一项坏掉都只影响它自己 —— 不做「整份丢弃」，
 * 否则一个字段写坏会让用户所有排版设置一起回到默认。
 */
export function parseStoredTypography(raw: string | null): PreviewTypography {
  const out = defaultPreviewTypography();
  if (!raw) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof parsed !== "object" || parsed === null) return out;

  const rec = parsed as Record<string, unknown>;
  for (const id of PREVIEW_ELEMENTS) {
    const v = rec[id];
    out[id] = normalizeTypography(
      id,
      typeof v === "object" && v !== null ? (v as Partial<ElementTypography>) : null,
    );
  }
  return out;
}

/** 把整套排版写进 `<html>` 上的 CSS 变量。 */
export function applyPreviewTypography(
  latin: EditorLatinFont,
  typography: PreviewTypography,
): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const id of PREVIEW_ELEMENTS) {
    const t = typography[id] ?? PREVIEW_DEFAULT_TYPOGRAPHY[id];
    root.style.setProperty(
      `--preview-font-${id}`,
      composePreviewFontStack(latin, t.cjkFont),
    );
    root.style.setProperty(`--preview-size-${id}`, `${t.sizePx}px`);
  }
}
