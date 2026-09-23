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
    settings: "设置",
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
    /** 另存为副本（新身份、独立文件，原标题与原文不动）。 */
    duplicate: "另存为副本",
    /** 导出为独立的 .md 文件，可交给别的编辑器打开。 */
    exportDoc: "导出为 Markdown…",
    /** 从磁盘导入 .md 文件为新笔记。 */
    importDoc: "导入 Markdown…",
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
      table: "表格",
      math: "行内公式",
      mathBlock: "块级公式",
    },
    /** 字体入口：给选中的文字单独指定字体；没选中则作用于接下来输入的内容。 */
    quickFont: "字体",
    quickFontHint: "选中文字后设置字体；未选中时，设置为接下来输入的字体。",
    quickFontClear: "清除字体",
    quickFontNoSelection: "请先选中文字",
    /** 编辑器内快速选字体时展示的短名（完整名在设置页）。 */
    quickFontOption: {
      system: "默认",
      yahei: "雅黑",
      simhei: "黑体",
      simsun: "宋体",
      kaiti: "楷体",
      fangsong: "仿宋",
      times: "Times",
      georgia: "Georgia",
      arial: "Arial",
      calibri: "Calibri",
      mono: "等宽",
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

  settings: {
    title: "设置",
    close: "关闭",
    /** 左侧分组导航的无障碍名称。 */
    navLabel: "设置分组",
    /** 按用户心智模型分组，不按实现模块（UI §34）。 */
    sections: {
      appearance: "外观",
      editor: "编辑器",
      files: "文件与数据",
      about: "关于",
    },

    appearance: {
      theme: "主题",
      themeHint: "可以选择固定的明暗主题，或跟随系统设置自动切换。",
      themeOption: {
        light: "浅色",
        dark: "深色",
        system: "跟随系统",
      },
    },

    editor: {
      fontSize: "字号",
      fontSizeHint: "调整正文文字大小，编辑区与预览区同时生效。",
      fontSizeOption: {
        sm: "小",
        md: "中",
        lg: "大",
        xl: "特大",
      },
      cjkFont: "中文字体",
      cjkFontHint: "设置汉字使用的字体。",
      latinFont: "西文字体",
      latinFontHint: "设置英文、数字与符号使用的字体，与中文字体各自独立。",
      /**
       * 用**字体自己的名字**，而不是「衬线/无衬线」这类抽象类别 ——
       * 用户想的是「我要用宋体」，中文的衬线差别也不像西文那样直观。
       */
      cjkFontOption: {
        system: "系统默认",
        yahei: "微软雅黑",
        simhei: "黑体",
        simsun: "宋体",
        kaiti: "楷体",
        fangsong: "仿宋",
      },
      latinFontOption: {
        system: "系统默认",
        times: "Times New Roman",
        georgia: "Georgia",
        arial: "Arial",
        calibri: "Calibri",
        mono: "等宽",
      },
      previewLabel: "预览",
      viewMode: "默认视图",
      viewModeHint: "仅编辑只看源码，仅阅读只看渲染结果。",
      /** 复用工具栏的视图模式文案，避免两处各写一份。 */
      viewModeOption: {
        edit: "仅编辑",
        split: "分栏",
        preview: "仅阅读",
      },
    },

    storage: {
      label: "数据目录",
      description: "所有笔记、附件与索引都保存在这个文件夹里。",
      current: "当前使用",
      /** 环境变量覆盖时的提示 —— 必须说清"改了也不会立刻生效"。 */
      fromEnvNote:
        "当前目录由环境变量 CRAB_MD_WORKSPACE 指定，在此修改不会生效。请先清除该环境变量。",
      browse: "更换…",
      open: "打开",
      reset: "恢复默认",
      defaultHint: "默认位置",
      configFile: "设置文件",
      copyPath: "复制路径",
      copied: "路径已复制",
      copyFailed: "复制失败，请手动选择文本复制",
      /** 切换确认：换目录后看到的是另一套笔记，要说清不是删除。 */
      confirmTitle: "切换数据目录",
      confirmBody: (path: string) =>
        `切换到「${path}」后，将显示该目录中的笔记。原目录里的内容不会被删除，随时可以切回。`,
      confirmOk: "切换",
      cancel: "取消",
      done: "已切换数据目录",
    },

    about: {
      versionLabel: "版本",
      /** 「关于」只放事实信息，不放推广内容（§34 不暴露内部实现细节）。 */
      description:
        "本地优先的 Markdown 笔记应用。笔记以标准 .md 文件保存在本机，不依赖网络。",
      dataFormat: "数据格式",
      dataFormatValue: "标准 Markdown + 本地 SQLite 索引",
    },

    update: {
      label: "软件更新",
      /** 自动检查的说明：让用户知道"它自己会看"，但一天最多一次。 */
      hint: "应用每天最多自动检查一次更新。",
      check: "检查更新",
      checking: "正在检查…",
      upToDate: "已是最新版本",
      available: (version: string) => `发现新版本 ${version}`,
      downloading: (percent: number) => `正在下载… ${percent}%`,
      /** 下载中拿不到总大小时不假装知道进度。 */
      downloadingUnknown: "正在下载…",
      install: "下载并安装",
      /** 提示条上的关闭（与设置页的「取消」语义不同：这是忽略本次提示）。 */
      dismiss: "暂不更新",
      /** 工具栏入口的提示文案：有更新时按钮带徽标。 */
      toolbarLabel: (version: string) => `有新版本 ${version}`,
      /** 安装会关闭应用 —— 必须提前说清并确认（§16 破坏性操作先确认）。 */
      confirmTitle: "安装更新",
      confirmBody: (version: string) =>
        `将下载并安装 ${version}，安装完成后应用会自动重启。未保存的内容会先自动保存。`,
      confirmOk: "安装并重启",
      cancel: "取消",
      restarting: "正在重启…",
      /** 失败原因对用户可操作：给出网络/代理的提示，而不是只报错。 */
      failed: "检查更新失败",
      failedHint: "请检查网络连接后重试。若使用了代理，请确认代理可访问 GitHub。",
      installFailed: "安装失败",
      /** 签名不匹配是安全信号，必须明确告知而不是含糊过去。 */
      installFailedHint: "更新包校验未通过，已中止安装。当前版本不受影响。",
    },
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
    duplicated: "已另存为副本",
    duplicateFailed: "另存失败，原文未受影响",
    exported: "已导出",
    exportFailed: "导出失败，原笔记未受影响",
    imported: (title: string) => `已导入「${title}」`,
    importFailed: "导入失败，未创建笔记",
  },

  /** 导入 / 导出用的系统文件对话框文案。 */
  transfer: {
    exportTitle: "导出为 Markdown",
    importTitle: "导入 Markdown 文件",
    /** 仅显示 Markdown，避免用户选中一个二进制文件。 */
    markdownFilterName: "Markdown",
  },

  /**
   * 另存为副本时的默认标题。
   *
   * 放在 i18n 而不是 Rust 侧：这是界面文案，语言属前端职责
   * （UI §2.5 要求文案集中在 src/lib/i18n.ts）。
   */
  duplicateTitle: (original: string) => `${original} 副本`,

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
