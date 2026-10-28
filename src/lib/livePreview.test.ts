import { describe, expect, it, vi } from "vitest";
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

  /**
   * 回归：列表项里的 `[文字](链接)` 完全不参与即时渲染，一直以原始源码呈现。
   *
   * 成因：D 段的行内规则只覆盖了加粗/行内代码/删除线/斜体，从来没有链接规则
   * （全仓库历史上也不存在 `cm-live-link`）。预览侧能显示是因为它走
   * markdown-it + DOMPurify，与本文件无关。
   */
  it("renders inline links inside list items as clickable marks", () => {
    const doc = [
      "- [机场购买](https://kitty.fo/register?invite=2P6SVT55)",
      "- 使用qq，Google邮箱注册[ChatGPT](https://chatgpt.com)",
      "- [ChatGPT Plus代充](https://wzyp.cn/item/as6ldw)",
      "",
      "光标在此",
    ].join("\n");

    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf("光标在此")),
    });
    const view = new EditorView({ state });
    const decos = buildLivePreviewDecorations(view);

    const marks: { from: number; to: number; href: string | undefined }[] = [];
    const hidden: { from: number; to: number }[] = [];
    decos.between(0, doc.length, (from, to, deco) => {
      if (deco.spec.class === "cm-live-link") {
        marks.push({ from, to, href: deco.spec.attributes?.["data-href"] });
      } else if (deco.spec.widget === undefined && to > from) {
        hidden.push({ from, to });
      }
    });

    // 三条链接都被标记成 .cm-live-link
    expect(marks).toHaveLength(3);

    // 第 1 行：整行就是一个链接，标记只包住文字
    expect(marks[0].href).toBe("https://kitty.fo/register?invite=2P6SVT55");
    expect(doc.slice(marks[0].from, marks[0].to)).toBe("机场购买");

    // 第 2 行：链接在行中间，前面的正文必须保持原样（不被折叠进去）
    expect(marks[1].href).toBe("https://chatgpt.com");
    expect(doc.slice(marks[1].from, marks[1].to)).toBe("ChatGPT");
    expect(doc.slice(state.doc.line(2).from, marks[1].from - 1)).toBe("- 使用qq，Google邮箱注册");

    // 每条链接两侧的 `[` / `](url)` 都要被折叠掉，否则会与文字重复显示
    for (const mark of marks) {
      const before = hidden.find((h) => h.to === mark.from);
      const after = hidden.find((h) => h.from === mark.to);
      expect(before, `missing '[' hide for ${mark.href}`).toBeDefined();
      expect(after, `missing '](url)' hide for ${mark.href}`).toBeDefined();
      expect(doc[before!.from]).toBe("[");
      expect(doc.slice(mark.to, after!.to)).toMatch(/^\]\(.*\)$/);
    }

    // 原始地址里那个 `?…=0` 结尾的更长链接也要完整吞掉（不能只折到 `=`）
    const longUrl =
      "https://alist.157342.xyz/d/BaiduNetdisk/share/FIClash-0.8.93-windows-amd64-setup.exe?sign=EsQgNBWBSwz6aBMf1Zs9nPDzv1RqNOHr9mOmm2EjI=0";
    const longDoc = `- [代理工具下载](${longUrl})\n\n光标在此`;
    const longState = EditorState.create({
      doc: longDoc,
      selection: EditorSelection.cursor(longDoc.indexOf("光标在此")),
    });
    const longDecos = buildLivePreviewDecorations(longState);
    let foldedTo = -1;
    let longHref: string | undefined;
    longDecos.between(0, longDoc.length, (_from, to, deco) => {
      if (deco.spec.class === "cm-live-link") longHref = deco.spec.attributes?.["data-href"];
      if (deco.spec.widget === undefined && to > _from && to > foldedTo) foldedTo = to;
    });
    expect(longHref).toBe(longUrl);
    expect(foldedTo).toBe(longDoc.indexOf(")\n") + 1);

    view.destroy();
  });

  it("leaves the active link line as raw markdown and ignores image syntax", () => {
    const doc = "- [机场购买](https://kitty.fo/x)\n![图](./a.png)\n\n光标在此";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(0), // 光标在第 1 行
    });
    const decos = buildLivePreviewDecorations(state);

    let linkMarkFound = false;
    decos.between(0, doc.length, (_from, _to, deco) => {
      if (deco.spec.class === "cm-live-link") linkMarkFound = true;
    });

    // 光标所在行保留源码，不渲染
    expect(linkMarkFound).toBe(false);

    // 光标离开后，图片语法 `![alt](src)` 不会被当成链接
    const state2 = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf("光标在此")),
    });
    const decos2 = buildLivePreviewDecorations(state2);
    let linkFoundAfter = false;
    decos2.between(0, doc.length, (_from, _to, deco) => {
      if (deco.spec.class === "cm-live-link") linkFoundAfter = true;
    });
    expect(linkFoundAfter).toBe(true); // 第 1 行的链接渲染了
    // 第 2 行的 `![图](./a.png)` 里没有 URL 被当作链接
    let imageUrlTreatedAsLink = false;
    decos2.between(doc.indexOf("![图]"), doc.length, (_from, _to, deco) => {
      if (deco.spec.class === "cm-live-link") imageUrlTreatedAsLink = true;
    });
    expect(imageUrlTreatedAsLink).toBe(false);
  });

  it("skips empty link text or empty target instead of throwing", () => {
    // 空文字会生成零长度 mark，MarkDecoration.range() 会抛
    // `RangeError: Mark decorations may not be empty`，必须提前跳过。
    const doc = "- [](https://a.com)\n- [文字]()\n\n光标在此";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf("光标在此")),
    });

    expect(() => buildLivePreviewDecorations(state)).not.toThrow();

    const view = new EditorView({ state });
    const decos = buildLivePreviewDecorations(view);
    let linkMarkFound = false;
    decos.between(0, doc.length, (_from, _to, deco) => {
      if (deco.spec.class === "cm-live-link") linkMarkFound = true;
    });
    expect(linkMarkFound).toBe(false);
    view.destroy();
  });

  it("folds plain list markers into bullets", () => {
    const doc = [
      "- 机场购买",
      "* 星号列表",
      "+ 加号列表",
      "  - 缩进子项",
      "- [ ] 任务项",
      "- - -",
      "",
      "光标在此",
    ].join("\n");
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf("光标在此")),
    });
    const decos = buildLivePreviewDecorations(state);

    const bullets: { from: number; to: number; text: string }[] = [];
    let taskWidgetFound = false;
    decos.between(0, doc.length, (from, to, deco) => {
      // Widget 的类名挂在 widget 实例上（Decoration.replace 的 spec.class 为空）
      if (deco.spec.widget?.constructor.name === "BulletListWidget") {
        bullets.push({ from, to, text: doc.slice(from, to) });
      }
      if (deco.spec.widget?.constructor.name === "TaskCheckboxWidget") taskWidgetFound = true;
    });

    // 三条普通列表各折叠掉一个标记字符，缩进子项也算一条
    expect(bullets.map((b) => b.text)).toEqual(["-", "*", "+", "-"]);
    // 折叠的必须恰好是标记字符本身，不能吞掉后面的空格
    expect(doc.slice(bullets[0].from, bullets[0].to + 1)).toBe("- ");
    // 缩进子项只折叠它自己那个 `-`（前面两个空格留着）
    expect(bullets[3].from).toBe(doc.indexOf("  - 缩进子项") + 2);

    // 任务清单仍归复选框管，不能被圆点抢走（`- [ ]` 的 `-` 保持源码）
    expect(taskWidgetFound).toBe(true);
    expect(bullets.some((b) => doc.slice(b.from, b.to + 6) === "- [ ] ")).toBe(false);

    // `- - -` 是主题分隔线，不是列表项：不能有圆点
    const hrLineFrom = doc.indexOf("- - -");
    expect(bullets.some((b) => b.from >= hrLineFrom)).toBe(false);
  });

  it("leaves the active list line marker as raw source", () => {
    const doc = "- 甲\n- 乙\n\n光标在此";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(0), // 光标在第 1 行
    });
    const decos = buildLivePreviewDecorations(state);

    const bullets: number[] = [];
    decos.between(0, doc.length, (from, _to, deco) => {
      if (deco.spec.widget?.constructor.name === "BulletListWidget") bullets.push(from);
    });
    // 第 1 行是活跃行，保留 `-` 供编辑；第 2 行渲染成圆点
    expect(bullets).toEqual([doc.indexOf("- 乙")]);
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

  it("renders the code block header with a lowercase language label and an icon-only copy button", () => {
    const doc = "```cpp\nconst char* p;\n```\n\n外部文本";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf("外部文本")),
      extensions: [livePreview(true)],
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({ state, parent: host });

    const header = host.querySelector(".cm-live-code-header") as HTMLElement;
    expect(header).not.toBeNull();

    // 语言名：左上、小写（参考图里是 `cpp` 而不是 `CPP`）
    const lang = header.querySelector(".cm-live-code-lang") as HTMLElement;
    expect(lang.textContent).toBe("cpp");

    // 复制按钮：纯图标，没有「复制」文字
    const copy = header.querySelector(".cm-live-code-copy") as HTMLButtonElement;
    expect(copy).not.toBeNull();
    expect(copy.querySelector("svg")).not.toBeNull();
    expect(copy.textContent?.trim()).toBe("");
    expect(copy.getAttribute("aria-label")).toBe("复制代码");

    view.destroy();
    host.remove();
  });

  it("copies the raw fenced code without the fence markers", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
      writable: true,
    });

    const doc = "```cpp\nconst char* p;\nint x = 1;\n```\n\n外部文本";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf("外部文本")),
      extensions: [livePreview(true)],
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = new EditorView({ state, parent: host });

    const copy = host.querySelector(".cm-live-code-copy") as HTMLButtonElement;
    copy.click();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    // 不能把 ```cpp / ``` 一起复制进去
    expect(copied).not.toContain("```");
    expect(copied).toContain("const char* p;");
    expect(copied).toContain("int x = 1;");

    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    view.destroy();
    host.remove();
  });
});

/** [[Wiki 链接]]：与 markdown.ts 的 parseWikiLink 同一套规则的编辑器侧呈现。 */
describe("livePreview wiki links", () => {
  function wikiMarks(doc: string) {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
    });
    const view = new EditorView({ state });
    const marks: { text: string; href: string }[] = [];
    const hidden: { from: number; to: number }[] = [];
    const decos = buildLivePreviewDecorations(view);
    decos.between(0, doc.length, (from, to, deco) => {
      if (deco.spec.class?.includes("cm-live-wiki-link")) {
        marks.push({ text: doc.slice(from, to), href: deco.spec.attributes?.["data-href"] });
      } else if (deco.spec.widget === undefined && to > from) {
        hidden.push({ from, to });
      }
    });
    view.destroy();
    return { marks, hidden };
  }

  it("hides the brackets and marks the target as a live link", () => {
    const doc = "见 [[下一节]]。\n";
    const { marks, hidden } = wikiMarks(doc);

    expect(marks).toHaveLength(1);
    expect(marks[0].text).toBe("下一节");
    expect(marks[0].href).toBe("下一节.md");

    const before = hidden.find((h) => h.to === doc.indexOf("下一节"));
    const after = hidden.find((h) => h.from === doc.indexOf("下一节") + "下一节".length);
    expect(doc.slice(before!.from, before!.to)).toBe("[[");
    expect(doc.slice(after!.from, after!.to)).toBe("]]");
  });

  it("collapses the target and pipe for alias form, keeping only the alias visible", () => {
    const doc = "[[目标笔记|显示名字]]\n";
    const { marks, hidden } = wikiMarks(doc);

    expect(marks).toHaveLength(1);
    expect(marks[0].text).toBe("显示名字");
    expect(marks[0].href).toBe("目标笔记.md");

    const before = hidden.find((h) => h.to === doc.indexOf("显示名字"));
    expect(doc.slice(before!.from, before!.to)).toBe("[[目标笔记|");
  });

  it("carries anchors into data-href for Ctrl+click routing", () => {
    const doc = "[[目标#小节]]\n";
    const { marks } = wikiMarks(doc);
    expect(marks[0].href).toBe("目标.md#小节");
    expect(marks[0].text).toBe("目标#小节");
  });
});
