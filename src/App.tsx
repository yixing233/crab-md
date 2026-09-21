import { useCallback, useEffect, useState } from "react";
import { MarkdownEditor } from "./components/editor/MarkdownEditor";
import { EditorStatusBar } from "./components/editor/EditorStatusBar";
import { MarkdownPreview } from "./components/editor/MarkdownPreview";
import { AppToolbar } from "./components/workspace/AppToolbar";
import { Sidebar } from "./components/workspace/Sidebar";
import { EmptyState } from "./components/ui/EmptyState";
import { Button } from "./components/ui/Button";
import { Dialog } from "./components/ui/Dialog";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { zh } from "./lib/i18n";
import {
  applyTheme,
  readStoredPreference,
  resolveTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "./lib/theme";
import "./App.css";

export default function App() {
  const documents = useWorkspaceStore((s) => s.documents);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const activeContent = useWorkspaceStore((s) => s.activeContent);
  const dirty = useWorkspaceStore((s) => s.dirty);
  const error = useWorkspaceStore((s) => s.error);
  const loadDocuments = useWorkspaceStore((s) => s.loadDocuments);
  const openDocument = useWorkspaceStore((s) => s.openDocument);
  const createDocument = useWorkspaceStore((s) => s.createDocument);
  const renameDocument = useWorkspaceStore((s) => s.renameDocument);
  const deleteDocument = useWorkspaceStore((s) => s.deleteDocument);
  const saveActive = useWorkspaceStore((s) => s.saveActive);
  const setContent = useWorkspaceStore((s) => s.setContent);
  const clearError = useWorkspaceStore((s) => s.clearError);

  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(true);
  // 待删除的文档；非空时显示确认对话框（UI §14.4 要求破坏性操作先确认）。
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readStoredPreference(typeof localStorage === "undefined" ? null : localStorage.getItem(THEME_STORAGE_KEY)),
  );

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
        void saveActive();
      } else if (e.key === "\\") {
        e.preventDefault();
        setPreviewVisible((v) => !v);
      } else if (e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        cycleTheme();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewDocument, saveActive, cycleTheme]);

  const activeTitle = documents.find((d) => d.id === activeId)?.title ?? "";

  return (
    <div className="app-shell" data-sidebar={sidebarVisible || undefined}>
      <AppToolbar
        onNewDocument={handleNewDocument}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        sidebarVisible={sidebarVisible}
        themePreference={themePreference}
        onCycleTheme={cycleTheme}
      />

      <div className="app-body">
        {sidebarVisible && (
          <Sidebar
            documents={documents}
            activeId={activeId}
            onSelect={(id) => void openDocument(id)}
            onCreate={handleNewDocument}
            onRename={(id, title) => void renameDocument(id, title)}
            onRequestDelete={(id, title) => setPendingDelete({ id, title })}
          />
        )}

        <main className="app-main" role="main">
          {error && (
            <div className="app-error" role="alert">
              <span>
                {zh.error.prefix}：{error}
              </span>
              <Button variant="ghost" size="sm" onClick={clearError}>
                {zh.error.dismiss}
              </Button>
            </div>
          )}

          {activeId ? (
            <>
              <div className="app-panes" data-preview={previewVisible || undefined}>
                <div className="app-pane app-pane--editor">
                  <MarkdownEditor
                    documentId={activeId}
                    value={activeContent}
                    onChange={setContent}
                    onSave={() => void saveActive()}
                  />
                </div>
                {previewVisible && (
                  <div className="app-pane app-pane--preview">
                    <MarkdownPreview source={activeContent} />
                  </div>
                )}
              </div>
              <EditorStatusBar dirty={dirty} line={1} column={1} path={activeTitle} />
            </>
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
    </div>
  );
}
