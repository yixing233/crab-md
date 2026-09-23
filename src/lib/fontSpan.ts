/**
 * 选区字体：把选中文字包进 `<span style="font-family:…">`。
 *
 * 与 `markdownActions.ts` 一样是**纯函数**：只做文本变换，不碰 DOM 与
 * CodeMirror，因此能脱离编辑器完整单测。
 *
 * 为什么用内联 HTML 而不是某种自定义标记：
 * Markdown 没有「局部字体」语法。内联 HTML 是唯一被主流 Markdown 工具
 * （Obsidian / Typora / VS Code 预览）共同识别的写法，且在 DOMPurify 下
 * 已验证只放行 `font-family`，`position` / `inset` 等仍被拦截。
 */

export interface FontSpanSelection {
  text: string;
  /** 选区起点（含）。 */
  from: number;
  /** 选区终点（不含）。 */
  to: number;
}

export interface FontSpanChange {
  text: string;
  from: number;
  to: number;
}

/**
 * 把值转义进双引号属性。
 *
 * 字体栈里带双引号（`"Times New Roman"`），不转义会直接截断属性 ——
 * 那不仅丢字体，还可能被用来注出额外属性。
 */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** 属性的反转义（读取时用）。 */
export function unescapeAttr(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

/** 紧跟选区左侧的 font-family 开始标签。 */
const OPEN_BEFORE = /<span\s+style="font-family:\s*([^"]*?)\s*">$/;

/** 紧跟选区右侧的结束标签。 */
const CLOSE_AFTER = /^<\/span>/;

/** 选区自身就是一整段 font span。 */
const WHOLE_SPAN = /^<span\s+style="font-family:\s*([^"]*?)\s*">([\s\S]*)<\/span>$/;

/**
 * 给选区设置字体。
 *
 * 行为是**替换而不是嵌套**：若选区已经被一段 font span 包住
 * （无论是选中了内层文字还是连标签一起选中），只改写它的 font-family，
 * 不叠加新标签 —— 否则反复用几次就会套出好几层 span。
 */
export function applyFontToSelection(
  sel: FontSpanSelection,
  fontStack: string,
): FontSpanChange {
  const { text, from, to } = sel;

  // 空选区时直接返回：没有文字可设字体，插入一对空 span
  // 只会在文件里留下垃圾（对 Markdown 可移植性也是污染）。
  if (from === to) return { text, from, to };

  const escaped = escapeAttr(fontStack);

  // 情况一：选区连标签一起选中 -> 直接换掉整段的值，保留内部文字。
  const whole = WHOLE_SPAN.exec(text.slice(from, to));
  if (whole) {
    const inner = whole[2];
    const replacement = `<span style="font-family:${escaped}">${inner}</span>`;
    const out = text.slice(0, from) + replacement + text.slice(to);
    return { text: out, from, to: from + replacement.length };
  }

  // 情况二：选区正处于一段 font span 的**内层文字**上（标签在选区外侧）
  // -> 改写外层标签的值，不新增标签。
  const before = text.slice(0, from);
  const after = text.slice(to);
  const open = OPEN_BEFORE.exec(before);
  if (open && CLOSE_AFTER.test(after)) {
    const tagStart = from - open[0].length;
    const replacement = `<span style="font-family:${escaped}">`;
    const out = text.slice(0, tagStart) + replacement + text.slice(from);
    // 选区位置不变（新标签与旧标签等长时），但字体值可能改变了长度，
    // 故重新按替换后的偏移计算。
    const delta = replacement.length - open[0].length;
    return { text: out, from: from + delta, to: to + delta };
  }

  // 情况三：普通选区 -> 包一层，并保留选中内容，方便继续操作。
  const selected = text.slice(from, to);
  const inserted = `<span style="font-family:${escaped}">${selected}</span>`;
  const out = text.slice(0, from) + inserted + text.slice(to);
  const innerStart = from + inserted.length - selected.length - "</span>".length;
  return { text: out, from: innerStart, to: innerStart + selected.length };
}

/**
 * 移除选区外层的 font span（如果存在），恢复成纯文字。
 *
 * 与 `applyFontToSelection` 配对，让「设为字体」可以撤销。
 */
export function removeFontFromSelection(sel: FontSpanSelection): FontSpanChange {
  const { text, from, to } = sel;

  // 选区连标签一起选中。
  const whole = WHOLE_SPAN.exec(text.slice(from, to));
  if (whole) {
    const inner = whole[2];
    const out = text.slice(0, from) + inner + text.slice(to);
    return { text: out, from, to: from + inner.length };
  }

  // 标签在选区外侧。
  const open = OPEN_BEFORE.exec(text.slice(0, from));
  if (open && CLOSE_AFTER.test(text.slice(to))) {
    const tagStart = from - open[0].length;
    const closeEnd = to + "</span>".length;
    const inner = text.slice(from, to);
    const out = text.slice(0, tagStart) + inner + text.slice(closeEnd);
    const delta = -open[0].length;
    return { text: out, from: from + delta, to: to + delta };
  }

  // 没有可移除的标签：原样返回，调用方据此可以不做任何事。
  return { text, from, to };
}

/**
 * 空选区时「为后续输入预设字体」。
 *
 * 做法是插入一对紧邻的 span 并把光标放在中间：接下来敲的字符自然落在
 * span 内部，装饰器随即按该字体渲染。这比「记住待用字体、在每次输入时
 * 再包一层」简单得多 —— 后者逐字符输入会套出很多个 span。
 *
 * 光标已经在一个**空的** font span 里时，改写它的值而不是再插一层，
 * 这样反复换字体只会得到一对标签。
 */
export function insertFontSpan(sel: FontSpanSelection, fontStack: string): FontSpanChange {
  const { text, from } = sel;
  if (from !== sel.to) {
    // 有选区时不该走这条路；按普通选区处理，避免调用方拿到意外结果。
    return applyFontToSelection(sel, fontStack);
  }

  const escaped = escapeAttr(fontStack);
  const tag = `<span style="font-family:${escaped}">`;

  // 光标处是否正好是一个空的 font span？是则替换掉它。
  const existing = findFontSpansWithBounds(text).find(
    (s) => s.textFrom === s.textTo && s.textFrom === from,
  );
  if (existing) {
    const out =
      text.slice(0, existing.spanStart) + tag + "</span>" + text.slice(existing.spanEnd);
    const caret = existing.spanStart + tag.length;
    return { text: out, from: caret, to: caret };
  }

  const inserted = tag + "</span>";
  const out = text.slice(0, from) + inserted + text.slice(from);
  const caret = from + tag.length;
  return { text: out, from: caret, to: caret };
}

/**
 * 清掉**空的** font span（用于「预设了字体却没输入」的收尾）。
 *
 * 光标所在的那个空 span 会保留 —— 它正是待生效的预设。
 * 光标一旦离开，它就没有意义了，留着只会在文件里堆积无用标签。
 *
 * 返回新的全文与（可能被平移的）光标位置；无变化时原样返回。
 */
export function cleanupEmptyFontSpans(
  text: string,
  cursor: number,
): { text: string; cursor: number } {
  const empties = findFontSpansWithBounds(text).filter((s) => s.textFrom === s.textTo);
  if (empties.length === 0) return { text, cursor };

  let out = text;
  let caret = cursor;
  // 从后往前删，前面的下标才不会被移动影响。
  for (const span of [...empties].reverse()) {
    if (span.textFrom === cursor) continue;

    out = out.slice(0, span.spanStart) + out.slice(span.spanEnd);
    if (caret > span.spanEnd) caret -= span.spanEnd - span.spanStart;
    else if (caret > span.spanStart) caret = span.spanStart;
  }
  return { text: out, cursor: caret };
}

/** 选区当前是否处于一段 font span 内（用于按钮的选中态）。 */
export function selectionHasFontSpan(sel: FontSpanSelection): boolean {
  const { text, from, to } = sel;
  if (WHOLE_SPAN.test(text.slice(from, to))) return true;
  return OPEN_BEFORE.test(text.slice(0, from)) && CLOSE_AFTER.test(text.slice(to));
}

/**
 * 找出文档里所有 font span 的位置与字体值。
 *
 * 供编辑器的装饰器使用：让选中的文字**在编辑时**就以设定字体显示，
 * 否则用户设完字体只能在预览里看到效果，编辑状态下毫无反馈。
 *
 * 逐段扫描全文而非只扫可视区：跨行的 span 在可视区扫描下会时有时无，
 * 视觉上会闪。笔记体量下全文扫描的开销可忽略。
 */
export interface FontSpanRange {
  /** 开始标签之后的第一个字符。 */
  textFrom: number;
  /** 结束标签之前的位置。 */
  textTo: number;
  /** 反转义后的字体栈。 */
  font: string;
}

const SPAN_GLOBAL = /<span\s+style="font-family:\s*([^"]*?)\s*">([\s\S]*?)<\/span>/g;

export function findFontSpans(text: string): FontSpanRange[] {
  const out: FontSpanRange[] = [];
  SPAN_GLOBAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPAN_GLOBAL.exec(text)) !== null) {
    const tagLength = m[0].length - m[2].length - "</span>".length;
    out.push({
      textFrom: m.index + tagLength,
      textTo: m.index + tagLength + m[2].length,
      font: unescapeAttr(m[1]),
    });
  }
  return out;
}

/** 与 FontSpanRange 相同，但额外带上整段标签的边界（供删除/改写用）。 */
interface FontSpanBounds extends FontSpanRange {
  /** 开始标签的起点。 */
  spanStart: number;
  /** 结束标签的终点。 */
  spanEnd: number;
}

function findFontSpansWithBounds(text: string): FontSpanBounds[] {
  const out: FontSpanBounds[] = [];
  SPAN_GLOBAL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPAN_GLOBAL.exec(text)) !== null) {
    const tagLength = m[0].length - m[2].length - "</span>".length;
    out.push({
      spanStart: m.index,
      spanEnd: m.index + m[0].length,
      textFrom: m.index + tagLength,
      textTo: m.index + tagLength + m[2].length,
      font: unescapeAttr(m[1]),
    });
  }
  return out;
}
