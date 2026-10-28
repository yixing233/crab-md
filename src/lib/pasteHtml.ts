/**
 * 富文本 → Markdown 转换（粘贴时用）。
 *
 * 网页 / Word 复制的内容自带 text/html 味道；不经转换直接落盘，
 * `html: true` 的渲染管线会把消毒后的内联标签原样存进文档 —— 文件不再
 * 是纯净的 Markdown。本模块只做转换这一件事，被编辑器在粘贴事件里调用。
 *
 * 抽成独立模块：turndown 实例的初始化有成本（注册规则），模块级复用一份；
 * 转换规则集中一处，测试不必牵扯 CodeMirror。
 */
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

let service: TurndownService | null = null;

function getService(): TurndownService {
  if (!service) {
    service = new TurndownService({
      // ATX 标题（#）与围栏代码块（```）是本应用渲染器与生态的主流写法。
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
    });
    // 表格 / 删除线 / 任务清单来自 GFM —— 与渲染器支持的范围一致。
    service.use(gfm);
    // gfm 插件的删除线输出单波浪号（~text~）；双波浪号（~~text~~）是
    // 更普遍的写法，渲染器与其它编辑器的兼容面也更宽。后加的规则优先生效。
    service.addRule("strikethroughDoubleTilde", {
      // del / s / strike 三种写法（strike 不在 HTMLElementTagNameMap 里，
      // 故用函数过滤器而非标签名数组）。
      filter: (node) =>
        node.nodeName === "DEL" || node.nodeName === "S" || node.nodeName === "STRIKE",
      replacement: (content) => `~~${content}~~`,
    });
  }
  return service;
}

/**
 * 把 HTML 转成 Markdown；输入为空或转换失败时返回空串。
 *
 * 转换失败不该打断粘贴：返回空串让调用方回退到 CodeMirror 的默认
 * 粘贴行为（插入纯文本），而不是把粘贴事件吞掉。
 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  try {
    return getService().turndown(html).trim();
  } catch {
    return "";
  }
}
