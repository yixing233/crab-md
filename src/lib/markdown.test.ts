import { describe, expect, it } from "vitest";
import { renderMarkdown, resolveKatexPlugin } from "./markdown";

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

describe("renderMarkdown math (KaTeX)", () => {
  it("renders inline math", () => {
    const html = renderMarkdown("行内 $E=mc^2$ 公式");
    expect(html).toContain("katex");
    // 公式被排版成结构化 HTML，而不是原样的 TeX 文本。
    expect(html).not.toContain("$E=mc^2$");
  });

  it("renders block math", () => {
    const html = renderMarkdown("$$\na^2+b^2=c^2\n$$");
    expect(html).toContain("katex-display");
  });

  it("keeps the KaTeX layout styles that formulas depend on", () => {
    // 上下标与分式的定位全靠内联 style；剥掉就会错位或空白。
    const html = renderMarkdown("$E=mc^2$ 与 $\\frac{a}{b}$");
    expect(html).toContain("style=");
    expect(html).toContain("height");
  });

  it("emits MathML so screen readers can read formulas", () => {
    // 只保留 HTML profile 会让公式对无障碍工具不可读。
    expect(renderMarkdown("$E=mc^2$")).toContain("<math");
  });

  it("shows a mistake in a formula instead of failing the whole render", () => {
    // 一个手误的公式不该让整页笔记渲染失败。
    const html = renderMarkdown("$\\frac{1}{$");
    expect(html.length).toBeGreaterThan(0);
  });

  it("still renders the rest of the document around broken math", () => {
    const html = renderMarkdown("# 标题\n\n$\\frac{1}{$\n\n正文仍在");
    expect(html).toContain("标题");
    expect(html).toContain("正文仍在");
  });
});

/**
 * KaTeX 插件是 CommonJS 包，在 vitest 与浏览器里拿到的形状不同。
 *
 * 真实事故：`md.use(import 值)` 在 vitest 下正常（直接是函数），
 * 在浏览器里抛 `plugin.apply is not a function`，预览整块空白 ——
 * 而全部单测依然全绿。这组用例把那次的形状差异固定下来。
 */
describe("resolveKatexPlugin", () => {
  it("accepts the function shape used by vitest", () => {
    const fn = () => {};
    expect(resolveKatexPlugin(fn)).toBe(fn);
  });

  it("unwraps the { default } shape produced in the browser bundle", () => {
    // 这才是真实浏览器里到达的形状；不处理就会 plugin.apply 报错。
    const fn = () => {};
    expect(resolveKatexPlugin({ default: fn })).toBe(fn);
  });

  it("passes through anything that is neither, rather than throwing", () => {
    // 形状异常时不应在模块加载期就崩掉整个应用。
    expect(resolveKatexPlugin(undefined)).toBeUndefined();
    expect(resolveKatexPlugin(null)).toBeNull();
  });

  it("does not pick up a non-function default", () => {
    const mod = { default: "not a function" };
    expect(resolveKatexPlugin(mod)).toBe(mod);
  });
});

/**
 * KaTeX 需要内联 style 才能排版，而 style 是界面覆盖攻击的入口
 * （`position:fixed;inset:0` 可以伪造全屏登录框）。
 * 这组用例把这个边界固定下来。
 */
describe("renderMarkdown style safety", () => {
  it("strips position from raw HTML so content cannot overlay the app", () => {
    const html = renderMarkdown(
      '<div style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999">钓鱼</div>',
    );
    expect(html).not.toContain("position");
    expect(html).not.toContain("z-index");
  });

  it("strips inset and background overlays", () => {
    const html = renderMarkdown('<p style="position:fixed;inset:0;background:red">假登录框</p>');
    expect(html).not.toContain("inset");
    expect(html).not.toContain("background");
  });

  it("cannot be bypassed by faking the katex class", () => {
    // 按 class 判断祖先会被内容作者伪造（class 由内容控制），
    // 因此过滤必须按属性名，与元素位置无关。
    const html = renderMarkdown(
      '<div class="katex"><p style="position:fixed;inset:0">假登录框</p></div>',
    );
    expect(html).not.toContain("position");
    expect(html).not.toContain("inset");
  });

  it("strips display:none used to hide content", () => {
    expect(renderMarkdown('<p style="display:none">隐藏</p>')).not.toContain("display:none");
  });

  it("keeps harmless typographic styles", () => {
    // 放行列表要足够用，否则公式排版会被误伤。
    const html = renderMarkdown('<span style="font-weight:bold;margin-left:4px">x</span>');
    expect(html).toContain("font-weight");
  });
});
