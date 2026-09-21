/**
 * 界面文案（简体中文）。
 *
 * **产品语言约定：本应用面向中文用户，所有用户可见文案一律使用简体中文。**
 * 该约定已写入 `UI_DESIGN_SYSTEM.md` §2.5，本文件是唯一文案来源 ——
 * 组件里不得再出现硬编码的中英文界面字符串。
 *
 * 例外：代码标识符、CSS 类名、日志、错误码（如 `NOT_FOUND`）保持英文，
 * 因为它们不是用户界面文案（`ARCHITECTURE.md` §16.1 要求错误码稳定可编程判断）。
 */
export const zh = {
  app: {
    name: "crab-md",
    untitled: "未命名",
  },

  toolbar: {
    toggleSidebar: "切换侧边栏",
    theme: {
      light: "浅色主题",
      dark: "深色主题",
      system: "跟随系统",
    },
    search: "搜索",
    newDocument: "新建",
  },

  sidebar: {
    title: "笔记",
  },

  fileTree: {
    emptyTitle: "还没有笔记",
    emptyDescription: "创建你的第一个 Markdown 文档。",
    newNote: "新建笔记",
    /** 无障碍标签：文件树本身。 */
    ariaLabel: "笔记列表",
  },

  editor: {
    /** 格式工具栏的无障碍标签。 */
    toolbarAriaLabel: "格式化",
    actions: {
      bold: "加粗",
      italic: "斜体",
      strikethrough: "删除线",
      heading: "标题",
      bulletList: "无序列表",
      orderedList: "有序列表",
      quote: "引用",
      link: "链接",
      image: "图片",
      inlineCode: "行内代码",
      codeBlock: "代码块",
    },
  },

  statusBar: {
    saved: "已保存",
    unsaved: "未保存",
    markdown: "Markdown",
    encoding: "UTF-8",
    /** Ln 1, Col 1 的中文写法。 */
    lineColumn: (line: number, column: number) => `第 ${line} 行，第 ${column} 列`,
  },

  empty: {
    noDocumentTitle: "未打开文档",
    noDocumentDescription: "从左侧列表选择一篇笔记，或新建一篇。",
    newNote: "新建笔记",
  },

  error: {
    /** 前缀 + 错误码，例如「出错了：DB_ERROR」。 */
    prefix: "出错了",
    dismiss: "关闭",
  },
} as const;
