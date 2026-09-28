import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownEditor, type MarkdownEditorHandle } from "./components/editor/MarkdownEditor";
import { EditorToolbar } from "./components/editor/EditorToolbar";
import { EditorStatusBar } from "./components/editor/EditorStatusBar";
import { MarkdownPreview } from "./components/editor/MarkdownPreview";
import { AppToolbar } from "./components/workspace/AppToolbar";
import { Sidebar } from "./components/workspace/Sidebar";
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
import { SettingsPage, type SettingsSection } from "./components/settings/SettingsPage";
import { Button } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { Spinner } from "./components/ui/Spinner";
import { Toast } from "./components/ui/Toast";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { api } from "./lib/api";
import { zh } from "./lib/i18n";
import { checkForUpdate, readLastCheck, shouldAutoCheck, writeLastCheck } from "./lib/updater";
import { tauriUpdaterBridge } from "./lib/updaterBridge";
import { printPreview } from "./lib/print";
import { toggleTaskInSource } from "./lib/markdown";
import { useUpdateStore } from "./stores/useUpdateStore";
import type { MarkdownActionId } from "./lib/markdownActions";
import {
  applyTheme,
  applyWindowTheme,
  readStoredPreference,
  resolveTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./lib/theme";
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
  nextViewMode,
  readStoredViewMode,
  showsEditor,
  showsPreview,
  VIEW_MODE_KEY,
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
  pickExportPath,
  pickOpenFilePath,
  runExport,
  runOpenFile,
} from "./lib/transfer";
import "./App.css";

/** 面板宽度持久化的存储键。 */
const SIDEBAR_WIDTH_KEY = "crab-md.sidebar-width";
const PREVIEW_WIDTH_KEY = "crab-md.preview-width";
const OPEN_TABS_KEY = "crab-md.open-tabs";

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

  const [sidebarVisible, setSidebarVisible] = useState(true);
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
  const handleEditorAction = useCallback((action: MarkdownActionId) => {
    editorRef.current?.dispatchAction(action);
  }, []);

  // 记录本次会话中新建尚未明确命名的文档 ID
  const newDocumentIdsRef = useRef<Set<string>>(new Set());
  // 关闭文档时的确认 / 命名弹窗状态
  const [closePrompt, setClosePrompt] = useState<ClosePromptType | null>(null);
  // 打开的外部物理磁盘文件映射表（原位查看/编辑，绝不拷贝进数据库）
  const [externalFiles, setExternalFiles] = useState<
    Map<
      string,
      {
        path: string;
        name: string;
        content: string;
        initialContent: string;
        dirty: boolean;
        size: number;
        modifiedAt: string;
      }
    >
  >(new Map());

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

  // 清理已被删除的不存在文档（排除原位打开的外部文件）
  useEffect(() => {
    if (documents.length > 0) {
      setOpenTabIds((prev) => {
        const next = prev.filter(
          (id) => id.startsWith("ext:") || documents.some((d) => d.id === id),
        );
        return next.length === prev.length ? prev : next;
      });
    }
  }, [documents]);
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
  // 打开设置时要落到哪个分组。工具栏的更新入口需要直达「关于」，
  // 否则用户点「有新版本」却停在「外观」，还要自己再找一次。
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  // 有新版时工具栏显示徽标；null 表示无更新（工具栏保持安静，§2.1）。
  const updateStatus = useUpdateStore((s) => s.status);
  const pendingUpdateVersion =
    updateStatus.kind === "available" ? updateStatus.version : null;
  // 待删除的文档；非空时显示确认对话框（UI §14.4 要求破坏性操作先确认）。
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readStoredPreference(typeof localStorage === "undefined" ? null : localStorage.getItem(THEME_STORAGE_KEY)),
  );
  // 编辑器字号与主题同属「纯展示偏好」，都由 App 持有 ——
  // 只有这样它才会在**启动时**生效；若只由设置页持有，
  // 就必须先打开设置页才应用，重启即回到默认值。
  const [fontSize, setFontSize] = useState<EditorFontSize>(() =>
    readStoredFontSize(typeof localStorage === "undefined" ? null : localStorage.getItem(FONT_SIZE_KEY)),
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
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PREVIEW_WIDTH_KEY, String(previewWidth));
    }
  }, [previewWidth]);

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

  const cycleTheme = useCallback(() => {
    setThemePreference((p) => (p === "system" ? "light" : p === "light" ? "dark" : "system"));
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

  const handleOpenDocument = useCallback(
    async (id: string) => {
      setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      await openDocument(id);
    },
    [openDocument],
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
          await openDocument(nextTabs[nextIndex]);
        } else {
          useWorkspaceStore.setState({ activeId: null, activeContent: "", dirty: false });
        }
      }
    },
    [activeId, openTabIds, openDocument],
  );

  const activeExt = activeId?.startsWith("ext:") ? externalFiles.get(activeId) : null;
  const activeDoc =
    activeId && !activeId.startsWith("ext:")
      ? documents.find((d) => d.id === activeId)
      : null;
  const activeTitle = activeExt ? activeExt.name : (activeDoc?.title ?? "");
  const activePath = activeExt ? activeExt.path : activeTitle;
  const isPlainText = activeTitle.toLowerCase().endsWith(".txt");

  const handleSelectTab = useCallback(
    async (id: string | null) => {
      if (id === null) {
        // 切换到主页
        if (dirty && activeId) {
          await saveActive();
        }
        useWorkspaceStore.setState({ activeId: null, activeContent: "", dirty: false });
      } else if (id.startsWith("ext:")) {
        // 切换到外部原位文件
        if (dirty && activeId) {
          await saveActive();
        }
        const entry = externalFiles.get(id);
        if (entry) {
          useWorkspaceStore.setState({
            activeId: id,
            activeContent: entry.content,
            dirty: entry.dirty,
          });
        }
      } else {
        await handleOpenDocument(id);
      }
    },
    [activeId, dirty, externalFiles, handleOpenDocument, saveActive],
  );

  const handleCloseTab = useCallback(
    async (id: string) => {
      // 场景 0：外部物理文件（原位编辑，不入库）
      if (id.startsWith("ext:")) {
        const entry = externalFiles.get(id);
        const isModified = id === activeId ? dirty : (entry?.dirty ?? false);
        if (isModified) {
          setClosePrompt({
            kind: "save-changes",
            id,
            title: entry?.name ?? "外部文件",
          });
          return;
        }
        setExternalFiles((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
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
      externalFiles,
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

      if (targetId.startsWith("ext:")) {
        const entry = externalFiles.get(targetId);
        if (entry) {
          try {
            await api.saveExternalFile(entry.path, activeContent);
          } catch {
            setToast({ message: zh.toast.saveFailed, tone: "error" });
          }
        }
        setExternalFiles((prev) => {
          const next = new Map(prev);
          next.delete(targetId);
          return next;
        });
        setClosePrompt(null);
        await finalizeCloseTab(targetId);
        return;
      }

      if (closePrompt.kind === "save-and-name" && name) {
        await renameDocument(targetId, name.trim());
      }
      if (targetId === activeId) {
        await saveActive();
      }
      setClosePrompt(null);
      await finalizeCloseTab(targetId);
    },
    [activeContent, activeId, closePrompt, externalFiles, finalizeCloseTab, renameDocument, saveActive],
  );

  const handleDiscardAndClose = useCallback(async () => {
    if (!closePrompt) return;
    const targetId = closePrompt.id;

    if (targetId.startsWith("ext:")) {
      setExternalFiles((prev) => {
        const next = new Map(prev);
        next.delete(targetId);
        return next;
      });
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
  }, [activeId, closePrompt, deleteDocument, externalFiles, finalizeCloseTab]);

  const handleContentChange = useCallback(
    (newContent: string) => {
      setContent(newContent);
      if (activeId?.startsWith("ext:")) {
        setExternalFiles((prev) => {
          const next = new Map(prev);
          const existing = next.get(activeId);
          if (existing) {
            const isDirty = newContent !== existing.initialContent;
            next.set(activeId, { ...existing, content: newContent, dirty: isDirty });
            useWorkspaceStore.setState({ dirty: isDirty });
          }
          return next;
        });
      }
    },
    [activeId, setContent],
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
    if (dirty && activeId) {
      await saveActive();
    }
    setOpenTabIds([]);
    useWorkspaceStore.setState({ activeId: null, activeContent: "", dirty: false });
  }, [activeId, dirty, saveActive]);

  const handleToggleTask = useCallback(
    (taskIndex: number) => {
      const updated = toggleTaskInSource(activeContent, taskIndex);
      handleContentChange(updated);
    },
    [activeContent, handleContentChange],
  );

  // 保存并给出反馈（UI §33）。自动保存与 Ctrl+S 都经过这里。
  const handleSave = useCallback(async () => {
    if (activeId?.startsWith("ext:")) {
      const entry = externalFiles.get(activeId);
      if (entry) {
        try {
          const saved = await api.saveExternalFile(entry.path, activeContent);
          setExternalFiles((prev) => {
            const next = new Map(prev);
            next.set(activeId, {
              ...entry,
              content: activeContent,
              initialContent: activeContent,
              dirty: false,
              size: saved.size,
              modifiedAt: saved.modifiedAt,
            });
            return next;
          });
          useWorkspaceStore.setState({ dirty: false });
          setToast({ message: zh.toast.saved, tone: "success" });
        } catch {
          setToast({ message: zh.toast.saveFailed, tone: "error" });
        }
        return;
      }
    }

    await saveActive();
    if (useWorkspaceStore.getState().error) {
      setToast({ message: zh.toast.saveFailed, tone: "error" });
    } else {
      setToast({ message: zh.toast.saved, tone: "success" });
    }
  }, [activeContent, activeId, externalFiles, saveActive]);

  const handlePrint = useCallback(() => {
    if (!activeId) {
      setToast({ message: "请先打开一篇笔记后再进行打印或导出 PDF", tone: "error" });
      return;
    }
    if (!printPreview(activeTitle)) {
      setToast({ message: zh.toast.printUnavailable, tone: "error" });
    }
  }, [activeId, activeTitle]);

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

  /** 打开指定路径：保留原始磁盘位置原位查看/编辑，绝不拷贝进数据库。 */
  const handleOpenPath = useCallback(async (sourcePath: string) => {
    try {
      const file = await api.readExternalFile(sourcePath);
      const tabId = `ext:${file.path}`;
      setExternalFiles((prev) => {
        const next = new Map(prev);
        next.set(tabId, {
          path: file.path,
          name: file.name,
          content: file.content,
          initialContent: file.content,
          dirty: false,
          size: file.size,
          modifiedAt: file.modifiedAt,
        });
        return next;
      });
      setOpenTabIds((prev) => (prev.includes(tabId) ? prev : [...prev, tabId]));
      useWorkspaceStore.setState({ activeId: tabId, activeContent: file.content, dirty: false });
      setToast({ message: zh.toast.opened(file.name), tone: "success" });
    } catch {
      // 降级：若在无 Tauri IPC 的单测环境中，回退兼容
      const store = useWorkspaceStore.getState();
      const outcome = await runOpenFile({
        pickOpenFile: async () => sourcePath,
        openFile: store.importDocument,
      });
      if (outcome.kind === "ok") {
        setToast({ message: zh.toast.opened(outcome.title), tone: "success" });
      } else if (outcome.kind === "failed") {
        setToast({ message: zh.toast.openFailed, tone: "error" });
      }
    }
  }, []);

  /** 打开文件：弹系统「打开文件」，由 Rust 收进工作区并打开。取消时不提示。 */
  const handleOpenFile = useCallback(async () => {
    const sourcePath = await pickOpenFilePath();
    if (sourcePath !== null) await handleOpenPath(sourcePath);
  }, [handleOpenPath]);

  /** 启动时接收 Windows 文件关联传入的路径，并复用同一套打开流程。 */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await loadDocuments();
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
  }, [handleOpenPath, loadDocuments]);

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
    if (id.startsWith("ext:")) {
      const ext = externalFiles.get(id);
      return {
        id,
        title: ext?.name ?? id.replace(/^ext:/, ""),
        dirty: id === activeId ? dirty : (ext?.dirty ?? false),
      };
    }
    const doc = documents.find((d) => d.id === id);
    return {
      id,
      title: doc?.title ?? "无标题",
      dirty: id === activeId ? dirty : false,
    };
  });

  return (
    <div className="app-shell" data-sidebar={sidebarVisible || undefined}>
      <AppToolbar
        onNewDocument={handleNewDocument}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        sidebarVisible={sidebarVisible}
        onOpenSettings={() => setSettingsOpen(true)}
        onPrint={handlePrint}
        pendingVersion={pendingUpdateVersion}
        onOpenUpdate={() => {
          // 直接落到「关于」分组 —— 用户点更新入口就是想安装。
          setSettingsSection("about");
          setSettingsOpen(true);
        }}
        themePreference={themePreference}
        onCycleTheme={cycleTheme}
      />

      <UpdateBar onInstall={handleInstallUpdate} />

      <div className="app-body">
        <Sidebar
          documents={documents}
          activeId={activeId}
          activeContent={activeContent}
          onJump={(line) => setJumpTarget({ line, nonce: Date.now() })}
          onSelect={(id) => void handleOpenDocument(id)}
          onCreate={handleNewDocument}
          onRename={(id, title) => void renameDocument(id, title)}
          onDuplicate={(id, title) => void handleDuplicate(id, title)}
          onExport={(id, title) => void handleExport(id, title)}
          onOpenFile={() => void handleOpenFile()}
          onRequestDelete={(id, title) => setPendingDelete({ id, title })}
          width={sidebarWidth}
          collapsed={!sidebarVisible}
        />
        {/* 侧栏在左，向右拖变宽（UI §11）。展开时才展示拖拽分隔条 */}
        {sidebarVisible && (
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

          {/* 顶部多标签栏 */}
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
          />

          {activeId ? (
            <>
              {/* 格式工具栏：左侧格式化动作，右侧文档内查找、视图切换与同步滚动开关 */}
              <EditorToolbar
                onAction={handleEditorAction}
                onSearch={() => setFindNonce((n) => n + 1)}
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
              onOpenDocument={(id) => void handleOpenDocument(id)}
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
        onOpenSettings={(section?: SettingsSection) => {
          if (section) setSettingsSection(section);
          setSettingsOpen(true);
        }}
        onPrint={handlePrint}
      />

      <Toast
        message={toast?.message ?? null}
        tone={toast?.tone}
        onDismiss={() => setToast(null)}
      />

      <SettingsPage
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          // 关掉后清空指定分组，下次从默认分组开始。
          setSettingsSection(null);
        }}
        onChanged={(message) => setToast({ message, tone: "success" })}
        themePreference={themePreference}
        onChangeTheme={setThemePreference}
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
        initialSection={settingsSection}
      />
    </div>
  );
}
