import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders basic markdown structure", () => {
    const html = renderMarkdown("# Title\n\nSome *text*.");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain("<em>text</em>");
  });

  it("renders tables", () => {
    const html = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
  });

  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
  });

  it("renders Chinese content correctly", () => {
    expect(renderMarkdown("## 中文标题")).toContain("中文标题");
  });

  it("strips script tags from raw HTML", () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain("<script");
  });

  it("strips inline event handlers", () => {
    expect(renderMarkdown('<img src="x" onerror="alert(1)">')).not.toContain("onerror");
  });

  it("strips svg onload", () => {
    expect(renderMarkdown('<svg onload="alert(1)"></svg>')).not.toContain("onload");
  });

  it("removes javascript: hrefs from raw HTML anchors", () => {
    const html = renderMarkdown('<a href="javascript:alert(1)">x</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<a");
  });

  it("removes data: hrefs from raw HTML anchors", () => {
    expect(renderMarkdown('<a href="data:text/html,<script>alert(1)</script>">x</a>'))
      .not.toContain("data:");
  });

  it("does not turn markdown javascript: syntax into a link", () => {
    // markdown-it 本就拒绝把 javascript: 转成链接，输出的是转义后的字面量源文本。
    // 因此这里断言"没有生成 href"，而不是断言"不含 javascript: 字样"
    // —— 后者会误判，因为字面量源文本里当然含有该字符串。已实测。
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("href=");
  });

  it("keeps legitimate links and images working", () => {
    expect(renderMarkdown("[ok](https://example.com)")).toContain('href="https://example.com"');
    expect(renderMarkdown("![a](https://example.com/a.png)"))
      .toContain('src="https://example.com/a.png"');
  });

  it("strips iframes", () => {
    expect(renderMarkdown('<iframe src="https://evil.test"></iframe>')).not.toContain("<iframe");
  });

  it("handles empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });
});

/**
 * 单个换行的处理（UI_DESIGN_SYSTEM.md §22）。
 *
 * 这是**有意偏离严格 CommonMark**：标准把单个换行当 soft break（渲染为空格），
 * 但那样编辑器显示三行、预览只有一行，两者自相矛盾。此组用例把选择固定下来。
 */
describe("renderMarkdown soft line breaks", () => {
  it("turns a single newline into a line break", () => {
    expect(renderMarkdown("第一行\n第二行")).toContain("<br");
  });

  it("matches what the editor shows for the reported case", () => {
    // 用户报告的原例：编辑器里三行，预览此前挤成一行。
    const html = renderMarkdown("呵是大神大神\nasdasd\nasdasd");
    expect((html.match(/<br/g) ?? []).length).toBe(2);
  });

  it("still separates paragraphs on a blank line", () => {
    // 空行分段是 Markdown 的核心语义，不能被 breaks 影响。
    const html = renderMarkdown("第一段\n\n第二段");
    expect((html.match(/<p>/g) ?? []).length).toBe(2);
  });

  it("does not alter code block contents", () => {
    // 代码块内的换行本来就是换行，不该插入 <br>。
    const html = renderMarkdown("```\nconst a = 1;\n```");
    expect(html).not.toContain("<br");
  });

  it("does not alter tables", () => {
    const html = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).not.toContain("<br");
  });
});
