import { describe, expect, it } from "vitest";
import {
  applyMarkdownAction,
  EDITOR_ACTIONS,
  type EditorSelection,
  type MarkdownActionId,
} from "./markdownActions";
// 用真实渲染器验证插入的骨架确实能变成表格/公式，
// 而不是只断言字符串长什么样。
import { renderMarkdown } from "./markdown";

/** 便捷构造：`sel("hello", 0, 5)` */
function sel(text: string, from = 0, to = 0): EditorSelection {
  return { text, from, to };
}

/** 取出某次动作后的「选中文本」，便于断言最终可见效果。 */
function selectionText(change: { text: string; from: number; to: number }): string {
  return change.text.slice(change.from, change.to);
}

describe("wrap actions", () => {
  it("wraps a selection in bold and keeps it selected", () => {
    const r = applyMarkdownAction(sel("hello world", 6, 11), "bold");
    expect(r.text).toBe("hello **world**");
    expect(selectionText(r)).toBe("world");
  });

  it("inserts bold markers with the caret between them when nothing is selected", () => {
    const r = applyMarkdownAction(sel("", 0, 0), "bold");
    expect(r.text).toBe("****");
    expect(r.from).toBe(2);
    expect(r.to).toBe(2);
  });

  it("toggles bold off when the selection is already wrapped", () => {
    // 选区正好是被包裹的内容
    const r = applyMarkdownAction(sel("a **b** c", 4, 5), "bold");
    expect(r.text).toBe("a b c");
  });

  it("unwraps when the selection itself includes the markers", () => {
    const r = applyMarkdownAction(sel("a **b** c", 2, 7), "bold");
    expect(r.text).toBe("a b c");
    expect(selectionText(r)).toBe("b");
  });

  it("treats italic and bold independently", () => {
    const r = applyMarkdownAction(sel("x", 0, 1), "italic");
    expect(r.text).toBe("*x*");
    // 斜体不该被误判成加粗的 toggle
    expect(applyMarkdownAction(sel("*x*", 1, 2), "italic").text).toBe("x");
  });

  it("wraps strikethrough with double tildes", () => {
    expect(applyMarkdownAction(sel("gone", 0, 4), "strikethrough").text).toBe("~~gone~~");
  });

  it("wraps inline code with a single backtick", () => {
    expect(applyMarkdownAction(sel("npm test", 0, 8), "inlineCode").text).toBe("`npm test`");
  });

  it("is idempotent-safe: wrapping twice returns to the original", () => {
    const once = applyMarkdownAction(sel("hi", 0, 2), "bold");
    // 用第一次结果的选区再次执行
    const twice = applyMarkdownAction(
      { text: once.text, from: once.from, to: once.to },
      "bold",
    );
    expect(twice.text).toBe("hi");
  });

  it("handles CJK content without breaking offsets", () => {
    const r = applyMarkdownAction(sel("并发编程与信道", 0, 3), "bold");
    expect(r.text).toBe("**并发编**程与信道");
    expect(selectionText(r)).toBe("并发编");
  });
});

describe("line prefix actions", () => {
  it("turns the caret line into a heading", () => {
    const r = applyMarkdownAction(sel("Title", 0, 0), "heading");
    expect(r.text).toBe("## Title");
  });

  it("toggles the heading off again", () => {
    const r = applyMarkdownAction(sel("## Title", 3, 3), "heading");
    expect(r.text).toBe("Title");
  });

  it("applies a bullet list to every selected line", () => {
    const r = applyMarkdownAction(sel("one\ntwo", 0, 7), "bulletList");
    expect(r.text).toBe("- one\n- two");
  });

  it("toggles bullets off when all selected lines already have them", () => {
    const r = applyMarkdownAction(sel("- one\n- two", 0, 11), "bulletList");
    expect(r.text).toBe("one\ntwo");
  });

  it("numbers selected lines incrementally", () => {
    const r = applyMarkdownAction(sel("a\nb\nc", 0, 5), "orderedList");
    expect(r.text).toBe("1. a\n2. b\n3. c");
  });

  it("strips ordered numbering on toggle", () => {
    const r = applyMarkdownAction(sel("1. a\n2. b", 0, 8), "orderedList");
    expect(r.text).toBe("a\nb");
  });

  it("quotes every selected line", () => {
    const r = applyMarkdownAction(sel("a\nb", 0, 3), "quote");
    expect(r.text).toBe("> a\n> b");
  });

  it("only prefixes the lines the selection actually touches", () => {
    // 选区落在第 2 行内部
    const text = "keep\ntarget\nkeep2";
    const r = applyMarkdownAction(sel(text, 5, 11), "bulletList");
    expect(r.text).toBe("keep\n- target\nkeep2");
  });
});

describe("code block", () => {
  it("fences the selection on its own lines", () => {
    const r = applyMarkdownAction(sel("const x = 1;", 0, 12), "codeBlock");
    expect(r.text).toBe("```\nconst x = 1;\n```");
  });

  it("adds a leading newline when inserted mid-line", () => {
    const text = "before after";
    const r = applyMarkdownAction(sel(text, 7, 12), "codeBlock");
    expect(r.text).toBe("before \n```\nafter\n```");
  });

  it("selects the fenced content for immediate typing", () => {
    const r = applyMarkdownAction(sel("code", 0, 4), "codeBlock");
    expect(selectionText(r)).toBe("code");
  });
});

describe("link and image", () => {
  it("wraps a selection as a link and selects the url placeholder", () => {
    const r = applyMarkdownAction(sel("site", 0, 4), "link");
    expect(r.text).toBe("[site](url)");
    expect(selectionText(r)).toBe("url");
  });

  it("inserts a link template with the label selected when nothing is selected", () => {
    const r = applyMarkdownAction(sel("", 0, 0), "link");
    expect(r.text).toBe("[text](url)");
    expect(selectionText(r)).toBe("text");
  });

  it("inserts an image template", () => {
    const r = applyMarkdownAction(sel("", 0, 0), "image");
    expect(r.text).toBe("![alt](url)");
    expect(selectionText(r)).toBe("alt");
  });

  it("wraps a selection as image alt text", () => {
    const r = applyMarkdownAction(sel("photo", 0, 5), "image");
    expect(r.text).toBe("![photo](url)");
    expect(selectionText(r)).toBe("url");
  });
});

describe("general invariants", () => {
  it("never mutates its input", () => {
    const input = sel("hello", 1, 3);
    const snapshot = { ...input };
    applyMarkdownAction(input, "bold");
    expect(input).toEqual(snapshot);
  });

  it("produces text whose length matches the reported selection bounds", () => {
    const cases: Array<[string, number, number, MarkdownActionId]> = [
      ["abc", 0, 3, "bold"],
      ["abc", 1, 1, "italic"],
      ["a\nb", 0, 3, "bulletList"],
      ["abc", 0, 3, "codeBlock"],
      ["abc", 0, 3, "link"],
      ["abc", 0, 3, "image"],
      ["abc", 2, 2, "heading"],
    ];
    for (const [text, from, to, action] of cases) {
      const r = applyMarkdownAction({ text, from, to }, action);
      expect(r.from, `${action} from`).toBeGreaterThanOrEqual(0);
      expect(r.to, `${action} to`).toBeLessThanOrEqual(r.text.length);
      expect(r.from, `${action} from<=to`).toBeLessThanOrEqual(r.to);
    }
  });

  it("leaves the text untouched for an unknown action", () => {
    const input = sel("abc", 0, 3);
    const r = applyMarkdownAction(input, "nope" as MarkdownActionId);
    expect(r.text).toBe("abc");
  });

  it("covers every action advertised by the toolbar", () => {
    // 工具栏列出的动作都必须真的实现，不能有占位项。
    for (const action of EDITOR_ACTIONS) {
      const r = applyMarkdownAction(sel("abc", 0, 3), action.id);
      expect(r.text, `action ${action.id} produced no change`).not.toBe("abc");
    }
  });

  it("advertises the spec's action set", () => {
    const ids = EDITOR_ACTIONS.map((a) => a.id);
    expect(ids).toEqual([
      "bold",
      "italic",
      "strikethrough",
      "heading",
      "bulletList",
      "orderedList",
      "quote",
      "link",
      "image",
      "inlineCode",
      "codeBlock",
      "table",
      "math",
      "mathBlock",
    ]);
  });
});

describe("table", () => {
  it("inserts a header, separator and body row", () => {
    const r = applyMarkdownAction(sel(""), "table");
    const lines = r.text.split("\n");
    expect(lines[0]).toContain("|");
    // 分隔行是表格能被解析的必要条件 —— 少了它整张表不成立。
    expect(lines[1]).toMatch(/^\|[\s-|]+\|$/);
    expect(lines.length).toBe(3);
  });

  it("selects the first header cell so the user can type immediately", () => {
    const r = applyMarkdownAction(sel(""), "table");
    expect(selectionText(r)).toBe("列 1");
  });

  it("separates the table from preceding text", () => {
    // 表格必须独占块；紧跟在文字后会并进上一段而无法解析。
    const r = applyMarkdownAction(sel("前面的文字", 5, 5), "table");
    expect(r.text.startsWith("前面的文字\n|")).toBe(true);
  });

  it("produces a table the renderer actually parses", () => {
    // 逐字跑一遍渲染链路，确保插入的骨架真的能变成表格。
    const r = applyMarkdownAction(sel(""), "table");
    const html = renderMarkdown(r.text);
    expect(html).toContain("<table>");
  });
});

describe("math", () => {
  it("wraps a selection as inline math", () => {
    const r = applyMarkdownAction(sel("E=mc^2", 0, 6), "math");
    expect(r.text).toBe("$E=mc^2$");
  });

  it("inserts an inline placeholder and selects it when nothing is selected", () => {
    const r = applyMarkdownAction(sel(""), "math");
    expect(r.text).toBe("$公式$");
    expect(selectionText(r)).toBe("公式");
  });

  it("puts block math on its own lines", () => {
    const r = applyMarkdownAction(sel(""), "mathBlock");
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("$$");
    expect(lines[lines.length - 1]).toBe("$$");
  });

  it("gives block math a valid placeholder formula", () => {
    const r = applyMarkdownAction(sel(""), "mathBlock");
    expect(selectionText(r)).toBe("a^2 + b^2 = c^2");
  });

  it("separates block math from surrounding text", () => {
    const r = applyMarkdownAction(sel("前文", 2, 2), "mathBlock");
    expect(r.text.startsWith("前文\n$$")).toBe(true);
  });

  it("reuses the selected text as the formula body", () => {
    const r = applyMarkdownAction(sel("x^2", 0, 3), "mathBlock");
    expect(r.text).toContain("x^2");
    expect(r.text).not.toContain("a^2 + b^2");
  });

  it("produces math the renderer actually renders", () => {
    // 这是本次改动的核心：插入的公式必须真的被 KaTeX 渲染出来。
    const inline = applyMarkdownAction(sel("E=mc^2", 0, 6), "math");
    expect(renderMarkdown(inline.text)).toContain("katex");

    const block = applyMarkdownAction(sel(""), "mathBlock");
    expect(renderMarkdown(block.text)).toContain("katex-display");
  });
});
