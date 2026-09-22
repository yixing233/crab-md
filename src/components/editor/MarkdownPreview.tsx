import { useMemo } from "react";
import { renderMarkdown } from "../../lib/markdown";
import { zh } from "../../lib/i18n";
// KaTeX 的排版样式与字体。从 node_modules 导入，Vite 会把字体一并打进产物 ——
// 数学公式的排版依赖这些字体，不能走 CDN（应用要能完全离线使用）。
import "katex/dist/katex.min.css";
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
