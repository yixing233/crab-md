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
    toggleOutline: "大纲",
    /** 视图模式切换（编辑 / 分栏 / 阅读）。 */
    view: {
      label: "视图",
      edit: "仅编辑",
      split: "分栏",
      preview: "仅阅读",
    },
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
    rename: "重命名",
    delete: "删除",
    /** 行内重命名输入框的无障碍标签。 */
    renameLabel: "笔记名称",
    /** 顶部「更多操作」按钮，用于触屏等无右键场景。 */
    moreActions: "更多操作",
  },

  dialog: {
    deleteTitle: "删除笔记",
    /** 删除是不可逆的数据丢失，文案要明确点出对象（UI §16）。 */
    deleteBody: (title: string) => `确定要删除「${title}」吗？此操作无法撤销。`,
    deleteConfirm: "删除",
    cancel: "取消",
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

  loading: {
    workspace: "正在载入工作区…",
  },

  preview: {
    empty: "暂无可预览的内容。",
  },

  outline: {
    title: "大纲",
    ariaLabel: "文档大纲",
    empty: "这篇文档还没有标题。",
    /** 空标题（只有一个 #）时的占位文字。 */
    untitled: "（无标题）",
  },

  breadcrumb: {
    ariaLabel: "文档位置",
  },

  splitter: {
    sidebar: "调整侧边栏宽度",
    preview: "调整预览宽度",
  },

  toast: {
    saved: "已保存",
    saveFailed: "保存失败，内容仍保留在编辑器中",
    renamed: "已重命名",
    deleted: "已删除",
  },

  error: {
    /** 前缀 + 中文说明。 */
    prefix: "出错了",
    dismiss: "关闭",
    retry: "重试",
    /** 错误码 → 中文说明。未知码回退到通用文案。 */
    // ARCHITECTURE.md §16.1 的错误码保持英文（可编程判断），
    // 但给用户的解释必须是中文（UI §2.5、§32）。
    messages: {
      NOT_FOUND: "找不到这篇笔记，它可能已被删除。",
      INVALID_ID: "文档标识无效，请求已被拒绝。",
      INVALID_INPUT: "输入不合法，请检查后重试。",
      WORKSPACE_MISSING: "工作区不存在或无法访问。",
      IO_ERROR: "读写本地文件失败。你的内容仍保存在本机。",
      DB_ERROR: "本地数据库访问失败。你的内容仍保存在本机。",
      SERDE_ERROR: "数据格式异常，无法解析。",
      UNKNOWN: "发生了未预期的错误。你的内容仍保存在本机。",
    } as Record<string, string>,
  },
} as const;

/**
 * CodeMirror 内置面板（查找 / 替换 / 跳转行）的中文词表。
 *
 * `@codemirror/search` 等扩展通过 `EditorState.phrases` 取这些字符串；
 * 不注入的话，中文产品里会冒出一整块英文 UI（UI §2.5）。
 */
export const cmPhrases: Record<string, string> = {
  // 查找
  Find: "查找",
  Replace: "替换",
  next: "下一个",
  previous: "上一个",
  all: "全部",
  "match case": "区分大小写",
  "by word": "全词匹配",
  regexp: "正则表达式",
  replace: "替换",
  "replace all": "全部替换",
  "go to line": "跳转到行",
  close: "关闭",
  "current match": "当前匹配",
  "replaced $ matches": "已替换 $ 处",
  "replaced match on line $": "已替换第 $ 行的匹配",
  "on line": "所在行",
};
