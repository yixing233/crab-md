import { useMemo } from "react";
import { renderMarkdown } from "../../lib/markdown";
import { zh } from "../../lib/i18n";
import "./editor.css";

export interface MarkdownPreviewProps {
  source: string;
}

export function MarkdownPreview({ source }: MarkdownPreviewProps) {
  // renderMarkdown 已内置 HTML 消毒（ARCHITECTURE.md §19）。
  const html = useMemo(() => renderMarkdown(source), [source]);

  if (!html) {
    return (
      <div className="markdown-preview markdown-preview--empty">{zh.preview.empty}</div>
    );
  }

  return (
    <div
      className="markdown-preview"
      // 内容已由 DOMPurify 消毒，见 lib/markdown.ts。
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
