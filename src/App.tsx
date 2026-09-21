import { useCallback, useEffect, useState } from "react";
import { MarkdownEditor } from "./components/editor/MarkdownEditor";
import { EditorStatusBar } from "./components/editor/EditorStatusBar";
import { MarkdownPreview } from "./components/editor/MarkdownPreview";
import { AppToolbar } from "./components/workspace/AppToolbar";
import { Sidebar } from "./components/workspace/Sidebar";
import { EmptyState } from "./components/ui/EmptyState";
import { Button } from "./components/ui/Button";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
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
  const saveActive = useWorkspaceStore((s) => s.saveActive);
  const setContent = useWorkspaceStore((s) => s.setContent);
  const clearError = useWorkspaceStore((s) => s.clearError);

  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(true);
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

  const handleNewDocument = useCallback(() => {
    void createDocument("Untitled");
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
          />
        )}

        <main className="app-main" role="main">
          {error && (
            <div className="app-error" role="alert">
              <span>Something went wrong: {error}</span>
              <Button variant="ghost" size="sm" onClick={clearError}>
                Dismiss
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
              title="No document open"
              description="Pick a note from the sidebar, or create a new one."
              action={
                <Button variant="primary" onClick={handleNewDocument}>
                  New note
                </Button>
              }
            />
          )}
        </main>
      </div>
    </div>
  );
}
