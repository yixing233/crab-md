import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { Compartment, type Extension, type Range, StateField, EditorState } from "@codemirror/state";
import katex from "katex";
import { renderMarkdown } from "./markdown";
import { isMarkdownTableRow } from "./tableHelper";
import { getRenderToggles } from "./renderToggles";
import { CHECK_ICON_SVG, COPY_ICON_SVG } from "./codeBlockIcons";

/**
 * 任务清单复选框 Widget：在编辑器中把 `- [ ] ` 与 `- [x] ` 原地替换为可交互复选框。
 * 点击复选框直接在文档源码中分发对应字符替换。
 */
class TaskCheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly lineFrom: number,
    readonly lineText: string,
  ) {
    super();
  }

  eq(other: TaskCheckboxWidget) {
    return this.checked === other.checked && this.lineFrom === other.lineFrom;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "cm-live-task-wrap";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.className = "cm-live-task-checkbox";
    checkbox.setAttribute("aria-label", "任务清单状态");

    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      const newMarker = this.checked ? "- [ ] " : "- [x] ";
      const match = this.lineText.match(/^(\s*[-*+]\s+\[[ xX]\]\s+)/);
      if (match) {
        view.dispatch({
          changes: {
            from: this.lineFrom,
            to: this.lineFrom + match[0].length,
            insert: newMarker,
          },
        });
      }
    });

    wrap.appendChild(checkbox);
    return wrap;
  }
}

/**
 * 无序列表项目符号 Widget：把 `- ` / `* ` / `+ ` 折叠成真正的圆点。
 *
 * 即时渲染此前只处理任务清单（`- [ ] ` 换成复选框），普通列表项一直原样显示
 * 源码里的 `-`。预览态由 markdown-it 渲染成 `<ul><li>`，浏览器画的是圆点，
 * 两边观感对不上，看起来就像「列表没渲染」。
 *
 * 缩进层级决定圆点样式，与 markdown-it 的 disc / circle / square 一致。
 */
class BulletListWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }

  eq(other: BulletListWidget) {
    return this.depth === other.depth;
  }

  // 圆点本身就是「这里的 - 被渲染了」的视觉替代，点击它应当照常落光标。
  ignoreEvent() {
    return false;
  }

  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-live-bullet";
    // depth 由缩进宽度推得，最多三级，与 markdown-it 的层级符号对应。
    span.textContent = this.depth === 0 ? "•" : this.depth === 1 ? "◦" : "▪";
    return span;
  }
}

/**
 * 水平分割线 Widget：把 `---`, `***`, `___` 原地折叠并渲染为真实水平线。
 */
class HorizontalRuleWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const hr = document.createElement("hr");
    hr.className = "cm-live-hr";
    return hr;
  }
}

/**
 * 行内数学公式 Widget ($formula$)
 */
class InlineMathWidget extends WidgetType {
  constructor(
    readonly formula: string,
    readonly from: number,
  ) {
    super();
  }

  eq(other: InlineMathWidget) {
    return this.formula === other.formula && this.from === other.from;
  }

  ignoreEvent() {
    return false;
  }

  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = "cm-live-inline-math-widget";
    try {
      span.innerHTML = katex.renderToString(this.formula.trim(), {
        displayMode: false,
        throwOnError: false,
      });
    } catch {
      span.textContent = `$${this.formula}$`;
    }
    span.addEventListener("mousedown", () => {
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return span;
  }
}

/**
 * 块级独立数学公式 Widget ($$\n...\n$$)
 */
class BlockMathWidget extends WidgetType {
  constructor(
    readonly formula: string,
    readonly from: number,
  ) {
    super();
  }

  eq(other: BlockMathWidget) {
    return this.formula === other.formula && this.from === other.from;
  }

  ignoreEvent() {
    return false;
  }

  toDOM(view: EditorView) {
    const div = document.createElement("div");
    div.className = "cm-live-block-math-widget";
    try {
      div.innerHTML = katex.renderToString(this.formula.trim(), {
        displayMode: true,
        throwOnError: false,
      });
    } catch {
      div.textContent = `$$ ${this.formula} $$`;
    }
    div.addEventListener("mousedown", () => {
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return div;
  }
}

/**
 * 代码块题头 Widget（左上语言名 + 右上复制按钮）
 *
 * 与预览栏 `markdown.ts` 的 fence 渲染器保持同一形态：语言名小写靠左，
 * 复制按钮为纯图标靠右。这里**不覆盖** `ignoreEvent`，即沿用 `WidgetType`
 * 默认的 `true` —— 题头整行都被替换成了 widget，点击它不应移动光标
 * （按钮自己的 DOM 监听器不受影响，见 `eventBelongsToEditor`）。
 */
class CodeBlockHeaderWidget extends WidgetType {
  constructor(
    readonly language: string,
    readonly code: string,
  ) {
    super();
  }

  eq(other: CodeBlockHeaderWidget) {
    return this.language === other.language && this.code === other.code;
  }

  toDOM() {
    const row = document.createElement("div");
    row.className = "cm-live-code-header";

    const lang = document.createElement("span");
    lang.className = "cm-live-code-lang";
    if (this.language) {
      lang.textContent = this.language;
    } else {
      lang.style.display = "none";
    }

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "cm-live-code-copy";
    copy.setAttribute("aria-label", "复制代码");
    copy.title = "复制代码";
    copy.innerHTML = COPY_ICON_SVG;

    // mousedown 阶段就 preventDefault，避免按钮抢走编辑器的焦点
    copy.addEventListener("mousedown", (event) => event.preventDefault());
    copy.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
      void navigator.clipboard.writeText(this.code);
      copy.dataset.copied = "true";
      copy.innerHTML = CHECK_ICON_SVG;
      setTimeout(() => {
        delete copy.dataset.copied;
        copy.innerHTML = COPY_ICON_SVG;
      }, 1500);
    });

    row.append(lang, copy);
    return row;
  }
}

/**
 * 所见即所得真实可视化表格 Widget
 */
class LiveTableWidget extends WidgetType {
  constructor(
    readonly markdown: string,
    readonly startLn: number,
    readonly tableFrom: number,
    readonly tableLines: string[],
  ) {
    super();
  }

  eq(other: LiveTableWidget) {
    return this.markdown === other.markdown && this.tableFrom === other.tableFrom;
  }

  ignoreEvent() {
    return false;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-live-table-widget";
    // 必须去掉首尾空白：`.cm-content` 是 `white-space: pre`（CodeMirror 基础主题），
    // markdown-it 的输出形如 `<table>…</table>\n`，那个末尾换行会被当成
    // **真实的一次换行**渲染出来，于是表格下方凭空多出整整一行（约 24px）。
    // 这就是「渲染后的表格底部总是有一大段间距」的成因。
    wrap.innerHTML = renderMarkdown(this.markdown).trim();

    // 为每个单元格添加点击侦听，精确导航到对应的行列
    const cells = wrap.querySelectorAll("th, td");
    cells.forEach((cell) => {
      cell.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        const tr = cell.closest("tr");
        if (!tr) return;
        const rowIndex = (tr as HTMLTableRowElement).rowIndex;
        // 在 Markdown 中，第 0 行是表头，第 1 行是分隔行 |---|，第 2 行起是数据行
        let docLineNumber = this.startLn + rowIndex;
        if (rowIndex > 0) {
          docLineNumber += 1; // 跨过分隔行
        }
        if (docLineNumber <= view.state.doc.lines) {
          const line = view.state.doc.line(docLineNumber);
          view.dispatch({
            selection: { anchor: Math.min(line.from + 2, line.to) },
          });
          view.focus();
        }
      });
    });

    return wrap;
  }
}

/**
 * 遍历可见文档并构建 Live Preview（即时渲染）装饰集。
 * 核心机制：光标所在的活跃行/块保留原始 Markdown 源码，离开后自动隐藏标记并呈现渲染效果。
 */
export function buildLivePreviewDecorations(stateOrView: EditorState | EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const state = "state" in stateOrView ? stateOrView.state : stateOrView;
  const doc = state.doc;

  // 1. 收集当前光标所处的全部行范围（含所有选区覆盖的行）
  const activeLineNumbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLn = doc.lineAt(range.from).number;
    const endLn = doc.lineAt(range.to).number;
    for (let l = startLn; l <= endLn; l++) {
      activeLineNumbers.add(l);
    }
  }

  let ln = 1;
  while (ln <= doc.lines) {
    const line = doc.line(ln);
    const lineText = line.text;

    // A.1 单行独立数学公式：$$ formula $$（「渲染公式」关闭时保持源码）
    const singleLineMath = lineText.match(/^\s*\$\$(.+?)\$\$\s*$/);
    if (singleLineMath && getRenderToggles().math) {
      const formula = singleLineMath[1];
      const touchesCaret = state.selection.ranges.some(
        (r) => r.from <= line.to && r.to >= line.from,
      );
      if (!touchesCaret) {
        const blockTo = ln < doc.lines ? doc.line(ln + 1).from : line.to;
        decos.push(
          Decoration.replace({
            widget: new BlockMathWidget(formula, line.from),
            block: true,
          }).range(line.from, blockTo),
        );
      }
      ln++;
      continue;
    }

    // A.2 多行独立数学公式识别：$$\n...\n$$（同受「渲染公式」开关约束）
    if (lineText.trim() === "$$" && getRenderToggles().math) {
      let endLn = ln + 1;
      while (endLn <= doc.lines && doc.line(endLn).text.trim() !== "$$") {
        endLn++;
      }
      if (endLn <= doc.lines) {
        const startLine = doc.line(ln);
        const endLine = doc.line(endLn);
        const touchesCaret = state.selection.ranges.some(
          (r) => r.from <= endLine.to && r.to >= startLine.from,
        );

        if (!touchesCaret) {
          const formulaLines: string[] = [];
          for (let k = ln + 1; k < endLn; k++) {
            formulaLines.push(doc.line(k).text);
          }
          const formula = formulaLines.join("\n");
          const blockTo = endLn < doc.lines ? doc.line(endLn + 1).from : endLine.to;
          decos.push(
            Decoration.replace({
              widget: new BlockMathWidget(formula, startLine.from),
              block: true,
            }).range(startLine.from, blockTo),
          );
        }
        ln = endLn + 1;
        continue;
      }
    }

    // B. 围栏代码块识别：```lang\n...\n```
    const codeBlockStart = lineText.match(/^```([a-zA-Z0-9_-]*)/);
    if (codeBlockStart) {
      const lang = codeBlockStart[1];
      let endLn = ln + 1;
      while (endLn <= doc.lines && !doc.line(endLn).text.match(/^```\s*$/)) {
        endLn++;
      }
      if (endLn <= doc.lines) {
        const startLine = doc.line(ln);
        const endLine = doc.line(endLn);
        const touchesCaret = state.selection.ranges.some(
          (r) => r.from <= endLine.to && r.to >= startLine.from,
        );

        // 供题头复制按钮使用的源码（去掉围栏行，保留行尾换行）
        const codeText =
          endLn > ln + 1
            ? doc.sliceString(doc.line(ln + 1).from, endLine.from)
            : "";

        if (!touchesCaret) {
          // 顶部栏显示语言标签与复制按钮并折叠 ```lang
          decos.push(
            Decoration.line({ class: "cm-live-code-line cm-live-code-line--header" }).range(startLine.from),
          );
          decos.push(
            Decoration.replace({
              widget: new CodeBlockHeaderWidget(lang, codeText),
            }).range(startLine.from, startLine.to),
          );

          // 正文行增加代码块边框底色
          for (let k = ln + 1; k < endLn; k++) {
            decos.push(
              Decoration.line({ class: "cm-live-code-line cm-live-code-line--body" }).range(doc.line(k).from),
            );
          }

          // 底部栏折叠 ```
          decos.push(
            Decoration.line({ class: "cm-live-code-line cm-live-code-line--footer" }).range(endLine.from),
          );
          decos.push(Decoration.replace({}).range(endLine.from, endLine.to));
        } else {
          // 光标在代码块内：保持 ``` 可编辑，但为每一行添加代码容器样式
          for (let k = ln; k <= endLn; k++) {
            decos.push(
              Decoration.line({ class: "cm-live-code-line cm-live-code-line--editing" }).range(doc.line(k).from),
            );
          }
        }
        ln = endLn + 1;
        continue;
      }
    }

    // C. Markdown 表格多行识别与所见即所得实时表格渲染
    if (isMarkdownTableRow(lineText)) {
      let endLn = ln;
      while (endLn < doc.lines && isMarkdownTableRow(doc.line(endLn + 1).text)) {
        endLn++;
      }
      // 表格至少要有表头和分隔行（2行以上）
      if (endLn >= ln + 1) {
        const startLine = doc.line(ln);
        const endLine = doc.line(endLn);
        const touchesCaret = state.selection.ranges.some(
          (r) => r.from <= endLine.to && r.to >= startLine.from,
        );

        if (!touchesCaret) {
          const tableLines: string[] = [];
          for (let k = ln; k <= endLn; k++) {
            tableLines.push(doc.line(k).text);
          }
          const tableMarkdown = tableLines.join("\n");
          const blockTo = endLn < doc.lines ? doc.line(endLn + 1).from : endLine.to;
          decos.push(
            Decoration.replace({
              widget: new LiveTableWidget(tableMarkdown, ln, startLine.from, tableLines),
              block: true,
            }).range(startLine.from, blockTo),
          );
        } else {
          // 光标在表格内部时：保持源码展开并提供行内卡片排版
          for (let k = ln; k <= endLn; k++) {
            const curLine = doc.line(k);
            const curText = curLine.text;
            const isHeader = k === ln;
            const isSep = k === ln + 1;
            const isLast = k === endLn;

            let lineClass = "cm-live-table-line";
            if (isHeader) lineClass += " cm-live-table-line--header";
            else if (isSep) lineClass += " cm-live-table-line--sep";
            else lineClass += " cm-live-table-line--row";

            if (isLast) lineClass += " cm-live-table-line--last";

            decos.push(Decoration.line({ class: lineClass }).range(curLine.from));

            let pipeIdx = curText.indexOf("|");
            while (pipeIdx !== -1) {
              decos.push(
                Decoration.mark({ class: "cm-live-table-pipe" }).range(
                  curLine.from + pipeIdx,
                  curLine.from + pipeIdx + 1,
                ),
              );
              pipeIdx = curText.indexOf("|", pipeIdx + 1);
            }
          }
        }

        ln = endLn + 1;
        continue;
      }
    }

    // D. 单行独立元素处理
    const isActive = activeLineNumbers.has(ln);

    // D.1 标题处理：# ~ ######
    const headingMatch = lineText.match(/^(#{1,6})\s+/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      decos.push(
        Decoration.line({
          class: `cm-live-heading cm-live-h${level}`,
        }).range(line.from),
      );
      if (!isActive) {
        // 光标不在该行时隐藏 # 标记和跟随空格
        decos.push(
          Decoration.replace({}).range(line.from, line.from + headingMatch[0].length),
        );
      }
    }

    // D.2 水平分割线：---, ***, ___
    const hrMatch = lineText.match(/^(\s*)([-*_]){3,}\s*$/);
    if (hrMatch) {
      if (!isActive) {
        decos.push(
          Decoration.replace({
            widget: new HorizontalRuleWidget(),
          }).range(line.from, line.to),
        );
      } else {
        decos.push(Decoration.line({ class: "cm-live-hr-line" }).range(line.from));
      }
    }

    // D.3 任务清单：- [ ] 或 - [x]
    const taskMatch = lineText.match(/^(\s*[-*+]\s+\[)([ xX])(\]\s+)/);
    if (taskMatch) {
      const fullMatch = taskMatch[0];
      const isChecked = taskMatch[2].toLowerCase() === "x";
      const taskFrom = line.from;
      const taskTo = line.from + fullMatch.length;

      // 如果当前光标没有紧贴或选在复选框标记字符内，替换为可交互复选框组件
      const touchesCaret = state.selection.ranges.some(
        (r) => r.from <= taskTo && r.to >= taskFrom,
      );

      if (!touchesCaret) {
        decos.push(
          Decoration.replace({
            widget: new TaskCheckboxWidget(isChecked, line.from, lineText),
          }).range(taskFrom, taskTo),
        );
      }
    }

    // D.3.1 普通无序列表：`- 甲` / `* 甲` / `+ 甲` 的标记折叠成圆点。
    //
    // 即时渲染此前只认任务清单，普通列表项一直原样显示源码里的 `-`；
    // 而预览态由 markdown-it 渲染成 <ul><li>，浏览器画的是圆点 ——
    // 两边对不上，看起来就像「列表没渲染」。
    //
    // 任务清单（`- [ ] `）已由 D.3 接管，这里必须让开，否则会把复选框
    // 的 `-` 又换成圆点。只替换标记那一个字符、保留其后的空格，宽度几乎
    // 不变，避免聚焦/失焦时整行文字左右跳动。
    //
    // 有两种「看着像列表其实不是」的写法要排除：`- - -` 这类主题分隔线
    // （行内只有 - * _ 与空白），以及 D.3 因缺少尾随空格而未接管的
    // `- [ ]`（此时 `• [ ]` 比原样更奇怪）。
    const isThematicBreak = /^[\s\-*_]+$/.test(lineText) && /[-*_]/.test(lineText);
    const looksLikeTask = /^\s*[-*+]\s+\[[ xX]\]/.test(lineText);
    const bulletMatch =
      taskMatch || isThematicBreak || looksLikeTask
        ? null
        : lineText.match(/^(\s*)([-*+])(\s+)/);
    if (bulletMatch && !isActive) {
      const markerFrom = line.from + bulletMatch[1].length;
      const level = Math.floor(bulletMatch[1].replace(/\t/g, "  ").length / 2);
      decos.push(
        Decoration.replace({
          widget: new BulletListWidget(Math.min(level, 2)),
        }).range(markerFrom, markerFrom + 1),
      );
    }

    // D.4 引用行：>
    const quoteMatch = lineText.match(/^(\s*>)\s*/);
    if (quoteMatch) {
      decos.push(Decoration.line({ class: "cm-live-quote" }).range(line.from));
      if (!isActive) {
        decos.push(
          Decoration.replace({}).range(line.from, line.from + quoteMatch[0].length),
        );
      }
    }

    // D.5 行内数学公式：$formula$（只要光标不在该公式字符内部即刻渲染，无需离开当前行；
    //     「渲染公式」关闭时保持源码，与预览侧行为一致）
    const mathRegex = /(?<!\$)\$([^\$\n]+?)\$(?!\$)/g;
    const mathEnabled = getRenderToggles().math;
    let mathMatch: RegExpExecArray | null;
    while (mathEnabled && (mathMatch = mathRegex.exec(lineText)) !== null) {
      const start = line.from + mathMatch.index;
      const end = start + mathMatch[0].length;
      const formula = mathMatch[1];

      const touchesFormula = state.selection.ranges.some(
        (r) => r.from <= end && r.to >= start,
      );

      if (!touchesFormula) {
        decos.push(
          Decoration.replace({
            widget: new InlineMathWidget(formula, start),
          }).range(start, end),
        );
      }
    }

    // D.6 行内格式渲染（仅当光标离开当前行时折叠前后标记并美化）：
    if (!isActive) {
      let match: RegExpExecArray | null;

      // D.6.1 行内链接：[文字](url)
      //
      // 之前完全没有这条规则，于是 `- [机场购买](https://…)` 这类列表项在
      // 即时渲染下始终显示原始源码（预览侧能显示成链接是因为它走的是
      // markdown-it + DOMPurify，与即时渲染无关）。
      //
      // 只认「行内链接」这一种写法：reference 形式（`[文字][ref]`）、
      // 快捷形式（`[文字]`）与裸 URL 都不在这里渲染，保持源码可见。
      //
      // 开头的 `(!?)` 用来区分图片语法 `![alt](src)`：两者只差一个 `!`，
      // 图片目前不做即时渲染，命中后直接跳过。
      const linkRegex =
        /(!?)\[([^\[\]\n]*)\]\(\s*(<[^<>\n]*>|[^\s()]*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g;
      while ((match = linkRegex.exec(lineText)) !== null) {
        if (match[1] === "!") continue; // 图片语法，留给图片规则处理

        const url = match[3].startsWith("<") ? match[3].slice(1, -1) : match[3];
        // 空文字（`[](url)`）或空地址（`[a]()`）没有可渲染的东西；
        // 而且空文字会让下面的 mark 变成零长度区间，直接抛
        // `RangeError: Mark decorations may not be empty`。
        if (match[2] === "" || url === "") continue;

        const start = line.from + match.index;
        const textStart = start + 1; // 跳过 `[`
        const textEnd = textStart + match[2].length; // `]` 的位置
        const end = start + match[0].length; // `)` 之后

        decos.push(Decoration.replace({}).range(start, textStart));
        decos.push(
          Decoration.mark({
            class: "cm-live-link",
            // data-href 供 Ctrl/Cmd+点击时取地址；title 顺带把目标暴露出来。
            attributes: { "data-href": url, title: `Ctrl/Cmd + 点击打开：${url}` },
          }).range(textStart, textEnd),
        );
        decos.push(Decoration.replace({}).range(textEnd, end));
      }

      // D.6.2 加粗：**文本** 或 __文本__
      const boldRegex = /(\*\*|__)(?!\s)(.+?)(?<!\s)\1/g;
      while ((match = boldRegex.exec(lineText)) !== null) {
        const markerLen = match[1].length;
        const start = line.from + match.index;
        const end = start + match[0].length;
        const contentStart = start + markerLen;
        const contentEnd = end - markerLen;

        decos.push(Decoration.replace({}).range(start, contentStart));
        decos.push(Decoration.mark({ class: "cm-live-bold" }).range(contentStart, contentEnd));
        decos.push(Decoration.replace({}).range(contentEnd, end));
      }

      // D.5.3 行内代码：`代码`
      const codeRegex = /(`+)(?!\s)(.+?)(?<!\s)\1/g;
      while ((match = codeRegex.exec(lineText)) !== null) {
        const markerLen = match[1].length;
        const start = line.from + match.index;
        const end = start + match[0].length;
        const contentStart = start + markerLen;
        const contentEnd = end - markerLen;

        decos.push(Decoration.replace({}).range(start, contentStart));
        decos.push(Decoration.mark({ class: "cm-live-code" }).range(contentStart, contentEnd));
        decos.push(Decoration.replace({}).range(contentEnd, end));
      }

      // D.5.4 删除线：~~文本~~
      const strikeRegex = /(~~)(?!\s)(.+?)(?<!\s)\1/g;
      while ((match = strikeRegex.exec(lineText)) !== null) {
        const markerLen = 2;
        const start = line.from + match.index;
        const end = start + match[0].length;
        const contentStart = start + markerLen;
        const contentEnd = end - markerLen;

        decos.push(Decoration.replace({}).range(start, contentStart));
        decos.push(Decoration.mark({ class: "cm-live-strikethrough" }).range(contentStart, contentEnd));
        decos.push(Decoration.replace({}).range(contentEnd, end));
      }

      // D.5.5 斜体：*文本* 或 _文本_
      const italicRegex = /(?<!\*)\*([^\s*](?:.*?[^\s*])?)\*(?!\*)|(?<!_)_([^\s_](?:.*?[^\s_])?)_(?!_)/g;
      while ((match = italicRegex.exec(lineText)) !== null) {
        const start = line.from + match.index;
        const end = start + match[0].length;
        const contentStart = start + 1;
        const contentEnd = end - 1;

        decos.push(Decoration.replace({}).range(start, contentStart));
        decos.push(Decoration.mark({ class: "cm-live-italic" }).range(contentStart, contentEnd));
        decos.push(Decoration.replace({}).range(contentEnd, end));
      }
    }

    ln++;
  }

  return Decoration.set(decos, true);
}

/**
 * 基于 CodeMirror 6 StateField 驱动的即时渲染状态字段。
 * 允许包含块级（block: true）Widget（公式块、表格等），彻底消除 Block decorations may not be specified via plugins 异常。
 */
export const livePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildLivePreviewDecorations(state);
  },
  update(decorations, tr) {
    if (tr.docChanged || tr.selection) {
      return buildLivePreviewDecorations(tr.state);
    }
    return decorations.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * 动态配置隔间，支持零延迟无缝开关 Live Preview
 */
export const livePreviewCompartment = new Compartment();

/**
 * 导出 Live Preview 扩展装配器
 */
export function livePreview(enabled = true): Extension {
  return livePreviewCompartment.of(enabled ? [livePreviewField] : []);
}
