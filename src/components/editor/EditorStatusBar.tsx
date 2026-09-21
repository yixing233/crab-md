import { zh } from "../../lib/i18n";
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
      <span>{zh.statusBar.lineColumn(line, column)}</span>
      <span>{zh.statusBar.markdown}</span>
      <span>{zh.statusBar.encoding}</span>
      <span data-dirty={dirty || undefined}>
        {dirty ? zh.statusBar.unsaved : zh.statusBar.saved}
      </span>
    </div>
  );
}
