import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { bracketMatching, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection as CmSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef, useState } from "react";
import { applyMarkdownAction, type MarkdownActionId } from "../../lib/markdownActions";
import type { EditorCjkFont, EditorLatinFont } from "../../lib/editorPrefs";
import {
  cleanupEmptyFontSpans,
  findFontSpans,
  insertFontSpan,
  removeFontFromSelection,
  selectionHasFontSpan,
} from "../../lib/fontSpan";
import { cmPhrases } from "../../lib/i18n";
import { EditorToolbar } from "./EditorToolbar";
import { EditorFontBar } from "./EditorFontBar";
import "./editor.css";

export interface MarkdownEditorProps {
  /** 当前文档 id；切换文档时重建编辑器状态。 */
  documentId: string | null;
  value: string;
  onChange: (value: string) => void;
  /** Ctrl+S 回调，用于立即落盘。 */
  onSave?: () => void;
  /** 光标位置变化（1 基行/列），供状态栏显示（UI §28）。 */
  onCursor?: (line: number, column: number) => void;
  /**
   * 请求把光标跳到某个 0 基行号（大纲点击时用）。
   * 用 `nonce` 区分「同一个行号被再次点击」，否则重复点击同一个标题不会触发。
   */
  jumpTarget?: { line: number; nonce: number } | null;
  /**
   * 请求打开查找面板（UI §29 的 Ctrl+F）。
   * 同样用 nonce：编辑器未聚焦时全局快捷键也要能把面板叫出来。
   */
  findNonce?: number;
  /** 是否显示格式工具栏（UI_DESIGN_SYSTEM.md §21.1）。 */
  showToolbar?: boolean;
  /**
   * 选区字体的目标值。设过之后**必须**用新 nonce 再次触发，
   * 否则同一字体连续应用两次不会生效。
   *
   * 走 prop 而不是 imperative ref：编辑器的 view 保持私有，
   * 工具栏只发语义化请求（与 onAction 同一套路）。
   */
  fontSpanRequest?: { stack: string; nonce: number } | null;
  /** 请求移除选区字体（nonce 同上）。 */
  clearFontNonce?: number;
  /** App 侧的「清除选区字体」动作，供编辑器内的字体条调用。 */
  onClearFont?: () => void;
  /** 选区是否已有字体 —— 供工具栏按钮显示选中态。 */
  onSelectionFontChange?: (hasFont: boolean) => void;
  /** 编辑器内快速给选区设字体（点一下即写入）。 */
  onQuickFont?: (stack: string) => void;
  /** 是否显示编辑器内的快速字体条。 */
  showFontBar?: boolean;
  /** 当前设置里的字体，供快速条的「默认」项使用。 */
  defaultLatinFont?: EditorLatinFont;
  defaultCjkFont?: EditorCjkFont;
}

/** 让 CodeMirror 读取应用主题令牌，避免出现与外壳无关的配色。 */
const appTheme = EditorView.theme({
  "&": {
    height: "100%",
    // 字号走 CSS 变量：设置页改字号时无需重建编辑器实例
    //（重建会丢光标位置与撤销历史）。
    fontSize: "var(--editor-font-size, var(--text-md))",
    backgroundColor: "var(--bg-app)",
    color: "var(--text-primary)",
  },
  ".cm-content": {
    // 字体族同样走变量，与字号一样无需重建编辑器。
    fontFamily: "var(--editor-font-family, var(--font-mono))",
    lineHeight: "var(--leading-prose)",
    padding: "var(--space-4) 0",
    // 文字插入光标。CodeMirror 基础主题写死了 `&light { caretColor: black }`，
    // 不覆盖的话深色背景下光标是黑的。
    caretColor: "var(--caret)",
  },
  // 竖线光标同理：基础主题是 `.cm-cursor { border-left: 1.2px solid black }`，
  // 亮色覆盖只写在 `&dark` 分支里。这里按令牌重设，明暗都正确。
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--caret)",
    borderLeftWidth: "2px",
  },
  ".cm-scroller": { overflow: "auto" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": {
    backgroundColor: "var(--bg-app)",
    color: "var(--text-muted)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--bg-surface)" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--selection-bg)" },
  // 括号配对高亮（UI §20 "bracket matching where useful"）。
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--accent-soft)",
    outline: "1px solid var(--border-focus)",
  },
});

/**
 * Markdown 语法高亮样式（UI §20）。
 *
 * 色值全部走主题令牌，因此明暗主题自动跟随，无需两套高亮定义。
 * 这是原先缺失的部分：只装了 markdown() 解析器而没有 HighlightStyle，
 * 所以编辑器完全没有可见着色。
 */
const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.5em", fontWeight: "600", color: "var(--text-primary)" },
  { tag: t.heading2, fontSize: "1.3em", fontWeight: "600", color: "var(--text-primary)" },
  { tag: t.heading3, fontSize: "1.15em", fontWeight: "600", color: "var(--text-primary)" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "600", color: "var(--text-primary)" },
  { tag: t.strong, fontWeight: "700", color: "var(--text-primary)" },
  { tag: t.emphasis, fontStyle: "italic", color: "var(--text-primary)" },
  { tag: t.strikethrough, textDecoration: "line-through", color: "var(--text-muted)" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline" },
  { tag: t.url, color: "var(--accent)" },
  { tag: t.monospace, color: "var(--info)" },
  { tag: t.quote, color: "var(--text-secondary)", fontStyle: "italic" },
  { tag: t.list, color: "var(--text-secondary)" },
  { tag: [t.meta, t.processingInstruction], color: "var(--text-muted)" },
  // 代码块内的语言 token：用 info / success / warning 三个语义色区分，
  // 不引入额外调色板（UI §41 要求低饱和）。
  { tag: [t.keyword, t.modifier], color: "var(--accent)" },
  { tag: [t.string, t.special(t.string)], color: "var(--success)" },
  { tag: [t.number, t.bool, t.null], color: "var(--warning)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--text-muted)", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.labelName], color: "var(--info)" },
  { tag: [t.typeName, t.className], color: "var(--text-primary)", fontWeight: "600" },
]);

/**
 * 把纯函数的 EditorChange 结果写回 CodeMirror。
 *
 * 纯函数只返回「新全文 + 新选区」，落点由这里统一处理；
 * 因此 `lib/markdownActions.ts` 无需依赖 CodeMirror，可独立单测。
 */
function dispatchAction(view: EditorView, action: MarkdownActionId): void {
  const { state } = view;
  const main = state.selection.main;

  const change = applyMarkdownAction(
    {
      text: state.doc.toString(),
      from: main.from,
      to: main.to,
    },
    action,
  );

  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: change.text },
    selection: CmSelection.range(change.from, change.to),
    // 让 Ctrl+Z 能撤销这次格式化。
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * 把「全文 + 选区」交给一个纯函数，再把结果写回编辑器。
 *
 * 与 `dispatchAction` 同一套路：文本变换都在可独立单测的纯函数里，
 * 这里只负责落点。用于选区字体这类不属于 `MarkdownActionId` 的动作。
 */
function dispatchTextChange(
  view: EditorView,
  transform: (sel: { text: string; from: number; to: number }) => {
    text: string;
    from: number;
    to: number;
  },
): void {
  const { state } = view;
  const main = state.selection.main;
  const change = transform({
    text: state.doc.toString(),
    from: main.from,
    to: main.to,
  });

  // 纯函数可能判定「无需改动」（如空选区、没有可移除的标签），
  // 此时不要 dispatch —— 会产生一个空的撤销步骤，Ctrl+Z 白按一次。
  if (change.text === state.doc.toString()) return;

  view.dispatch({
    changes: { from: 0, to: state.doc.length, insert: change.text },
    selection: CmSelection.range(change.from, change.to),
    scrollIntoView: true,
  });
  view.focus();
}

/** 取 1 基的行列号（状态栏用，UI §28）。 */
function cursorPosition(state: EditorState): { line: number; column: number } {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

/**
 * 让已在文件里的 `<span style="font-family:…">` 在**编辑状态**下也按其字体
 * 显示内部文字。
 *
 * 没有它的话，用户给一段文字设了字体却只能在预览里看到效果，编辑时毫无
 * 反馈 —— 看起来就像设置没生效。
 *
 * 用 ViewPlugin 而不是 MatchDecorator：后者只匹配开标签，装饰只会落在标签
 * 自身上，内部文字不会变。这里需要按 findFontSpans 给出的**内部范围**装饰。
 *
 * 标签本身保持默认样式：它是可移植 Markdown 的一部分，不是语法错误，
 * 不该被高亮成代码色而显得像异常。
 */
const fontSpanPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildFontDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildFontDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

function buildFontDecorations(view: EditorView): DecorationSet {
  const ranges = findFontSpans(view.state.doc.toString()).map((s) =>
    Decoration.mark({ attributes: { style: `font-family:${s.font}` } }).range(
      s.textFrom,
      s.textTo,
    ),
  );
  // 必须有序，Decoration.set 会校验。
  return Decoration.set(ranges, true);
}

export function MarkdownEditor({
  documentId,
  value,
  onChange,
  onSave,
  onCursor,
  jumpTarget,
  findNonce,
  showToolbar = true,
  fontSpanRequest,
  clearFontNonce,
  onSelectionFontChange,
  onQuickFont,
  onClearFont,
  showFontBar = true,
  defaultLatinFont,
  defaultCjkFont,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // 选区是否已有字体：决定下拉里「清除」是否出现。
  // 不再跟踪「选区是否为空」—— 无选区时改字体作用于接下来输入的内容，
  // 因此入口按钮永不因缺选区而禁用。
  const [selectionHasFontState, setSelectionHasFontState] = useState(false);
  // 用 ref 持有最新回调，避免每次渲染都重建编辑器。
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCursorRef = useRef(onCursor);
  const onSelectionFontRef = useRef(onSelectionFontChange);
  // 选区是否已有字体用 ref 上报，避免每次渲染重建编辑器。
  const onSelectionStateRef = useRef<
    ((state: { hasSelection: boolean; hasFont: boolean }) => void) | null
  >((state) => {
    setSelectionHasFontState(state.hasFont);
  });
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCursorRef.current = onCursor;
  onSelectionFontRef.current = onSelectionFontChange;

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          // codeLanguages 让围栏代码块按语言高亮；此前该依赖已在
          // package.json 里却从未被引用（UI §20）。
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(markdownHighlight),
          bracketMatching(),
          EditorView.lineWrapping,
          appTheme,
          // 让文件里已有的 <span style="font-family:…"> 在编辑时也生效。
          fontSpanPlugin,
          // CodeMirror 内置面板（查找/替换）默认英文，注入中文词表（UI §2.5）。
          EditorState.phrases.of(cmPhrases),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
            // UI_DESIGN_SYSTEM.md §29：加粗 / 斜体 / 行内代码。
            { key: "Mod-b", preventDefault: true, run: (v) => (dispatchAction(v, "bold"), true) },
            { key: "Mod-i", preventDefault: true, run: (v) => (dispatchAction(v, "italic"), true) },
            { key: "Mod-`", preventDefault: true, run: (v) => (dispatchAction(v, "inlineCode"), true) },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            // 光标移动也要更新状态栏行列号。
            if (update.selectionSet || update.docChanged) {
              const { line, column } = cursorPosition(update.state);
              onCursorRef.current?.(line, column);
            }
            // 选区是否已有字体、是否为空：决定字体入口的状态。
            if (update.selectionSet || update.docChanged) {
              const main = update.state.selection.main;
              const hasFont = selectionHasFontSpan({
                text: update.state.doc.toString(),
                from: main.from,
                to: main.to,
              });
              onSelectionFontRef.current?.(hasFont);
              onSelectionStateRef.current?.({
                hasSelection: main.from !== main.to,
                hasFont,
              });
            }
            // 光标离开后，之前为「待输入」插入的空 span 就没意义了。
            // 只在**光标移动**时清理，不在输入过程中 —— 否则刚插入的
            // 那个空 span 会在第一次输入前就被删掉，预设直接失效。
            if (update.selectionSet && !update.docChanged) {
              const text = update.state.doc.toString();
              const caret = update.state.selection.main.from;
              const cleaned = cleanupEmptyFontSpans(text, caret);
              if (cleaned.text !== text) {
                update.view.dispatch({
                  changes: { from: 0, to: text.length, insert: cleaned.text },
                  selection: CmSelection.cursor(cleaned.cursor),
                });
              }
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    // 初始光标位置也要上报，否则状态栏在打开文档前是空的。
    const { line, column } = cursorPosition(view.state);
    onCursorRef.current?.(line, column);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 仅在切换文档时重建；value 变化走下面的同步分支。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // 外部内容变化（例如切换文档后打开）时同步进编辑器。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  // 大纲跳转：把光标移到目标行并滚动到可见位置。
  // 依赖 nonce 而不是 line，这样反复点击同一个标题也会重新跳转。
  const jumpNonce = jumpTarget?.nonce;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !jumpTarget) return;

    // 行号可能因为编辑而越界，先夹到合法范围再取。
    const total = view.state.doc.lines;
    const lineNo = Math.min(Math.max(1, jumpTarget.line + 1), total);
    const line = view.state.doc.line(lineNo);

    view.dispatch({
      selection: CmSelection.cursor(line.from),
      scrollIntoView: true,
    });
    view.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpNonce]);

  // 全局 Ctrl+F：编辑器未聚焦时也要能打开查找面板。
  // searchKeymap 只在编辑器有焦点时生效，所以这里显式补一条。
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !findNonce) return;
    view.focus();
    // openSearchPanel 由 @codemirror/search 提供。
    void import("@codemirror/search").then(({ openSearchPanel }) => {
      openSearchPanel(view);
    });
  }, [findNonce]);

  // 设置字体。依赖 nonce：同一字体连点两次也要重新生效。
  //
  // 有选区时包住选区；**没有选区时插入一对空 span 并把光标放进去**，
  // 于是接下来输入的内容自动带上该字体（用户明确要求的行为）。
  const fontNonce = fontSpanRequest?.nonce;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !fontSpanRequest) return;
    dispatchTextChange(view, (sel) => insertFontSpan(sel, fontSpanRequest.stack));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontNonce]);

  // 移除选区字体。
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !clearFontNonce) return;
    const change = removeFontFromSelection({
      text: view.state.doc.toString(),
      from: view.state.selection.main.from,
      to: view.state.selection.main.to,
    });
    // 选区外层没有 font span 时，「清除」还要能撤掉光标处那个**待输入的
    // 空 span**（用户点了字体却还没打字，然后又点清除）。
    const r =
      change.text === view.state.doc.toString()
        ? cleanupEmptyFontSpans(
            view.state.doc.toString(),
            view.state.selection.main.from,
          )
        : { text: change.text, cursor: change.from };

    if (r.text !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: r.text },
        selection: CmSelection.cursor(r.cursor),
        scrollIntoView: true,
      });
    }
    view.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearFontNonce]);

  const handleAction = (action: MarkdownActionId) => {
    const view = viewRef.current;
    if (view) dispatchAction(view, action);
  };

  return (
    <div className="markdown-editor-root">
      {showToolbar && (
        <EditorToolbar
          onAction={handleAction}
          // 字体入口作为工具栏的行尾控件，与格式动作共用一行 ——
          // 一个图标按钮不值得单占一条横栏（§2.1）。
          trailing={
            showFontBar && onQuickFont && onClearFont && defaultLatinFont && defaultCjkFont ? (
              <EditorFontBar
                onPick={onQuickFont}
                onClear={onClearFont}
                hasFont={selectionHasFontState}
                // 无选区时也能改字体：作用于**接下来输入的内容**（见 insertFontSpan）。
                defaultLatin={defaultLatinFont}
                defaultCjk={defaultCjkFont}
              />
            ) : undefined
          }
        />
      )}
      <div className="markdown-editor" ref={hostRef} data-testid="markdown-editor" />
    </div>
  );
}
