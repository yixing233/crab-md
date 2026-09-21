import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: true,       // 允许 Markdown 中内嵌 HTML……
  linkify: true,
  breaks: false,
  typographer: false,
});

/**
 * 渲染 Markdown 为可安全插入 DOM 的 HTML。
 *
 * `html: true` 是必要的（用户可能写表格/居中标签），但同步内容是不可信输入
 * （ARCHITECTURE.md §19），因此**必须**经 DOMPurify 消毒后再返回，
 * 移除 <script>、内联事件处理器、javascript: URL 等。
 */
export function renderMarkdown(source: string): string {
  if (!source || !source.trim()) {
    return "";
  }
  const raw = md.render(source);
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "style"],
  });
}
