# Markdown Editor Feature Implementation Plan

> **For agentic workers:** implement each task in order, keep changes scoped to the listed files, and run the focused tests after every slice.

**Goal:** 完成 crab-md 的五项 Markdown 编辑器能力：图片粘贴、查找替换、Mermaid 预览、PDF 导出、自动保存与崩溃恢复，并保持本地优先、安全渲染和现有中文 UI 体验。

**Architecture:** 图片通过 CodeMirror 粘贴事件进入 Rust 附件存储，Markdown 使用稳定的 `attachment://` 引用，预览异步解析为内存 URL；查找替换复用 CodeMirror Search；Mermaid 只把 fenced source 作为受控标记交给客户端渲染，错误时保留源码回退；PDF 使用系统打印到 PDF 的 MVP（`window.print()` + 打印样式），不引入未经验证的跨平台原生 PDF 后端；恢复草稿保存在浏览器本地存储，成功落盘后删除并在启动/打开文档时提示恢复。

**Tech Stack:** React 19, TypeScript, CodeMirror 6, markdown-it, DOMPurify, Mermaid, Tauri 2/Rust, Vitest, Cargo tests.

---

## 1. 图片粘贴闭环

**Files:** `src/components/editor/MarkdownEditor.tsx`, `src/App.tsx`, `src/lib/api.ts`, `src/types/document.ts`, `src/components/editor/MarkdownPreview.tsx`, `src/lib/markdown.ts`, `src/components/editor/editor.css`, `src-tauri/src/commands/attachments.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/workspace.rs`。

1. 增加 `save_attachment` / `read_attachment` Tauri 命令；只接受 PNG/JPEG/GIF/WebP，限制大小，服务端生成 UUID 文件名，不信任用户文件名和路径，并使用已有原子写入。
2. 增加前端 attachment API 和类型。CodeMirror `paste` handler 只在剪贴板存在图片时拦截，读取 `File.arrayBuffer()`，保存当前选择，成功后插入 `![图片](attachment://...)`；普通文本粘贴保持原行为，失败不破坏编辑内容。
3. 预览识别 `attachment://` 引用，通过 API 读取二进制并创建 `ObjectURL`；组件卸载或源变化时释放 URL。DOMPurify 仍是最终安全边界，不允许任意协议。
4. 添加前端粘贴/API/预览测试及 Rust 的路径遍历、MIME、大小、读写往返测试。

## 2. 查找与替换

**Files:** `src/components/workspace/AppToolbar.tsx`, `src/App.tsx`, `src/components/editor/MarkdownEditor.tsx`, `src/lib/i18n.ts`, related tests。

1. 打通现有全局 `findNonce`：工具栏搜索按钮可用，点击后聚焦 CodeMirror 搜索面板。
2. 在编辑器右键菜单中提供“查找/替换”入口，继续使用现有二级菜单收纳格式化和插入动作，避免菜单再次纵向过长。
3. 覆盖工具栏点击、快捷键、右键入口测试；确认搜索面板的查找、替换、全部替换由 CodeMirror 原生能力提供。

## 3. Mermaid 预览

**Files:** `package.json`, `package-lock.json`, `src/lib/markdown.ts`, `src/components/editor/MarkdownPreview.tsx`, `src/components/editor/editor.css`, markdown/preview tests。

1. 添加 Mermaid 运行时依赖；markdown-it 将 `mermaid` fenced block 输出为受控 `.mermaid-block` 源码容器，而不是直接信任 SVG/HTML。
2. 预览组件在 effect 中初始化 Mermaid strict 模式并渲染每个图；生成结果再次经过 SVG/HTML sanitization。渲染失败时保留源码并显示轻量错误状态，不让预览空白。
3. 增加 fenced block、恶意 HTML/URL 不绕过 sanitizer、成功/失败回退测试；增加暗色/打印下的图表样式。

## 4. PDF 导出（MVP）

**Files:** `src/App.tsx`, `src/components/workspace/AppToolbar.tsx`, `src/lib/print.ts`, `src/components/editor/editor.css`, `src/lib/i18n.ts`, tests。

1. 新增“导出 PDF”动作，打印当前预览内容；调用系统打印对话框，由用户选择“另存为 PDF”。
2. 添加 `@media print` 规则，隐藏侧栏、工具栏、编辑器、文档栏和滚动容器，只保留 Markdown 预览；确保标题、代码、表格、公式、图片和 Mermaid 可分页打印。
3. 对 `window.print` 做小型可测试封装，覆盖调用和取消/无浏览器环境保护。明确不宣称静默写入指定路径，后续再做平台原生 PDF 命令。

## 5. 自动保存与崩溃恢复

**Files:** `src/lib/recovery.ts`, `src/stores/useWorkspaceStore.ts`, `src/App.tsx`, `src/lib/i18n.ts`, store/App tests。

1. 每次编辑立即把当前文档草稿写入 localStorage（带文档 ID、内容和时间），现有后端防抖自动保存继续负责正式文件落盘。
2. 正式保存成功且内容仍是同一版本时删除对应草稿；保存失败或进程崩溃则保留草稿。
3. 打开文档时检测比正式内容更新的草稿，在编辑器上方/对话框提供“恢复草稿”和“放弃草稿”；两者都必须明确清理/保留状态，不能静默覆盖正式文件。
4. 增加 localStorage 不可用、草稿过期/内容相同、恢复、放弃、保存竞态测试。

## 6. 验证顺序

1. `npx vitest run src/components/editor/MarkdownEditor*.test.tsx src/components/workspace/AppToolbar.test.tsx src/lib/markdown.test.ts src/lib/recovery.test.ts src/stores/useWorkspaceStore.test.ts`
2. `npm test`
3. `npx tsc --noEmit`
4. `npm run build`
5. `npm run test:rust`
6. `npm run tauri:build`（若 updater 签名环境缺失，记录为环境限制；检查 Rust 编译和 bundle 是否已成功）。

**Acceptance:** 普通文本/Markdown 打开行为不回归；图片粘贴后可保存并在预览显示；搜索按钮和右键入口可打开查找替换；Mermaid 图可渲染且不扩大 HTML 注入面；打印预览只包含文档内容；崩溃后重新打开能选择恢复最近草稿；下拉和右键菜单均可点击外部关闭。
