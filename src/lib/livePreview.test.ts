import { describe, expect, it } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { buildLivePreviewDecorations, livePreview } from "./livePreview";

describe("livePreview", () => {
  it("decorates inactive lines and leaves active lines in raw markdown", () => {
    const doc = [
      "# 一级标题",
      "",
      "**加粗内容**",
      "",
      "- [ ] 任务待办",
      "",
      "---",
    ].join("\n");

    // 光标位于第 1 行（字符 0，第一行激活）
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(0),
    });

    const view = new EditorView({ state });
    const decos = buildLivePreviewDecorations(view);

    // 活跃的第 1 行：保留 # 源码供编辑，但挂载 cm-live-h1 行样式
    let line1HasLineDeco = false;
    let line1ReplacedMark = false;
    let boldMarkFound = false;
    let boldMarkerHidden = false;
    let taskWidgetFound = false;
    let hrWidgetFound = false;

    decos.between(0, doc.length, (from, to, deco) => {
      const spec = deco.spec;
      if (spec.class?.includes("cm-live-h1")) {
        line1HasLineDeco = true;
      }
      // 第 1 行的前 2 个字符（# ）是否被 replace 折叠
      if (from === 0 && to === 2 && (deco as any).value?.spec?.widget === undefined) {
        line1ReplacedMark = true;
      }
      if (spec.class?.includes("cm-live-bold")) {
        boldMarkFound = true;
      }
      if (from === doc.indexOf("**加粗内容**") && to === doc.indexOf("**加粗内容**") + 2) {
        boldMarkerHidden = true;
      }
      if (spec.widget && spec.widget.constructor.name === "TaskCheckboxWidget") {
        taskWidgetFound = true;
      }
      if (spec.widget && spec.widget.constructor.name === "HorizontalRuleWidget") {
        hrWidgetFound = true;
      }
    });

    expect(line1HasLineDeco).toBe(true);
    // 因为光标在第 1 行，# 标记绝对不应该被隐藏，必须可见供编辑
    expect(line1ReplacedMark).toBe(false);

    // 非活跃的第 3 行（加粗）：星号被折叠，文字加粗
    expect(boldMarkFound).toBe(true);
    expect(boldMarkerHidden).toBe(true);

    // 非活跃的第 5 行：任务复选框被替换为可交互 Widget
    expect(taskWidgetFound).toBe(true);

    // 非活跃的第 7 行：--- 被替换为水平线 Widget
    expect(hrWidgetFound).toBe(true);
  });

  it("folds heading mark when cursor leaves the heading line", () => {
    const doc = "# 标题行\n\n正文行";

    // 光标位于正文行（第 3 行）
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf("正文行")),
    });

    const view = new EditorView({ state });
    const decos = buildLivePreviewDecorations(view);

    let headingMarkHidden = false;
    decos.between(0, 2, (from, to) => {
      if (from === 0 && to === 2) {
        headingMarkHidden = true;
      }
    });

    // 光标离开标题行后，# 标记自动折叠隐藏
    expect(headingMarkHidden).toBe(true);
  });

  it("renders live widgets for math formulas, code blocks, and markdown tables when cursor is outside", () => {
    const doc = [
      "行内公式 $E=mc^2$ 测试",
      "",
      "$$",
      "\\int_0^1 x dx",
      "$$",
      "",
      "```typescript",
      "const a: number = 42;",
      "```",
      "",
      "| 姓名 | 年龄 |",
      "| --- | --- |",
      "| 张三 | 25 |",
      "",
      "光标在此",
    ].join("\n");

    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf("光标在此")),
    });

    const view = new EditorView({ state });
    const decos = buildLivePreviewDecorations(view);

    let inlineMathFound = false;
    let blockMathFound = false;
    let codeHeaderFound = false;
    let tableWidgetFound = false;

    decos.between(0, doc.length, (_from, _to, deco) => {
      const widget = deco.spec.widget;
      if (widget) {
        const name = widget.constructor.name;
        if (name === "InlineMathWidget") inlineMathFound = true;
        if (name === "BlockMathWidget") blockMathFound = true;
        if (name === "CodeBlockHeaderWidget") codeHeaderFound = true;
        if (name === "LiveTableWidget") tableWidgetFound = true;
      }
    });

    expect(inlineMathFound).toBe(true);
    expect(blockMathFound).toBe(true);
    expect(codeHeaderFound).toBe(true);
    expect(tableWidgetFound).toBe(true);
  });

  it("provides livePreview extension that attaches to EditorState", () => {
    const doc = "| a | b |\n|---|---|\n| 1 | 2 |\n\n$$\nE=mc^2\n$$\n\n外部文本";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf("外部文本")),
      extensions: [livePreview(true)],
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({ state, parent: host });

    expect(host.querySelector("table")).toBeInTheDocument();
    expect(host.querySelector(".katex")).toBeInTheDocument();
    expect(view).toBeDefined();
    view.destroy();
    host.remove();
  });

  it("renders single-line block math $$ formula $$", () => {
    const doc = "$$x^2 + y^2 = 1$$\n\n外部文本";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf("外部文本")),
    });

    const decos = buildLivePreviewDecorations(state);
    let found = false;
    decos.between(0, doc.length, (_from, _to, deco) => {
      if (deco.spec.widget?.constructor.name === "BlockMathWidget") {
        found = true;
      }
    });

    expect(found).toBe(true);
  });

  /**
   * 回归：渲染表格底部凭空多出一大段空白。
   *
   * 成因：`.cm-content` 是 `white-space: pre`（CodeMirror 基础主题），
   * markdown-it 的输出形如 `<table>…</table>\n`，这个末尾换行会被当成
   * **真实的换行**渲染，在表格下方撑出整整一行（约 24px）。
   * 实测 Widget 高 122px，而内部 table 只有 94px。
   *
   * 修复要同时满足两点，缺一不可：
   *   1. innerHTML 用 trim() 去掉首尾空白；
   *   2. Widget 自己声明 white-space: normal，不再继承 pre。
   */
  it("does not add trailing whitespace height to the table widget", async () => {
    const doc = "| a | b |\n| - | - |\n| 1 | 2 |\n\n外部文本";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf("外部文本")),
      extensions: [livePreview(true)],
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({ state, parent: host });

    const wrap = host.querySelector(".cm-live-table-widget") as HTMLElement;
    expect(wrap).not.toBeNull();

    // 1) 渲染结果首尾不能残留空白文本（换行在 white-space: pre 下会占一整行）
    const leadingOrTrailing = /^\s|\s$/.test(wrap.innerHTML);
    expect(
      leadingOrTrailing,
      `table widget HTML must not start/end with whitespace, got: ${JSON.stringify(
        wrap.innerHTML.slice(-24),
      )}`,
    ).toBe(false);

    // 2) 直接子节点里不能有纯空白文本节点
    const blankTextChildren = Array.from(wrap.childNodes).filter(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() === "",
    );
    expect(blankTextChildren).toHaveLength(0);

    // 3) CSS 必须把 white-space 还原为 normal，阻断 pre 的继承
    const css = (await import("node:fs")).readFileSync(
      (await import("node:path")).resolve(__dirname, "../components/editor/editor.css"),
      "utf8",
    );
    const block = css.match(/\.cm-live-table-widget\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block, "missing .cm-live-table-widget rule").not.toBe("");
    expect(
      block,
      "the table widget must reset white-space so the inherited `pre` cannot render stray newlines",
    ).toMatch(/white-space:\s*normal/);

    view.destroy();
    host.remove();
  });
});
