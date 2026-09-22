/**
 * 开发期视觉校验入口（不参与构建/测试）。
 *
 * 为什么需要它：设置页的样式问题（分段控件被拉宽、路径断词）在 jsdom 里
 * 查不出来 —— jsdom 不做布局。而每次改 CSS 都重建 Tauri release 要 3–8 分钟。
 * 这里用真实浏览器渲染同一个组件，秒级看到效果。
 *
 * 用法：npx vite --config vite.harness.config.ts
 * 该文件与 harness.html 都不进 dist、不被 vitest 收集。
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsPage } from "./components/settings/SettingsPage";
import { AppToolbar } from "./components/workspace/AppToolbar";
import { Breadcrumb } from "./components/workspace/Breadcrumb";
import { DocumentBar } from "./components/workspace/DocumentBar";
import { UpdateBar } from "./components/workspace/UpdateBar";
import { Button } from "./components/ui/Button";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { useUpdateStore } from "./stores/useUpdateStore";
import { applyTheme, resolveTheme, systemPrefersDark, type ThemePreference } from "./lib/theme";
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
import "./styles/globals.css";

// 给 store 灌入一份假设置，让各分组渲染出真实内容。
useWorkspaceStore.setState({
  settings: {
    workspaceRoot: "E:/Documents/my/crab-md/.manual-workspace",
    effectiveWorkspaceRoot: "E:/Documents/my/crab-md/.manual-workspace",
    workspaceRootIsFromEnv: false,
    configPath: "C:/Users/Administrator/AppData/Roaming/dev.crabmd.app/settings.json",
    version: 1,
  },
  loadSettings: async () => {},
  setWorkspaceRoot: async () => true,
  resetWorkspaceRoot: async () => true,
} as never);

// 更新提示条要显示内容，先给 store 灌一个「有新版」的状态。
useUpdateStore.setState({
  status: { kind: "available", version: "1.2.3", notes: null },
  barDismissed: false,
});

function Harness() {
  const [theme, setTheme] = useState<ThemePreference>("light");
  const [viewMode, setViewMode] = useState<"edit" | "split" | "preview">("split");
  const [fontSize, setFontSize] = useState<EditorFontSize>(() =>
    readStoredFontSize(localStorage.getItem(FONT_SIZE_KEY)),
  );
  const [fontFamily, setFontFamily] = useState<EditorFontFamily>(() =>
    readStoredFontFamily(localStorage.getItem(FONT_FAMILY_KEY)),
  );

  // 复刻 App.tsx 的接线，才能在 harness 里看到暗色对比度与字体效果。
  useEffect(() => {
    applyTheme(resolveTheme(theme, systemPrefersDark()));
  }, [theme]);

  useEffect(() => {
    applyFontSize(fontSize);
  }, [fontSize]);

  useEffect(() => {
    applyFontFamily(fontFamily);
  }, [fontFamily]);

  return (
    <>
      {/* 实心按钮的对比度最容易在改主题时被弄坏（深色下尤其），
          这里放一组真实按钮，供截图直接核对。 */}
      <div
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          display: "flex",
          gap: 8,
          zIndex: 2000,
        }}
      >
        <Button variant="primary" size="md">
          新建
        </Button>
        <Button variant="secondary" size="md">
          次要
        </Button>
        <Button variant="ghost" size="md">
          幽灵
        </Button>
        <Button variant="danger" size="md">
          删除
        </Button>
      </div>
      {/* 更新提示：工具栏徽标 + 常驻提示条。
          用假版本注入 store，便于目视核对配色与排布。 */}
      <UpdateBar onInstall={() => {}} />
      <AppToolbar
        onNewDocument={() => {}}
        onToggleSidebar={() => {}}
        sidebarVisible
        onOpenSettings={() => {}}
        pendingVersion="1.2.3"
        onOpenUpdate={() => {}}
        themePreference={theme}
        onCycleTheme={() => {}}
      />
      <DocumentBar
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        outlineVisible={false}
        onToggleOutline={() => {}}
      >
        <Breadcrumb virtualPath="/笔记/" title="示例文档.md" />
      </DocumentBar>

      <SettingsPage
        open
        onClose={() => {}}
        onChanged={() => {}}
        themePreference={theme}
        onChangeTheme={setTheme}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        fontSize={fontSize}
        onChangeFontSize={setFontSize}
        fontFamily={fontFamily}
        onChangeFontFamily={setFontFamily}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
