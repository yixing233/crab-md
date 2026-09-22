import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import katex from "@vscode/markdown-it-katex";

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

// 数学公式（$...$ 与 $$...$$）。
//
// throwOnError: false —— 公式写错时渲染成红色错误文本而不是抛异常。
// 渲染一份笔记不该因为一个手误的公式而整页失败。
//
// 解析插件形状：该包是 CommonJS（module.exports = { default: fn }）。
// vitest 下拿到的是函数本身，浏览器里经 Vite 的 CJS 互操作拿到的是
// { default: fn } —— 直接 md.use(import 值) 在浏览器会抛
// "plugin.apply is not a function"（单测全绿但实际打不开预览）。
// 两种形状都兼容，避免这类只在真实环境暴露的缺陷。
const katexPlugin =
  (katex as unknown as { default?: typeof katex }).default ?? katex;

md.use(katexPlugin, {
  throwOnError: false,
  // 输出同时包含 MathML（无障碍朗读）与 HTML（视觉排版）。
  output: "htmlAndMathml",
});

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
    USE_PROFILES: { html: true, mathMl: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    // 注意：这里**不再**禁止 style。KaTeX 依赖它做排版，
    // 改用 ALLOWED_STYLE_PROPS 按属性名精确放行（见上）。
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus"],
  });
}
