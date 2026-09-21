import { describe, expect, it } from "vitest";
import { extractOutline } from "./outline";

describe("extractOutline", () => {
  it("returns nothing for empty input", () => {
    expect(extractOutline("")).toEqual([]);
  });

  it("returns nothing when there are no headings", () => {
    expect(extractOutline("just text\nmore text")).toEqual([]);
  });

  it("extracts ATX headings with their level and line number", () => {
    // 行号是 0 基，供 CodeMirror 跳转直接用。
    expect(extractOutline("# 一级\n\ntext\n\n## 二级")).toEqual([
      { level: 1, text: "一级", line: 0 },
      { level: 2, text: "二级", line: 4 },
    ]);
  });

  it("handles all six heading levels", () => {
    const src = "# a\n## b\n### c\n#### d\n##### e\n###### f";
    expect(extractOutline(src).map((i) => i.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const src = ["# 真标题", "```", "# 代码里的井号", "```", "# 另一个真标题"].join("\n");
    expect(extractOutline(src).map((i) => i.text)).toEqual(["真标题", "另一个真标题"]);
  });

  it("ignores headings inside tilde fences", () => {
    const src = ["~~~", "# 不是标题", "~~~"].join("\n");
    expect(extractOutline(src)).toEqual([]);
  });

  it("does not treat a tilde fence as closing a backtick fence", () => {
    const src = ["```", "~~~", "# 仍在代码块内", "```", "# 真标题"].join("\n");
    expect(extractOutline(src).map((i) => i.text)).toEqual(["真标题"]);
  });

  it("strips a trailing closing sequence of hashes when space-separated", () => {
    expect(extractOutline("## 标题 ##")[0].text).toBe("标题");
  });

  it("keeps hashes that are not a valid closing sequence", () => {
    // CommonMark 要求结尾 # 前有空格；`标题##` 就是正文的一部分。
    expect(extractOutline("## 标题##")[0].text).toBe("标题##");
  });

  it("allows up to three leading spaces", () => {
    expect(extractOutline("   # 缩进的标题").map((i) => i.text)).toEqual(["缩进的标题"]);
  });

  it("does not treat a hash without a space as a heading", () => {
    // `#标签` 是常见写法，不是标题。
    expect(extractOutline("#标签")).toEqual([]);
  });

  it("does not treat seven hashes as a heading", () => {
    expect(extractOutline("####### 太深了")).toEqual([]);
  });

  it("tolerates CRLF line endings", () => {
    expect(extractOutline("# 一\r\n\r\n## 二").map((i) => i.line)).toEqual([0, 2]);
  });

  it("handles a heading with no text", () => {
    expect(extractOutline("#")[0]).toEqual({ level: 1, text: "", line: 0 });
  });
});
