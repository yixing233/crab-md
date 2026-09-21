/**
 * 从 Markdown 源码抽取标题大纲（UI_DESIGN_SYSTEM.md §23 Outline）。
 *
 * 纯函数、不依赖 DOM —— 与 `markdownActions.ts` 同样的思路：
 * 逻辑可独立单测，组件只负责渲染。
 *
 * 只识别 ATX 标题（`#` 开头）。围栏代码块（``` / ~~~）内的 `#` 不算标题，
 * 否则代码示例会污染大纲。setext 标题（`===` 下划线）在编辑中歧义较大，不处理。
 */

export interface OutlineItem {
  /** 1–6，对应 `#` 的数量。 */
  level: number;
  /** 标题文字，已去掉首尾空白与结尾的 `#`。 */
  text: string;
  /** 文档内的行号（0 基），供跳转使用。 */
  line: number;
}

/** 匹配 ATX 标题：0–3 个前导空格 + 1–6 个 # + 空格/行尾。 */
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;

/** 匹配围栏代码块的开合（``` 或 ~~~，允许 info string）。 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * 抽取大纲。空输入返回空数组；无标题也返回空数组（调用方据此显示空态）。
 */
export function extractOutline(source: string): OutlineItem[] {
  if (!source) return [];

  const items: OutlineItem[] = [];
  let fenceChar: string | null = null;

  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1][0];
      if (fenceChar === null) {
        fenceChar = marker;
      } else if (fenceChar === marker) {
        // 同种围栏才闭合；``` 里出现 ~~~ 不算结束。
        fenceChar = null;
      }
      continue;
    }
    // 在代码块内一律不当作标题。
    if (fenceChar !== null) continue;

    const m = ATX.exec(line);
    if (!m) continue;

    const raw = (m[2] ?? "").trim();
    // 去掉可选的结尾 #（`## 标题 ##`）。
    const text = raw.replace(/[ \t]+#+$/, "").trim();
    items.push({ level: m[1].length, text, line: i });
  }

  return items;
}
