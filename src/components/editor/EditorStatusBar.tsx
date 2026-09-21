import "./editor.css";

export interface EditorStatusBarProps {
  /** 未保存标记；正常状态保持安静（UI §26.1）。 */
  dirty: boolean;
  line: number;
  column: number;
  path: string;
}

export function EditorStatusBar({ dirty, line, column, path }: EditorStatusBarProps) {
  return (
    <div className="editor-status">
      <span className="editor-status__path">{path}</span>
      <span className="editor-status__spacer" />
      <span>Ln {line}, Col {column}</span>
      <span>Markdown</span>
      <span>UTF-8</span>
      <span data-dirty={dirty || undefined}>{dirty ? "Unsaved" : "Saved"}</span>
    </div>
  );
}
