import { describe, expect, it } from "vitest";
import {
  applyFontToSelection,
  cleanupEmptyFontSpans,
  escapeAttr,
  findFontSpans,
  insertFontSpan,
  removeFontFromSelection,
  selectionHasFontSpan,
  unescapeAttr,
} from "./fontSpan";

const SERIF = 'SimSun, "Songti SC", serif';
const KAI = 'KaiTi, "Kaiti SC", serif';

describe("escapeAttr", () => {
  it("escapes double quotes so the attribute cannot be broken out of", () => {
    expect(escapeAttr('"Times New Roman"')).toBe("&quot;Times New Roman&quot;");
  });

  it("escapes ampersands before quotes (order matters)", () => {
    // 若先替换引号再替换 &，会把 &quot; 里的 & 二次转义成 &amp;quot;。
    expect(escapeAttr('a&b"c')).toBe("a&amp;b&quot;c");
  });

  it("round-trips through unescapeAttr", () => {
    const raw = '"Times New Roman", serif & mono';
    expect(unescapeAttr(escapeAttr(raw))).toBe(raw);
  });
});

describe("applyFontToSelection", () => {
  it("wraps a plain selection in a font span", () => {
    const r = applyFontToSelection({ text: "这是中文", from: 0, to: 4 }, SERIF);
    expect(r.text).toBe(`<span style="font-family:${escapeAttr(SERIF)}">这是中文</span>`);
  });

  it("keeps the inner text selected so the user can keep working", () => {
    const r = applyFontToSelection({ text: "前半这是中文后半", from: 2, to: 6 }, SERIF);
    expect(r.text.slice(r.from, r.to)).toBe("这是中文");
  });

  it("keeps text outside the selection untouched", () => {
    const r = applyFontToSelection({ text: "AAA中文BBB", from: 3, to: 5 }, SERIF);
    expect(r.text.startsWith("AAA<")).toBe(true);
    expect(r.text.endsWith(">BBB")).toBe(true);
  });

  it("replaces the font when the whole span is selected, instead of nesting", () => {
    const first = applyFontToSelection({ text: "中文", from: 0, to: 2 }, SERIF);
    // 连标签一起选中再设另一种字体
    const second = applyFontToSelection(
      { text: first.text, from: 0, to: first.text.length },
      KAI,
    );
    expect(second.text).toBe(`<span style="font-family:${escapeAttr(KAI)}">中文</span>`);
    // 关键：没有套出两层
    expect((second.text.match(/<span/g) ?? []).length).toBe(1);
  });

  it("rewrites the font when the selection is the inner text, instead of nesting", () => {
    const first = applyFontToSelection({ text: "中文", from: 0, to: 2 }, SERIF);
    // 只选中内层文字（标签在外侧）
    const second = applyFontToSelection(
      { text: first.text, from: first.from, to: first.to },
      KAI,
    );
    expect(second.text).toBe(`<span style="font-family:${escapeAttr(KAI)}">中文</span>`);
    expect((second.text.match(/<span/g) ?? []).length).toBe(1);
  });

  it("keeps the selection on the same visible text after rewriting", () => {
    const first = applyFontToSelection({ text: "中文", from: 0, to: 2 }, SERIF);
    const second = applyFontToSelection(
      { text: first.text, from: first.from, to: first.to },
      KAI,
    );
    // 值长度变了，选区必须跟着平移，否则会选中标签的一部分。
    expect(second.text.slice(second.from, second.to)).toBe("中文");
  });

  it("escapes a font stack containing quotes", () => {
    const r = applyFontToSelection({ text: "x", from: 0, to: 1 }, '"Times New Roman"');
    // 未转义的引号会提前闭合 style 属性。
    expect(r.text).toContain("&quot;Times New Roman&quot;");
    expect((r.text.match(/style="/g) ?? []).length).toBe(1);
  });

  it("is a no-op for an empty selection, rather than inserting junk", () => {
    // 没有文字可设字体时插一对空 span 只会在 .md 里留下垃圾。
    const r = applyFontToSelection({ text: "abc", from: 1, to: 1 }, SERIF);
    expect(r).toEqual({ text: "abc", from: 1, to: 1 });
  });
});

describe("removeFontFromSelection", () => {
  it("unwraps when the whole span is selected", () => {
    const wrapped = applyFontToSelection({ text: "中文", from: 0, to: 2 }, SERIF);
    const r = removeFontFromSelection({ text: wrapped.text, from: 0, to: wrapped.text.length });
    expect(r.text).toBe("中文");
    expect(r.text.slice(r.from, r.to)).toBe("中文");
  });

  it("unwraps when only the inner text is selected", () => {
    const wrapped = applyFontToSelection({ text: "中文", from: 0, to: 2 }, SERIF);
    const r = removeFontFromSelection({ text: wrapped.text, from: wrapped.from, to: wrapped.to });
    expect(r.text).toBe("中文");
  });

  it("is a no-op when there is no span", () => {
    const r = removeFontFromSelection({ text: "中文", from: 0, to: 2 });
    expect(r.text).toBe("中文");
    expect(r).toEqual({ text: "中文", from: 0, to: 2 });
  });

  it("round-trips: apply then remove returns the original text", () => {
    const original = "前后中文混排";
    const wrapped = applyFontToSelection({ text: original, from: 2, to: 4 }, SERIF);
    const r = removeFontFromSelection({ text: wrapped.text, from: wrapped.from, to: wrapped.to });
    expect(r.text).toBe(original);
  });
});

describe("selectionHasFontSpan", () => {
  it("is true when the whole span is selected", () => {
    const w = applyFontToSelection({ text: "中文", from: 0, to: 2 }, SERIF);
    expect(selectionHasFontSpan({ text: w.text, from: 0, to: w.text.length })).toBe(true);
  });

  it("is true when the inner text is selected", () => {
    const w = applyFontToSelection({ text: "中文", from: 0, to: 2 }, SERIF);
    expect(selectionHasFontSpan({ text: w.text, from: w.from, to: w.to })).toBe(true);
  });

  it("is false for plain text", () => {
    expect(selectionHasFontSpan({ text: "中文", from: 0, to: 2 })).toBe(false);
  });
});

describe("insertFontSpan (no selection -> font for what you type next)", () => {
  it("inserts an empty span and puts the caret inside it", () => {
    const r = insertFontSpan({ text: "前后", from: 1, to: 1 }, SERIF);
    // 光标必须落在开始标签之后、结束标签之前，后续输入才会落进 span。
    expect(r.text.slice(0, r.from)).toMatch(/<span style="font-family:[^"]*">$/);
    expect(r.text.slice(r.to)).toMatch(/^<\/span>/);
  });

  it("wraps text typed at the caret", () => {
    // 模拟用户接着输入三个字符。
    const r = insertFontSpan({ text: "", from: 0, to: 0 }, SERIF);
    const typed = r.text.slice(0, r.from) + "中文" + r.text.slice(r.to);
    expect(typed).toBe(`<span style="font-family:${escapeAttr(SERIF)}">中文</span>`);
  });

  it("keeps the caret collapsed", () => {
    const r = insertFontSpan({ text: "abc", from: 2, to: 2 }, SERIF);
    expect(r.from).toBe(r.to);
  });

  it("rewrites an existing empty span instead of nesting", () => {
    const first = insertFontSpan({ text: "", from: 0, to: 0 }, SERIF);
    const second = insertFontSpan({ text: first.text, from: first.from, to: first.to }, KAI);
    // 反复换字体只应留下一对标签。
    expect((second.text.match(/<span/g) ?? []).length).toBe(1);
    expect(second.text).toContain(escapeAttr(KAI));
  });

  it("falls back to wrapping when there is a selection", () => {
    const r = insertFontSpan({ text: "中文", from: 0, to: 2 }, SERIF);
    expect(r.text).toBe(`<span style="font-family:${escapeAttr(SERIF)}">中文</span>`);
  });

  it("leaves surrounding text untouched", () => {
    const r = insertFontSpan({ text: "AB", from: 1, to: 1 }, SERIF);
    expect(r.text.startsWith("A<")).toBe(true);
    expect(r.text.endsWith(">B")).toBe(true);
  });
});

describe("cleanupEmptyFontSpans", () => {
  it("removes an empty span the caret has left", () => {
    // 预设了字体但没输入就点走了，标签不该留在文件里。
    const kept = insertFontSpan({ text: "abc", from: 3, to: 3 }, SERIF);
    const moved = 0; // 光标移到了开头
    const r = cleanupEmptyFontSpans(kept.text, moved);
    expect(r.text).toBe("abc");
    expect(r.cursor).toBe(0);
  });

  it("keeps the empty span the caret is still inside", () => {
    // 光标还在里面，说明用户正准备输入，不能删。
    const kept = insertFontSpan({ text: "abc", from: 3, to: 3 }, SERIF);
    const r = cleanupEmptyFontSpans(kept.text, kept.from);
    expect(r.text).toBe(kept.text);
  });

  it("removes several abandoned empty spans at once", () => {
    const a = insertFontSpan({ text: "x", from: 1, to: 1 }, SERIF);
    const b = insertFontSpan({ text: a.text, from: 0, to: 0 }, KAI);
    // 光标放在全文开头 —— 那在**标签之外**，两段预设都已放弃，应全部清掉。
    // （若要保留，光标必须落在标签内部，即 b.from。）
    const r = cleanupEmptyFontSpans(b.text, 0);
    expect(r.text).toBe("x");
    expect((r.text.match(/<span/g) ?? []).length).toBe(0);
  });

  it("keeps only the span the caret sits inside", () => {
    const a = insertFontSpan({ text: "x", from: 1, to: 1 }, SERIF);
    const b = insertFontSpan({ text: a.text, from: 0, to: 0 }, KAI);
    // b.from 落在后插入的那段标签内部，这一段是「待输入」的预设。
    const r = cleanupEmptyFontSpans(b.text, b.from);
    expect((r.text.match(/<span/g) ?? []).length).toBe(1);
    expect(r.text).toContain(escapeAttr(KAI));
  });

  it("is a no-op when there are no empty spans", () => {
    const text = `<span style="font-family:${escapeAttr(SERIF)}">中文</span>`;
    expect(cleanupEmptyFontSpans(text, 0)).toEqual({ text, cursor: 0 });
  });

  it("shifts the caret when it sits after a removed span", () => {
    const a = insertFontSpan({ text: "abc", from: 0, to: 0 }, SERIF);
    const caretAtEnd = a.text.length;
    const r = cleanupEmptyFontSpans(a.text, caretAtEnd);
    expect(r.text).toBe("abc");
    expect(r.cursor).toBe(3);
  });
});

describe("findFontSpans", () => {
  it("finds a span and reports the inner text range", () => {
    const text = `前<span style="font-family:${escapeAttr(SERIF)}">中文</span>后`;
    const spans = findFontSpans(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].textFrom, spans[0].textTo)).toBe("中文");
    expect(spans[0].font).toBe(SERIF);
  });

  it("finds multiple spans", () => {
    const a = applyFontToSelection({ text: "甲", from: 0, to: 1 }, SERIF);
    const b = applyFontToSelection({ text: `${a.text}乙`, from: a.text.length, to: a.text.length + 1 }, KAI);
    expect(findFontSpans(b.text)).toHaveLength(2);
  });

  it("ignores spans that are not font spans", () => {
    const text = '<span class="x">中文</span>';
    expect(findFontSpans(text)).toHaveLength(0);
  });

  it("returns the unescaped font stack", () => {
    const text = `<span style="font-family:&quot;Times New Roman&quot;, serif">x</span>`;
    expect(findFontSpans(text)[0].font).toBe('"Times New Roman", serif');
  });

  it("handles a span containing newlines", () => {
    const text = `<span style="font-family:${escapeAttr(SERIF)}">第一行\n第二行</span>`;
    const spans = findFontSpans(text);
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].textFrom, spans[0].textTo)).toBe("第一行\n第二行");
  });

  it("returns nothing for text without spans", () => {
    expect(findFontSpans("普通文字")).toEqual([]);
  });
});
