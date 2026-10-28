import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { PanelLeftOpen } from "lucide-react";
import { MarkdownEditor, type MarkdownEditorHandle } from "./components/editor/MarkdownEditor";
import { EditorToolbar } from "./components/editor/EditorToolbar";
import { EditorStatusBar } from "./components/editor/EditorStatusBar";
import { MarkdownPreview } from "./components/editor/MarkdownPreview";
import { AppToolbar } from "./components/workspace/AppToolbar";
import type { MenuBarMenu } from "./components/workspace/MenuBar";
import { Sidebar, type SidebarTab } from "./components/workspace/Sidebar";
import { UpdateBar } from "./components/workspace/UpdateBar";
import { Breadcrumb } from "./components/workspace/Breadcrumb";
import { TabBar } from "./components/workspace/TabBar";
import { HomePage } from "./components/home/HomePage";
import { CommandPalette } from "./components/workspace/CommandPalette";
import {
  CloseDocumentModal,
  type ClosePromptType,
} from "./components/workspace/CloseDocumentModal";
import { clearRecoveryDraft } from "./lib/recovery";
import { Splitter } from "./components/workspace/Splitter";
import { SettingsPage } from "./components/settings/SettingsPage";
import { AboutDialog } from "./components/settings/AboutDialog";
import { Button } from "./components/ui/Button";
import { Tooltip } from "./components/ui/Tooltip";
import { Dialog } from "./components/ui/Dialog";
import { Spinner } from "./components/ui/Spinner";
import { Toast } from "./components/ui/Toast";
import type { ContextMenuItem } from "./components/ui/ContextMenu";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { api } from "./lib/api";
import { zh } from "./lib/i18n";
import { checkForUpdate, readLastCheck, shouldAutoCheck, writeLastCheck } from "./lib/updater";
import { tauriUpdaterBridge } from "./lib/updaterBridge";
import { toggleTaskInSource } from "./lib/markdown";
import { PrintExportModal } from "./components/export/PrintExportModal";
import { useUpdateStore } from "./stores/useUpdateStore";
import type { MarkdownActionId } from "./lib/markdownActions";
import {
  applyTheme,
  applyWindowTheme,
  readStoredPreference,
  resolveTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "./lib/theme";
import {
  createRippleEnvironment,
  freshOrigin,
  runThemeTransition,
  type StampedOrigin,
} from "./lib/themeTransition";
import {
  applyFontSize,
  applyFontStack,
  FONT_CJK_KEY,
  FONT_LATIN_KEY,
  FONT_SIZE_KEY,
  LEGACY_FONT_FAMILY_KEY,
  migrateLegacyFontPreset,
  readStoredCjkFont,
  readStoredFontSize,
  readStoredLatinFont,
  type EditorCjkFont,
  type EditorFontSize,
  type EditorLatinFont,
} from "./lib/editorPrefs";
import {
  applyAccentColor,
  applyDarkStyle,
  applyUiDensity,
  applyUiZoom,
  readStoredAccentColor,
  readStoredDarkStyle,
  readStoredUiDensity,
  readStoredUiZoom,
  ACCENT_COLOR_KEY,
  DARK_STYLE_KEY,
  UI_DENSITY_KEY,
  UI_ZOOM_KEY,
  type AccentColor,
  type DarkStyle,
  type UiDensity,
  type UiZoom,
} from "./lib/appearancePrefs";
import { getAntdTheme } from "./lib/antdTheme";
import {
  nextViewMode,
  readStoredViewMode,
  showsEditor,
  showsPreview,
  VIEW_MODE_KEY,
  VIEW_MODES,
  type ViewMode,
} from "./lib/viewMode";
import {
  applyPreviewTypography,
  defaultPreviewTypography,
  parseStoredTypography,
  PREVIEW_TYPE_KEY,
  type ElementTypography,
  type PreviewElementId,
  type PreviewTypography,
} from "./lib/previewTypography";
import {
  readStoredSyncScroll,
  SYNC_SCROLL_KEY,
  useSyncScroll,
} from "./lib/syncScroll";
import {
  AUTOSAVE_KEY,
  LINE_NUMBERS_KEY,
  LINE_WRAP_KEY,
  PASTE_HTML_AS_MARKDOWN_KEY,
  PARAGRAPH_FOCUS_KEY,
  TYPEWRITER_KEY,
  readStoredAutosaveMode,
  readStoredLineNumbers,
  readStoredLineWrap,
  readStoredParagraphFocus,
  readStoredPasteHtmlAsMarkdown,
  readStoredTypewriter,
  type AutosaveMode,
} from "./lib/editorSettings";
import {
  loadRenderToggles,
  parseRenderToggles,
  RENDER_TOGGLES_KEY,
  setRenderToggles,
} from "./lib/renderToggles";
import { applyAutosaveMode } from "./stores/useWorkspaceStore";
import { pickExportPath, pickOpenFilePath, runExport } from "./lib/transfer";
import {
  baseName,
  externalPathOf,
  externalTabId,
  samePath,
} from "./lib/externalFiles";
import "./App.css";

/** 面板宽度持久化的存储键。 */
const SIDEBAR_WIDTH_KEY = "crab-md.sidebar-width";
const PREVIEW_WIDTH_KEY = "crab-md.preview-width";
const OPEN_TABS_KEY = "crab-md.open-tabs";
/** 侧栏当前面板（大纲 / 文件 / 外部文件）。 */
const SIDEBAR_TAB_KEY = "crab-md.sidebar-tab";

/**
 * 读取已保存的侧栏面板。
 *
 * 默认「文件」而不是「大纲」：新工作区里大纲必然是空的，只有文件面板
 * 能给出可执行的动作（新建笔记），否则首次打开会先看到一块空面板。
 */
function readStoredSidebarTab(raw: string | null): SidebarTab {
  return raw === "outline" || raw === "notes" || raw === "external" ? raw : "notes";
}

/** 读取已保存的面板宽度；无存储或值非法时回退到默认值。 */
function readStoredWidth(key: string, fallback: number): number {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 智能从正文中提取建议的笔记标题（优先取第一个一级标题或首行内容）。 */
function extractSuggestedTitle(content: string): string {
  const headingMatch = content.match(/^#+\s+(.+)$/m);
  if (headingMatch && headingMatch[1].trim()) {
    return headingMatch[1].trim().slice(0, 40).replace(/[\\/:*?"<>|]/g, "");
  }
  const firstLine = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
  if (firstLine) {
    return firstLine.replace(/^[#*`>~-]+\s*/, "").slice(0, 40).replace(/[\\/:*?"<>|]/g, "").trim();
  }
  return "";
}

export default function App() {
  const documents = useWorkspaceStore((s) => s.documents);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const activeContent = useWorkspaceStore((s) => s.activeContent);
  const dirty = useWorkspaceStore((s) => s.dirty);
  const loading = useWorkspaceStore((s) => s.loading);
  const error = useWorkspaceStore((s) => s.error);
  const loadDocuments = useWorkspaceStore((s) => s.loadDocuments);
  const openDocument = useWorkspaceStore((s) => s.openDocument);
  const createDocument = useWorkspaceStore((s) => s.createDocument);
  const renameDocument = useWorkspaceStore((s) => s.renameDocument);
  const deleteDocument = useWorkspaceStore((s) => s.deleteDocument);
  const duplicateDocument = useWorkspaceStore((s) => s.duplicateDocument);
  const saveActive = useWorkspaceStore((s) => s.saveActive);
  const flushActive = useWorkspaceStore((s) => s.flushActive);
  const setContent = useWorkspaceStore((s) => s.setContent);
  const clearError = useWorkspaceStore((s) => s.clearError);
  const recoveryCandidate = useWorkspaceStore((s) => s.recoveryCandidate);
  const restoreRecovery = useWorkspaceStore((s) => s.restoreRecovery);
  const discardRecovery = useWorkspaceStore((s) => s.discardRecovery);
  // 打开过的外部文件清单（来自工作区数据库，只有元数据没有正文）。
  // 这是「重启后还能看到」的依据：列表面板与标签标题都从它恢复。
  const externalCatalog = useWorkspaceStore((s) => s.externalFiles);
  const externalFilesLoaded = useWorkspaceStore((s) => s.externalFilesLoaded);
  const loadExternalFiles = useWorkspaceStore((s) => s.loadExternalFiles);
  const forgetExternalFile = useWorkspaceStore((s) => s.forgetExternalFile);
  const openExternalDocument = useWorkspaceStore((s) => s.openExternal);
  // 统一磁盘历史记录
  const recentFiles = useWorkspaceStore((s) => s.recentFiles);
  const loadRecentFiles = useWorkspaceStore((s) => s.loadRecentFiles);
  const removeRecentFile = useWorkspaceStore((s) => s.removeRecentFile);
  const deleteDiskFile = useWorkspaceStore((s) => s.deleteDiskFile);
  const setFilePinned = useWorkspaceStore((s) => s.setFilePinned);

  const [sidebarVisible, setSidebarVisible] = useState(true);
  // 侧栏当前面板：大纲 / 文件，两者互斥（顶部标签页切换）。持久化。
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>(() =>
    readStoredSidebarTab(typeof localStorage === "undefined" ? null : localStorage.getItem(SIDEBAR_TAB_KEY)),
  );
  // 「大纲正在显示」= 侧栏展开且停在「大纲」标签页。
  // 之前它是一个独立的显隐开关；改成标签页后，显隐由「当前是哪个面板」
  // 决定，不再需要第二份状态（两份状态迟早会互相矛盾）。
  const outlineVisible = sidebarVisible && sidebarTab === "outline";
  /** 视图菜单里的「大纲」：已显示则切回笔记，否则展开侧栏并切到大纲。 */
  const toggleOutline = useCallback(() => {
    if (outlineVisible) {
      setSidebarTab("notes");
    } else {
      setSidebarTab("outline");
      setSidebarVisible(true);
    }
  }, [outlineVisible]);
  // 视图模式：仅编辑 / 分栏 / 仅阅读（UI §11）。持久化，记住用户的选择。
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    readStoredViewMode(typeof localStorage === "undefined" ? null : localStorage.getItem(VIEW_MODE_KEY)),
  );
  // 面板宽度（UI §11 pane resizing）。侧栏宽度持久化，符合「记住我的布局」预期。
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredWidth(SIDEBAR_WIDTH_KEY, 260));
  const [previewWidth, setPreviewWidth] = useState(() => readStoredWidth(PREVIEW_WIDTH_KEY, 420));
  // 编辑器光标位置与选中文本，供状态栏显示（UI §28）。
  const [cursor, setCursor] = useState({ line: 1, column: 1, selectedText: "" });
  // 编辑器句柄，供横跨全屏的工具栏派发格式化动作。
  const editorRef = useRef<MarkdownEditorHandle>(null);
  // 最近一次指针按下位置与时刻；主题波纹以它为圆心（见 lib/themeTransition.ts）。
  // 用「最近一次」而不是把坐标一路透传：主题入口有四个（工具栏、视图菜单、
  // 命令面板、设置页），让每个控件都往外传事件会把改动扩散到无关组件。
  const lastPointerRef = useRef<StampedOrigin | null>(null);
  const handleEditorAction = useCallback((action: MarkdownActionId) => {
    editorRef.current?.dispatchAction(action);
  }, []);

  // 记录本次会话中新建尚未明确命名的文档 ID
  const newDocumentIdsRef = useRef<Set<string>>(new Set());
  // 关闭文档时的确认 / 命名弹窗状态
  const [closePrompt, setClosePrompt] = useState<ClosePromptType | null>(null);
  // PDF 导出与打印排版沉浸式对话框
  const [printModalOpen, setPrintModalOpen] = useState(false);

  // 顶部多标签栏打开的文档 ID 列表
  const [openTabIds, setOpenTabIds] = useState<string[]>(() => {
    if (typeof localStorage === "undefined") return [];
    try {
      const stored = localStorage.getItem(OPEN_TABS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // 持久化打开的标签列表
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(openTabIds));
    }
  }, [openTabIds]);

  // 保证当前激活文档在打开标签列表中（仅当 activeId 发生切换时执行）
  useEffect(() => {
    if (activeId) {
      setOpenTabIds((prev) => (prev.includes(activeId) ? prev : [...prev, activeId]));
    }
  }, [activeId]);

  /**
   * 清理已经不复存在的标签。
   *
   * - 工作区文档：仍在列表里才保留（等文档列表加载完再判断，否则冷启动会闪掉）；
   * - 外部文件：数据库里还记着就保留。**必须等清单加载完**再清理 ——
   *   清单没读回来时所有记录都「不存在」，那时清理会把重启前的标签全删掉。
   */
  useEffect(() => {
    setOpenTabIds((prev) => {
      const next = prev.filter((id) => {
        const extPath = externalPathOf(id);
        if (extPath !== null) {
          if (!externalFilesLoaded) return true;
          return externalCatalog.some((f) => samePath(f.path, extPath));
        }
        if (documents.length === 0) return true;
        return documents.some((d) => d.id === id);
      });
      return next.length === prev.length ? prev : next;
    });
  }, [documents, externalCatalog, externalFilesLoaded]);
  // 大纲跳转目标；nonce 保证重复点同一标题也能再次跳转。
  const [jumpTarget, setJumpTarget] = useState<{ line: number; nonce: number } | null>(null);
  // 轻提示（UI §33）：保存成功/失败等非阻塞反馈。
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  // Ctrl+F 的触发计数；递增即请求编辑器打开查找面板。
  const [findNonce, setFindNonce] = useState(0);
  // 命令面板 / 快速打开开关（Ctrl+P / Ctrl+K）
  const [paletteOpen, setPaletteOpen] = useState(false);
  // 设置页开关（UI §34）。
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 「关于」对话框开关（UI §16、§34）。它不再是设置页的一个分组：
  // 关于只是应用信息 + 更新入口，用户不必先想到「设置」才能查版本。
  const [aboutOpen, setAboutOpen] = useState(false);
  // 有新版时工具栏显示徽标；null 表示无更新（工具栏保持安静，§2.1）。
  const updateStatus = useUpdateStore((s) => s.status);
  const pendingUpdateVersion =
    updateStatus.kind === "available" ? updateStatus.version : null;
  // 待删除的文档；非空时显示确认对话框（UI §14.4 要求破坏性操作先确认）。
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readStoredPreference(typeof localStorage === "undefined" ? null : localStorage.getItem(THEME_STORAGE_KEY)),
  );
  // 主题的只读镜像。`cycleTheme` 被快捷键监听闭包持有，若直接依赖
  // themePreference，每切一次主题都要重装一次 keydown 监听 ——
  // 用 ref 既拿到最新值，又让 `cycleTheme` 的引用保持稳定。
  const themePreferenceRef = useRef(themePreference);
  themePreferenceRef.current = themePreference;
  // 当前**实际生效**的明暗，由下面的主题 effect 写入。偏好从 system 切成
  // 与系统同名的固定值时（跟随系统·亮 → 浅色），偏好变了但画面没变，
  // 不该为一次零视觉差异的切换播满屏波纹。
  const resolvedThemeRef = useRef<ResolvedTheme | null>(null);
  // resolved theme 的响应式镜像：antd ConfigProvider 的 token 配置是
  // JS 对象而非 CSS 变量，主题切换时要触发重渲染才能换肤（data-theme 只够 CSS 用）。
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");
  // 编辑器字号与主题同属「纯展示偏好」，都由 App 持有 ——
  // 只有这样它才会在**启动时**生效；若只由设置页持有，
  // 就必须先打开设置页才应用，重启即回到默认值。
  const [fontSize, setFontSize] = useState<EditorFontSize>(() =>
    readStoredFontSize(typeof localStorage === "undefined" ? null : localStorage.getItem(FONT_SIZE_KEY)),
  );
  const [accentColor, setAccentColor] = useState<AccentColor>(() =>
    readStoredAccentColor(typeof localStorage === "undefined" ? null : localStorage.getItem(ACCENT_COLOR_KEY)),
  );
  const [uiZoom, setUiZoom] = useState<UiZoom>(() =>
    readStoredUiZoom(typeof localStorage === "undefined" ? null : localStorage.getItem(UI_ZOOM_KEY)),
  );
  const [uiDensity, setUiDensity] = useState<UiDensity>(() =>
    readStoredUiDensity(typeof localStorage === "undefined" ? null : localStorage.getItem(UI_DENSITY_KEY)),
  );
  const [darkStyle, setDarkStyle] = useState<DarkStyle>(() =>
    readStoredDarkStyle(typeof localStorage === "undefined" ? null : localStorage.getItem(DARK_STYLE_KEY)),
  );

  /**
   * 字体分西文与中文两项（Word 也是分开的）。
   *
   * 初始化时处理**旧版本的单一预设**：老用户只存过 `crab-md.editor-font-family`，
   * 直接读新 key 会得到默认值，体感是「我的设置丢了」。故先在旧 key 上做一次
   * 迁移，把预设拆成（西文, 中文）两个值。
   */
  const [latinFont, setLatinFont] = useState<EditorLatinFont>(() => {
    if (typeof localStorage === "undefined") return readStoredLatinFont(null);
    const stored = localStorage.getItem(FONT_LATIN_KEY);
    if (stored !== null) return readStoredLatinFont(stored);
    const legacy = migrateLegacyFontPreset(localStorage.getItem(LEGACY_FONT_FAMILY_KEY));
    return legacy ? legacy[0] : readStoredLatinFont(null);
  });
  const [cjkFont, setCjkFont] = useState<EditorCjkFont>(() => {
    if (typeof localStorage === "undefined") return readStoredCjkFont(null);
    const stored = localStorage.getItem(FONT_CJK_KEY);
    if (stored !== null) return readStoredCjkFont(stored);
    const legacy = migrateLegacyFontPreset(localStorage.getItem(LEGACY_FONT_FAMILY_KEY));
    return legacy ? legacy[1] : readStoredCjkFont(null);
  });

  /**
   * 预览排版：按元素分别设置字体与字号（只影响阅读面）。
   *
   * 从 localStorage 还原时逐元素归一 —— 用户手改存储或从旧版本升级
   * 都可能带来非法值，绝不能直接写进 CSS。
   */
  const [previewTypography, setPreviewTypography] = useState<PreviewTypography>(() =>
    parseStoredTypography(
      typeof localStorage === "undefined"
        ? null
        : localStorage.getItem(PREVIEW_TYPE_KEY),
    ),
  );

  /** 改一类元素的排版。 */
  const handleChangePreviewElement = useCallback(
    (element: PreviewElementId, next: ElementTypography) => {
      setPreviewTypography((prev) => ({ ...prev, [element]: next }));
    },
    [],
  );

  /** 恢复默认排版（用户可能把某类元素调得没法看）。 */
  const handleResetPreviewTypography = useCallback(() => {
    setPreviewTypography(defaultPreviewTypography());
  }, []);

  // 编辑器行为偏好（行号 / 自动换行）：与字号同属「启动即生效」的纯展示偏好，
  // 都由 App 持有 —— 只由设置页自持的话，重启即回到默认值。
  const [lineNumbersOn, setLineNumbersOn] = useState<boolean>(() =>
    readStoredLineNumbers(typeof localStorage === "undefined" ? null : localStorage.getItem(LINE_NUMBERS_KEY)),
  );
  const [lineWrapOn, setLineWrapOn] = useState<boolean>(() =>
    readStoredLineWrap(typeof localStorage === "undefined" ? null : localStorage.getItem(LINE_WRAP_KEY)),
  );
  const [pasteHtmlAsMarkdownOn, setPasteHtmlAsMarkdownOn] = useState<boolean>(() =>
    readStoredPasteHtmlAsMarkdown(
      typeof localStorage === "undefined" ? null : localStorage.getItem(PASTE_HTML_AS_MARKDOWN_KEY),
    ),
  );
  // 写作模式（F8 / F9 也可切换）：状态在这里，编辑器快捷键只是上报意图。
  const [typewriterOn, setTypewriterOn] = useState<boolean>(() =>
    readStoredTypewriter(typeof localStorage === "undefined" ? null : localStorage.getItem(TYPEWRITER_KEY)),
  );
  const [paragraphFocusOn, setParagraphFocusOn] = useState<boolean>(() =>
    readStoredParagraphFocus(
      typeof localStorage === "undefined" ? null : localStorage.getItem(PARAGRAPH_FOCUS_KEY),
    ),
  );

  // 自动保存档位：App 持有并同步给 store（store 是模块级状态，不进 React）。
  const [autosaveMode, setAutosaveMode] = useState<AutosaveMode>(() =>
    readStoredAutosaveMode(typeof localStorage === "undefined" ? null : localStorage.getItem(AUTOSAVE_KEY)),
  );

  // 预览渲染开关（Mermaid / 公式）：读入后注入渲染管线的模块级状态。
  const [renderToggles, setRenderTogglesState] = useState(() =>
    parseRenderToggles(typeof localStorage === "undefined" ? null : localStorage.getItem(RENDER_TOGGLES_KEY)),
  );

  const [editorScrollEl, setEditorScrollEl] = useState<HTMLElement | null>(null);
  const [previewScrollEl, setPreviewScrollEl] = useState<HTMLElement | null>(null);
  // 同步滚动开关：分栏视图下编辑区与预览区按比例双向同步滚动。
  const [syncScroll, setSyncScroll] = useState<boolean>(() =>
    readStoredSyncScroll(
      typeof localStorage === "undefined" ? null : localStorage.getItem(SYNC_SCROLL_KEY),
    ),
  );

  // 同步滚动偏好持久化（UI §34.2）。
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SYNC_SCROLL_KEY, String(syncScroll));
    }
  }, [syncScroll]);

  // 编辑区与预览区双向同步滚动（在分栏且开启时生效）。
  useSyncScroll({
    editorEl: editorScrollEl,
    previewEl: previewScrollEl,
    enabled: syncScroll && showsEditor(viewMode) && showsPreview(viewMode),
  });

  // 字号：写 CSS 变量（CodeMirror theme 读它），并持久化。
  // 用变量而非重建编辑器：重建会丢光标位置与撤销历史。
  useEffect(() => {
    applyFontSize(fontSize);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FONT_SIZE_KEY, fontSize);
    }
  }, [fontSize]);

  // 两个字体合成一条 CSS 栈（西文在前、中文在后，靠逐字符回退分流），
  // 同时持久化。改动只写变量，不重建编辑器。
  useEffect(() => {
    applyFontStack(latinFont, cjkFont);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FONT_LATIN_KEY, latinFont);
      localStorage.setItem(FONT_CJK_KEY, cjkFont);
    }
  }, [latinFont, cjkFont]);

  // 预览排版：按元素分别写 CSS 变量，同时持久化。
  //
  // 与编辑区那套互相独立：编辑区只关心「写起来舒服」，
  // 预览要按元素区分（标题/代码/公式各有各的字号）。
  useEffect(() => {
    applyPreviewTypography(latinFont, previewTypography);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PREVIEW_TYPE_KEY, JSON.stringify(previewTypography));
    }
  }, [latinFont, previewTypography]);

  // 行号 / 自动换行：持久化。编辑器组件经 prop 拿到最新值，原地重配扩展。
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LINE_NUMBERS_KEY, String(lineNumbersOn));
    }
  }, [lineNumbersOn]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LINE_WRAP_KEY, String(lineWrapOn));
    }
  }, [lineWrapOn]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PASTE_HTML_AS_MARKDOWN_KEY, String(pasteHtmlAsMarkdownOn));
    }
  }, [pasteHtmlAsMarkdownOn]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TYPEWRITER_KEY, String(typewriterOn));
    }
  }, [typewriterOn]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PARAGRAPH_FOCUS_KEY, String(paragraphFocusOn));
    }
  }, [paragraphFocusOn]);

  // 自动保存档位：同步给 store（模块级状态），同时持久化。
  useEffect(() => {
    applyAutosaveMode(autosaveMode);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AUTOSAVE_KEY, autosaveMode);
    }
  }, [autosaveMode]);

  // 渲染开关：注入渲染管线（markdown.ts / livePreview.ts 的模块级状态），同时持久化。
  // 启动时统一走 loadRenderToggles，保证任何早于首帧的渲染读到的也是持久值。
  useEffect(() => {
    setRenderToggles(renderToggles);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(RENDER_TOGGLES_KEY, JSON.stringify(renderToggles));
    }
  }, [renderToggles]);

  // 自动保存档位同样在首帧前生效：初始化 effect 按 useState 顺序先于子组件渲染执行，
  // 这里再跑一次 loadRenderToggles 是为了兜住「渲染先于 effect」的极端路径（无副作用）。
  useEffect(() => {
    loadRenderToggles(typeof localStorage === "undefined" ? null : localStorage);
    applyAutosaveMode(autosaveMode);
    // 仅启动时执行一次：后续变化由上面的 effect 即时同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题：写入 <html data-theme>，CSS 变量随之切换（UI_DESIGN_SYSTEM.md §4.1）。
  // 偏好为 system 时还要监听系统变化，用户切换系统主题应当即时跟随。
  //
  // 同时把主题同步给原生窗口：`data-theme` 只影响 WebView 内部，
  // 原生标题栏由系统绘制，不同步的话深色下标题栏仍是白色。
  useEffect(() => {
    const mq = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

    const sync = () => {
      const resolved = resolveTheme(themePreference, systemPrefersDark());
      resolvedThemeRef.current = resolved;
      setResolvedTheme(resolved);
      applyTheme(resolved);
      void applyWindowTheme(resolved);
    };

    sync();
    if (themePreference !== "system" || !mq) return;

    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [themePreference]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    }
  }, [themePreference]);

  useEffect(() => {
    applyAccentColor(accentColor, resolvedTheme);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ACCENT_COLOR_KEY, accentColor);
    }
  }, [accentColor, resolvedTheme]);

  useEffect(() => {
    applyUiZoom(uiZoom);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(UI_ZOOM_KEY, uiZoom);
    }
  }, [uiZoom]);

  useEffect(() => {
    applyUiDensity(uiDensity);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(UI_DENSITY_KEY, uiDensity);
    }
  }, [uiDensity]);

  useEffect(() => {
    applyDarkStyle(darkStyle);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(DARK_STYLE_KEY, darkStyle);
    }
  }, [darkStyle]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PREVIEW_WIDTH_KEY, String(previewWidth));
    }
  }, [previewWidth]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SIDEBAR_TAB_KEY, sidebarTab);
    }
  }, [sidebarTab]);

  /**
   * 启动时后台检查更新。
   *
   * 三条约束（「稳定」的核心）：
   * - **节流**：一天最多一次，避免每次开应用都打扰；
   * - **静默**：网络不可达是常态（GitHub 在部分网络下不通），
   *   失败只写日志，绝不弹窗、绝不阻塞编辑；
   * - **不自动安装**：只提示有新版，装不装由用户决定。
   *
   * 结果写进 useUpdateStore，由工具栏徽标与提示条呈现 ——
   * 不再用会消失的 toast（UI §33 把「需要用户选择」列为 toast 反例）。
   */
  useEffect(() => {
    const storage = typeof localStorage === "undefined" ? null : localStorage;
    const now = Date.now();
    if (!shouldAutoCheck(now, readLastCheck(storage))) return;

    let cancelled = false;
    void (async () => {
      const result = await checkForUpdate(tauriUpdaterBridge);
      // 无论成功失败都记时间：失败时若也重试，网络异常会变成每次启动都试。
      if (!cancelled) writeLastCheck(storage, now);
      if (!cancelled && "update" in result && result.update) {
        useUpdateStore.getState().setAvailable(result.update);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /** 安装更新：先落盘，再安装（store 内部保证这个顺序）。 */
  const handleInstallUpdate = useCallback(() => {
    void useUpdateStore.getState().install(async () => {
      const saved = await flushActive();
      if (!saved) {
        setToast({ message: zh.toast.saveFailed, tone: "error" });
      }
      return saved;
    });
  }, [flushActive]);

  // 视图模式持久化：下次打开应用保持同一档。
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    }
  }, [viewMode]);

  /**
   * 切换主题偏好。工具栏、视图菜单、命令面板、设置页四个入口共用这一条路径，
   * 这样波纹动画与原生标题栏同步不需要在四处各写一遍。
   *
   * 为什么不能只 `setThemePreference`：
   * - 转场快照在回调**执行的那一刻**抓取，`data-theme` 必须在那之前改完；
   *   交给渲染后的 effect 写入就晚了，波纹扫过的是同一套配色；
   * - `flushSync` 让 React 立即提交，于是图标的明暗、菜单勾选、设置页分段
   *   控件的选中态与新主题同处一张快照，不会在动画结束后才「跳」一下。
   *
   * 系统偏好变化不在这里 —— 那是外部事件，没有可用的指针起点，
   * 仍由上面的 effect 同步应用。
   */
  const changeTheme = useCallback((next: ThemePreference) => {
    // 重复选中当前项（例如菜单里点已勾选的那一行）不该再播一次全屏波纹。
    if (next === themePreferenceRef.current) return;
    const resolved = resolveTheme(next, systemPrefersDark());

    // 偏好变了、画面没变：「跟随系统」（系统为亮）切到「浅色」就是这种情况。
    // 直接改状态，不铺开波纹 —— 否则会为一次零视觉差异的切换播满屏动画。
    if (resolved === resolvedThemeRef.current) {
      flushSync(() => setThemePreference(next));
      return;
    }

    runThemeTransition(
      () => {
        resolvedThemeRef.current = resolved;
        applyTheme(resolved);
        void applyWindowTheme(resolved);
        flushSync(() => setThemePreference(next));
      },
      freshOrigin(lastPointerRef.current, Date.now()),
      createRippleEnvironment(),
    );
  }, []);

  const cycleTheme = useCallback(() => {
    const current = themePreferenceRef.current;
    changeTheme(current === "system" ? "light" : current === "light" ? "dark" : "system");
  }, [changeTheme]);

  /**
   * 记录指针按下位置，供主题波纹取圆心。
   *
   * 用捕获阶段挂在 window 上：切换主题的入口分散在工具栏按钮、菜单项、
   * 命令面板与设置页分段控件里，逐个透传事件会污染它们的公共接口
   * （ContextMenu 的 `onSelect()`、SegmentedControl 的 `onChange(value)`
   * 都不带事件对象）。在顶层记一次，四个入口自动都有起点。
   */
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      lastPointerRef.current = { origin: { x: e.clientX, y: e.clientY }, at: Date.now() };
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  // 关窗前强制落盘。
  //
  // Rust 侧 `WindowEvent::CloseRequested` 会 prevent_close 并 emit
  // `flush-before-close`，这里落盘完成后再调 close_window 真正关闭。
  // 这样异步写盘一定能跑完，而不是像 beforeunload 那样随时被终止。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");

        const off = await listen("flush-before-close", () => {
          void (async () => {
            const saved = await useWorkspaceStore.getState().flushActive();
            // 保存失败时保持窗口打开，给用户机会处理磁盘错误；绝不能静默丢稿。
            if (saved) await invoke("close_window");
            else setToast({ message: zh.toast.saveFailed, tone: "error" });
          })();
        });

        // 组件在 await 期间被卸载的话，立刻退订避免泄漏。
        if (disposed) off();
        else unlisten = off;
      } catch {
        // 没有 Tauri IPC 的环境（单测的 jsdom、纯浏览器预览）里 listen 会抛。
        // 这不是错误路径：那种环境下也不会有关窗事件，忽略即可，
        // 但不能让异常逃逸成 unhandled rejection。
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleNewDocument = useCallback(async () => {
    await createDocument(zh.app.untitled);
    const newId = useWorkspaceStore.getState().activeId;
    if (newId) {
      newDocumentIdsRef.current.add(newId);
      setOpenTabIds((prev) => (prev.includes(newId) ? prev : [...prev, newId]));
    }
  }, [createDocument]);

  // 主页态：无活动文档时侧栏整体隐藏（主页自身就是文件入口，左侧再挂一列
  // 文件列表是重复）。打开任意文档后按 sidebarVisible 偏好恢复。
  const onHomePage = activeId === null;

  const handleOpenDocument = useCallback(
    async (id: string) => {
      setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      await openDocument(id);
    },
    [openDocument],
  );

  // 当前激活的外部文件：标签页 id 里有路径，库里有名字（拿不到时退回文件名）。
  const activeExtPath = activeId ? externalPathOf(activeId) : null;
  const activeExtRecord = activeExtPath
    ? externalCatalog.find((f) => samePath(f.path, activeExtPath))
    : undefined;
  const activeExt = activeExtPath
    ? { path: activeExtPath, name: activeExtRecord?.name ?? baseName(activeExtPath) }
    : null;
  const activeDoc =
    activeId && !activeExtPath ? documents.find((d) => d.id === activeId) : null;
  const activeTitle = activeExt ? activeExt.name : (activeDoc?.title ?? "");
  const activePath = activeExt ? activeExt.path : activeTitle;
  const isPlainText = activeTitle.toLowerCase().endsWith(".txt");

  /**
   * 打开（或切换回）一个外部文件标签页。
   *
   * 正文每次都**从磁盘读**：外部文件可能已被别的程序改动，缓存一份旧正文
   * 会让用户看到过期内容。读盘成功的同时 Rust 会把记录写进两张登记表
   * （标签恢复用的外部清单 + 文件树用的统一历史），因此两张清单都要重拉，
   * 否则刚打开的文件不会出现在左侧文件树里。
   *
   * 读失败（被移动、删除、过大、非 UTF-8）只提示并**保留记录** ——
   * 列表里会把它标成「文件不存在」，由用户决定何时移除。
   */
  const openExternalTab = useCallback(
    async (path: string) => {
      try {
        const file = await api.readExternalFile(path);
        const tabId = externalTabId(file.path);
        setOpenTabIds((prev) => (prev.includes(tabId) ? prev : [...prev, tabId]));
        openExternalDocument(file.path, file.content);
        await Promise.all([loadExternalFiles(), loadRecentFiles()]);
      } catch {
        setToast({ message: zh.toast.openFailed, tone: "error" });
      }
    },
    [loadExternalFiles, loadRecentFiles, openExternalDocument],
  );

  const handleSelectTab = useCallback(
    async (id: string | null) => {
      // 切换前必须先落盘当前编辑；**落盘失败就放弃切换**。
      // 若失败也照切，下面的 setState 会覆盖 activeContent —— 那是静默丢内容
      // （ARCHITECTURE.md §18.1、UI §42.10 明令禁止）。
      // 外部文件与工作区文档共用这条规则：两者都在编辑区里。
      if (activeId !== null && activeId !== id) {
        if (!(await useWorkspaceStore.getState().flushActive())) {
          setToast({ message: zh.toast.saveFailed, tone: "error" });
          return;
        }
      }

      if (id === null) {
        // 切换到主页
        useWorkspaceStore.setState({
          activeId: null,
          activeContent: "",
          dirty: false,
          externalBaseline: null,
        });
      } else if (id.startsWith("ext:")) {
        // 点已经打开的那条标签是无操作：重新读盘会把编辑区的未保存内容
        // 换成磁盘上的旧版本。上面那条 flush 守卫在 activeId === id 时不生效，
        // 因此这里必须自己挡一次。
        if (id !== activeId) await openExternalTab(id.slice(4));
      } else {
        await handleOpenDocument(id);
      }
    },
    [activeId, handleOpenDocument, openExternalTab],
  );

  const finalizeCloseTab = useCallback(
    async (id: string) => {
      newDocumentIdsRef.current.delete(id);
      const nextTabs = openTabIds.filter((t) => t !== id);
      setOpenTabIds(nextTabs);

      if (activeId === id) {
        if (nextTabs.length > 0) {
          const currentIndex = openTabIds.indexOf(id);
          const nextIndex = Math.min(currentIndex, nextTabs.length - 1);
          // 下一个标签可能是外部文件，必须走同一套分流逻辑，
          // 否则会把 `ext:` 当成文档 id 去读库（必然失败）。
          await handleSelectTab(nextTabs[nextIndex]);
        } else {
          useWorkspaceStore.setState({
            activeId: null,
            activeContent: "",
            dirty: false,
            externalBaseline: null,
          });
        }
      }
    },
    [activeId, openTabIds, handleSelectTab],
  );

  const handleCloseTab = useCallback(
    async (id: string) => {
      // 场景 0：外部物理文件（原位保存，只删标签不改磁盘）
      const extPath = externalPathOf(id);
      if (extPath !== null) {
        // 只有当前激活的那条可能有未落盘的编辑：切换标签前必先 flush，
        // 因此不需要额外维护一份 per-tab 脏标记（两份状态迟早会矛盾）。
        if (id === activeId && dirty) {
          setClosePrompt({
            kind: "save-changes",
            id,
            title: baseName(extPath),
          });
          return;
        }
        await finalizeCloseTab(id);
        return;
      }

      const doc = documents.find((d) => d.id === id);
      const isNewDoc = newDocumentIdsRef.current.has(id) || doc?.title === zh.app.untitled;
      let content = id === activeId ? activeContent : "";
      if (id !== activeId && isNewDoc) {
        try {
          const fullDoc = await api.readDocument(id);
          content = fullDoc.content;
        } catch {
          content = "";
        }
      }
      const isContentEmpty = content.trim().length === 0;

      // 场景 1：新建了空白文档但没有任何内容输入 -> 直接关闭并静默删除，不入库不存盘
      if (isNewDoc && isContentEmpty) {
        newDocumentIdsRef.current.delete(id);
        const nextTabs = openTabIds.filter((t) => t !== id);
        setOpenTabIds(nextTabs);
        await deleteDocument(id);
        if (activeId === id) {
          if (nextTabs.length > 0) {
            const currentIndex = openTabIds.indexOf(id);
            const nextIndex = Math.min(currentIndex, nextTabs.length - 1);
            await openDocument(nextTabs[nextIndex]);
          } else {
            useWorkspaceStore.setState({ activeId: null, activeContent: "", dirty: false });
          }
        }
        return;
      }

      // 场景 3：新建了文档且已输入内容 -> 提示保存并顺带命名
      if (isNewDoc && !isContentEmpty) {
        const suggested = extractSuggestedTitle(content) || (doc?.title ?? zh.app.untitled);
        setClosePrompt({
          kind: "save-and-name",
          id,
          suggestedName: suggested,
        });
        return;
      }

      // 场景 2：既有文档修改但未保存（dirty === true） -> 提示是否保存修改
      const isModified = id === activeId ? dirty : false;
      if (isModified) {
        setClosePrompt({
          kind: "save-changes",
          id,
          title: doc?.title ?? "当前文档",
        });
        return;
      }

      // 常态已保存文档直接关闭
      await finalizeCloseTab(id);
    },
    [
      activeId,
      activeContent,
      dirty,
      documents,
      openTabIds,
      deleteDocument,
      finalizeCloseTab,
      openDocument,
    ],
  );

  const handleConfirmSaveAndClose = useCallback(
    async (name?: string) => {
      if (!closePrompt) return;
      const targetId = closePrompt.id;

      // 外部文件先原位写回，再关闭标签：记录仍然留在列表里，
      // 用户随时能再打开它 —— 关闭标签不等于「从列表移除」。
      if (targetId.startsWith("ext:")) {
        setClosePrompt(null);
        // flushActive 在写入期间用户又改了字时返回 false（dirty 仍为真），
        // 此时保留标签而不是关掉：关掉就等于把新输入丢进垃圾堆。
        if (!(await useWorkspaceStore.getState().flushActive())) {
          setToast({ message: zh.toast.saveFailed, tone: "error" });
          return;
        }
        await finalizeCloseTab(targetId);
        return;
      }

      if (closePrompt.kind === "save-and-name" && name) {
        await renameDocument(targetId, name.trim());
      }
      if (targetId === activeId) {
        if (!(await useWorkspaceStore.getState().flushActive())) {
          setToast({ message: zh.toast.saveFailed, tone: "error" });
          setClosePrompt(null);
          return;
        }
      }
      setClosePrompt(null);
      await finalizeCloseTab(targetId);
    },
    [activeId, closePrompt, finalizeCloseTab, renameDocument],
  );

  const handleDiscardAndClose = useCallback(async () => {
    if (!closePrompt) return;
    const targetId = closePrompt.id;

    if (targetId.startsWith("ext:")) {
      // 丢弃改动：把编辑区还原到磁盘上的那一版，标签照常关闭。
      // 记录不动 —— 「关标签」与「从列表移除」是两件事。
      if (targetId === activeId) {
        const baseline = useWorkspaceStore.getState().externalBaseline;
        if (baseline !== null) {
          useWorkspaceStore.setState({ activeContent: baseline, dirty: false });
        }
      }
      setClosePrompt(null);
      await finalizeCloseTab(targetId);
      return;
    }

    if (closePrompt.kind === "save-and-name") {
      // 新建未保存的草稿丢弃 -> 彻底删除
      await deleteDocument(targetId);
    } else {
      // 既有修改丢弃 -> 清除草稿还原
      clearRecoveryDraft(targetId);
      if (targetId === activeId) {
        useWorkspaceStore.setState({ dirty: false });
      }
    }
    setClosePrompt(null);
    await finalizeCloseTab(targetId);
  }, [activeId, closePrompt, deleteDocument, finalizeCloseTab]);

  /**
   * 编辑区内容变化。
   *
   * 外部文件的「脏」由 store 依据磁盘基准推导（见 `setContent`），
   * 这里不再需要额外的 per-tab 状态 —— 那是两份迟早会互相矛盾的状态。
   */
  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
    },
    [setContent],
  );

  const handleCloseOtherTabs = useCallback(
    async (id: string) => {
      setOpenTabIds([id]);
      if (activeId !== id) {
        await handleSelectTab(id);
      }
    },
    [activeId, handleSelectTab],
  );

  const handleCloseRightTabs = useCallback(
    async (id: string) => {
      const idx = openTabIds.indexOf(id);
      if (idx === -1) return;
      const nextTabs = openTabIds.slice(0, idx + 1);
      setOpenTabIds(nextTabs);
      if (activeId && !nextTabs.includes(activeId)) {
        await handleSelectTab(id);
      }
    },
    [activeId, handleSelectTab, openTabIds],
  );

  const handleCloseAllTabs = useCallback(async () => {
    // 全部关闭前必须确认落盘成功，失败则保持标签不动 ——
    // 关闭不等于丢弃（外部文件与工作区文档同理）。
    if (activeId !== null && !(await useWorkspaceStore.getState().flushActive())) {
      setToast({ message: zh.toast.saveFailed, tone: "error" });
      return;
    }
    setOpenTabIds([]);
    useWorkspaceStore.setState({
      activeId: null,
      activeContent: "",
      dirty: false,
      externalBaseline: null,
    });
  }, [activeId]);

  const handleToggleTask = useCallback(
    (taskIndex: number) => {
      const updated = toggleTaskInSource(activeContent, taskIndex);
      handleContentChange(updated);
    },
    [activeContent, handleContentChange],
  );

  /**
   * 保存并给出反馈（UI §33）。自动保存与 Ctrl+S 都经过这里。
   *
   * 外部文件与工作区文档走同一个入口：store 的 `saveActive` 依据 `activeId`
   * 是否带 `ext:` 前缀决定写回磁盘原文件还是写工作区（原位编辑语义）。
   */
  const handleSave = useCallback(async () => {
    await saveActive();
    if (useWorkspaceStore.getState().error) {
      setToast({ message: zh.toast.saveFailed, tone: "error" });
    } else {
      setToast({ message: zh.toast.saved, tone: "success" });
    }
  }, [saveActive]);

  const handlePrint = useCallback(() => {
    if (!activeId) {
      setToast({ message: "请先打开一篇笔记后再进行打印或导出 PDF", tone: "error" });
      return;
    }
    setPrintModalOpen(true);
  }, [activeId]);

  const handlePasteImage = useCallback(async (file: File): Promise<string | null> => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await api.saveAttachment(bytes, file.type);
    } catch {
      setToast({ message: zh.toast.imagePasteFailed, tone: "error" });
      return null;
    }
  }, []);

  /**
   * 另存为副本（新身份、独立文件）。
   *
   * 先把当前未保存的编辑 flush 掉：用户点「另存为」时预期副本包含
   * 眼前看到的内容，而不是上次保存的版本（ARCHITECTURE.md §18.1）。
   */
  const handleDuplicate = useCallback(
    async (id: string, title: string) => {
      if (!(await useWorkspaceStore.getState().flushActive())) return;
      await duplicateDocument(id, zh.duplicateTitle(title));
      if (useWorkspaceStore.getState().error) {
        setToast({ message: zh.toast.duplicateFailed, tone: "error" });
      } else {
        setToast({ message: zh.toast.duplicated, tone: "success" });
      }
    },
    [duplicateDocument],
  );

  /**
   * 导出：弹系统「保存到…」，再由 Rust 写文件。
   *
   * 用户取消时**不提示** —— 那只是改了主意，不是错误。
   */
  const handleExport = useCallback(async (id: string, title: string) => {
    const store = useWorkspaceStore.getState();
    const outcome = await runExport(
      { pickExport: pickExportPath, exportDocument: store.exportDocument },
      id,
      title,
    );
    if (outcome.kind === "ok") {
      setToast({ message: zh.toast.exported, tone: "success" });
    } else if (outcome.kind === "failed") {
      setToast({ message: zh.toast.exportFailed, tone: "error" });
    }
  }, []);

  /**
   * 在系统文件管理器里定位文件（右键菜单「打开文件所在位置」）。
   *
   * 工作区笔记与外部文件分别走各自的命令：前者由 Rust 解析 UUID 文件名，
   * 后者直接用 `ext:` 标签页里的原始绝对路径。成功不弹提示 ——
   * 文件管理器窗口已经把文件摆到眼前了；失败必须说出来，否则用户
   * 分不清「没反应」和「坏了」。
   */
  const handleReveal = useCallback(async (id: string, title: string) => {
    try {
      const extPath = externalPathOf(id);
      if (extPath !== null) {
        await api.revealExternalFile(extPath);
      } else {
        await api.revealDocument(id);
      }
    } catch {
      setToast({ message: zh.toast.revealFailed(title), tone: "error" });
    }
  }, []);

  /**
   * 从外部文件列表移除一条记录（**不删除磁盘文件**）。
   *
   * 顺便关掉对应的标签页：记录一没，标签就成了一条打不开的死项。
   * 注意拖动关闭用的 `finalizeCloseTab` 会去读「下一个标签」，
   * 所以先把标签关掉再移除记录，顺序反了会读到刚被移除的那条。
   */
  const handleForgetExternal = useCallback(
    async (path: string) => {
      const tabId = externalTabId(path);
      if (openTabIds.includes(tabId)) {
        await handleCloseTab(tabId);
      }
      const ok = await forgetExternalFile(path);
      if (ok) {
        setToast({ message: zh.toast.removedFromList, tone: "success" });
      } else {
        setToast({ message: zh.toast.removeFromListFailed, tone: "error" });
      }
    },
    [openTabIds, handleCloseTab, forgetExternalFile],
  );

  /**
   * 打开指定路径的外部文件：保留原始磁盘位置原位查看/编辑，
   * 绝不把正文复制进工作区（用户要求库里只存路径/名称）。
   *
   * 打开成功时 Rust 已把这条记录写进数据库，因此它会在重启后仍然出现。
   */
  const handleOpenPath = useCallback(
    async (sourcePath: string) => {
      await openExternalTab(sourcePath);
    },
    [openExternalTab],
  );

  /** 打开文件：弹系统「打开文件」对话框。取消时不提示（那只是改了主意）。 */
  const handleOpenFile = useCallback(async () => {
    const sourcePath = await pickOpenFilePath();
    if (sourcePath !== null) await handleOpenPath(sourcePath);
  }, [handleOpenPath]);

  /**
   * 打开文档内互链指向的本地笔记（`[xxx](./other.md)` 相对路径）。
   *
   * 只有外部文件（原位打开的磁盘文件）才有「所在目录」可依据；
   * 工作区文档的相对链接没有解析基准（notes/ 下是 UUID 文件名），直接忽略。
   * 链接可能带 `#锚点`，解析前剥掉 —— 锚点跨文档跳转暂不支持。
   */
  const handleOpenMarkdownLink = useCallback(
    async (href: string) => {
      const basePath = activeExtPath;
      if (!basePath) return;
      const reference = href.split("#")[0].split("?")[0];
      if (!reference) return;
      try {
        const resolved = await api.resolveLocalLink(basePath, reference);
        await handleOpenPath(resolved);
      } catch {
        setToast({ message: zh.toast.openFailed, tone: "error" });
      }
    },
    [activeExtPath, handleOpenPath],
  );

  /**
   * 启动时恢复上次打开的文件。
   *
   * 两件事，顺序不能反：
   * 1. 先读**数据库里的外部文件清单** —— 它是列表与标签的权威来源；
   * 2. 再接收 Windows 文件关联传入的路径（双击 .md 启动时），走同一套打开流程。
   *
   * 标签 id 早就由 localStorage 恢复了（见 openTabIds 初始化），
   * 但那时清单还没读回来，所以清理 effect 必须等 `externalFilesLoaded`
   * 才允许删标签，否则重启后第一帧就会把外部标签全删掉。
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await Promise.all([loadDocuments(), loadExternalFiles(), loadRecentFiles()]);
      if (cancelled) return;

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const paths = await invoke<string[]>("opened_files");
        for (const path of paths) {
          if (cancelled) return;
          await handleOpenPath(path);
        }
      } catch {
        // 浏览器预览与单测没有 Tauri IPC；桌面版则由 Rust 提供该命令。
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [handleOpenPath, loadDocuments, loadExternalFiles, loadRecentFiles]);

  /**
   * 单实例跨进程打开文件监听：
   * 当用户在外部（资源管理器双击 / 命令行）用本软件打开文件，而已有实例已在运行时，
   * 后台会通过 single-instance 插件激活当前窗口并广播 "open-files" 事件。
   * 此处在已有窗口中直接追加打开新标签页，绝不开启多余进程。
   */
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const off = await api.listenOpenFiles(async (paths) => {
        for (const path of paths) {
          await handleOpenPath(path);
        }
      });
      if (cancelled) {
        off();
      } else {
        unlisten = off;
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [handleOpenPath]);

  // 全局快捷键（UI_DESIGN_SYSTEM.md §29）。集中在此处而非散落各页面。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key.toLowerCase() === "p" || e.key.toLowerCase() === "k") {
        // Ctrl+P / Ctrl+K：全局命令面板 / 快速跳转
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNewDocument();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      } else if (e.key.toLowerCase() === "w") {
        // Ctrl+W：关闭当前标签页
        if (activeId) {
          e.preventDefault();
          void handleCloseTab(activeId);
        }
      } else if (e.key.toLowerCase() === "f") {
        // Ctrl+F：文档内查找。编辑器未聚焦时 searchKeymap 不生效，故在此兜住。
        e.preventDefault();
        setFindNonce((n) => n + 1);
      } else if (e.key === ",") {
        // Ctrl+, 打开设置（UI §29 约定的平台习惯）。
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "\\") {
        // Ctrl+\：在三档视图之间循环（规范 §29 未占用该组合）。
        e.preventDefault();
        setViewMode((m) => nextViewMode(m));
      } else if (e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setSidebarVisible((v) => !v);
      } else if (e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        cycleTheme();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewDocument, handleSave, cycleTheme, activeId, handleCloseTab]);

  const tabsList = openTabIds.map((id) => {
    const extPath = externalPathOf(id);
    if (extPath !== null) {
      // 名字优先取库里的记录（用户看到的原始文件名），退回路径末段。
      const record = externalCatalog.find((f) => samePath(f.path, extPath));
      return {
        id,
        title: record?.name ?? baseName(extPath),
        dirty: id === activeId ? dirty : false,
      };
    }
    const doc = documents.find((d) => d.id === id);
    return {
      id,
      title: doc?.title ?? "无标题",
      dirty: id === activeId ? dirty : false,
    };
  });

  /**
   * 顶部菜单栏的内容（文件 / 编辑 / 视图 / 帮助）。
   *
   * 菜单项只做「转发」：每一项都调用页面上已有的那一个回调，所以菜单、
   * 快捷键、命令面板三条入口走的是同一条代码路径，不会各自漂移。
   * 不可用的命令用 `disabled` 明示，而不是点了没反应。
   */
  const menus: MenuBarMenu[] = useMemo(() => {
    // 下列菜单项只在有活动文档时才有意义；闭包里用局部常量保住收窄后的类型，
    // 免得在回调里写一堆非空断言。
    const currentId = activeId;
    const currentTitle = activeTitle;
    const hasDocument = currentId !== null;
    // 有文档时才有意义的动作统一走这里：函数内部自己挡一次 null，
    // 既让 `disabled` 与行为一致，也避免在回调里散落非空断言。
    const withDocument = (run: (id: string) => void) => () => {
      if (currentId === null) return;
      run(currentId);
    };
    const viewLabels: Record<ViewMode, string> = {
      edit: zh.toolbar.view.edit,
      split: zh.toolbar.view.split,
      preview: zh.toolbar.view.preview,
    };
    const formatIds: MarkdownActionId[] = [
      "bold",
      "italic",
      "strikethrough",
      "heading",
      "bulletList",
      "orderedList",
      "quote",
      "link",
      "image",
      "inlineCode",
      "codeBlock",
      "table",
      "math",
      "mathBlock",
    ];

    return [
      {
        id: "file",
        label: zh.menu.file,
        items: [
          {
            id: "file-new",
            label: zh.toolbar.newDocument,
            shortcut: "Ctrl+N",
            onSelect: () => void handleNewDocument(),
          },
          {
            id: "file-open",
            label: zh.fileTree.openFile,
            onSelect: () => void handleOpenFile(),
          },
          { id: "file-sep-1", separator: true },
          {
            id: "file-save",
            label: zh.menu.save,
            shortcut: "Ctrl+S",
            disabled: !hasDocument,
            onSelect: () => void handleSave(),
          },
          {
            id: "file-export",
            label: zh.fileTree.exportDoc,
            disabled: !hasDocument,
            onSelect: withDocument((id) => void handleExport(id, currentTitle)),
          },
          {
            id: "file-reveal",
            label: zh.fileTree.revealInExplorer,
            disabled: !hasDocument,
            onSelect: withDocument((id) => void handleReveal(id, currentTitle)),
          },
          { id: "file-sep-2", separator: true },
          {
            id: "file-close-tab",
            label: zh.menu.closeTab,
            shortcut: "Ctrl+W",
            disabled: !hasDocument,
            onSelect: withDocument((id) => void handleCloseTab(id)),
          },
          {
            id: "file-close-all",
            label: zh.menu.closeAllTabs,
            onSelect: () => void handleCloseAllTabs(),
          },
        ],
      },
      {
        id: "edit",
        label: zh.menu.edit,
        items: [
          {
            id: "edit-undo",
            label: zh.editor.contextMenu.undo,
            shortcut: "Ctrl+Z",
            disabled: !hasDocument,
            onSelect: () => editorRef.current?.undo(),
          },
          {
            id: "edit-redo",
            label: zh.editor.contextMenu.redo,
            shortcut: "Ctrl+Y",
            disabled: !hasDocument,
            onSelect: () => editorRef.current?.redo(),
          },
          { id: "edit-sep-1", separator: true },
          {
            id: "edit-find",
            label: zh.editor.contextMenu.findReplace,
            shortcut: "Ctrl+F",
            disabled: !hasDocument,
            onSelect: () => setFindNonce((n) => n + 1),
          },
          {
            id: "edit-palette",
            label: zh.menu.palette,
            shortcut: "Ctrl+Shift+P",
            onSelect: () => setPaletteOpen(true),
          },
          { id: "edit-sep-2", separator: true },
          {
            id: "edit-format",
            label: zh.editor.contextMenu.format,
            disabled: !hasDocument || isPlainText,
            submenu: formatIds.map((action) => ({
              id: `edit-format-${action}`,
              label: zh.editor.actions[action],
              onSelect: () => handleEditorAction(action),
            })),
          },
        ],
      },
      {
        id: "view",
        label: zh.menu.view,
        items: [
          ...VIEW_MODES.map(
            (mode): ContextMenuItem => ({
              id: `view-mode-${mode}`,
              label: viewLabels[mode],
              checked: viewMode === mode,
              onSelect: () => setViewMode(mode),
            }),
          ),
          { id: "view-sep-1", separator: true },
          {
            id: "view-sidebar",
            label: zh.menu.sidebar,
            checked: sidebarVisible,
            onSelect: () => setSidebarVisible((v) => !v),
          },
          {
            id: "view-outline",
            label: zh.toolbar.toggleOutline,
            checked: outlineVisible,
            onSelect: toggleOutline,
          },
          {
            id: "view-sync-scroll",
            label: zh.toolbar.syncScroll,
            checked: syncScroll,
            onSelect: () => setSyncScroll((v) => !v),
          },
          { id: "view-sep-2", separator: true },
          {
            id: "view-theme",
            label: zh.menu.theme,
            submenu: (["light", "dark", "system"] as const).map((preference) => ({
              id: `view-theme-${preference}`,
              label: zh.toolbar.theme[preference],
              checked: themePreference === preference,
              onSelect: () => changeTheme(preference),
            })),
          },
        ],
      },
      {
        id: "help",
        label: zh.menu.help,
        items: [
          {
            id: "help-settings",
            label: zh.toolbar.settings,
            shortcut: "Ctrl+,",
            onSelect: () => setSettingsOpen(true),
          },
          {
            id: "help-about",
            label: zh.about.title,
            onSelect: () => setAboutOpen(true),
          },
        ],
      },
    ];
  }, [
    activeId,
    activeTitle,
    handleCloseAllTabs,
    handleCloseTab,
    handleEditorAction,
    handleExport,
    handleNewDocument,
    handleOpenFile,
    handleReveal,
    handleSave,
    isPlainText,
    outlineVisible,
    sidebarVisible,
    syncScroll,
    themePreference,
    toggleOutline,
    viewMode,
  ]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={getAntdTheme(resolvedTheme, accentColor)}
      button={{ autoInsertSpace: false }}
    >
      <div className="app-shell" data-sidebar={(sidebarVisible && !onHomePage) || undefined}>
      <AppToolbar
        onNewDocument={handleNewDocument}
        menus={menus}
        onOpenSettings={() => setSettingsOpen(true)}
        pendingVersion={pendingUpdateVersion}
        onOpenUpdate={() => {
          // 打开「关于」对话框 —— 更新详情与安装入口都在里面。
          setAboutOpen(true);
        }}
        themePreference={themePreference}
        onCycleTheme={cycleTheme}
      />

      <UpdateBar onInstall={handleInstallUpdate} />

      {/* 顶部多标签栏：横贯窗口全宽（侧栏从它下方开始），
          与 VS Code / 浏览器的「标签在最上、内容分区在下」同一结构。 */}
      <TabBar
        tabs={tabsList}
        activeId={activeId}
        onSelectTab={(id) => void handleSelectTab(id)}
        onCloseTab={(id) => void handleCloseTab(id)}
        onNewTab={handleNewDocument}
        onCloseOtherTabs={(id) => void handleCloseOtherTabs(id)}
        onCloseRightTabs={(id) => void handleCloseRightTabs(id)}
        onCloseAllTabs={() => void handleCloseAllTabs()}
        onRenameTab={(id, title) => void renameDocument(id, title)}
        onDuplicateTab={(id, title) => void handleDuplicate(id, title)}
        onExportTab={(id, title) => void handleExport(id, title)}
        onRevealTab={(id, title) => void handleReveal(id, title)}
      />

      <div className="app-body">
        <Sidebar
          documents={documents}
          activeId={activeId}
          activeContent={activeContent}
          onJump={(line) => setJumpTarget({ line, nonce: Date.now() })}
          tab={sidebarTab}
          onChangeTab={setSidebarTab}
          onSelect={(id) => void handleOpenDocument(id)}
          onCreate={handleNewDocument}
          onRename={(id, title) => void renameDocument(id, title)}
          onDuplicate={(id, title) => void handleDuplicate(id, title)}
          onExport={(id, title) => void handleExport(id, title)}
          onReveal={(id, title) => void handleReveal(id, title)}
          onOpenFile={() => void handleOpenFile()}
          onRequestDelete={(id, title) => setPendingDelete({ id, title })}
          externalFiles={externalCatalog}
          recentFiles={recentFiles}
          // 走 handleSelectTab 而不是直接读盘：它会先落盘当前未保存的编辑，
          // 否则从列表点开外部文件会静默丢掉正在编辑的文档（或外部文件）。
          onOpenExternal={(path) => void handleSelectTab(externalTabId(path))}
          onRevealExternal={(path) =>
            void handleReveal(externalTabId(path), baseName(path))
          }
          onForgetExternal={(path) => void handleForgetExternal(path)}
          onRemoveRecentFile={(path) => void removeRecentFile(path)}
          onDeleteDiskFile={(path) => void deleteDiskFile(path)}
          onTogglePin={(path, pinned) => void setFilePinned(path, pinned)}
          width={sidebarWidth}
          collapsed={!sidebarVisible || onHomePage}
          onCollapse={() => setSidebarVisible(false)}
        />
        {/* 收起后的窄轨：留一个「展开」入口在侧栏自己的区域里
            （主页强制隐藏时窄轨同样不出现）。 */}
        {!sidebarVisible && !onHomePage && (
          <div className="app-sidebar-rail">
            <Tooltip content={zh.sidebar.expand}>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={zh.sidebar.expand}
                onClick={() => setSidebarVisible(true)}
              >
                <PanelLeftOpen size={15} aria-hidden />
              </Button>
            </Tooltip>
          </div>
        )}
        {/* 侧栏在左，向右拖变宽（UI §11）。展开时才展示拖拽分隔条 */}
        {sidebarVisible && !onHomePage && (
          <Splitter
            value={sidebarWidth}
            onChange={setSidebarWidth}
            min={180}
            max={480}
            ariaLabel={zh.splitter.sidebar}
            side="left"
          />
        )}

        <main className="app-main" role="main">
          {error && (
            <div className="app-error" role="alert">
              {/* 给用户中文解释，并说明本地数据是否安全（UI §32）。 */}
              <span>{zh.error.messages[error] ?? zh.error.messages.UNKNOWN}</span>
              <Button variant="ghost" size="sm" onClick={clearError}>
                {zh.error.dismiss}
              </Button>
            </div>
          )}

          {/* 顶部多标签栏已上移至 app-shell 层（横贯全宽）。 */}

          {activeId ? (
            <>
              {/* 格式工具栏：左侧格式化动作，右侧文档内查找、导出 PDF、视图切换与同步滚动开关 */}
              <EditorToolbar
                onAction={handleEditorAction}
                onSearch={() => setFindNonce((n) => n + 1)}
                onPrint={handlePrint}
                viewMode={viewMode}
                onChangeViewMode={setViewMode}
                syncScroll={syncScroll}
                onToggleSyncScroll={() => setSyncScroll((s) => !s)}
                showFormatting={showsEditor(viewMode) && !isPlainText}
              />

              {/* 隐藏的无障碍路径面包屑导航 */}
              <div className="sr-only">
                <Breadcrumb
                  virtualPath={activeDoc?.virtualPath ?? "/"}
                  title={activeTitle}
                />
              </div>

              <div
                className="app-panes"
                data-view={viewMode}
                data-preview={showsPreview(viewMode) || undefined}
              >
                {showsEditor(viewMode) && (
                  <div className="app-pane app-pane--editor">
                    <MarkdownEditor
                      ref={editorRef}
                      showToolbar={false}
                      documentId={activeId}
                      value={activeContent}
                      onChange={handleContentChange}
                      onSave={() => void handleSave()}
                      onPasteImage={handlePasteImage}
                      onCursor={(line, column, selectedText) =>
                        setCursor({ line, column, selectedText: selectedText ?? "" })
                      }
                      jumpTarget={jumpTarget}
                      findNonce={findNonce}
                      onScrollDOM={setEditorScrollEl}
                      lineNumbersEnabled={lineNumbersOn}
                      lineWrapEnabled={lineWrapOn}
                      // 分栏模式（右侧已有渲染预览）：左侧展示纯正的 Markdown 源码；单栏编辑模式则默认开启即时渲染。
                      livePreviewEnabled={viewMode !== "split" && !isPlainText}
                      onOpenLink={(href) => void handleOpenMarkdownLink(href)}
                      pasteHtmlAsMarkdownEnabled={pasteHtmlAsMarkdownOn}
                      typewriterEnabled={typewriterOn}
                      paragraphFocusEnabled={paragraphFocusOn}
                      onToggleTypewriter={() => setTypewriterOn((v) => !v)}
                      onToggleParagraphFocus={() => setParagraphFocusOn((v) => !v)}
                    />
                  </div>
                )}
                {showsPreview(viewMode) && (
                  <>
                    {/* 分隔条只在两栏并存时有意义；单栏模式没有可拖的边界。 */}
                    {showsEditor(viewMode) && (
                      <Splitter
                        value={previewWidth}
                        onChange={setPreviewWidth}
                        min={260}
                        max={760}
                        ariaLabel={zh.splitter.preview}
                        side="right"
                      />
                    )}
                    <div
                      className="app-pane app-pane--preview"
                      // 单栏（仅阅读）时占满宽度，忽略记忆的拖拽宽度。
                      style={showsEditor(viewMode) ? { flexBasis: previewWidth } : undefined}
                    >
                      <MarkdownPreview
                        source={activeContent}
                        onScrollDOM={setPreviewScrollEl}
                        onToggleTask={handleToggleTask}
                        isPlainText={isPlainText}
                        documentTitle={activeTitle}
                        documentPath={activeExtPath}
                        onOpenLink={(href) => void handleOpenMarkdownLink(href)}
                        resetKey={activeId}
                      />
                    </div>
                  </>
                )}
              </div>
              <EditorStatusBar
                dirty={dirty}
                line={cursor.line}
                column={cursor.column}
                path={activePath}
                content={activeContent}
                selectedText={cursor.selectedText}
              />
              {/* 编辑模式也必须能导出：平时隐藏的打印副本避免切换视图时打印空白。 */}
              {!showsPreview(viewMode) && (
                <div className="app-print-preview" aria-hidden="true">
                  <MarkdownPreview
                    source={activeContent}
                    isPlainText={isPlainText}
                    documentTitle={activeTitle}
                    documentPath={activeExtPath}
                    resetKey={activeId}
                  />
                </div>
              )}
            </>
          ) : loading ? (
            // 冷启动期间给出加载态，而不是一片空白（UI §32）。
            <div className="app-loading" role="status" aria-live="polite">
              <Spinner size={20} label={zh.loading.workspace} />
              <p>{zh.loading.workspace}</p>
            </div>
          ) : (
            <HomePage
              documents={documents}
              recentFiles={recentFiles}
              externalFiles={externalCatalog}
              onOpenDocument={(id) => void handleOpenDocument(id)}
              onOpenPath={(path) => void handleSelectTab(externalTabId(path))}
              onNewDocument={handleNewDocument}
              onOpenFile={() => void handleOpenFile()}
              onOpenSettings={() => setSettingsOpen(true)}
              workspacePath={useWorkspaceStore.getState().settings?.effectiveWorkspaceRoot}
            />
          )}
        </main>
      </div>

      <Dialog
        open={recoveryCandidate !== null}
        title={zh.recovery.title}
        confirmLabel={zh.recovery.restore}
        cancelLabel={zh.recovery.discard}
        onCancel={discardRecovery}
        onConfirm={restoreRecovery}
      >
        {recoveryCandidate
          ? recoveryCandidate.conflict
            ? zh.recovery.conflictBody(recoveryCandidate.title)
            : zh.recovery.body(recoveryCandidate.title)
          : null}
      </Dialog>

      <Dialog
        open={pendingDelete !== null}
        title={zh.dialog.deleteTitle}
        confirmLabel={zh.dialog.deleteConfirm}
        cancelLabel={zh.dialog.cancel}
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete;
          setPendingDelete(null);
          if (target) void deleteDocument(target.id);
        }}
      >
        {/* 文案点名具体对象，避免用户误删（UI §16）。 */}
        {pendingDelete ? zh.dialog.deleteBody(pendingDelete.title) : null}
      </Dialog>

      <CloseDocumentModal
        prompt={closePrompt}
        onSave={handleConfirmSaveAndClose}
        onDiscard={handleDiscardAndClose}
        onCancel={() => setClosePrompt(null)}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        documents={documents}
        onOpenDocument={(id) => void handleOpenDocument(id)}
        onNewDocument={handleNewDocument}
        onOpenFile={() => void handleOpenFile()}
        onSaveActive={activeId ? () => void handleSave() : undefined}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        onCycleTheme={cycleTheme}
        onChangeViewMode={setViewMode}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        onPrint={handlePrint}
      />

      <Toast
        message={toast?.message ?? null}
        tone={toast?.tone}
        onDismiss={() => setToast(null)}
      />

      <SettingsPage
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onChanged={(message) => setToast({ message, tone: "success" })}
        themePreference={themePreference}
        onChangeTheme={changeTheme}
        accentColor={accentColor}
        onChangeAccentColor={setAccentColor}
        uiZoom={uiZoom}
        onChangeUiZoom={setUiZoom}
        uiDensity={uiDensity}
        onChangeUiDensity={setUiDensity}
        darkStyle={darkStyle}
        onChangeDarkStyle={setDarkStyle}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        syncScroll={syncScroll}
        onChangeSyncScroll={setSyncScroll}
        fontSize={fontSize}
        onChangeFontSize={setFontSize}
        latinFont={latinFont}
        onChangeLatinFont={setLatinFont}
        cjkFont={cjkFont}
        onChangeCjkFont={setCjkFont}
        previewTypography={previewTypography}
        onChangePreviewElement={handleChangePreviewElement}
        onResetPreviewTypography={handleResetPreviewTypography}
        lineNumbersOn={lineNumbersOn}
        onChangeLineNumbers={setLineNumbersOn}
        lineWrapOn={lineWrapOn}
        onChangeLineWrap={setLineWrapOn}
        pasteHtmlAsMarkdownOn={pasteHtmlAsMarkdownOn}
        onChangePasteHtmlAsMarkdown={setPasteHtmlAsMarkdownOn}
        typewriterOn={typewriterOn}
        onChangeTypewriter={setTypewriterOn}
        paragraphFocusOn={paragraphFocusOn}
        onChangeParagraphFocus={setParagraphFocusOn}
        autosaveMode={autosaveMode}
        onChangeAutosaveMode={setAutosaveMode}
        renderToggles={renderToggles}
        onChangeRenderToggles={setRenderTogglesState}
      />

      <AboutDialog
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        onSaveFailed={(message) => setToast({ message, tone: "error" })}
      />

      <PrintExportModal
        open={printModalOpen}
        documentTitle={activeTitle}
        content={activeContent}
        isPlainText={isPlainText}
        onClose={() => setPrintModalOpen(false)}
      />
      </div>
    </ConfigProvider>
  );
}
