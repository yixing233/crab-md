import { useMemo } from "react";
import { countText } from "../../lib/wordCount";
import { zh } from "../../lib/i18n";
import "./editor.css";

export interface EditorStatusBarProps {
  /** 未保存标记；正常状态保持安静（UI §26.1）。 */
  dirty: boolean;
  line: number;
  column: number;
  path: string;
  /** 全文文本，用于统计总字数与阅读时长。 */
  content?: string;
  /** 当前选中的文本，用于展示选区字数。 */
  selectedText?: string;
}

export function EditorStatusBar({
  dirty,
  line,
  column,
  path,
  content = "",
  selectedText = "",
}: EditorStatusBarProps) {
  const docStats = useMemo(() => countText(content), [content]);
  const selStats = useMemo(
    () => (selectedText ? countText(selectedText) : null),
    [selectedText],
  );

  return (
    <div className="editor-status" role="status" aria-label="编辑器状态栏">
      <span className="editor-status__path">{path}</span>
      <span className="editor-status__spacer" />

      {/* 实时字数与阅读时长统计 */}
      {selStats && selStats.words > 0 ? (
        <span className="editor-status__stat" title="当前选中文本统计">
          已选 {selStats.words.toLocaleString()} 词（{selStats.characters.toLocaleString()} 字符）
        </span>
      ) : (
        <span className="editor-status__stat" title="文档全文字数与预估阅读时长">
          {docStats.words.toLocaleString()} 词
          {docStats.readingTimeMin > 0 && ` · 约 ${docStats.readingTimeMin} 分钟`}
        </span>
      )}

      <span>{zh.statusBar.lineColumn(line, column)}</span>
      <span>{path.toLowerCase().endsWith(".txt") ? "纯文本 (TXT)" : zh.statusBar.markdown}</span>
      <span>{zh.statusBar.encoding}</span>
      <span data-dirty={dirty || undefined}>
        {dirty ? zh.statusBar.unsaved : zh.statusBar.saved}
      </span>
    </div>
  );
}
