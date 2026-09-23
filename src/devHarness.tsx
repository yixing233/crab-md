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
import { MarkdownPreview } from "./components/editor/MarkdownPreview";
import { MarkdownEditor } from "./components/editor/MarkdownEditor";
import { Button } from "./components/ui/Button";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import { useUpdateStore } from "./stores/useUpdateStore";
import { applyTheme, resolveTheme, systemPrefersDark, type ThemePreference } from "./lib/theme";
import {
  applyFontSize,
  applyFontStack,
  FONT_CJK_KEY,
  FONT_LATIN_KEY,
  FONT_SIZE_KEY,
  readStoredCjkFont,
  readStoredFontSize,
  readStoredLatinFont,
  type EditorCjkFont,
  type EditorFontSize,
  type EditorLatinFont,
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
  const [latinFont, setLatinFont] = useState<EditorLatinFont>(() =>
    readStoredLatinFont(localStorage.getItem(FONT_LATIN_KEY)),
  );
  const [cjkFont, setCjkFont] = useState<EditorCjkFont>(() =>
    readStoredCjkFont(localStorage.getItem(FONT_CJK_KEY)),
  );

  // 复刻 App.tsx 的接线，才能在 harness 里看到暗色对比度与字体效果。
  useEffect(() => {
    applyTheme(resolveTheme(theme, systemPrefersDark()));
  }, [theme]);

  useEffect(() => {
    applyFontSize(fontSize);
  }, [fontSize]);

  useEffect(() => {
    applyFontStack(latinFont, cjkFont);
  }, [latinFont, cjkFont]);

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

      {/* 真实 CodeMirror 编辑器：用来核对光标颜色、选区字体与字体下拉。
          这些都只靠单测证明不了 —— 光标颜色由 CodeMirror 基础主题写死，
          选区字体靠 ViewPlugin 注入装饰，下拉位置由 portal 计算，
          必须看浏览器里的真实计算样式与坐标。 */}
      <div style={{ height: 220, border: "1px solid #888", margin: 16 }}>
        <MarkdownEditor
          documentId="harness"
          value={'# 光标验证\n\n普通文字\n\n<span style="font-family:KaiTi, serif">这段应是楷体</span>\n\n结束'}
          onChange={() => {}}
          onQuickFont={() => {}}
          onClearFont={() => {}}
          defaultLatinFont={latinFont}
          defaultCjkFont={cjkFont}
        />
      </div>

      {/* 表格与公式的真实渲染效果（含真实 KaTeX 样式与字体）。 */}
      <div style={{ padding: 16, maxWidth: 720 }}>
        <MarkdownPreview
          source={[
            "| 语言 | 并发模型 |",
            "| --- | --- |",
            "| Go | goroutine |",
            "| Erlang | actor |",
            "",
            "行内公式 $E=mc^2$ 与分式 $\\frac{a}{b}$。",
            "",
            "$$",
            "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
            "$$",
          ].join("\n")}
        />
      </div>

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
        latinFont={latinFont}
        onChangeLatinFont={setLatinFont}
        cjkFont={cjkFont}
        onChangeCjkFont={setCjkFont}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
