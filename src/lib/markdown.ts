import DOMPurify from "dompurify";
import MarkdownIt, { type StateInline } from "markdown-it";
import katex from "@vscode/markdown-it-katex";
import footnotePlugin from "markdown-it-footnote";
import frontMatterPlugin from "markdown-it-front-matter";
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

// 脚注：`[^1]` … `[^1]: 说明` 渲染为文末注释区与可点击的往返链接。
// 输出只有 sup/a/ol/section 等标准标签，DOMPurify 全部放行（有测试锁定）。
md.use(resolveKatexPlugin(footnotePlugin) as typeof footnotePlugin);

// YAML front matter（Obsidian/Jekyll 等导出文件的文件头元信息）。
// 插件把它从正文里整体摘走（不再渲染成分隔线+裸文本），原始文本经
// 回调捕获；renderMarkdown 里同步取出并渲染成元信息表。
let capturedFrontMatter: string | null = null;
md.use(
  resolveKatexPlugin(frontMatterPlugin) as typeof frontMatterPlugin,
  (raw: string) => {
    capturedFrontMatter = raw;
  },
);

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

// ---------------------------------------------------------------------------
// [[Wiki 链接]]（Obsidian 风格的笔记互链）
// ---------------------------------------------------------------------------

/** Wiki 目标里禁止出现的字符：`:` 挡 scheme 注入，其余挡嵌套/换行。 */
const WIKI_TARGET_FORBIDDEN = /[\[\]|\n\r]/;

/**
 * 把 `[[目标]]` 解析为 { target, anchor, alias }；不匹配或非法返回 null。
 *
 * 支持的写法（与 Obsidian 对齐）：
 * - `[[笔记]]` → 同目录 `笔记.md`
 * - `[[笔记|显示名]]` → 链接 `笔记.md`，显示「显示名」
 * - `[[笔记#标题]]` / `[[#标题]]` → 带页内锚点 / 同文档锚点
 */
export function parseWikiLink(raw: string): { target: string; anchor: string | null; alias: string | null } | null {
  // 字符类只排除括号与换行；`|` 是别名的分隔符，要在匹配之后才拆分。
  const match = raw.match(/^\[\[([^\[\]\n\r]*?)\]\]/);
  if (!match) return null;

  let body = match[1];
  let alias: string | null = null;
  const pipe = body.indexOf("|");
  if (pipe !== -1) {
    alias = body.slice(pipe + 1).trim() || null;
    body = body.slice(0, pipe);
  }

  let target = body.trim();
  let anchor: string | null = null;
  const hash = target.lastIndexOf("#");
  if (hash !== -1) {
    anchor = target.slice(hash + 1).trim() || null;
    target = target.slice(0, hash).trim();
  }

  if (target === "" && !anchor) return null;
  if (WIKI_TARGET_FORBIDDEN.test(target)) return null;
  // `:` 在 Windows 文件名里非法，也顺带挡死 `javascript:` 之类 scheme。
  if (target.includes(":")) return null;

  // 无扩展名的目标按 Markdown 笔记处理（Obsidian 的默认语义）。
  if (target !== "" && !/\.(md|markdown|txt)$/i.test(target)) {
    target = `${target}.md`;
  }
  return { target, anchor, alias };
}

/**
 * Wiki 链接的最终 href：与相对路径互链完全同一形态，
 * 复用既有的解析与打开管线（resolveLocalLink / 锚点滚动）。
 */
export function wikiLinkHref(parsed: { target: string; anchor: string | null }): string {
  if (parsed.target === "") return `#${parsed.anchor ?? ""}`;
  return parsed.anchor ? `${parsed.target}#${parsed.anchor}` : parsed.target;
}

/** Wiki 链接显示文本：显式别名优先，否则目标名（去扩展名，保留锚点）。 */
export function wikiLinkText(parsed: { target: string; anchor: string | null; alias: string | null }): string {
  if (parsed.alias !== null) return parsed.alias;
  const name = parsed.target.replace(/\.(md|markdown|txt)$/i, "");
  return parsed.anchor ? `${name}#${parsed.anchor}` : name;
}

/**
 * `[[...]]` 内联规则。必须排在 `link` 之前：CommonMark 对 `[[x]]` 的解析
 * 结果是字面文本（外层候选链失败），但我们要抢在它之前整体消费。
 */
function wikiLinkInline(state: StateInline, silent: boolean): boolean {
  if (state.src[state.pos] !== "[" || state.src[state.pos + 1] !== "[") return false;

  const consumed = state.src.slice(state.pos).match(/^\[\[[^\[\]\n\r]*?\]\]/);
  if (!consumed) return false;
  const parsed = parseWikiLink(consumed[0]);
  if (!parsed) return false;

  if (!silent) {
    const open = state.push("link_open", "a", 1);
    open.attrSet("href", wikiLinkHref(parsed));
    open.attrSet("class", "wiki-link");
    const text = state.push("text", "", 0);
    text.content = wikiLinkText(parsed);
    state.push("link_close", "a", -1);
  }
  state.pos += consumed[0].length;
  return true;
}
md.inline.ruler.before("link", "wiki_link", wikiLinkInline);

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

  // 长代码块默认折叠（仅预览 env 请求时）：先看到开头，感兴趣再展开。
  // 打印/PDF 由 @media print 强制展开，不会打出半截代码。
  const lineCount = token.content.replace(/\n$/, "").split("\n").length;
  const collapsible = env?.collapsibleCode === true && lineCount > CODE_COLLAPSE_THRESHOLD;

  return [
    `<div class="code-block" data-language="${md.utils.escapeHtml(langLabel)}"`,
    collapsible
      ? ` data-collapsed="true" data-line-count="${lineCount}">`
      : ">",
    '  <div class="code-block__header">',
    `    <span class="code-block__lang">${md.utils.escapeHtml(langLabel)}</span>`,
    '    <button type="button" class="code-block__copy" aria-label="复制代码" title="复制代码">',
    `      ${COPY_ICON_SVG}`,
    "    </button>",
    "  </div>",
    codeHtml,
    collapsible
      ? `  <button type="button" class="code-block__expand">展开全部 ${lineCount} 行</button>\n`
      : "",
    '</div>\n',
  ].join("\n");
};

/** 页内锚点 id 的统一前缀；点击 `#标题` 链接时按同一规则反查。 */
export const HEADING_ID_PREFIX = "h-";

/**
 * 为标题生成页内锚点 id：`h-` + encodeURIComponent(标题文本)。
 * 同名标题依次追加 `-2`、`-3`…… 链接只能指向第一个同名标题（与 GitHub 一致）。
 *
 * 之所以自己生成而不是用 markdown-it-anchor：点击侧的反查必须与生成侧
 * 完全同规则（中文标题会先被 normalizeLink 编码成 %XX），一份规则两处
 * 复用才不会出现「生成的 id 和链接对不上」。
 */
function headingAnchorId(text: string, occurrence: number): string {
  const base = `${HEADING_ID_PREFIX}${encodeURIComponent(text)}`;
  return occurrence === 0 ? base : `${base}-${occurrence + 1}`;
}

/** 页内锚点：为每个标题注入 id，让 `[见下文](#标题)` 可以真正跳转。 */
md.core.ruler.after("inline", "heading_anchor", (state) => {
  const used = new Map<string, number>();
  for (let i = 0; i < state.tokens.length; i++) {
    if (state.tokens[i].type !== "heading_open") continue;
    const inline = state.tokens[i + 1];
    const text = (inline?.children ?? [])
      .map((child) => child.content)
      .join("")
      .trim();
    if (!text) continue;

    const key = text.toLowerCase();
    const occurrence = used.get(key) ?? 0;
    used.set(key, occurrence + 1);
    state.tokens[i].attrSet("id", headingAnchorId(text, occurrence));
  }
});

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
 * 本地图片占位 URL 的固定来源。
 *
 * 外部磁盘文件里的 `![](./images/x.png)` 不能直接交给 webview：
 * 相对 src 会按应用自身路径解析成破图，`E:\...` 盘符路径会被 DOMPurify
 * 当成未知协议剥掉。因此渲染时先改写成这个固定 https 占位符（能安全
 * 通过消毒），预览组件再按占位符从磁盘读图、注入本地 blob URL。
 */
export const LOCAL_IMAGE_PLACEHOLDER_PREFIX = "https://crab-md-local.invalid/";

/** 从已渲染 HTML 中找出本地图片占位符；捕获组是整体编码后的引用。 */
export const LOCAL_IMAGE_PLACEHOLDER_RE =
  /https:\/\/crab-md-local\.invalid\/([^\s"'<>]+)/g;

/** 本地图片引用占位符：整体再编码一次，保证占位 URL 自身永远合法。 */
export function localImagePlaceholder(reference: string): string {
  return LOCAL_IMAGE_PLACEHOLDER_PREFIX + encodeURIComponent(reference);
}

/** 从占位符还原原始引用；编码损坏时返回 null（加载侧跳过）。 */
export function decodeLocalImageRef(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/** 视为远程/内联、不做本地解析的 src 协议。file: 一并排除（安全边界）。 */
const NON_LOCAL_IMAGE_RE = /^(?:https?:|data:|blob:|file:|mailto:)/i;

const defaultImageRenderer = md.renderer.rules.image;
md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index];
  // markdown-it v15 的 attr 值类型是 string | number；这里按字符串处理。
  const src = String(token.attrGet("src") ?? "");

  // 仅在外层明确启用时改写（外部文件预览）；工作区文档与既有测试
  // 看到的 src 保持原样。
  if (env?.localImages === true && src && !NON_LOCAL_IMAGE_RE.test(src)) {
    // markdown-it 的 normalizeLink 已把非 ASCII 编码成 %XX；先解回原文
    // 再编码进占位符，取出时解码才能得到与磁盘一致的文件名。
    let reference = src;
    try {
      reference = decodeURIComponent(src);
    } catch {
      // 保留原样（畸形编码按字面处理）。
    }
    // 本地路径没有查询/片段成分，`x.png?v=2` 实际指向 x.png。
    reference = reference.split("#")[0].split("?")[0];
    if (reference) {
      token.attrSet("src", localImagePlaceholder(reference));
    }
  }

  return (
    defaultImageRenderer?.(tokens, index, options, env, self) ??
    self.renderToken(tokens, index, options)
  );
};

/** 预览中超过该行数的代码块默认折叠（env.collapsibleCode 开启时）。 */
export const CODE_COLLAPSE_THRESHOLD = 20;

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

let mermaidInitialized = false;

/**
 * Parse and render one Mermaid source string, returning only sanitized SVG.
 * `htmlLabels: false` keeps Mermaid's labels in SVG text nodes rather than
 * introducing HTML `foreignObject` content that would need to be trusted.
 *
 * `initialize` 只执行一次：配置固定不变，逐图重初始化纯属浪费
 * （一篇文档可能有十几个图，每个都重走一遍全局配置）。
 */
export async function renderMermaidDiagram(source: string, id: string): Promise<string> {
  const mermaid = await loadMermaid();
  if (!mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
    });
    mermaidInitialized = true;
  }

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
 * 把捕获到的 front matter 渲染成安静的元信息表。
 *
 * 只做行级 `key: value` 解析：front matter 的键值对是元信息展示，
 * 嵌套结构（列表、多行值）不是给阅读者的，略去不强求 YAML 完备性。
 * 没有可解析的键值对时不输出任何东西。
 */
function renderFrontMatterTable(raw: string): string {
  const rows: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_\-. ]+?)\s*:\s*(.*)$/);
    if (!match) continue;
    rows.push(
      `<tr><th>${md.utils.escapeHtml(match[1])}</th>` +
        `<td>${md.utils.escapeHtml(match[2])}</td></tr>`,
    );
  }
  if (rows.length === 0) return "";
  return `<div class="front-matter"><table><tbody>${rows.join("")}</tbody></table></div>\n`;
}

/**
 * 渲染 Markdown 为可安全插入 DOM 的 HTML。
 *
 * `html: true` 是必要的（用户可能写居中标签），但同步内容是不可信输入
 * （ARCHITECTURE.md §19），因此**必须**经 DOMPurify 消毒后再返回。
 *
 * 这里同时放行 MathML（`mathMl` profile）：KaTeX 输出 MathML 供屏幕阅读器
 * 朗读公式，只保留 HTML profile 会让公式对无障碍工具不可读。
 *
 * `env.localImages`：外部文件预览置 true 时，本地图片 src 会被改写成
 * 占位符（见上方渲染器规则），供预览组件按占位符注入磁盘读出的 blob。
 * `env.collapsibleCode`：预览置 true 时，超长代码块默认折叠。
 */
export interface RenderMarkdownEnv {
  localImages?: boolean;
  collapsibleCode?: boolean;
  /** markdown-it 的 Env 允许携带任意附加键（插件约定），保留索引签名。 */
  [key: string]: unknown;
}

export function renderMarkdown(source: string, env?: RenderMarkdownEnv): string {
  if (!source || !source.trim()) {
    return "";
  }
  // front matter 回调是渲染期间的唯一出口；同步渲染内取用即清，
  // 避免残留影响下一次调用（markdown-it 解析是同步的，无并发问题）。
  capturedFrontMatter = null;
  // markdown-it 的 Env 带 symbol 索引签名，与本接口的可选键形状不完全
  // 重合；这里传的就是本模块自产的 env，收窄一次即可。
  const raw = md.render(source, env as Parameters<typeof md.render>[1]);
  const frontHtml =
    capturedFrontMatter !== null ? renderFrontMatterTable(capturedFrontMatter) : "";
  capturedFrontMatter = null;

  return DOMPurify.sanitize(frontHtml + raw, {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    ADD_ATTR: [
      "data-task-index",
      "checked",
      "disabled",
      "data-language",
      "data-collapsed",
      "data-line-count",
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
