/**
 * 代码块语法高亮（预览侧）
 *
 * 编辑器即时渲染的代码块一直由 CodeMirror 的 `syntaxHighlighting(markdownHighlight)`
 * 着色，而预览侧是 markdown-it 默认渲染出的单色 `<pre><code>` —— 这是「两边观感
 * 对不上」的最后一块缺口。这里用 highlight.js 补上，并复用与编辑器
 * `markdownHighlight`（见 `MarkdownEditor.tsx:152-174`）相同的语义色 token，
 * 保证同一份代码在两侧颜色一致。
 *
 * 设计取舍：
 * - 只注册 `highlight.js/lib/common` 里的常用语言（36 种），全量 `lib/index.js`
 *   会把 190+ 种语言全部打进 bundle，对桌面应用是纯浪费。
 * - 语言未注册 / 高亮抛错时返回 `null`，调用方回退到 markdown-it 的默认渲染，
 *   这样未知语言仍然输出 `<code class="language-xxx">`（`markdown.test.ts` 有断言）。
 * - 只接管「内部 HTML」，`<pre><code>` 外壳仍由 markdown-it 生成，避免两处拼装。
 */
import hljs from "highlight.js/lib/common";

/** 高亮结果：可直接插入 `<code>` 内部的 HTML；不支持时返回 null。 */
export function highlightCode(code: string, language: string): string | null {
  const lang = language.trim().toLowerCase();
  if (!lang) return null;
  if (!hljs.getLanguage(lang)) return null;

  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    // 高亮失败（语言定义有 bug、源码畸形）时静默回退到纯文本，
    // 代码块本身仍然可用，不该因为着色而整块渲染不出来。
    return null;
  }
}

/**
 * 供即时渲染侧查询：某语言高亮后的 token 颜色映射表。
 * 目前只有 CSS 需要，此处不导出，避免无谓的公开 API。
 */
