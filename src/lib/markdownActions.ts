/**
 * Markdown 格式化动作的纯函数实现。
 *
 * 每个动作接收「当前文本 + 选区」并返回「新文本 + 新选区」，
 * 不碰 DOM、不碰 CodeMirror —— 因此可以脱离编辑器完整单测。
 * UI_DESIGN_SYSTEM.md §21.1 列出的动作在此逐一实现。
 */

export interface EditorSelection {
  text: string;
  /** 选区起点（含）。 */
  from: number;
  /** 选区终点（不含）。`from === to` 表示光标折叠。 */
  to: number;
}

export interface EditorChange {
  text: string;
  from: number;
  to: number;
}

export type MarkdownActionId =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inlineCode"
  | "codeBlock"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "quote"
  | "link"
  | "image"
  | "table"
  | "math"
  | "mathBlock";

/** 包裹型动作的标记。再次触发同一动作即取消（toggle）。 */
const WRAP_MARKERS: Partial<Record<MarkdownActionId, string>> = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
  inlineCode: "`",
};

/** 行首前缀型动作；再次触发即移除。 */
const LINE_PREFIXES: Partial<Record<MarkdownActionId, string>> = {
  heading: "## ",
  bulletList: "- ",
  quote: "> ",
};

/** 把选区扩展为完整行范围，返回 [行首, 行尾] 与行数组。 */
function expandToLines(sel: EditorSelection): { start: number; end: number; lines: string[] } {
  const { text, from, to } = sel;
  const start = text.lastIndexOf("\n", from - 1) + 1;
  const nextBreak = text.indexOf("\n", to);
  const end = nextBreak === -1 ? text.length : nextBreak;
  return { start, end, lines: text.slice(start, end).split("\n") };
}

/** 该行是否已有指定前缀（用于 toggle 判断）。 */
function hasPrefix(line: string, prefix: string): boolean {
  return line.startsWith(prefix);
}

/**
 * 包裹动作：`**加粗**`、`*斜体*`、`` `代码` ``、`~~删除线~~`。
 *
 * 三种情形：
 * 1. 已包裹（标记紧贴选区内外侧）→ 取消包裹
 * 2. 有选区 → 包裹选区，保持选中被包裹的内容
 * 3. 无选区 → 插入标记并将光标置于中间，便于直接输入
 */
function applyWrap(sel: EditorSelection, marker: string): EditorChange {
  const { text, from, to } = sel;
  const len = marker.length;

  const outerStart = from - len;
  const outerEnd = to + len;
  const alreadyWrapped =
    outerStart >= 0 &&
    text.slice(outerStart, from) === marker &&
    text.slice(to, outerEnd) === marker;

  if (alreadyWrapped) {
    return {
      text: text.slice(0, outerStart) + text.slice(from, to) + text.slice(outerEnd),
      from: outerStart,
      to: to - len,
    };
  }

  // 选区内部自身带着标记，例如选中了 "**粗**"：移除内层标记而不是再套一层。
  if (to - from >= 2 * len) {
    const inner = text.slice(from, to);
    if (inner.startsWith(marker) && inner.endsWith(marker)) {
      return {
        text: text.slice(0, from) + inner.slice(len, -len) + text.slice(to),
        from,
        to: to - 2 * len,
      };
    }
  }

  const selected = text.slice(from, to);
  const inserted = `${marker}${selected}${marker}`;
  const out = text.slice(0, from) + inserted + text.slice(to);

  // 有选区时保持选中被包裹的内容；无选区时 from === to，光标自然落在两标记之间。
  return { text: out, from: from + len, to: to + len };
}

/**
 * 行前缀动作：标题、无序列表、引用。
 * 对选区内每一行生效；若所有行都已有该前缀则整体移除（toggle）。
 */
function applyLinePrefix(sel: EditorSelection, prefix: string): EditorChange {
  const { start, end, lines } = expandToLines(sel);
  const text = sel.text;

  const allHave = lines.every((l) => l.trim() === "" || hasPrefix(l, prefix));
  const next = lines
    .map((l) => {
      if (allHave) return l.startsWith(prefix) ? l.slice(prefix.length) : l;
      // 空行不强行加前缀（引用除外，空引用行是合法的）。
      if (l.trim() === "" && prefix !== "> ") return l;
      return l.startsWith(prefix) ? l : prefix + l;
    })
    .join("\n");

  return { text: text.slice(0, start) + next + text.slice(end), from: start, to: start + next.length };
}

/** 有序列表：逐行编号。已有编号则整体移除。 */
function applyOrderedList(sel: EditorSelection): EditorChange {
  const { start, end, lines } = expandToLines(sel);
  const text = sel.text;
  const numbered = /^\d+\.\s/;
  const allNumbered = lines.every((l) => l.trim() === "" || numbered.test(l));

  let n = 1;
  const next = lines
    .map((l) => {
      if (allNumbered) return l.replace(numbered, "");
      if (l.trim() === "") return l;
      return numbered.test(l) ? l : `${n++}. ${l}`;
    })
    .join("\n");

  return { text: text.slice(0, start) + next + text.slice(end), from: start, to: start + next.length };
}

/** 围栏代码块：标记独立成行，内容包在中间。 */
function applyCodeBlock(sel: EditorSelection): EditorChange {
  const { text, from, to } = sel;
  const selected = text.slice(from, to);
  const fence = "```";
  const before = from === 0 || text[from - 1] === "\n" ? "" : "\n";
  const inserted = `${before}${fence}\n${selected}\n${fence}`;
  const out = text.slice(0, from) + inserted + text.slice(to);
  const contentStart = from + before.length + fence.length + 1;
  return { text: out, from: contentStart, to: contentStart + selected.length };
}

/**
 * 表格：插入一个两列三行的骨架（表头 + 分隔行 + 一行空体）。
 *
 * 插入后选中第一个表头单元格，用户可直接键入列名，按 Tab 走向下一格。
 * 分隔行的 `---` 是 Markdown 表格的必需部分 —— 少了它整张表不会被解析，
 * 因此必须一起给出，不能让用户自己补。
 */
function applyTable(sel: EditorSelection): EditorChange {
  const { text, from, to } = sel;
  // 前置换行：表格必须独占块。若光标紧跟在文字后面，不补换行会被并进上一段。
  const before = from === 0 || text[from - 1] === "\n" ? "" : "\n";
  const rows = [
    "| 列 1 | 列 2 |",
    "| --- | --- |",
    "|  |  |",
  ];
  const inserted = `${before}${rows.join("\n")}`;
  const out = text.slice(0, from) + inserted + text.slice(to);

  // 选中首个「列 1」，便于直接覆盖输入。
  const start = from + before.length + "| ".length;
  return { text: out, from: start, to: start + "列 1".length };
}

/**
 * 行内公式：`$...$`。
 *
 * 有选区时把选区包起来（用户很可能先写好公式再套标记）；
 * 无选区时给出占位并选中，便于直接键入。
 */
function applyInlineMath(sel: EditorSelection): EditorChange {
  const { text, from, to } = sel;
  const selected = text.slice(from, to);
  const body = selected || "公式";
  const inserted = `$${body}$`;
  const out = text.slice(0, from) + inserted + text.slice(to);
  const start = from + 1;
  return { text: out, from: start, to: start + body.length };
}

/**
 * 块级公式：`$$` 独立成行。
 *
 * 与行内公式分开成两个动作，而不是自动判断：`$$` 独占一行才有编号与居中，
 * 而用户想不想独占一行只有他自己知道 —— 交给两个按钮比猜测更可靠。
 */
function applyBlockMath(sel: EditorSelection): EditorChange {
  const { text, from, to } = sel;
  const selected = text.slice(from, to).trim();
  const body = selected || "a^2 + b^2 = c^2";
  const before = from === 0 || text[from - 1] === "\n" ? "" : "\n";
  const after = text[to] === "\n" || to === text.length ? "" : "\n";
  const inserted = `${before}$$\n${body}\n$$${after}`;
  const out = text.slice(0, from) + inserted + text.slice(to);
  const start = from + before.length + 3;
  return { text: out, from: start, to: start + body.length };
}

/** 插入型动作（链接、图片）：无选区时给出占位文本并选中它，便于直接覆盖输入。 */
function applyInsertTemplate(
  sel: EditorSelection,
  build: (label: string) => { inserted: string; selectFrom: number; selectTo: number },
): EditorChange {
  const { text, from, to } = sel;
  const selected = text.slice(from, to);
  const { inserted, selectFrom, selectTo } = build(selected);
  const out = text.slice(0, from) + inserted + text.slice(to);
  return { text: out, from: from + selectFrom, to: from + selectTo };
}

/**
 * 对当前选区执行一个 Markdown 动作。
 * 纯函数：相同输入必得相同输出，不修改入参。
 */
export function applyMarkdownAction(sel: EditorSelection, action: MarkdownActionId): EditorChange {
  const wrapMarker = WRAP_MARKERS[action];
  if (wrapMarker) return applyWrap(sel, wrapMarker);

  const linePrefix = LINE_PREFIXES[action];
  if (linePrefix) return applyLinePrefix(sel, linePrefix);

  switch (action) {
    case "orderedList":
      return applyOrderedList(sel);

    case "codeBlock":
      return applyCodeBlock(sel);

    case "table":
      return applyTable(sel);

    case "math":
      return applyInlineMath(sel);

    case "mathBlock":
      return applyBlockMath(sel);

    case "link":
      return applyInsertTemplate(sel, (label) => {
        const text = label || "text";
        const inserted = `[${text}](url)`;
        // 用 indexOf 定位而不是算长度：标记结构若调整，选择范围不会静默错位。
        const urlAt = inserted.indexOf("(url)") + 1;
        // 无选区时选中占位 label 便于直接输入；有选区时选中 url 提示替换目标。
        return label
          ? { inserted, selectFrom: urlAt, selectTo: urlAt + 3 }
          : { inserted, selectFrom: 1, selectTo: 1 + text.length };
      });

    case "image":
      return applyInsertTemplate(sel, (label) => {
        const text = label || "alt";
        const inserted = `![${text}](url)`;
        const urlAt = inserted.indexOf("(url)") + 1;
        // `![` 占 2 个字符，故无选区时 label 从索引 2 开始。
        return label
          ? { inserted, selectFrom: urlAt, selectTo: urlAt + 3 }
          : { inserted, selectFrom: 2, selectTo: 2 + text.length };
      });

    default:
      return { text: sel.text, from: sel.from, to: sel.to };
  }
}

/** 供工具栏渲染用的动作清单（UI_DESIGN_SYSTEM.md §21.1 的顺序）。 */
export const EDITOR_ACTIONS: ReadonlyArray<{
  id: MarkdownActionId;
  label: string;
  shortcut?: string;
}> = [
  { id: "bold", label: "Bold", shortcut: "Ctrl+B" },
  { id: "italic", label: "Italic", shortcut: "Ctrl+I" },
  { id: "strikethrough", label: "Strikethrough" },
  { id: "heading", label: "Heading" },
  { id: "bulletList", label: "Bullet list" },
  { id: "orderedList", label: "Numbered list" },
  { id: "quote", label: "Quote" },
  { id: "link", label: "Link" },
  { id: "image", label: "Image" },
  { id: "inlineCode", label: "Inline code", shortcut: "Ctrl+`" },
  { id: "codeBlock", label: "Code block" },
  { id: "table", label: "Table" },
  { id: "math", label: "Inline math" },
  { id: "mathBlock", label: "Block math" },
];
