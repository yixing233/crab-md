import DOMPurify from "dompurify";
import MarkdownIt, { type StateInline } from "markdown-it";
import katex from "@vscode/markdown-it-katex";
import { highlightCode } from "./codeHighlight";
import { COPY_ICON_SVG } from "./codeBlockIcons";
import { getRenderToggles } from "./renderToggles";

const md = new MarkdownIt({
  html: true,       // 允许 Markdown 中内嵌 HTML……
  linkify: true,
  // 有意偏离严格 CommonMark（UI_DESIGN_SYSTEM.md §22）。
  //
  // CommonMark 规定单个换行是 "soft break"，渲染为空格。但那样编辑器与预览
  // 会自相矛盾：编辑器中三行文字，预览里挤成一行。同类产品（Obsidian）的
  // 「严格换行」默认也是关闭的。
  //
  // 重要：这个选项**只影响渲染**，不改磁盘内容 —— 文件里仍是 \n，
  // 因此不违反 ARCHITECTURE.md §24「保留标准 Markdown 文件」。
  breaks: true,
  typographer: false,
});

/**
 * 取出 KaTeX 插件函数，兼容两种模块形状。
 *
 * 该包是 CommonJS（`module.exports = { default: fn }`）：
 * - vitest 下 import 直接得到函数；
 * - 浏览器里经 Vite 的 CJS 互操作得到 `{ default: fn }`。
 *
 * 若不处理，浏览器会抛 `plugin.apply is not a function` ——
 * 而单元测试全绿，因为测试环境恰好是前一种形状。
 * 这个只在真实运行环境暴露的差异，是本函数存在的唯一理由。
 */
export function resolveKatexPlugin(mod: unknown): unknown {
  if (typeof mod === "function") return mod;
  if (mod && typeof (mod as { default?: unknown }).default === "function") {
    return (mod as { default: unknown }).default;
  }
  return mod;
}

md.use(resolveKatexPlugin(katex) as typeof katex, {
  // 公式写错时渲染成错误文本而非抛异常：一个手误的公式
  // 不该让整页笔记渲染失败。
  throwOnError: false,
  // 输出同时包含 MathML（无障碍朗读）与 HTML（视觉排版）。
  output: "htmlAndMathml",
});

/** 与插件一致：字母、数字、下划线都算「单词字符」。 */
const WORD_CHAR = /[\w\d]/;

/**
 * 补一条内联公式规则，使公式在**带属性的行内标签内**也能渲染。
 *
 * 为什么必须有这条：`@vscode/markdown-it-katex` 的 inlineMath 开头有守卫 ——
 * 若前一个 token 是形如 `<span style="…">` 的**带属性**行内 HTML，就直接
 * 放弃识别（其本意是不在 HTML 属性里误认公式）。但「选区设字体」写出的正是
 * `<span style="font-family:…">$x$</span>`，于是公式全部退化成原文。
 *
 * 实测：带属性标签内的公式一律不渲染；不带属性的 `<b>$x$</b>` 正常。
 *
 * 这条规则保留插件原有的边界判定（起止 `$` 不能紧邻单词字符），只去掉
 * 「前面有带属性标签就放弃」这一条，因此不会把 `$5 and $10` 这类货币误判
 * 成公式（已用测试锁定）。渲染仍复用插件注册的 `math_inline` 渲染器。
 */
function mathInlineAnywhere(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  if (state.src[start] !== "$") return false;
  // `$$` 属于块级公式，交给插件的块级规则处理。
  if (state.src[start + 1] === "$") return false;

  // 与插件一致：起始 `$` 前紧邻单词字符时视为普通文本（避免 `x$y$`）。
  const prev = state.src[start - 1];
  if (prev !== undefined && WORD_CHAR.test(prev)) return false;

  // 找闭合 `$`：跳过被转义的（`\$`），并要求其后不紧邻单词字符。
  let search = start + 1;
  let end = -1;
  for (;;) {
    const found = state.src.indexOf("$", search);
    if (found === -1) break;

    let back = found - 1;
    let escapes = 0;
    while (state.src[back] === "\\") {
      escapes += 1;
      back -= 1;
    }
    // 偶数个反斜杠表示这个 $ 未被转义，可作为闭合符。
    if (escapes % 2 === 0) {
      const next = state.src[found + 1];
      if (next === undefined || !WORD_CHAR.test(next)) {
        end = found;
        break;
      }
    }
    search = found + 1;
  }

  // 没有闭合符，或内容为空（`$$`）—— 不是公式。
  if (end === -1 || end === start + 1) return false;

  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = state.src.slice(start + 1, end);
    token.markup = "$";
  }
  state.pos = end + 1;
  return true;
}

// 注册在插件规则**之前**：必须抢在它那条带守卫的规则前面拿到 `$`，
// 否则守卫会先把这里当成普通文本消费掉。
md.inline.ruler.before("math_inline", "math_inline_anywhere", mathInlineAnywhere);

/**
 * 「渲染公式」开关的运行时闸门。
 *
 * markdown-it 的规则注册在模块加载时完成，无法按次渲染装卸；
 * 因此包一层渲染器：开关关闭时把 token 还原为原始写法（含定界符），
 * 让公式保持 `$...$` / `$$...$$` 原文可见。解析照常进行，
 * 只是渲染结果不同 —— 对 DOMPurify 与文档内容零影响。
 */
function gateMathRenderers(): void {
  const rules = md.renderer.rules;
  const mathTokenTypes = new Set(["math_inline", "math_block", "math_inline_block", "math_inline_bare_block"]);
  for (const [type, renderer] of Object.entries(rules)) {
    if (!mathTokenTypes.has(type) || !renderer) continue;
    rules[type] = (tokens, index, options, env, self) => {
      if (!getRenderToggles().math) {
        const token = tokens[index];
        const markup = token.markup || "$";
        if (type === "math_block") return `$$\n${token.content}\n$$`;
        return `${markup}${token.content}${markup}`;
      }
      return renderer(tokens, index, options, env, self);
    };
  }
}
gateMathRenderers();

/**
 * Mermaid fences are deliberately rendered as inert source containers first.
 *
 * Mermaid must not receive HTML from the Markdown renderer directly: the source
 * is escaped into a `<code>` element and the preview effect replaces that
 * element only after Mermaid has parsed it and its SVG has gone through a
 * second DOMPurify pass.
 *
 * 「渲染图表」开关关闭时走普通代码块路径：源码 + 高亮 + 复制按钮，
 * 与其他语言围栏完全一致（设置页 §34「预览排版」）。
 */
const defaultFenceRenderer = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/u)[0]?.toLowerCase();

  if (language === "mermaid" && getRenderToggles().mermaid) {
    return [
      '<div class="mermaid-diagram" data-mermaid-source>',
      '<pre class="mermaid-source"><code>',
      md.utils.escapeHtml(token.content),
      "</code></pre></div>\n",
    ].join("");
  }

  const rawRendered = defaultFenceRenderer?.(tokens, index, options, env, self) ?? "";
  const langLabel = language || "text";

  // 已注册的语言自己拼装 `<pre><code>`：highlight.js 的 `highlight()` 已经转义过
  // HTML，DOMPurify 随后还会再消毒一遍。未注册/高亮失败时回退到 markdown-it 的
  // 默认渲染，它仍会输出 `<code class="language-xxx">`（见 markdown.test.ts 断言）。
  const highlighted = highlightCode(token.content, language ?? "");
  const codeHtml =
    highlighted === null
      ? rawRendered
      : `<pre><code class="hljs language-${md.utils.escapeHtml(langLabel)}">${highlighted}</code></pre>\n`;

  return [
    `<div class="code-block" data-language="${md.utils.escapeHtml(langLabel)}">`,
    '  <div class="code-block__header">',
    `    <span class="code-block__lang">${md.utils.escapeHtml(langLabel)}</span>`,
    '    <button type="button" class="code-block__copy" aria-label="复制代码" title="复制代码">',
    `      ${COPY_ICON_SVG}`,
    '    </button>',
    '  </div>',
    codeHtml,
    '</div>\n',
  ].join("\n");
};

/** 任务清单解析器（- [ ] 与 - [x] 渲染为可交互复选框） */
md.core.ruler.after("inline", "task_list", (state) => {
  let taskIndex = 0;
  const tokens = state.tokens;

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "list_item_open") continue;

    let inlineIdx = -1;
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].type === "list_item_close") break;
      if (tokens[j].type === "inline") {
        inlineIdx = j;
        break;
      }
    }
    if (inlineIdx === -1) continue;

    const inlineToken = tokens[inlineIdx];
    if (!inlineToken.children || inlineToken.children.length === 0) continue;
    const firstChild = inlineToken.children[0];
    if (!firstChild || firstChild.type !== "text") continue;

    const match = firstChild.content.match(/^\[([ xX])\](?:\s+(.*))?$/);
    if (!match) continue;

    const checked = match[1] === "x" || match[1] === "X";
    tokens[i].attrJoin("class", "task-list-item");
    firstChild.content = match[2] ?? "";

    const checkboxToken = new state.Token("html_inline", "", 0);
    checkboxToken.content = `<input type="checkbox" class="task-list-item-checkbox" data-task-index="${taskIndex++}" ${checked ? 'checked="checked"' : ""} /> `;
    inlineToken.children.unshift(checkboxToken);
  }
});

/**
 * 为 Markdown 表格自动外包一层 `<div class="table-wrapper">`。
 * 确保表格内容超宽时仅在内部出现水平滚动条，防止撑破整体阅读视口。
 */
const defaultTableOpen =
  md.renderer.rules.table_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };
const defaultTableClose =
  md.renderer.rules.table_close ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.table_open = function (tokens, idx, options, env, self) {
  return '<div class="table-wrapper">' + defaultTableOpen(tokens, idx, options, env, self);
};
md.renderer.rules.table_close = function (tokens, idx, options, env, self) {
  return defaultTableClose(tokens, idx, options, env, self) + "</div>";
};

/**
 * 切换 Markdown 源码中第 taskIndex 个复选框的状态（[ ] ↔ [x]）。
 */
export function toggleTaskInSource(source: string, taskIndex: number): string {
  let count = 0;
  return source.replace(/^(\s*[-*+]|\s*\d+\.)\s+\[([ xX])\]/gm, (match, prefix, check) => {
    if (count === taskIndex) {
      count++;
      const next = check === " " ? "x" : " ";
      return `${prefix} [${next}]`;
    }
    count++;
    return match;
  });
}

/** A deliberately small surface for Mermaid, so jsdom tests can mock it. */
export interface MermaidRenderer {
  initialize(config: {
    startOnLoad: boolean;
    securityLevel: "strict";
    htmlLabels: boolean;
  }): void;
  render(
    id: string,
    source: string,
  ): Promise<{ svg: string } | string> | { svg: string } | string;
}

/**
 * Load Mermaid lazily. Mermaid expects browser layout APIs (for example
 * `getBBox`), which are not available in jsdom; keeping the import behind this
 * function lets Markdown rendering and the fallback source stay testable there.
 */
export async function loadMermaid(): Promise<MermaidRenderer> {
  const module = await import("mermaid");
  const candidate = module.default ?? module;

  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.initialize !== "function" ||
    typeof candidate.render !== "function"
  ) {
    throw new Error("Mermaid module does not expose initialize/render");
  }

  return candidate as unknown as MermaidRenderer;
}

/**
 * Sanitize Mermaid's generated SVG separately from the Markdown HTML.
 * Mermaid strict mode is the first boundary; this is the second boundary
 * before generated markup is inserted into the live preview DOM.
 */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: [
      "onerror",
      "onload",
      "onclick",
      "onmouseover",
      "onfocus",
      "onmouseenter",
      "onanimationstart",
      "onbegin",
      "onend",
      "onrepeat",
    ],
  });
}

/**
 * Parse and render one Mermaid source string, returning only sanitized SVG.
 * `htmlLabels: false` keeps Mermaid's labels in SVG text nodes rather than
 * introducing HTML `foreignObject` content that would need to be trusted.
 */
export async function renderMermaidDiagram(source: string, id: string): Promise<string> {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
  });

  const result = await mermaid.render(id, source);
  const svg = typeof result === "string" ? result : result.svg;
  if (typeof svg !== "string") {
    throw new Error("Mermaid did not return SVG markup");
  }

  const sanitized = sanitizeMermaidSvg(svg);
  if (!sanitized.trim()) {
    throw new Error("Mermaid SVG was empty after sanitization");
  }
  return sanitized;
}

/**
 * KaTeX 允许保留的内联样式属性白名单。
 *
 * 为什么要有白名单，而不是简单放行 `style`：
 * KaTeX 的上下标、分式、根号全靠内联 `style`（height / margin / top 等）
 * 做像素级定位 —— 全部剥掉公式会错位甚至变成空白。但 `style` 一旦无差别
 * 放行，同步来的恶意笔记就能用
 * `position:fixed;inset:0;z-index:99999` 覆盖整个应用界面（伪造登录框钓鱼）。
 *
 * 因此只放行 KaTeX 真正需要的**排版类**属性：
 * position / inset / z-index / background / display 等一律不在其中。
 */
const ALLOWED_STYLE_PROPS = new Set([
  "height",
  "width",
  "min-width",
  "top",
  "left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-left",
  "padding-right",
  "vertical-align",
  "transform",
  "font-size",
  "font-style",
  "font-weight",
  "font-family",
  "line-height",
  "border-bottom-width",
]);

/** 过滤单条 style 声明，丢掉白名单之外的属性。 */
function filterStyleDeclarations(raw: string): string {
  return raw
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((decl) => {
      const name = decl.split(":")[0]?.trim().toLowerCase();
      return name !== undefined && ALLOWED_STYLE_PROPS.has(name);
    })
    .join("; ");
}

/**
 * 挂上 DOMPurify 钩子，对每个元素过滤其 style。
 *
 * 用钩子按**属性名**过滤，而不是按 `closest(".katex")` 判断祖先：
 * class 由内容作者控制，写一个 `class="katex"` 就能骗过祖先判断
 * （实测可绕过）。按属性名过滤与元素位置无关，绕不过去。
 */
function installStyleFilter(): void {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (node.nodeType !== 1) return;

    // 仅允许复选框类型的 input，其他表单输入一律剥除
    if (node.tagName.toLowerCase() === "input") {
      const type = node.getAttribute("type");
      if (type !== "checkbox") {
        node.remove();
        return;
      }
    }

    const raw = node.getAttribute("style");
    if (raw === null) return;
    const kept = filterStyleDeclarations(raw);
    if (kept) node.setAttribute("style", kept);
    else node.removeAttribute("style");
  });
}

installStyleFilter();

/**
 * 渲染 Markdown 为可安全插入 DOM 的 HTML。
 *
 * `html: true` 是必要的（用户可能写居中标签），但同步内容是不可信输入
 * （ARCHITECTURE.md §19），因此**必须**经 DOMPurify 消毒后再返回。
 *
 * 这里同时放行 MathML（`mathMl` profile）：KaTeX 输出 MathML 供屏幕阅读器
 * 朗读公式，只保留 HTML profile 会让公式对无障碍工具不可读。
 */
export function renderMarkdown(source: string): string {
  if (!source || !source.trim()) {
    return "";
  }
  const raw = md.render(source);
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    ADD_ATTR: [
      "data-task-index",
      "checked",
      "disabled",
      "data-language",
      "viewBox",
      "stroke-width",
      "stroke-linecap",
      "stroke-linejoin",
    ],
    // 注意：这里**不再**禁止 style。KaTeX 依赖它做排版，
    // 改用 ALLOWED_STYLE_PROPS 按属性名精确放行（见上）。
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus"],
  });
}
