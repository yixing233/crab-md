import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { Compartment, type Extension, type Range } from "@codemirror/state";
import katex from "katex";
import { renderMarkdown } from "./markdown";
import { isMarkdownTableRow } from "./tableHelper";

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
  constructor(readonly formula: string) {
    super();
  }

  eq(other: InlineMathWidget) {
    return this.formula === other.formula;
  }

  toDOM() {
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
    return span;
  }
}

/**
 * 块级独立数学公式 Widget ($$\n...\n$$)
 */
class BlockMathWidget extends WidgetType {
  constructor(readonly formula: string) {
    super();
  }

  eq(other: BlockMathWidget) {
    return this.formula === other.formula;
  }

  toDOM() {
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
    return div;
  }
}

/**
 * 代码块题头语言 Widget
 */
class CodeBlockHeaderWidget extends WidgetType {
  constructor(readonly language: string) {
    super();
  }

  eq(other: CodeBlockHeaderWidget) {
    return this.language === other.language;
  }

  toDOM() {
    const header = document.createElement("div");
    header.className = "cm-live-code-header-widget";
    if (this.language) {
      const lang = document.createElement("span");
      lang.className = "cm-live-code-lang";
      lang.textContent = this.language;
      header.appendChild(lang);
    }
    return header;
  }
}

/**
 * 所见即所得实时表格 Widget
 */
class LiveTableWidget extends WidgetType {
  constructor(readonly markdown: string) {
    super();
  }

  eq(other: LiveTableWidget) {
    return this.markdown === other.markdown;
  }

  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-live-table-widget";
    wrap.innerHTML = renderMarkdown(this.markdown);
    return wrap;
  }
}

/**
 * 遍历可见文档并构建 Live Preview（即时渲染）装饰集。
 * 核心机制：光标所在的活跃行/块保留原始 Markdown 源码，离开后自动隐藏标记并呈现渲染效果。
 */
export function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const state = view.state;
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

    // A. 块级数学公式识别：$$\n...\n$$
    if (lineText.trim() === "$$") {
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
          decos.push(
            Decoration.replace({
              widget: new BlockMathWidget(formula),
              block: true,
            }).range(startLine.from, endLine.to),
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

        if (!touchesCaret) {
          // 顶部栏显示语言标签并折叠 ```lang
          decos.push(
            Decoration.line({ class: "cm-live-code-line cm-live-code-line--header" }).range(startLine.from),
          );
          decos.push(
            Decoration.replace({
              widget: new CodeBlockHeaderWidget(lang),
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

    // C. Markdown 表格多行识别
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
          decos.push(
            Decoration.replace({
              widget: new LiveTableWidget(tableMarkdown),
              block: true,
            }).range(startLine.from, endLine.to),
          );
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

    // D.5 行内样式渲染（仅当光标不在该行时折叠前后标记并美化）：
    if (!isActive) {
      // D.5.1 行内数学公式：$formula$
      const mathRegex = /(?<!\$)\$([^\$\n]+?)\$(?!\$)/g;
      let match: RegExpExecArray | null;
      while ((match = mathRegex.exec(lineText)) !== null) {
        const start = line.from + match.index;
        const end = start + match[0].length;
        const formula = match[1];

        decos.push(
          Decoration.replace({
            widget: new InlineMathWidget(formula),
          }).range(start, end),
        );
      }

      // D.5.2 加粗：**文本** 或 __文本__
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
 * CodeMirror 6 实时即时渲染 ViewPlugin
 */
export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLivePreviewDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

/**
 * 动态配置隔间，支持零延迟无缝开关 Live Preview
 */
export const livePreviewCompartment = new Compartment();

/**
 * 导出 Live Preview 扩展装配器
 */
export function livePreview(enabled = true): Extension {
  return livePreviewCompartment.of(enabled ? [livePreviewPlugin] : []);
}
