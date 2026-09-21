import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection as CmSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { useEffect, useRef } from "react";
import { applyMarkdownAction, type MarkdownActionId } from "../../lib/markdownActions";
import { EditorToolbar } from "./EditorToolbar";
import "./editor.css";

export interface MarkdownEditorProps {
  /** 当前文档 id；切换文档时重建编辑器状态。 */
  documentId: string | null;
  value: string;
  onChange: (value: string) => void;
  /** Ctrl+S 回调，用于立即落盘。 */
  onSave?: () => void;
  /** 是否显示格式工具栏（UI_DESIGN_SYSTEM.md §21.1）。 */
  showToolbar?: boolean;
}

/** 让 CodeMirror 读取应用主题令牌，避免出现与外壳无关的配色。 */
const appTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--text-md)",
    backgroundColor: "var(--bg-app)",
    color: "var(--text-primary)",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    lineHeight: "var(--leading-prose)",
    padding: "var(--space-4) 0",
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
});

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

export function MarkdownEditor({
  documentId,
  value,
  onChange,
  onSave,
  showToolbar = true,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // 用 ref 持有最新回调，避免每次渲染都重建编辑器。
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          markdown(),
          EditorView.lineWrapping,
          appTheme,
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
          }),
        ],
      }),
    });

    viewRef.current = view;
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

  const handleAction = (action: MarkdownActionId) => {
    const view = viewRef.current;
    if (view) dispatchAction(view, action);
  };

  return (
    <div className="markdown-editor-root">
      {showToolbar && <EditorToolbar onAction={handleAction} />}
      <div className="markdown-editor" ref={hostRef} data-testid="markdown-editor" />
    </div>
  );
}
