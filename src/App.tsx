import { useCallback, useEffect, useState } from "react";
import { MarkdownEditor } from "./components/editor/MarkdownEditor";
import { EditorStatusBar } from "./components/editor/EditorStatusBar";
import { MarkdownPreview } from "./components/editor/MarkdownPreview";
import { OutlineTree } from "./components/editor/OutlineTree";
import { AppToolbar } from "./components/workspace/AppToolbar";
import { Sidebar } from "./components/workspace/Sidebar";
import { Breadcrumb } from "./components/workspace/Breadcrumb";
import { Splitter } from "./components/workspace/Splitter";
import { SettingsPage } from "./components/settings/SettingsPage";
import { EmptyState } from "./components/ui/EmptyState";
import { Button } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { Spinner } from "./components/ui/Spinner";
import { Toast } from "./components/ui/Toast";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { zh } from "./lib/i18n";
import { checkForUpdate, readLastCheck, shouldAutoCheck, writeLastCheck } from "./lib/updater";
import { tauriUpdaterBridge } from "./lib/updaterBridge";
import {
  applyTheme,
  readStoredPreference,
  resolveTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./lib/theme";
import {
  applyFontFamily,
  applyFontSize,
  FONT_FAMILY_KEY,
  FONT_SIZE_KEY,
  readStoredFontFamily,
  readStoredFontSize,
  type EditorFontFamily,
  type EditorFontSize,
} from "./lib/editorPrefs";
import {
  nextViewMode,
  readStoredViewMode,
  showsEditor,
  showsPreview,
  VIEW_MODE_KEY,
  type ViewMode,
} from "./lib/viewMode";
import "./App.css";

/** 面板宽度持久化的存储键。 */
const SIDEBAR_WIDTH_KEY = "crab-md.sidebar-width";
const PREVIEW_WIDTH_KEY = "crab-md.preview-width";

/** 读取已保存的面板宽度；无存储或值非法时回退到默认值。 */
function readStoredWidth(key: string, fallback: number): number {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
  const setContent = useWorkspaceStore((s) => s.setContent);
  const clearError = useWorkspaceStore((s) => s.clearError);

  const [sidebarVisible, setSidebarVisible] = useState(true);
  // 视图模式：仅编辑 / 分栏 / 仅阅读（UI §11）。持久化，记住用户的选择。
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    readStoredViewMode(typeof localStorage === "undefined" ? null : localStorage.getItem(VIEW_MODE_KEY)),
  );
  const [outlineVisible, setOutlineVisible] = useState(false);
  // 面板宽度（UI §11 pane resizing）。侧栏宽度持久化，符合「记住我的布局」预期。
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredWidth(SIDEBAR_WIDTH_KEY, 260));
  const [previewWidth, setPreviewWidth] = useState(() => readStoredWidth(PREVIEW_WIDTH_KEY, 420));
  // 编辑器光标位置，供状态栏显示（UI §28）。
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  // 大纲跳转目标；nonce 保证重复点同一标题也能再次跳转。
  const [jumpTarget, setJumpTarget] = useState<{ line: number; nonce: number } | null>(null);
  // 轻提示（UI §33）：保存成功/失败等非阻塞反馈。
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  // Ctrl+F 的触发计数；递增即请求编辑器打开查找面板。
  const [findNonce, setFindNonce] = useState(0);
  // 设置页开关（UI §34）。
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [fontFamily, setFontFamily] = useState<EditorFontFamily>(() =>
    readStoredFontFamily(typeof localStorage === "undefined" ? null : localStorage.getItem(FONT_FAMILY_KEY)),
  );

  // 字号：写 CSS 变量（CodeMirror theme 读它），并持久化。
  // 用变量而非重建编辑器：重建会丢光标位置与撤销历史。
  useEffect(() => {
    applyFontSize(fontSize);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FONT_SIZE_KEY, fontSize);
    }
  }, [fontSize]);

  // 字体族同上，同样走 CSS 变量。
  useEffect(() => {
    applyFontFamily(fontFamily);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(FONT_FAMILY_KEY, fontFamily);
    }
  }, [fontFamily]);

  // 主题：写入 <html data-theme>，CSS 变量随之切换（UI_DESIGN_SYSTEM.md §4.1）。
  // 偏好为 system 时还要监听系统变化，用户切换系统主题应当即时跟随。
  useEffect(() => {
    const mq = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

    const sync = () => applyTheme(resolveTheme(themePreference, systemPrefersDark()));

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
   * - **不自动安装**：只在设置页里提示有新版，装不装由用户决定。
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
        // 有新版时用轻提示告知，安装入口在设置页。
        setToast({
          message: zh.settings.update.available(result.update.version),
          tone: "success",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 视图模式持久化：下次打开应用保持同一档。
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    }
  }, [viewMode]);

  const cycleTheme = useCallback(() => {
    setThemePreference((p) => (p === "system" ? "light" : p === "light" ? "dark" : "system"));
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

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
            await useWorkspaceStore.getState().flushActive();
            await invoke("close_window");
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

  const handleNewDocument = useCallback(() => {
    void createDocument(zh.app.untitled);
  }, [createDocument]);

  // 保存并给出反馈（UI §33）。自动保存与 Ctrl+S 都经过这里。
  const handleSave = useCallback(async () => {
    await saveActive();
    if (useWorkspaceStore.getState().error) {
      setToast({ message: zh.toast.saveFailed, tone: "error" });
    } else {
      setToast({ message: zh.toast.saved, tone: "success" });
    }
  }, [saveActive]);

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

  // 全局快捷键（UI_DESIGN_SYSTEM.md §29）。集中在此处而非散落各页面。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNewDocument();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
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
        setOutlineVisible((v) => !v);
      } else if (e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        cycleTheme();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewDocument, handleSave, cycleTheme]);

  const activeDoc = documents.find((d) => d.id === activeId);
  const activeTitle = activeDoc?.title ?? "";

  return (
    <div className="app-shell" data-sidebar={sidebarVisible || undefined}>
      <AppToolbar
        onNewDocument={handleNewDocument}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        sidebarVisible={sidebarVisible}
        outlineVisible={outlineVisible}
        onToggleOutline={() => setOutlineVisible((v) => !v)}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        onOpenSettings={() => setSettingsOpen(true)}
        themePreference={themePreference}
        onCycleTheme={cycleTheme}
      />

      <div className="app-body">
        {sidebarVisible && (
          <>
            <Sidebar
              documents={documents}
              activeId={activeId}
              onSelect={(id) => void openDocument(id)}
              onCreate={handleNewDocument}
              onRename={(id, title) => void renameDocument(id, title)}
              onDuplicate={(id, title) => void handleDuplicate(id, title)}
              onRequestDelete={(id, title) => setPendingDelete({ id, title })}
              width={sidebarWidth}
            />
            {/* 侧栏在左，向右拖变宽（UI §11）。 */}
            <Splitter
              value={sidebarWidth}
              onChange={setSidebarWidth}
              min={180}
              max={480}
              ariaLabel={zh.splitter.sidebar}
              side="left"
            />
          </>
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

          {activeId ? (
            <>
              {/* 面包屑：让用户知道当前文档在哪个目录下（UI §17）。 */}
              <Breadcrumb
                virtualPath={activeDoc?.virtualPath ?? "/"}
                title={activeTitle}
              />
              <div
                className="app-panes"
                data-view={viewMode}
                data-preview={showsPreview(viewMode) || undefined}
                data-outline={outlineVisible || undefined}
              >
                {showsEditor(viewMode) && (
                  <div className="app-pane app-pane--editor">
                    <MarkdownEditor
                      documentId={activeId}
                      value={activeContent}
                      onChange={setContent}
                      onSave={() => void handleSave()}
                      onCursor={(line, column) => setCursor({ line, column })}
                      jumpTarget={jumpTarget}
                      findNonce={findNonce}
                    />
                  </div>
                )}
                {outlineVisible && (
                  <div className="app-pane app-pane--outline">
                    <OutlineTree
                      source={activeContent}
                      onJump={(line) => setJumpTarget({ line, nonce: Date.now() })}
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
                      <MarkdownPreview source={activeContent} />
                    </div>
                  </>
                )}
              </div>
              <EditorStatusBar
                dirty={dirty}
                line={cursor.line}
                column={cursor.column}
                path={activeTitle}
              />
            </>
          ) : loading ? (
            // 冷启动期间给出加载态，而不是一片空白（UI §32）。
            <div className="app-loading" role="status" aria-live="polite">
              <Spinner size={20} label={zh.loading.workspace} />
              <p>{zh.loading.workspace}</p>
            </div>
          ) : (
            <EmptyState
              title={zh.empty.noDocumentTitle}
              description={zh.empty.noDocumentDescription}
              action={
                <Button variant="primary" onClick={handleNewDocument}>
                  {zh.empty.newNote}
                </Button>
              }
            />
          )}
        </main>
      </div>

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
        onChangeTheme={setThemePreference}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        fontSize={fontSize}
        onChangeFontSize={setFontSize}
        fontFamily={fontFamily}
        onChangeFontFamily={setFontFamily}
      />
    </div>
  );
}
