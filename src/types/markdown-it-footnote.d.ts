/**
 * markdown-it-footnote 未随包发布类型声明（只有运行时代码）。
 * 插件形状与其它 markdown-it 插件一致：(md, options) => void。
 */
declare module "markdown-it-footnote" {
  const markdownItFootnote: (md: unknown, options?: unknown) => void;
  export default markdownItFootnote;
}
