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
 * 西文（拉丁）字体。
 *
 * 与中文字体**分开设置**：二者的选择逻辑不同 —— 中文关心字形风格
 * （宋/黑/楷/仿宋），西文更常是为了让代码或数字好看。Word 也是分开的。
 *
 * 实现靠 CSS 字体栈的**逐字符回退**：西文字体没有汉字字形，把西文名写在
 * 前面时中文会自动落到后面的中文字体上。因此不需要任何 JS 分流。
 */
export type EditorLatinFont =
  | "system"
  | "times"
  | "georgia"
  | "arial"
  | "calibri"
  | "mono";

export const EDITOR_LATIN_FONTS: readonly EditorLatinFont[] = [
  "system",
  "times",
  "georgia",
  "arial",
  "calibri",
  "mono",
] as const;

/** 中文（CJK）字体。 */
export type EditorCjkFont = "system" | "yahei" | "simhei" | "simsun" | "kaiti" | "fangsong";

export const EDITOR_CJK_FONTS: readonly EditorCjkFont[] = [
  "system",
  "yahei",
  "simhei",
  "simsun",
  "kaiti",
  "fangsong",
] as const;

/**
 * 字体的**具名字形**部分（不含通用族）。
 *
 * §34.6 要求显式列出 CJK 字体名：只写 `serif` / `sans-serif` 时中文会回退到
 * 系统默认字体，用户看到的「没变化」其实是设置失效。
 *
 * 字体缺失时**不需要**检测：CSS 会沿栈继续找下一个可用字体，
 * 这是浏览器原生行为，比拼字体可用性更可靠。
 * （实测 `System.Drawing` 的字体枚举会漏报 SimSun/SimHei，不可作为依据。）
 */
export const LATIN_FACES: Record<EditorLatinFont, string> = {
  /** 跟随系统 UI 字体，不指定具体西文字体。 */
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue"',
  times: '"Times New Roman", Times, "Nimbus Roman"',
  georgia: "Georgia, Cambria",
  arial: "Arial, Helvetica",
  calibri: "Calibri, Candara, Segoe UI",
  /**
   * 等宽：写代码、对齐数字时用。
   * 中文没有真正的等宽字体可用，故汉字仍走中文字体选择。
   */
  mono: '"Cascadia Mono", "JetBrains Mono", Consolas, "Courier New"',
};

export const CJK_FACES: Record<EditorCjkFont, string> = {
  /** 跟随系统 UI 字体。 */
  system: '"Microsoft YaHei UI", "PingFang SC", "Hiragino Sans GB", "Noto Sans SC"',
  /** 微软雅黑：Windows 默认中文界面字体，屏幕显示最清晰。 */
  yahei: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Noto Sans SC"',
  /** 黑体：笔画粗细均匀，适合标题与需要突出显示的正文。 */
  simhei: 'SimHei, "Heiti SC", "Hiragino Sans GB", "Noto Sans SC"',
  /** 宋体：正文衬线体，长文阅读最常用。 */
  simsun: 'SimSun, NSimSun, "Songti SC", "Noto Serif SC", "Source Han Serif SC"',
  /** 楷体：手写笔意，适合散文、引用等需要「温和」语气的段落。 */
  kaiti: 'KaiTi, "Kaiti SC", STKaiti, "Noto Serif SC"',
  /** 仿宋：公文与正式文稿的常用字体。 */
  fangsong: 'FangSong, "FangSong_GB2312", STFangsong, "Noto Serif SC"',
};

/**
 * 每种组合的通用族兜底。
 *
 * 取自**中文字体**一侧：通用族是「前面所有名字都没命中时的兜底」，
 * 而中文是本产品的主要文字，兜底风格与中文选择一致才不会突然跳字形。
 */
const CJK_GENERIC: Record<EditorCjkFont, string> = {
  system: "sans-serif",
  yahei: "sans-serif",
  simhei: "sans-serif",
  simsun: "serif",
  kaiti: "serif",
  fangsong: "serif",
};

/**
 * 把「西文 + 中文」两个选择合成一条 CSS 字体栈。
 *
 * 顺序固定为**西文在前、中文在后**：西文字体没有汉字字形，浏览器逐字符
 * 查栈时中文会自动跳过它落到中文字体上。反过来放则西文也会被中文字体
 * 自带的拉丁字形接管（宋体自带英文），用户选的西文字体就白设了。
 *
 * 另外：某个方向选 `system` 时它的具名字形仍在栈里（system-ui / 系统中文），
 * 这不是多余 —— 它保证了「只改一侧」时另一侧仍然是明确的字体选择。
 */
export function composeFontStack(latin: EditorLatinFont, cjk: EditorCjkFont): string {
  const latinFaces = LATIN_FACES[latin] ?? LATIN_FACES.system;
  const cjkFaces = CJK_FACES[cjk] ?? CJK_FACES.system;
  const generic = CJK_GENERIC[cjk] ?? "sans-serif";
  return `${latinFaces}, ${cjkFaces}, ${generic}`;
}

/**
 * 只用一个方向自己的字形构栈，供**设置页预览标签**使用。
 *
 * 为什么不能直接用 `composeFontStack`：预览标签本身是中文
 * （「宋体」「黑体」），而合成栈把西文放在最前。当西文选「系统默认」时
 * 最前面是 `system-ui` —— 它**自带汉字字形**，于是六个中文选项全部渲染成
 * 同一种字体，选择列表看起来毫无区别（实测确认）。
 *
 * 所以预览标签必须让**该选项自己的字形排第一**。
 */
export function previewStack(
  latin: EditorLatinFont,
  cjk: EditorCjkFont,
  showAs: "latin" | "cjk",
): string {
  const generic = CJK_GENERIC[cjk] ?? "sans-serif";
  if (showAs === "cjk") {
    return `${CJK_FACES[cjk] ?? CJK_FACES.system}, ${generic}`;
  }
  return `${LATIN_FACES[latin] ?? LATIN_FACES.system}, ${CJK_FACES[cjk] ?? CJK_FACES.system}, ${generic}`;
}

export const FONT_LATIN_KEY = "crab-md.editor-font-latin";
export const FONT_CJK_KEY = "crab-md.editor-font-cjk";

/**
 * 旧版本的单一字体预设键。
 *
 * 只用于**读取迁移**，不再写入：老用户升级后靠它把原来那一个选择
 * 拆成（西文, 中文）两项，避免设置看起来被重置。
 */
export const LEGACY_FONT_FAMILY_KEY = "crab-md.editor-font-family";
export const DEFAULT_LATIN_FONT: EditorLatinFont = "system";
export const DEFAULT_CJK_FONT: EditorCjkFont = "system";

/**
 * 编辑器内快速字体条用的一维 id 列表。
 *
 * 快速条是一条窄工具条，不便分成两个下拉，故把两个方向的选项**并成一排**
 * （`mono` 属于西文，中文字体仍走中文字体；`system` 是「两个方向都默认」）。
 */
export type EditorFontFamilyId = EditorLatinFont | EditorCjkFont;

export const EDITOR_FONT_FAMILY_IDS: readonly EditorFontFamilyId[] = [
  "system",
  "yahei",
  "simhei",
  "simsun",
  "kaiti",
  "fangsong",
  "times",
  "mono",
] as const;

/** 判断某个 id 是不是西文字体项。 */
export function isLatinFontId(id: EditorFontFamilyId): id is EditorLatinFont {
  return (EDITOR_LATIN_FONTS as readonly string[]).includes(id);
}

/** 判断某个 id 是不是中文字体项。 */
export function isCjkFontId(id: EditorFontFamilyId): id is EditorCjkFont {
  return (EDITOR_CJK_FONTS as readonly string[]).includes(id);
}

function isIn<T extends string>(list: readonly T[], v: string): v is T {
  return (list as readonly string[]).includes(v);
}

/** 校验并读取已存储的西文字体；非法或缺失时回退默认值。 */
export function readStoredLatinFont(raw: string | null): EditorLatinFont {
  return raw !== null && isIn(EDITOR_LATIN_FONTS, raw) ? raw : DEFAULT_LATIN_FONT;
}

/** 校验并读取已存储的中文字体；非法或缺失时回退默认值。 */
export function readStoredCjkFont(raw: string | null): EditorCjkFont {
  return raw !== null && isIn(EDITOR_CJK_FONTS, raw) ? raw : DEFAULT_CJK_FONT;
}

/**
 * 旧版本的单一字体预设 → 拆成（西文, 中文）两个选择。
 *
 * 不做迁移的话，老用户升级后会看到字体被重置成默认值，
 * 体感就是「我的设置丢了」。这类静默回退要避免。
 */
export const LEGACY_FONT_PRESET: Record<string, readonly [EditorLatinFont, EditorCjkFont]> = {
  sans: ["system", "system"],
  serif: ["times", "simsun"],
  mono: ["mono", "system"],
  system: ["system", "system"],
  yahei: ["system", "yahei"],
  simhei: ["system", "simhei"],
  simsun: ["system", "simsun"],
  kaiti: ["system", "kaiti"],
  fangsong: ["system", "fangsong"],
  times: ["times", "simsun"],
};

/**
 * 从旧预设还原出两个选择。返回 null 表示这个值不认识。
 *
 * 新建/覆盖两处 key 时都调用它，让「缺失新 key 但有旧 key」的老用户
 * 无缝过渡。
 */
export function migrateLegacyFontPreset(
  raw: string | null,
): readonly [EditorLatinFont, EditorCjkFont] | null {
  if (raw === null) return null;
  return LEGACY_FONT_PRESET[raw] ?? null;
}

/** 把合成后的字体栈写到 `<html>` 上的 CSS 变量。 */
export function applyFontStack(latin: EditorLatinFont, cjk: EditorCjkFont): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--editor-font-family",
    composeFontStack(latin, cjk),
  );
}

