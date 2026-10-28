/** turndown-plugin-gfm 未随包发布类型声明（只有运行时代码）。 */
declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown";

  /** 一次启用全部 GFM 规则（表格 / 删除线 / 任务清单 / 高亮代码块）。 */
  export function gfm(service: TurndownService): void;
  export function highlightedCodeBlock(service: TurndownService): void;
  export function strikethrough(service: TurndownService): void;
  export function tables(service: TurndownService): void;
  export function taskListItems(service: TurndownService): void;
}
