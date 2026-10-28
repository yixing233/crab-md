/**
 * 写作模式（打字机滚动 + 当前段落聚焦）。
 *
 * 拆成纯函数 + 薄扩展：滚动量与段落区间的计算可独立单测，
 * jsdom 里没有真实布局，直接测 ViewPlugin 反而测不到任何东西。
 */
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder, type Extension } from "@codemirror/state";

/**
 * 打字机滚动：光标应吸附的视口高度比例（38%，略高于中心）。
 * 太居中会把正文实际可见区压得太小，略偏上更接近纸面写作的视线位置。
 */
export const TYPEWRITER_ANCHOR = 0.38;

/**
 * 计算把光标行滚到锚点位置所需的 scrollTop 增量。
 *
 * 返回 0 表示无需滚动（已在锚点附近 ±2px 容差内）。
 * 抽成纯函数是为了可测：布局数值全部由调用方传入。
 */
export function typewriterScrollDelta(
  cursorTop: number,
  scrollerTop: number,
  viewportHeight: number,
  anchor: number = TYPEWRITER_ANCHOR,
): number {
  const target = scrollerTop + viewportHeight * anchor;
  const delta = cursorTop - target;
  return Math.abs(delta) < 2 ? 0 : delta;
}

/**
 * 打字机滚动扩展：每次文档变更（键入）后把光标行吸附到视口锚点。
 *
 * 只在 docChanged 时动作：选区变化（点击、方向键）不动视口，
 * 那是读者的滚动自主权；写作时跟随的是输入，不是浏览。
 * rAF 一帧后执行：CodeMirror 需要先完成自身的测量与布局。
 */
export function typewriterScroll(): Extension {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged) return;
    const view = update.view;
    requestAnimationFrame(() => {
      if (!view.dom.isConnected) return;
      const coords = view.coordsAtPos(view.state.selection.main.head);
      if (!coords) return;
      const scroller = view.scrollDOM;
      const delta = typewriterScrollDelta(coords.top, scroller.getBoundingClientRect().top, scroller.clientHeight);
      if (delta !== 0) scroller.scrollTop += delta;
    });
  });
}

/**
 * 光标所在「段落」的行区间（闭区间，0 基）：以空行为块边界的连续非空行。
 *
 * 返回 null 表示没有可聚焦的段落（空文档等）。
 */
export function focusedParagraphRange(
  lines: readonly string[],
  activeIndex: number,
): [number, number] | null {
  if (lines.length === 0 || activeIndex < 0 || activeIndex >= lines.length) return null;
  let start = activeIndex;
  let end = activeIndex;
  while (start > 0 && lines[start - 1].trim() !== "") start -= 1;
  while (end < lines.length - 1 && lines[end + 1].trim() !== "") end += 1;
  return [start, end];
}

const focusedLineDeco = Decoration.line({ class: "cm-para-focus" });

/**
 * 当前段落聚焦扩展。
 *
 * 用「全体变暗 + 活跃段落提亮」的反向思路：装饰只加在活跃段落的那
 * 几行（数量恒定且小），而不是给其余全部行加 dim —— 千行文档里前者
 * 是 O(段落)，后者是 O(文档)。
 * `cm-writing-dim` 类同时挂在内容元素上驱动 CSS 变暗。
 */
export function paragraphFocus(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged) {
          this.decorations = this.build(u.view);
        }
      }
      build(view: EditorView): DecorationSet {
        const doc = view.state.doc;
        const lines: string[] = [];
        for (let ln = 1; ln <= doc.lines; ln++) lines.push(doc.line(ln).text);
        const range = focusedParagraphRange(lines, doc.lineAt(view.state.selection.main.head).number - 1);
        const builder = new RangeSetBuilder<Decoration>();
        if (range) {
          for (let ln = range[0] + 1; ln <= range[1] + 1; ln++) {
            const line = doc.line(ln);
            builder.add(line.from, line.from, focusedLineDeco);
          }
        }
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [
    plugin,
    EditorView.contentAttributes.of({ class: "cm-writing-dim" }),
  ];
}
