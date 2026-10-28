import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./pasteHtml";

describe("htmlToMarkdown", () => {
  it("converts headings and emphasis", () => {
    const markdown = htmlToMarkdown(
      "<h1>标题</h1><p>重要 <strong>加粗</strong> 与 <em>斜体</em></p>",
    );
    expect(markdown).toContain("# 标题");
    expect(markdown).toContain("**加粗**");
    expect(markdown).toContain("*斜体*");
    expect(markdown).not.toContain("<");
  });

  it("converts GFM tables", () => {
    const markdown = htmlToMarkdown(
      "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>",
    );
    expect(markdown).toContain("| a | b |");
    expect(markdown).toContain("| 1 | 2 |");
    expect(markdown).toMatch(/---/);
  });

  it("converts task list checkboxes", () => {
    const markdown = htmlToMarkdown(
      '<ul><li><input type="checkbox" checked>已完成</li>' +
        '<li><input type="checkbox">待办</li></ul>',
    );
    expect(markdown).toContain("[x] 已完成");
    expect(markdown).toContain("[ ] 待办");
  });

  it("converts strikethrough", () => {
    expect(htmlToMarkdown("<p><del>删除</del></p>")).toContain("~~删除~~");
  });

  it("keeps fenced code blocks", () => {
    const markdown = htmlToMarkdown("<pre><code>const x = 1;</code></pre>");
    expect(markdown).toContain("```");
    expect(markdown).toContain("const x = 1;");
  });

  it("returns empty for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("   ")).toBe("");
  });
});
