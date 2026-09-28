import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { Compartment, type Extension, type Range } from "@codemirror/state";

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
 * 遍历可见文档并构建 Live Preview（即时渲染）装饰集。
 * 核心机制：光标所在的活跃行保留原始 Markdown 源码，离开的非活跃行自动隐藏标记并呈现渲染效果。
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
    for (let ln = startLn; ln <= endLn; ln++) {
      activeLineNumbers.add(ln);
    }
  }

  // 2. 遍历可见区域或整个文档构建装饰
  for (let ln = 1; ln <= doc.lines; ln++) {
    const line = doc.line(ln);
    const lineText = line.text;
    const isActive = activeLineNumbers.has(ln);

    // 2.1 标题处理：# ~ ######
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

    // 2.2 水平分割线：---, ***, ___
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

    // 2.3 任务清单：- [ ] 或 - [x]
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

    // 2.4 引用行：>
    const quoteMatch = lineText.match(/^(\s*>)\s*/);
    if (quoteMatch) {
      decos.push(Decoration.line({ class: "cm-live-quote" }).range(line.from));
      if (!isActive) {
        decos.push(
          Decoration.replace({}).range(line.from, line.from + quoteMatch[0].length),
        );
      }
    }

    // 2.5 行内样式渲染（仅当光标不在该行时折叠前后标记并美化）：
    if (!isActive) {
      // 2.5.1 加粗：**文本** 或 __文本__
      const boldRegex = /(\*\*|__)(?!\s)(.+?)(?<!\s)\1/g;
      let match: RegExpExecArray | null;
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

      // 2.5.2 行内代码：`代码`
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

      // 2.5.3 删除线：~~文本~~
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

      // 2.5.4 斜体：*文本* 或 _文本_
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
