import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection as CmSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  redoDepth,
  selectAll,
  undo,
  undoDepth,
} from "@codemirror/commands";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { applyMarkdownAction, type MarkdownActionId } from "../../lib/markdownActions";
import { cmPhrases, zh } from "../../lib/i18n";
import {
  ContextMenu,
  type ContextMenuEntry,
  type ContextMenuItem,
} from "../ui/ContextMenu";
import { SlashMenu, type SlashCommandItem } from "./SlashMenu";
import { TableFloatingBar } from "./TableFloatingBar";
import {
  isMarkdownTableRow,
  alignMarkdownTable,
  insertTableRow,
  deleteTableRow,
  insertTableColumn,
  deleteTableColumn,
} from "../../lib/tableHelper";
import { createCustomSearchPanel, openSearchWithReplace } from "./customSearchPanel";
import { EditorToolbar } from "./EditorToolbar";
import "./editor.css";

export type PasteImageHandler = (
  file: File,
) => Promise<string | null | undefined> | string | null | undefined;

export interface MarkdownEditorProps {
  /** 当前文档 id；切换文档时重建编辑器状态。 */
  documentId: string | null;
  value: string;
  onChange: (value: string) => void;
  /** Ctrl+S 回调，用于立即落盘。 */
  onSave?: () => void;
  /** 图片剪贴板回调；返回附件 UUID 后编辑器插入 attachment:// 引用。 */
  onPasteImage?: PasteImageHandler;
  /** 光标位置变化（1 基行/列与选中文本），供状态栏显示（UI §28）。 */
  onCursor?: (line: number, column: number, selectedText?: string) => void;
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
  /** 上报 CodeMirror 可滚动的根 DOM 容器（cm-scroller），供编辑/预览同步滚动机制监听。 */
  onScrollDOM?: (el: HTMLElement | null) => void;
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
    // 舒适的编辑边距：顶部 24px 避开工具栏下沿，左右 32px 保持呼吸空间与预览区完全对齐，
    // 底部 48px 留出滚动余量，避免最后一行贴死状态栏。
    padding: "var(--space-6) var(--space-8) var(--space-12)",
    // 文字插入光标。CodeMirror 基础主题写死了 `&light { caretColor: black }`，
    // 不覆盖的话深色背景下光标是黑的。
    caretColor: "var(--caret)",
  },
  "@media (max-width: 599px)": {
    ".cm-content": {
      padding: "var(--space-4) var(--space-4) var(--space-8)",
    },
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
  // 查找与替换面板：适配明暗主题令牌
  ".cm-panels": {
    backgroundColor: "var(--bg-surface)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
  },
  ".cm-panels-top": {
    borderBottom: "1px solid var(--border-default)",
  },
  ".cm-panels-bottom": {
    borderTop: "1px solid var(--border-default)",
  },
  ".cm-searchMatch": {
    backgroundColor: "rgb(250 204 21 / 0.45)",
    borderRadius: "2px",
  },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--accent-solid)",
    color: "var(--text-on-accent)",
    borderRadius: "2px",
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


/** 取 1 基的行列号与选区内容（状态栏用，UI §28）。 */
function cursorPosition(state: EditorState): { line: number; column: number; selectedText: string } {
  const main = state.selection.main;
  const head = main.head;
  const line = state.doc.lineAt(head);
  const selectedText = main.from !== main.to ? state.sliceDoc(main.from, main.to) : "";
  return { line: line.number, column: head - line.from + 1, selectedText };
}

interface EditorContextMenuState {
  x: number;
  y: number;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
}

const SUPPORTED_PASTE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** 只从剪贴板提取支持的图片；没有图片时交回 CodeMirror 的默认粘贴流程。 */
function clipboardImage(event: ClipboardEvent): File | null {
  const data = event.clipboardData;
  if (!data) return null;

  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !SUPPORTED_PASTE_IMAGE_TYPES.has(item.type.toLowerCase())) {
      continue;
    }
    const file = item.getAsFile();
    if (file) return file;
  }

  // 某些 WebView 只暴露 files，不暴露 items；仍然保持同一 MIME 白名单。
  for (const file of Array.from(data.files)) {
    if (SUPPORTED_PASTE_IMAGE_TYPES.has(file.type.toLowerCase())) return file;
  }
  return null;
}

/** 从拖放事件中提取支持的图片文件。 */
function droppedImage(event: DragEvent): File | null {
  const data = event.dataTransfer;
  if (!data) return null;
  for (const file of Array.from(data.files)) {
    if (SUPPORTED_PASTE_IMAGE_TYPES.has(file.type.toLowerCase())) return file;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext && ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return file;
  }
  return null;
}

const LUCIDE_CHEVRON_DOWN =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const LUCIDE_CHEVRON_RIGHT =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

function createFoldMarker(open: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = open ? "cm-fold-marker cm-fold-marker--open" : "cm-fold-marker cm-fold-marker--closed";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = open ? LUCIDE_CHEVRON_DOWN : LUCIDE_CHEVRON_RIGHT;
  return el;
}

export interface MarkdownEditorHandle {
  dispatchAction: (action: MarkdownActionId) => void;
  focus: () => void;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      documentId,
      value,
      onChange,
      onSave,
      onPasteImage,
      onCursor,
      jumpTarget,
      findNonce,
      showToolbar = true,
      onScrollDOM,
    }: MarkdownEditorProps,
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [contextMenu, setContextMenu] = useState<EditorContextMenuState | null>(null);
    const [slashState, setSlashState] = useState<{
      open: boolean;
      x: number;
      y: number;
      lineFrom: number;
      head: number;
    } | null>(null);

    const [tableState, setTableState] = useState<{
      visible: boolean;
      x: number;
      y: number;
      tableFrom: number;
      tableTo: number;
      tableLines: string[];
      currentLineIdx: number;
      currentColIdx: number;
    } | null>(null);

    // 用 ref 持有最新回调，避免每次渲染都重建编辑器。
    const onChangeRef = useRef(onChange);
    const onSaveRef = useRef(onSave);
    const onPasteImageRef = useRef(onPasteImage);
    const onCursorRef = useRef(onCursor);
    const onScrollDOMRef = useRef(onScrollDOM);
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    onPasteImageRef.current = onPasteImage;
    onCursorRef.current = onCursor;
    onScrollDOMRef.current = onScrollDOM;

    useImperativeHandle(
      ref,
      () => ({
        dispatchAction: (action: MarkdownActionId) => {
          const view = viewRef.current;
          if (view) dispatchAction(view, action);
        },
        focus: () => {
          viewRef.current?.focus();
        },
      }),
      [],
    );

    const handleSlashSelect = (item: SlashCommandItem) => {
      const view = viewRef.current;
      if (!view || !slashState) return;
      view.dispatch({
        changes: { from: slashState.lineFrom, to: slashState.head, insert: item.insertText },
        selection: CmSelection.cursor(slashState.lineFrom + (item.cursorOffset ?? item.insertText.length)),
      });
      setSlashState(null);
      view.focus();
    };

    const handleApplyTable = (newLines: string[]) => {
      const view = viewRef.current;
      if (!view || !tableState) return;
      view.dispatch({
        changes: { from: tableState.tableFrom, to: tableState.tableTo, insert: newLines.join("\n") },
      });
      view.focus();
    };

    const handleAddRow = () => {
      if (!tableState) return;
      handleApplyTable(insertTableRow(tableState.tableLines, tableState.currentLineIdx));
    };

    const handleDeleteRow = () => {
      if (!tableState) return;
      handleApplyTable(deleteTableRow(tableState.tableLines, tableState.currentLineIdx));
    };

    const handleAddCol = () => {
      if (!tableState) return;
      handleApplyTable(insertTableColumn(tableState.tableLines, tableState.currentColIdx));
    };

    const handleDeleteCol = () => {
      if (!tableState) return;
      handleApplyTable(deleteTableColumn(tableState.tableLines, tableState.currentColIdx));
    };

    const handleAlignTable = () => {
      if (!tableState) return;
      handleApplyTable(alignMarkdownTable(tableState.tableLines));
    };

    const handleDrop = (event: DragEvent, editor: EditorView): boolean => {
      const file = droppedImage(event);
      if (!file) return false;
      event.preventDefault();
      let pos = editor.state.selection.main.head;
      try {
        if (event.clientX && event.clientY) {
          const atCoords = editor.posAtCoords({ x: event.clientX, y: event.clientY });
          if (atCoords !== null) pos = atCoords;
        }
      } catch {
        pos = editor.state.selection.main.head;
      }
      void saveClipboardImage(file, editor, pos, pos);
      return true;
    };

    const handleDragOver = (event: DragEvent): boolean => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        return true;
      }
      return false;
    };

  const insertAttachmentReference = (
    editor: EditorView,
    attachmentId: string,
    from: number,
    to: number,
  ): boolean => {
    if (viewRef.current !== editor) return false;
    const id = attachmentId.trim();
    if (!id) return false;
    const reference = id.startsWith("attachment://") ? id : `attachment://${id}`;
    const markdown = `![图片](${reference})`;
    // 上传期间用户可能编辑了文档；把旧选区夹回当前文档，避免越界。
    const currentLength = editor.state.doc.length;
    const safeFrom = Math.min(from, currentLength);
    const safeTo = Math.min(Math.max(safeFrom, to), currentLength);
    editor.dispatch({
      changes: { from: safeFrom, to: safeTo, insert: markdown },
      selection: CmSelection.cursor(safeFrom + markdown.length),
      scrollIntoView: true,
    });
    editor.focus();
    return true;
  };

  const saveClipboardImage = async (
    file: File,
    editor: EditorView,
    from: number,
    to: number,
  ): Promise<boolean> => {
    const callback = onPasteImageRef.current;
    if (!callback) return false;
    try {
      const attachmentId = await callback(file);
      return attachmentId
        ? insertAttachmentReference(editor, attachmentId, from, to)
        : false;
    } catch {
      // 保存失败时保留原文与原选区；由调用方决定是否展示错误提示。
      return false;
    }
  };

  const handlePasteImage = (event: ClipboardEvent, editor: EditorView): boolean => {
    const file = clipboardImage(event);
    const callback = onPasteImageRef.current;
    // 没有受支持的图片，或父层未接入保存回调时，绝不阻止普通文本粘贴。
    if (!file || !callback) return false;

    event.preventDefault();
    const { from, to } = editor.state.selection.main;
    void saveClipboardImage(file, editor, from, to);
    return true;
  };

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
          foldGutter({ markerDOM: (open) => createFoldMarker(open) }),
          EditorView.lineWrapping,
          search({ top: true, createPanel: createCustomSearchPanel }),
          appTheme,
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
            { key: "Mod-Alt-1", preventDefault: true, run: (v) => (dispatchAction(v, "h1"), true) },
            { key: "Mod-Alt-2", preventDefault: true, run: (v) => (dispatchAction(v, "h2"), true) },
            { key: "Mod-Alt-3", preventDefault: true, run: (v) => (dispatchAction(v, "h3"), true) },
            { key: "Mod-Alt-4", preventDefault: true, run: (v) => (dispatchAction(v, "h4"), true) },
            { key: "Mod-Alt-5", preventDefault: true, run: (v) => (dispatchAction(v, "h5"), true) },
            { key: "Mod-Alt-6", preventDefault: true, run: (v) => (dispatchAction(v, "h6"), true) },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
          ]),
          EditorView.domEventHandlers({
            paste: (event, editor) => handlePasteImage(event, editor),
            drop: (event, editor) => handleDrop(event, editor),
            dragover: (event) => handleDragOver(event),
            contextmenu: (event, editor) => {
              event.preventDefault();
              const position = editor.posAtCoords({ x: event.clientX, y: event.clientY });
              const selection = editor.state.selection.main;
              // 右键落在当前选区内时保留选区，便于复制/剪切/格式化；
              // 否则将光标移到右键位置，符合编辑器的常见行为。
              if (
                position !== null &&
                !(selection.from !== selection.to && position >= selection.from && position <= selection.to)
              ) {
                editor.dispatch({ selection: CmSelection.cursor(position) });
              }
              editor.focus();
              const current = editor.state.selection.main;
              setContextMenu({
                x: event.clientX,
                y: event.clientY,
                canUndo: undoDepth(editor.state) > 0,
                canRedo: redoDepth(editor.state) > 0,
                hasSelection: !current.empty,
              });
              return true;
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            // 光标移动也要更新状态栏行列号与选中文本。
            if (update.selectionSet || update.docChanged) {
              const { line, column, selectedText } = cursorPosition(update.state);
              if (selectedText) {
                onCursorRef.current?.(line, column, selectedText);
              } else {
                onCursorRef.current?.(line, column);
              }

              // 检测是否触发 / 斜杠快捷菜单（在行首或空行输入 /）
              const head = update.state.selection.main.head;
              const curLine = update.state.doc.lineAt(head);
              const textBefore = curLine.text.slice(0, head - curLine.from);
              if (textBefore.trim() === "/") {
                const coords = update.view.coordsAtPos(head);
                if (coords) {
                  setSlashState({
                    open: true,
                    x: coords.left,
                    y: coords.bottom + 4,
                    lineFrom: curLine.from,
                    head,
                  });
                }
              } else if (!textBefore.startsWith("/")) {
                setSlashState(null);
              }

              // 检测是否在 Markdown 表格中触发表格悬浮操作条
              if (isMarkdownTableRow(curLine.text)) {
                let startLn = curLine.number;
                while (startLn > 1 && isMarkdownTableRow(update.state.doc.line(startLn - 1).text)) {
                  startLn--;
                }
                let endLn = curLine.number;
                while (endLn < update.state.doc.lines && isMarkdownTableRow(update.state.doc.line(endLn + 1).text)) {
                  endLn++;
                }

                const lines: string[] = [];
                for (let ln = startLn; ln <= endLn; ln++) {
                  lines.push(update.state.doc.line(ln).text);
                }

                const coords = update.view.coordsAtPos(head);
                if (coords) {
                  setTableState({
                    visible: true,
                    x: coords.left,
                    y: coords.top,
                    tableFrom: update.state.doc.line(startLn).from,
                    tableTo: update.state.doc.line(endLn).to,
                    tableLines: lines,
                    currentLineIdx: curLine.number - startLn,
                    currentColIdx: Math.max(0, curLine.text.slice(0, head - curLine.from).split("|").length - 2),
                  });
                }
              } else {
                setTableState(null);
              }
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    onScrollDOMRef.current?.(view.scrollDOM);
    // 初始光标位置也要上报，否则状态栏在打开文档前是空的。
    const { line, column, selectedText } = cursorPosition(view.state);
    if (selectedText) {
      onCursorRef.current?.(line, column, selectedText);
    } else {
      onCursorRef.current?.(line, column);
    }

    return () => {
      onScrollDOMRef.current?.(null);
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
  const openFindPanel = (expandReplace = false) => {
    const view = viewRef.current;
    if (!view) return;
    view.focus();
    if (expandReplace) {
      openSearchWithReplace(view);
    } else {
      openSearchPanel(view);
    }
  };

  useEffect(() => {
    if (!findNonce) return;
    openFindPanel();
    // 该函数只依赖 ref；nonce 是唯一触发条件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findNonce]);

  const handleAction = (action: MarkdownActionId) => {
    const view = viewRef.current;
    if (view) dispatchAction(view, action);
  };

  const runCommand = (command: (view: EditorView) => boolean) => () => {
    const view = viewRef.current;
    if (!view) return;
    command(view);
    view.focus();
  };

  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  const copySelection = async (cut: boolean) => {
    const view = viewRef.current;
    if (!view || !clipboard?.writeText) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    try {
      await clipboard.writeText(view.state.sliceDoc(from, to));
    } catch {
      // 剪贴板被系统拒绝时不修改文档，避免剪切操作导致内容丢失。
      return;
    }
    if (cut) {
      view.dispatch({
        changes: { from, to, insert: "" },
        selection: CmSelection.cursor(from),
        scrollIntoView: true,
      });
    }
    view.focus();
  };

  const readClipboardImage = async (): Promise<File | null> => {
    if (!clipboard?.read) return null;
    try {
      const items = await clipboard.read();
      for (const item of items) {
        const type = item.types.find((candidate) =>
          SUPPORTED_PASTE_IMAGE_TYPES.has(candidate.toLowerCase()),
        );
        if (!type) continue;
        const blob = await item.getType(type);
        const extension = type.slice(type.indexOf("/") + 1).replace("jpeg", "jpg");
        return new File([blob], `pasted-image.${extension}`, { type });
      }
    } catch {
      // 系统可能要求额外剪贴板权限；交给文本读取流程兜底。
    }
    return null;
  };

  const pasteFromClipboard = async () => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;

    // 右键「粘贴」也支持截图；没有图片时再读取纯文本。
    if (onPasteImageRef.current) {
      const image = await readClipboardImage();
      if (image && (await saveClipboardImage(image, view, from, to))) return;
    }

    if (!clipboard?.readText) return;
    try {
      const text = await clipboard.readText();
      view.dispatch({
        changes: { from, to, insert: text },
        selection: CmSelection.cursor(from + text.length),
        scrollIntoView: true,
      });
      view.focus();
    } catch {
      // 系统可能要求额外剪贴板权限；失败时保留原文并安静结束。
    }
  };

  const formatItem = (action: MarkdownActionId): ContextMenuItem => ({
    id: `format-${action}`,
    label: zh.editor.actions[action],
    onSelect: () => handleAction(action),
  });

  const contextMenuItems: ContextMenuEntry[] = contextMenu
    ? [
        {
          id: "undo",
          label: zh.editor.contextMenu.undo,
          shortcut: "Ctrl+Z",
          disabled: !contextMenu.canUndo,
          onSelect: runCommand(undo),
        },
        {
          id: "redo",
          label: zh.editor.contextMenu.redo,
          shortcut: "Ctrl+Y",
          disabled: !contextMenu.canRedo,
          onSelect: runCommand(redo),
        },
        { id: "edit-separator", separator: true },
        {
          id: "cut",
          label: zh.editor.contextMenu.cut,
          shortcut: "Ctrl+X",
          disabled: !contextMenu.hasSelection || !clipboard?.writeText,
          onSelect: () => copySelection(true),
        },
        {
          id: "copy",
          label: zh.editor.contextMenu.copy,
          shortcut: "Ctrl+C",
          disabled: !contextMenu.hasSelection || !clipboard?.writeText,
          onSelect: () => copySelection(false),
        },
        {
          id: "paste",
          label: zh.editor.contextMenu.paste,
          shortcut: "Ctrl+V",
          disabled: !clipboard?.readText && !clipboard?.read,
          onSelect: pasteFromClipboard,
        },
        {
          id: "select-all",
          label: zh.editor.contextMenu.selectAll,
          shortcut: "Ctrl+A",
          onSelect: runCommand(selectAll),
        },
        {
          id: "find-replace",
          label: zh.editor.contextMenu.findReplace,
          shortcut: "Ctrl+F",
          onSelect: () => openFindPanel(true),
        },
         { id: "format-separator", separator: true },
        {
          id: "format",
          label: zh.editor.contextMenu.format,
          submenu: [
            formatItem("bold"),
            formatItem("italic"),
            formatItem("strikethrough"),
            formatItem("inlineCode"),
            { id: "heading-separator", separator: true },
            {
              id: "heading-submenu",
              label: "标题",
              submenu: [
                formatItem("h1"),
                formatItem("h2"),
                formatItem("h3"),
                formatItem("h4"),
                formatItem("h5"),
                formatItem("h6"),
              ],
            },
            { id: "block-separator", separator: true },
            formatItem("bulletList"),
            formatItem("orderedList"),
            formatItem("quote"),
            formatItem("codeBlock"),
          ],
        },
        {
          id: "insert",
          label: zh.editor.contextMenu.insert,
          submenu: [
            formatItem("link"),
            formatItem("image"),
            { id: "insert-separator", separator: true },
            formatItem("table"),
            formatItem("math"),
            formatItem("mathBlock"),
          ],
        },
      ]
    : [];

  return (
    <div className="markdown-editor-root">
      {showToolbar && <EditorToolbar onAction={handleAction} />}
      <div className="markdown-editor" ref={hostRef} data-testid="markdown-editor" />
      <ContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextMenuItems}
        ariaLabel={zh.editor.contextMenu.ariaLabel}
        onClose={() => setContextMenu(null)}
      />
      <SlashMenu
        open={slashState?.open ?? false}
        x={slashState?.x ?? 0}
        y={slashState?.y ?? 0}
        onClose={() => setSlashState(null)}
        onSelect={handleSlashSelect}
      />
      <TableFloatingBar
        visible={tableState?.visible ?? false}
        x={tableState?.x ?? 0}
        y={tableState?.y ?? 0}
        onAddRow={handleAddRow}
        onDeleteRow={handleDeleteRow}
        onAddCol={handleAddCol}
        onDeleteCol={handleDeleteCol}
        onAlign={handleAlignTable}
      />
    </div>
  );
});
