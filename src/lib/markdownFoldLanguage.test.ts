import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { foldable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { markdownFoldLanguage } from "./markdownFoldLanguage";

/**
 * 回归测试：折叠箭头只在「确实有可折叠结构」的行上出现。
 *
 * 用户反馈：「为啥这有一个折叠容器？似乎没有什么提供折叠的内容啊」——
 * 一段「表格 + 任务列表 + 紧跟一段正文」的文档里，正文旁边凭空多出一个折叠箭头。
 * 根因是 Markdown 的懒惰续行规则把该段落并入了上一个列表项，而默认折叠规则给
 * 这种零缩进的续行文本也挂了折叠范围。
 *
 * 这里覆盖两个来源（`ListItem` 与列表内的 `Paragraph`），并锁死「列表之外的
 * 普通多行段落仍可折叠」这一不能被误伤的既有行为。
 */

const fixed = markdown({ base: markdownFoldLanguage });
const original = markdown({ base: markdownLanguage });

/** 返回该文档中所有可折叠的行号。 */
function foldableLines(doc: string, extension = fixed): number[] {
  const state = EditorState.create({ doc, extensions: [extension] });
  const lines: number[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const range = foldable(state, line.from, line.to);
    if (range && range.to > range.from) lines.push(n);
  }
  return lines;
}

const TABLE = ["| 列 1 | 列 2 |", "| ----- | ----- |", "| 123 | 123 |", "| 123123 | 123123 |"];
const TASKS = ["- [ ] 123123123", "- [ ] 123123123", "- [ ] 123123123", "- [ ] 123123123"];

describe("折叠范围：不应出现无意义的折叠箭头", () => {
  it("用户文档形状：表格 + 任务列表 + 紧跟无缩进正文，只剩表格可折叠", () => {
    const doc = [...TABLE, ...TASKS, "123123sddfffg"].join("\n");
    // 行 8 是最后一个任务项，行 9 的正文被懒惰续行并入它 —— 这正是截图里的箭头。
    expect(foldableLines(doc)).toEqual([1]);
  });

  it("紧跟的多行块级公式同样不再产生折叠箭头", () => {
    const doc = [...TABLE, ...TASKS, "$$", "123123sddfffg", "$$"].join("\n");
    expect(foldableLines(doc)).toEqual([1]);
  });

  it("普通无序列表的懒惰续行也不再产生折叠箭头", () => {
    // 这条走的是列表内 `Paragraph` 那条路径，与任务列表是不同来源。
    expect(foldableLines(["- 甲", "- 乙", "丙丙丙丙丙"].join("\n"))).toEqual([]);
  });

  it("有序列表的懒惰续行同样不产生折叠箭头", () => {
    expect(foldableLines(["1. 甲", "2. 乙", "丙丙丙丙丙"].join("\n"))).toEqual([]);
  });

  it("单行列表项不产生折叠箭头", () => {
    expect(foldableLines(["- 甲", "- 乙", "- 丙"].join("\n"))).toEqual([]);
  });
});

describe("折叠范围：真正有结构的内容仍然可折叠", () => {
  it("嵌套列表保留折叠箭头", () => {
    expect(foldableLines(["- 父项", "  - 子项一", "  - 子项二"].join("\n"))).toEqual([1]);
  });

  it("表格 + 嵌套列表：表格与列表各自可折叠", () => {
    const doc = [...TABLE, "- 父项", "  - 子项一", "  - 子项二"].join("\n");
    expect(foldableLines(doc)).toEqual([1, 5]);
  });

  it("缩进的懒惰续行保留折叠箭头（确实有缩进结构）", () => {
    const doc = [...TABLE, ...TASKS, "   123123sddfffg"].join("\n");
    expect(foldableLines(doc)).toEqual([1, 8]);
  });

  it("列表项下的围栏代码块保留折叠箭头", () => {
    // 行 2 的箭头来自围栏代码块自身，属于 CodeMirror 默认行为，与本次收窄无关。
    const doc = ["- 项目", "  ```js", "  const a = 1;", "  ```"].join("\n");
    expect(foldableLines(doc)).toEqual([1, 2]);
  });

  it("表格本身仍可折叠（GFM 的 Table 规则未被破坏）", () => {
    expect(foldableLines(TABLE.join("\n"))).toEqual([1]);
  });

  it("列表之外的普通多行段落仍然可折叠", () => {
    // 折叠长段落是有用行为，不能被这次收窄误伤。
    const doc = ["第一行文字", "第二行文字", "第三行文字"].join("\n");
    expect(foldableLines(doc)).toEqual([1]);
  });

  it("标题折叠（foldService）不受影响", () => {
    // 标题本身可折叠；正文段落各自也可折叠，这是 CodeMirror 原有行为。
    const doc = ["# 一级标题", "正文一", "正文二"].join("\n");
    expect(foldableLines(doc)).toEqual([1, 2]);
  });
});

describe("只收窄目标场景，其余行为与上游一致", () => {
  // 这些形态在修改前后必须完全一致，确保没有误伤。
  const UNCHANGED: Record<string, string[]> = {
    "嵌套列表": ["- 父项", "  - 子项一", "  - 子项二"],
    "围栏代码块（列表内）": ["- 项目", "  ```js", "  const a = 1;", "  ```"],
    "围栏代码块（顶层）": ["```js", "const a = 1;", "```"],
    "标题 + 正文": ["# 一级标题", "正文一", "正文二"],
    "普通多行段落": ["第一行文字", "第二行文字", "第三行文字"],
    "表格": TABLE,
    "引用块": ["> 引用一", "> 引用二", "> 引用三"],
    "缩进的懒惰续行": ["- 甲", "- 乙", "   丙丙丙丙丙"],
    "空行分隔的段落": ["- 甲", "- 乙", "", "丙丙丙丙丙"],
  };

  it.each(Object.entries(UNCHANGED))("%s 的折叠行为与上游一致", (_name, lines) => {
    const doc = lines.join("\n");
    expect(foldableLines(doc)).toEqual(foldableLines(doc, original));
  });
});
