/**
 * 收窄列表内的折叠范围，避免出现「看不出有什么可折叠的」折叠箭头。
 *
 * 背景（用户反馈：「为啥这有一个折叠容器？似乎没有什么提供折叠的内容啊」）：
 * Markdown 的**懒惰续行**规则会把紧跟在列表项之后、没有空行分隔的普通段落并入
 * 该列表项。`@codemirror/lang-markdown` 的默认规则给所有「块级且非 Document /
 * 标题 / 列表」的节点挂上折叠范围，于是这种没有缩进的续行文本旁边也会冒出折叠
 * 箭头 —— 视觉上完全无从理解：里面既没有嵌套结构，折叠后也只是藏起一行正文。
 *
 * 判据：只有当被折叠的内容里**真的存在缩进行**（嵌套列表、缩进续行块等结构性
 * 内容）时才允许折叠。纯懒惰续行（零缩进）一律视为不可折叠。
 *
 * 覆盖两个节点，二者是同一现象的两个来源，缺一不可：
 *   - `ListItem`：任务列表等形态（`- [ ] 甲` 的续行由 ListItem 承载）；
 *   - `Paragraph`：普通无序/有序列表（`- 甲` 的续行由 Paragraph 承载）。
 *     只对**直接位于 ListItem 之下**的段落生效，因此列表之外的普通多行段落
 *     仍保持可折叠（折叠长段落是正常且有用的行为）。
 *
 * 之所以自己构造 `Language` 而不是 `markdownLanguage.configure(...)`（后者不是函数）：
 * `markdown({ base })` 只读取 `base.parser`，所以必须把覆盖后的解析器包进 `Language`。
 * `configure` 是叠加语义，GFM 等原有 props 会保留，`Table` 的折叠等能力不受影响。
 */
import { foldNodeProp, Language } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { markdownLanguage } from "@codemirror/lang-markdown";

/** 被折叠的区间里是否存在缩进行（即真正可折叠的结构）。 */
function hasIndentedLine(state: EditorState, from: number, to: number): boolean {
  if (to <= from) return false;
  return state
    .sliceDoc(from, to)
    .split("\n")
    .some((line) => line.trim() !== "" && /^\s/.test(line));
}

/**
 * 与默认规则一致：从「起始行末尾」折叠到节点末尾。
 * `requireIndent` 为 true 时，只有内容含缩进行才可折叠（用于列表内）。
 */
function foldRange(state: EditorState, nodeFrom: number, nodeTo: number, requireIndent: boolean) {
  const from = state.doc.lineAt(nodeFrom).to;
  if (from >= nodeTo) return null;
  if (requireIndent && !hasIndentedLine(state, from, nodeTo)) return null;
  return { from, to: nodeTo };
}

/**
 * `markdownLanguage.parser` 的类型被擦成了通用的 `Parser`，拿不到 `configure`；
 * 但 `markdown()` 在运行时会断言它是 `MarkdownParser`（否则抛 RangeError）。
 * 这里用一个最小结构类型把 `configure` 补回来 —— 仅为类型用途，因此不必新增
 * `@lezer/markdown` 依赖。
 */
type ConfigureableParser = typeof markdownLanguage.parser & {
  configure(spec: { props: readonly unknown[] }): typeof markdownLanguage.parser;
};

export const markdownFoldLanguage = new Language(
  markdownLanguage.data,
  (markdownLanguage.parser as ConfigureableParser).configure({
    props: [
      foldNodeProp.add({
        // 列表项：仅当折叠内容里确有缩进结构（嵌套列表 / 缩进续行块）时才可折叠。
        ListItem: (node, state) => foldRange(state, node.from, node.to, true),
        // 段落：位于列表项之下时同样要求缩进（懒惰续行的第二种来源）；
        // 列表之外的普通多行段落保持默认可折叠行为，不受影响。
        Paragraph: (node, state) =>
          foldRange(state, node.from, node.to, node.parent?.name === "ListItem"),
      }),
    ],
  }),
  [],
  "markdown",
);
