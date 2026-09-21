# crab-md Phase 1（本地编辑器闭环）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在不联网的情况下新建、编辑、重命名、删除 Markdown 文档，正文以标准 `.md` 文件落在本地工作区、元数据存入本地 SQLite，应用重启后原样恢复；桌面三区布局与明暗双主题可运行。

**Architecture:** Tauri 2 客户端。React 负责界面，**所有文件与数据库访问一律经 Rust 命令层**，前端不直接触盘（`ARCHITECTURE.md` §19 不向客户端暴露内部路径）。Rust 侧分四层：`error`（错误类型）→ `model`（领域模型）→ `workspace`（路径解析与原子写）/ `db`（迁移与查询）→ `commands`（暴露给前端的薄封装）。文档身份是 UUIDv7，文件名即 `<uuid>.md`，与标题/路径解耦（§11）。

**Tech Stack:** Tauri 2.11 / React 19.3 / TypeScript 5.9 / Vite 8 / CodeMirror 6 / rusqlite 0.37 (bundled, FTS5) / Zustand 5 / markdown-it 15 + DOMPurify 3 / Vitest 5。

---

## 参考文档

实现时必须对照这两份规范（本仓库根目录）：

- `ARCHITECTURE.md` —— §10 客户端本地存储、§11 文档身份、§16.1 API 规则、§18.2 原子写、§18.3 迁移、§19 安全基线、§24 Agent 规则
- `UI_DESIGN_SYSTEM.md` —— §3 设计令牌、§4 颜色令牌、§11 桌面布局、§18 FileTree、§20 MarkdownEditor、§25 命令面板、§29 键盘、§32 空/加载/错误态

---

## 1. 已实测的环境事实

以下均为 2026-09-21 在本机实测所得，可直接依赖：

| 项 | 结论 |
| --- | --- |
| Tauri 2 构建链 | `create-tauri-app` react-ts 模板 + `npm run tauri build --no-bundle` → 4m04s 产出 exe |
| MSVC 链接器 | 可用。rustc 自动发现 `E:\Microsoft Visual Studio\2022\Community\...\link.exe`；`where /R` 搜不到它，但 `cargo build` 正常 |
| WebView2 | 140.0.3485.66 已装 |
| rusqlite bundled | 编译**无需** INCLUDE/LIB 环境变量；内置 SQLite 3.50.2；**FTS5 可用** |
| Node / npm | v24.20.0 / 11.19.0（registry = `registry.npmmirror.com`） |
| Rust | 1.91.1 stable-x86_64-pc-windows-msvc |

### 1.1 两个必须避开的搜索陷阱（已实测）

这是本计划最重要的技术结论，写错会导致"中文搜不到"或"短词搜不到"：

1. **FTS5 默认 `unicode61` 分词器把整段中文当成一个 token。**
   实测词表：`["channel","go","ownership","rust","并发编程与信道","所有权与借用检查器","的深入讲解","笔记"]`
   —— 查询「并发」返回 **0** 条。必须改用 `tokenize = 'trigram'`。

2. **`trigram` 分词器降级：查询长度不足 3 个字符时返回 0 条。**
   实测：3 字「并发编」命中，2 字「并发」「信道」**返回 0**。
   而中文双字词（并发/信道/笔记/所有权）是**最常见**的查询形态。
   → 必须对 `< 3` 字符的查询回退到 `LIKE`。

最终方案（`trigram` + `LIKE` 回退）已跑通 7/7 测试，代码见 T1.5。

### 1.2 三个 API 事实

- 只有 `&Connection`（非 `&mut`）时开事务要用 `conn.unchecked_transaction()`；`conn.transaction()` 需要 `&mut`，会借用报错。
- 测试用到 `tempfile` 必须在 `[dev-dependencies]` 声明，否则 `error[E0433]`。
- 迁移用 `PRAGMA user_version` 记录版本，逐级 `+1` 应用。

---

## 2. 文件结构

Phase 1 新建的全部文件及其职责：

```text
crab-md/
├── package.json                     # 客户端依赖与脚本
├── vite.config.ts                   # Vite + Vitest 配置（含 jsdom）
├── vitest.setup.ts                  # 测试环境初始化
├── tsconfig.json / tsconfig.node.json
├── index.html
├── .gitignore
├── src/
│   ├── main.tsx                     # React 挂载入口
│   ├── App.tsx                      # 顶层布局装配（三区）
│   ├── styles/
│   │   ├── tokens.css               # 间距/圆角/字号/动效令牌（UI §5–§9）
│   │   ├── theme-light.css          # 亮色语义色（UI §4）
│   │   ├── theme-dark.css           # 暗色语义色
│   │   └── globals.css              # reset + 基础排版
│   ├── components/
│   │   ├── ui/
│   │   │   ├── Button.tsx           # primary/secondary/ghost/danger × sm/md/lg
│   │   │   ├── Input.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   └── Spinner.tsx
│   │   ├── workspace/
│   │   │   ├── AppToolbar.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── FileTree.tsx         # 一等公民组件（UI §18）
│   │   └── editor/
│   │       ├── MarkdownEditor.tsx   # CodeMirror 6 封装
│   │       ├── MarkdownPreview.tsx  # markdown-it + DOMPurify
│   │       └── EditorStatusBar.tsx
│   ├── features/documents/
│   │   └── documentActions.ts       # 新建/重命名/删除的业务编排（可单测）
│   ├── lib/
│   │   ├── api.ts                   # Tauri invoke 的类型化封装
│   │   ├── markdown.ts              # renderMarkdown()：markdown-it + DOMPurify
│   │   └── fileTree.ts              # 扁平列表 → 树形结构（纯函数，可单测）
│   ├── stores/
│   │   └── useWorkspaceStore.ts     # Zustand：文档列表/当前文档/主题
│   └── types/
│       └── document.ts              # DocumentSummary / DocumentPayload
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── icons/
    └── src/
        ├── main.rs                  # 仅调用 lib::run()
        ├── lib.rs                   # 组装 state + 注册命令
        ├── error.rs                 # AppError + serde 序列化
        ├── model.rs                 # DocumentSummary / DocumentPayload
        ├── workspace.rs             # 工作区路径解析、原子写、ID 校验
        ├── db/
        │   ├── mod.rs               # open() + 迁移驱动
        │   ├── documents.rs         # 文档 CRUD
        │   └── search.rs            # trigram + LIKE 混合搜索
        └── commands/
            ├── mod.rs
            └── documents.rs         # #[tauri::command] 列表
```

**职责边界：** `lib/fileTree.ts`、`lib/markdown.ts`、`features/documents/documentActions.ts`、`db/search.rs`、`workspace.rs` 都是**纯逻辑或纯 IO 单元**，各自可独立单测；React 组件只做装配与渲染。

---

## 3. 任务分解

共 14 个任务。T1.1–T1.6 建立可测的 Rust 内核，T1.7–T1.10 打通命令层与前端桥接，T1.11–T1.14 构建界面与端到端验证。

---

### Task T1.1: 脚手架与工具链基线

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `vitest.setup.ts`, `.gitignore`
- Create: `src/main.tsx`, `src/App.tsx`, `src/vite-env.d.ts`
- Create: `src-tauri/`（整个目录，来自模板）
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `src-tauri/tauri.conf.json`（改名）

- [ ] **Step 1: 用官方模板生成 Tauri 2 骨架**

在 `E:\Documents\my\crab-md` 的**父目录**执行（模板会创建新目录，故先生成到临时名再移入）：

```powershell
cd E:\Documents\my
npm create tauri-app@latest crab-md-tmp -- --template react-ts --manager npm --identifier dev.crabmd.app --yes
```

预期输出结尾：`Template created!`

- [ ] **Step 2: 把骨架内容移入 crab-md（保留两份规范文档）**

```powershell
cd E:\Documents\my
Get-ChildItem crab-md-tmp -Force | ForEach-Object { Move-Item $_.FullName E:\Documents\my\crab-md\ -Force }
Remove-Item crab-md-tmp -Recurse -Force
Get-ChildItem E:\Documents\my\crab-md
```

预期：能同时看到 `ARCHITECTURE.md`、`UI_DESIGN_SYSTEM.md`、`package.json`、`src`、`src-tauri`。

- [ ] **Step 3: 修正模板留下的临时命名**

模板会把包名固化成交付目录名 `crab-md-tmp`。**这一步不能跳过**：`src-tauri/src/main.rs` 里调用的是 `crab_md_tmp_lib::run()`，而 T1.7 会把 `lib.rs` 整体替换掉 —— 不改名会直接编译失败。

先确认现状（三处都应命中）：

```powershell
Select-String -Path src-tauri/Cargo.toml,src-tauri/src/main.rs,src-tauri/tauri.conf.json -Pattern 'crab-md-tmp|crab_md_tmp'
```

预期：`Cargo.toml` 2 处（`name`、`[lib] name`）、`main.rs` 1 处、`tauri.conf.json` 2 处（`productName`、窗口 `title`）。

一次改完四处（本组命令已实测：改后残留检查无输出，且 JSON 仍然合法）：

```powershell
(Get-Content src-tauri/Cargo.toml -Raw) `
  -replace 'name = "crab-md-tmp"', 'name = "crab-md"' `
  -replace 'name = "crab_md_tmp_lib"', 'name = "crab_md_lib"' `
  | Set-Content src-tauri/Cargo.toml -NoNewline

(Get-Content src-tauri/src/main.rs -Raw) `
  -replace 'crab_md_tmp_lib', 'crab_md_lib' `
  | Set-Content src-tauri/src/main.rs -NoNewline

(Get-Content src-tauri/tauri.conf.json -Raw) `
  -replace '"productName": "crab-md-tmp"', '"productName": "crab-md"' `
  -replace '"title": "crab-md-tmp"', '"title": "crab-md"' `
  | Set-Content src-tauri/tauri.conf.json -NoNewline
```

- [ ] **Step 4: 验证改名彻底且未破坏配置**

```powershell
Select-String -Path src-tauri/Cargo.toml,src-tauri/src/main.rs,src-tauri/tauri.conf.json -Pattern 'crab-md-tmp|crab_md_tmp'
Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json | Out-Null; "JSON OK"
Select-String -Path src-tauri/tauri.conf.json -Pattern 'productName|identifier'
Select-String -Path src-tauri/Cargo.toml -Pattern '^name'
```

预期：

- 第一条**无输出**（exit code 1；没匹配到即正确）
- 打印 `JSON OK`
- `"productName": "crab-md"`、`"identifier": "dev.crabmd.app"`（identifier 由模板参数决定，无需改）
- `Cargo.toml` 为 `name = "crab-md"` 与 `name = "crab_md_lib"`

- [ ] **Step 5: 锁定依赖版本**

整个替换 `package.json`（`typescript` 必须是 5.9，npm 上 `latest` 已是 7.0.2 的 Go 重写版，与已验证工具链不符）：

```json
{
  "name": "crab-md",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "Local-first Markdown reader/editor with per-user cloud sync",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:rust": "cargo test --manifest-path src-tauri/Cargo.toml",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@codemirror/commands": "^6.11.1",
    "@codemirror/lang-markdown": "^6.5.2",
    "@codemirror/language": "^6.12.4",
    "@codemirror/language-data": "^6.5.2",
    "@codemirror/search": "^6.7.2",
    "@codemirror/state": "^6.7.5",
    "@codemirror/view": "^6.43.12",
    "@tauri-apps/api": "^2.11.1",
    "dompurify": "^3.4.15",
    "lucide-react": "^1.47.0",
    "markdown-it": "^15.0.2",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "zustand": "^5.0.15"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.11.5",
    "@testing-library/jest-dom": "^7.0.1",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.7",
    "@types/markdown-it": "^14.2.0",
    "@types/node": "^26.6.2",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.1",
    "jsdom": "^30.1.0",
    "typescript": "^5.9.3",
    "vite": "^8.3.0",
    "vitest": "^5.0.1"
  }
}
```

- [ ] **Step 6: 安装依赖**

```powershell
cd E:\Documents\my\crab-md
npm install
```

预期：`added N packages`，退出码 0。

- [ ] **Step 7: 配置 Vitest（jsdom 环境）**

整个替换 `vite.config.ts`：

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 在开发时通过固定端口加载前端，故端口不能随机。
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

创建 `vitest.setup.ts`：

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 8: 写第一个测试，确认测试运行器可用**

创建 `src/lib/smoke.test.ts`：

```ts
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs vitest in jsdom", () => {
    expect(typeof document).toBe("object");
    expect(1 + 1).toBe(2);
  });
});
```

运行：

```powershell
npm test
```

预期：`1 passed`。

- [ ] **Step 9: 验证 Rust 侧可编译**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

预期：编译成功，`0 passed`（模板暂无测试）。首次编译约 4 分钟，属正常。

这一步同时**验证了改名正确** —— 若 `main.rs` 的 lib 名与 `Cargo.toml` 的 `[lib] name` 不一致，此处会编译失败。

- [ ] **Step 10: 补全 .gitignore（关键，先于首次提交）**

模板生成的 `.gitignore` **不含** `src-tauri/target`。Rust 构建产物体积达 GB 级，若不先忽略，接下来的 `git add -A` 会把整个编译产物提交进仓库。追加以下内容：

```powershell
@'

# Rust / Tauri build output
src-tauri/target/
src-tauri/gen/

# Local workspace used for manual verification (see T1.14)
.manual-workspace/
'@ | Add-Content .gitignore
```

确认生效：

```powershell
Select-String -Path .gitignore -Pattern 'src-tauri/target'
```

预期：命中 1 行。

- [ ] **Step 11: 提交**

```powershell
git init
git add -A
git commit -m "chore: scaffold Tauri 2 + React 19 + Vitest baseline"
```

提交后用 `git ls-files | Measure-Object -Line` 自查文件数 —— 应在**数十个**量级。若是上千个，说明 `target/` 没被忽略，需 `git rm -r --cached src-tauri/target` 后重来。

---

### Task T1.2: 设计令牌与主题

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/theme-light.css`, `src/styles/theme-dark.css`, `src/styles/globals.css`
- Modify: `src/main.tsx`

- [ ] **Step 1: 写令牌文件**

创建 `src/styles/tokens.css`（UI §5–§9）：

```css
:root {
  --space-0: 0;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 999px;

  --text-xs: 12px;
  --text-sm: 13px;
  --text-md: 14px;
  --text-lg: 16px;
  --text-xl: 20px;
  --text-2xl: 24px;

  --leading-tight: 1.4;
  --leading-normal: 1.5;
  --leading-prose: 1.7;

  --duration-fast: 120ms;
  --duration-normal: 180ms;
  --duration-slow: 280ms;

  --font-ui: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --font-mono: "Cascadia Mono", "JetBrains Mono", Consolas, "Courier New", monospace;
}
```

创建 `src/styles/theme-light.css`：

```css
:root,
[data-theme="light"] {
  --bg-app: #ffffff;
  --bg-surface: #fafafa;
  --bg-surface-hover: #f2f2f2;
  --bg-surface-active: #e8e8e8;
  --bg-elevated: #ffffff;

  --border-subtle: #ececec;
  --border-default: #dcdcdc;
  --border-strong: #c0c0c0;
  --border-focus: #3b82f6;

  --text-primary: #1a1a1a;
  --text-secondary: #555555;
  --text-muted: #8a8a8a;
  --text-disabled: #b5b5b5;
  --text-inverse: #ffffff;

  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-active: #1e40af;
  --accent-soft: #eff6ff;

  --success: #16a34a;
  --success-soft: #f0fdf4;
  --warning: #d97706;
  --warning-soft: #fffbeb;
  --danger: #dc2626;
  --danger-soft: #fef2f2;
  --info: #0284c7;
  --info-soft: #f0f9ff;

  --selection-bg: #bfdbfe;
  --selection-text: #1a1a1a;
}
```

创建 `src/styles/theme-dark.css`：

```css
[data-theme="dark"] {
  --bg-app: #1a1a1a;
  --bg-surface: #202020;
  --bg-surface-hover: #2a2a2a;
  --bg-surface-active: #333333;
  --bg-elevated: #262626;

  --border-subtle: #2e2e2e;
  --border-default: #3a3a3a;
  --border-strong: #4d4d4d;
  --border-focus: #60a5fa;

  --text-primary: #e8e8e8;
  --text-secondary: #b0b0b0;
  --text-muted: #808080;
  --text-disabled: #5a5a5a;
  --text-inverse: #1a1a1a;

  --accent: #3b82f6;
  --accent-hover: #60a5fa;
  --accent-active: #93c5fd;
  --accent-soft: #1e293b;

  --success: #22c55e;
  --success-soft: #14261a;
  --warning: #f59e0b;
  --warning-soft: #2a2113;
  --danger: #ef4444;
  --danger-soft: #2a1616;
  --info: #38bdf8;
  --info-soft: #12222b;

  --selection-bg: #1e40af;
  --selection-text: #ffffff;
}
```

- [ ] **Step 2: 写全局样式**

创建 `src/styles/globals.css`：

```css
@import "./tokens.css";
@import "./theme-light.css";
@import "./theme-dark.css";

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  margin: 0;
}

body {
  font-family: var(--font-ui);
  font-size: var(--text-md);
  line-height: var(--leading-normal);
  color: var(--text-primary);
  background: var(--bg-app);
  -webkit-font-smoothing: antialiased;
}

:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: 在入口引入样式**

模板的 `src/main.tsx` **没有引入任何样式文件**（它依赖 `App.tsx` 内部 import）。这里改为在入口统一引入，保证主题令牌在任何组件渲染前就已生效：

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: 移除模板遗留文件**

模板自带 `src/App.css` 与 `src/assets/react.svg`，且 `App.tsx` 引用了它们。T1.13 会整体替换 `App.tsx`，故此处**只删资源文件、保留 `App.css` 备后续覆盖**：

```powershell
Remove-Item src/assets/react.svg -Force -ErrorAction SilentlyContinue
Remove-Item src/assets -Recurse -Force -ErrorAction SilentlyContinue
```

注意：此刻 `src/App.tsx` 仍在 `import reactLogo from "./assets/react.svg"`，删除后 `npm test` / `npm run build` 会报模块找不到。**这是预期的** —— T1.13 会用最终版本覆盖 `App.tsx`。如果希望中途保持绿色，可在本步顺带把该 import 与相关 `<img>` 一并删除。

- [ ] **Step 5: 提交**

```powershell
git add -A
git commit -m "feat(ui): add design tokens and light/dark themes"
```

---

### Task T1.3: Rust 错误类型与领域模型

**Files:**
- Create: `src-tauri/src/error.rs`, `src-tauri/src/model.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1: 加依赖**

替换 `src-tauri/Cargo.toml` 的 `[dependencies]` 段（其余段保持模板内容不变）：

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.37", features = ["bundled"] }
uuid = { version = "1", features = ["v7", "serde"] }
sha2 = "0.10"
hex = "0.4"
chrono = { version = "0.4", features = ["serde"] }
thiserror = "2"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: 写失败测试**

创建 `src-tauri/src/error.rs`，仅含测试与占位：

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn error_serializes_to_machine_readable_code() {
        use super::AppError;
        let e = AppError::InvalidId("../etc/passwd".to_string());
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["code"], "INVALID_ID");
        assert!(json["message"].as_str().unwrap().contains("etc/passwd"));
        assert_eq!(json["code"].as_str().unwrap(), json["code"].as_str().unwrap().to_uppercase());
    }
}
```

- [ ] **Step 3: 运行测试确认失败**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml error_serializes
```

预期：编译失败，`cannot find type AppError` / `serde_json` 未导入。

- [ ] **Step 4: 实现错误类型**

整个替换 `src-tauri/src/error.rs`（`ARCHITECTURE.md` §16.1 要求稳定机器可读错误码）：

```rust
use serde::{Serialize, Serializer};

/// 面向客户端的错误。序列化为 `{ "code": "...", "message": "..." }`，
/// code 稳定可编程判断，message 供日志与排查。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("document not found: {0}")]
    NotFound(String),
    #[error("invalid document id: {0}")]
    InvalidId(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("workspace not initialised")]
    WorkspaceMissing,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::InvalidId(_) => "INVALID_ID",
            AppError::InvalidInput(_) => "INVALID_INPUT",
            AppError::WorkspaceMissing => "WORKSPACE_MISSING",
            AppError::Io(_) => "IO_ERROR",
            AppError::Db(_) => "DB_ERROR",
            AppError::Serde(_) => "SERDE_ERROR",
        }
    }

    pub fn message(&self) -> String {
        self.to_string()
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.message())?;
        st.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_to_machine_readable_code() {
        let e = AppError::InvalidId("../etc/passwd".to_string());
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["code"], "INVALID_ID");
        assert!(json["message"].as_str().unwrap().contains("etc/passwd"));
    }

    #[test]
    fn every_variant_has_uppercase_snake_code() {
        let cases = [
            AppError::NotFound("x".into()),
            AppError::InvalidId("x".into()),
            AppError::InvalidInput("x".into()),
            AppError::WorkspaceMissing,
            AppError::Io(std::io::Error::other("x")),
        ];
        for e in cases {
            let code = e.code();
            assert!(!code.is_empty());
            assert_eq!(code, code.to_uppercase(), "code must be uppercase: {code}");
            assert!(!code.contains(' '), "code must not contain spaces: {code}");
        }
    }
}
```

- [ ] **Step 5: 运行测试确认通过**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml error
```

预期：`2 passed`。

- [ ] **Step 6: 写模型的失败测试**

创建 `src-tauri/src/model.rs`：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_serializes_with_camel_case_for_frontend() {
        let s = DocumentSummary {
            id: "01993ab2-0000-7000-8000-000000000000".into(),
            title: "Go Basics".into(),
            virtual_path: "/Development/Go/".into(),
            revision: 1,
            content_hash: "sha256:aa".into(),
            created_at: "2026-09-21T00:00:00Z".into(),
            updated_at: "2026-09-21T00:00:00Z".into(),
            size: 12,
        };
        let json = serde_json::to_value(&s).unwrap();
        assert!(json.get("virtualPath").is_some(), "frontend expects camelCase");
        assert!(json.get("virtual_path").is_none());
        assert_eq!(json["revision"], 1);
    }
}
```

- [ ] **Step 7: 运行确认失败**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml summary_serializes
```

预期：编译失败，`cannot find type DocumentSummary`。

- [ ] **Step 8: 实现模型**

整个替换 `src-tauri/src/model.rs`：

```rust
use serde::{Deserialize, Serialize};

/// 文档元数据（对应 ARCHITECTURE.md §9 的 documents 表）。
/// id 是 UUIDv7 字符串，与 title / virtual_path 解耦（§11）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub title: String,
    pub virtual_path: String,
    pub revision: i64,
    pub content_hash: String,
    pub created_at: String,
    pub updated_at: String,
    pub size: i64,
}

/// 元数据 + 正文，用于打开单个文档。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    #[serde(flatten)]
    pub summary: DocumentSummary,
    pub content: String,
}

/// 新建文档的请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocumentRequest {
    pub title: String,
    #[serde(default = "default_virtual_path")]
    pub virtual_path: String,
}

fn default_virtual_path() -> String {
    "/".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> DocumentSummary {
        DocumentSummary {
            id: "01993ab2-0000-7000-8000-000000000000".into(),
            title: "Go Basics".into(),
            virtual_path: "/Development/Go/".into(),
            revision: 1,
            content_hash: "sha256:aa".into(),
            created_at: "2026-09-21T00:00:00Z".into(),
            updated_at: "2026-09-21T00:00:00Z".into(),
            size: 12,
        }
    }

    #[test]
    fn summary_serializes_with_camel_case_for_frontend() {
        let json = serde_json::to_value(sample()).unwrap();
        assert!(json.get("virtualPath").is_some(), "frontend expects camelCase");
        assert!(json.get("virtual_path").is_none());
        assert_eq!(json["revision"], 1);
    }

    #[test]
    fn payload_flattens_summary_fields() {
        let p = DocumentPayload { summary: sample(), content: "# hi".into() };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["title"], "Go Basics");
        assert_eq!(json["content"], "# hi");
        assert!(json.get("summary").is_none(), "must flatten, not nest");
    }

    #[test]
    fn create_request_defaults_virtual_path() {
        let r: CreateDocumentRequest = serde_json::from_str(r#"{"title":"x"}"#).unwrap();
        assert_eq!(r.virtual_path, "/");
    }
}
```

- [ ] **Step 9: 运行确认通过**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml model
```

预期：`3 passed`。

- [ ] **Step 10: 在 lib.rs 注册模块**

修改 `src-tauri/src/lib.rs`，在文件顶部加入：

```rust
pub mod error;
pub mod model;
```

- [ ] **Step 11: 提交**

```powershell
git add -A
git commit -m "feat(rust): add typed errors and document models"
```

---

### Task T1.4: 工作区路径解析与原子写

**Files:**
- Create: `src-tauri/src/workspace.rs`
- Modify: `src-tauri/src/lib.rs`

本任务落实 `ARCHITECTURE.md` §7.1（不信任用户提供的路径）、§11（身份与路径解耦）、§18.2（原子写）、§24.5。

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/workspace.rs`：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal_via_id() {
        let root = std::path::Path::new("C:/ws");
        assert!(matches!(note_path(root, "../../etc/passwd"), Err(AppError::InvalidId(_))));
        assert!(matches!(note_path(root, ".."), Err(AppError::InvalidId(_))));
        assert!(matches!(note_path(root, "a/b"), Err(AppError::InvalidId(_))));
        assert!(matches!(note_path(root, ""), Err(AppError::InvalidId(_))));
    }
}
```

- [ ] **Step 2: 运行确认失败**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml rejects_path_traversal
```

预期：编译失败，`cannot find function note_path`。

- [ ] **Step 3: 实现工作区模块**

整个替换 `src-tauri/src/workspace.rs`：

```rust
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

pub const NOTES_DIR: &str = "notes";
pub const ATTACHMENTS_DIR: &str = "attachments";
pub const APP_DIR: &str = ".app";
pub const DB_FILE: &str = "metadata.db";

/// 解析文档在磁盘上的真实路径。
///
/// 安全性：id 必须先通过 UUID 解析，才能参与路径拼接。
/// 这从根上排除了 `../`、绝对路径、分隔符注入等穿越手段
/// （ARCHITECTURE.md §7.1 / §16.1），也使文档身份与标题解耦（§11）。
pub fn note_path(root: &Path, id: &str) -> AppResult<PathBuf> {
    let uuid = uuid::Uuid::parse_str(id).map_err(|_| AppError::InvalidId(id.to_string()))?;
    Ok(root.join(NOTES_DIR).join(format!("{uuid}.md")))
}

/// 工作区内的元数据数据库路径。
pub fn db_path(root: &Path) -> PathBuf {
    root.join(APP_DIR).join(DB_FILE)
}

/// 生成新的文档 ID（UUIDv7：按时间可排序，便于按创建顺序列出）。
pub fn new_document_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// 正文内容哈希，格式 `sha256:<hex>`。
pub fn content_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(content.as_bytes());
    format!("sha256:{}", hex::encode(h.finalize()))
}

/// 当前时间戳（RFC 3339，UTC）。
pub fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 原子写入：先写同目录临时文件 → fsync → rename 覆盖目标。
///
/// 直接覆写目标文件在崩溃或断电时可能留下截断内容；
/// 同目录 rename 在 NTFS 上是原子的，因此读者要么看到旧内容、要么看到新内容
/// （ARCHITECTURE.md §18.2）。
pub fn atomic_write(target: &Path, data: &[u8]) -> AppResult<()> {
    use std::io::Write;

    let dir = target
        .parent()
        .ok_or_else(|| AppError::InvalidInput(format!("path has no parent: {}", target.display())))?;
    std::fs::create_dir_all(dir)?;

    let tmp = dir.join(format!(".tmp-{}", uuid::Uuid::now_v7()));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }

    match std::fs::rename(&tmp, target) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(AppError::Io(e))
        }
    }
}

/// 读取文档正文；文档缺失时返回空串（新建后尚未落盘的文档视作空文档）。
pub fn read_note(root: &Path, id: &str) -> AppResult<String> {
    let path = note_path(root, id)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// 初始化工作区目录结构（幂等）。
pub fn ensure_layout(root: &Path) -> AppResult<()> {
    std::fs::create_dir_all(root.join(NOTES_DIR))?;
    std::fs::create_dir_all(root.join(ATTACHMENTS_DIR))?;
    std::fs::create_dir_all(root.join(APP_DIR))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn tmp_root() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        ensure_layout(&root).unwrap();
        (dir, root)
    }

    #[test]
    fn rejects_path_traversal_via_id() {
        let root = Path::new("C:/ws");
        assert!(matches!(note_path(root, "../../etc/passwd"), Err(AppError::InvalidId(_))));
        assert!(matches!(note_path(root, ".."), Err(AppError::InvalidId(_))));
        assert!(matches!(note_path(root, "a/b"), Err(AppError::InvalidId(_))));
        assert!(matches!(note_path(root, ""), Err(AppError::InvalidId(_))));
        assert!(matches!(note_path(root, "C:/Windows/System32"), Err(AppError::InvalidId(_))));
    }

    #[test]
    fn note_path_stays_inside_notes_dir() {
        let root = Path::new("C:/ws");
        let id = new_document_id();
        let p = note_path(root, &id).unwrap();
        assert!(p.starts_with(root.join(NOTES_DIR)));
        assert_eq!(p.file_name().unwrap().to_str().unwrap(), format!("{id}.md"));
    }

    #[test]
    fn id_is_uuid_v7_and_sortable() {
        let a = new_document_id();
        let b = new_document_id();
        assert!(uuid::Uuid::parse_str(&a).is_ok());
        assert_eq!(uuid::Uuid::parse_str(&a).unwrap().get_version_num(), 7);
        assert!(a < b, "v7 must be time-sortable: {a} vs {b}");
    }

    #[test]
    fn atomic_write_creates_and_replaces() {
        let (_d, root) = tmp_root();
        let id = new_document_id();
        let p = note_path(&root, &id).unwrap();

        atomic_write(&p, b"first").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "first");

        atomic_write(&p, b"second").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "second");
    }

    #[test]
    fn atomic_write_leaves_no_temp_files() {
        let (_d, root) = tmp_root();
        let id = new_document_id();
        let p = note_path(&root, &id).unwrap();
        atomic_write(&p, b"x").unwrap();

        let leftovers: Vec<_> = std::fs::read_dir(root.join(NOTES_DIR))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp files leaked: {leftovers:?}");
    }

    #[test]
    fn atomic_write_handles_unicode_content() {
        let (_d, root) = tmp_root();
        let id = new_document_id();
        let p = note_path(&root, &id).unwrap();
        let text = "# 中文标题\n\n并发编程与信道 🦀\n";
        atomic_write(&p, text.as_bytes()).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), text);
    }

    #[test]
    fn read_note_returns_empty_for_missing_file() {
        let (_d, root) = tmp_root();
        assert_eq!(read_note(&root, &new_document_id()).unwrap(), "");
    }

    #[test]
    fn read_note_round_trips() {
        let (_d, root) = tmp_root();
        let id = new_document_id();
        atomic_write(&note_path(&root, &id).unwrap(), "hello 世界".as_bytes()).unwrap();
        assert_eq!(read_note(&root, &id).unwrap(), "hello 世界");
    }

    #[test]
    fn content_hash_is_stable_and_prefixed() {
        assert_eq!(content_hash("x"), content_hash("x"));
        assert_ne!(content_hash("x"), content_hash("y"));
        assert!(content_hash("x").starts_with("sha256:"));
        assert_eq!(content_hash("x").len(), "sha256:".len() + 64);
    }

    #[test]
    fn ensure_layout_is_idempotent() {
        let (_d, root) = tmp_root();
        ensure_layout(&root).unwrap();
        assert!(root.join(NOTES_DIR).is_dir());
        assert!(root.join(ATTACHMENTS_DIR).is_dir());
        assert!(root.join(APP_DIR).is_dir());
    }

    #[test]
    fn now_iso8601_is_parseable() {
        let s = now_iso8601();
        assert!(chrono::DateTime::parse_from_rfc3339(&s).is_ok(), "bad ts: {s}");
    }
}
```

- [ ] **Step 4: 运行确认通过**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml workspace
```

预期：`11 passed`。

- [ ] **Step 5: 在 lib.rs 注册模块**

在 `src-tauri/src/lib.rs` 顶部加入：

```rust
pub mod workspace;
```

- [ ] **Step 6: 提交**

```powershell
git add -A
git commit -m "feat(rust): add workspace paths, atomic writes and content hashing"
```

---

### Task T1.5: 元数据数据库、版本化迁移与文档 CRUD

**Files:**
- Create: `src-tauri/src/db/mod.rs`, `src-tauri/src/db/documents.rs`
- Modify: `src-tauri/src/lib.rs`

落实 `ARCHITECTURE.md` §9（documents 表）、§10（本地跟踪字段）、§18.3（版本化迁移）。

- [ ] **Step 1: 写迁移的失败测试**

创建 `src-tauri/src/db/mod.rs`：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_applies_migrations_and_sets_user_version() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&dir.path().join("metadata.db")).unwrap();
        let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, LATEST_VERSION);
    }
}
```

- [ ] **Step 2: 运行确认失败**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml open_applies_migrations
```

预期：编译失败，`cannot find function open`。

- [ ] **Step 3: 实现迁移驱动**

整个替换 `src-tauri/src/db/mod.rs`：

```rust
pub mod documents;
pub mod search;

use rusqlite::Connection;
use std::path::Path;

/// 当前 schema 版本。新增迁移时 +1 并在 `migration_sql` 加分支；
/// 已有分支的内容**不得**修改，否则已升级的库不会重跑（ARCHITECTURE.md §18.3）。
pub const LATEST_VERSION: i32 = 1;

fn migration_sql(version: i32) -> Option<&'static str> {
    match version {
        1 => Some(
            r#"
CREATE TABLE documents (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    virtual_path  TEXT NOT NULL DEFAULT '/',
    revision      INTEGER NOT NULL DEFAULT 1,
    content_hash  TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    deleted_at    TEXT,
    size          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_documents_path ON documents(virtual_path);
CREATE INDEX idx_documents_updated ON documents(updated_at DESC);

-- trigram 分词器：中文没有空格，默认 unicode61 会把整段 CJK 当成一个 token，
-- 导致「并发」搜不到「并发编程与信道」。trigram 让中文可按子串匹配。
CREATE VIRTUAL TABLE documents_fts USING fts5(
    doc_id UNINDEXED,
    title,
    body,
    tokenize = 'trigram'
);
"#,
        ),
        _ => None,
    }
}

/// 打开数据库并升级到最新 schema。
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(e))
        })?;
    }

    let conn = Connection::open(path)?;
    // WAL：允许读写并发，且崩溃后不易损坏。
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // 多窗口/多进程同时写入时不要立刻报 SQLITE_BUSY。
    conn.pragma_update(None, "busy_timeout", 5000)?;

    migrate(&conn)?;
    Ok(conn)
}

/// 逐级应用迁移。每级迁移与其版本号写入在同一事务内，
/// 因此不会出现「schema 改了但版本号没记上」的半完成状态。
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let mut version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    while version < LATEST_VERSION {
        let next = version + 1;
        let sql = migration_sql(next)
            .ok_or_else(|| rusqlite::Error::InvalidParameterName(format!("missing migration {next}")))?;

        // 此处只有 &Connection，故用 unchecked_transaction()。
        // conn.transaction() 需要 &mut Connection，会编译失败。
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", next)?;
        tx.commit()?;

        version = next;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&dir.path().join("metadata.db")).unwrap();
        (dir, conn)
    }

    #[test]
    fn open_applies_migrations_and_sets_user_version() {
        let (_d, conn) = tmp_db();
        let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, LATEST_VERSION);
    }

    #[test]
    fn migrate_is_idempotent() {
        let (_d, conn) = tmp_db();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, LATEST_VERSION);
    }

    #[test]
    fn reopen_keeps_schema_version_and_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("metadata.db");
        {
            let conn = open(&path).unwrap();
            conn.execute(
                "INSERT INTO documents (id,title,virtual_path,content_hash,created_at,updated_at,size)
                 VALUES ('01993ab2-0000-7000-8000-000000000001','T','/','sha256:a','2026-01-01','2026-01-01',0)",
                [],
            )
            .unwrap();
        }
        let conn = open(&path).unwrap();
        let v: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, LATEST_VERSION);
        let n: i64 = conn.query_row("SELECT count(*) FROM documents", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "data must survive reopen");
    }

    #[test]
    fn wal_mode_is_enabled() {
        let (_d, conn) = tmp_db();
        let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
    }

    #[test]
    fn migration_creates_fts_table() {
        let (_d, conn) = tmp_db();
        conn.execute(
            "INSERT INTO documents_fts (doc_id, title, body) VALUES ('x','T','text')",
            [],
        )
        .unwrap();
    }
}
```

- [ ] **Step 4: 运行确认通过**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml db::tests
```

预期：`5 passed`。

- [ ] **Step 5: 写文档 CRUD 的失败测试**

创建 `src-tauri/src/db/documents.rs`：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_then_list_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let conn = crate::db::open(&dir.path().join("m.db")).unwrap();
        insert(&conn, "01993ab2-0000-7000-8000-000000000001", "Go Basics", "/", "sha256:a", "2026-01-01", 3).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
    }
}
```

- [ ] **Step 6: 运行确认失败**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml insert_then_list
```

预期：编译失败，`cannot find function insert`。

- [ ] **Step 7: 实现文档 CRUD**

整个替换 `src-tauri/src/db/documents.rs`。注意每个写操作都过滤 `deleted_at IS NULL`，且返回受影响行数，调用方据此区分「成功」与「文档不存在」：

```rust
use crate::error::AppResult;
use crate::model::DocumentSummary;
use rusqlite::{params, Connection};

/// 插入新文档元数据，并写入全文索引。
pub fn insert(
    conn: &Connection,
    id: &str,
    title: &str,
    virtual_path: &str,
    content_hash: &str,
    now: &str,
    size: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO documents
           (id, title, virtual_path, revision, content_hash, created_at, updated_at, size)
         VALUES (?1, ?2, ?3, 1, ?4, ?5, ?5, ?6)",
        params![id, title, virtual_path, content_hash, now, size],
    )?;
    Ok(())
}

/// 列出未删除的文档，按虚拟路径 + 标题排序（大小写不敏感）。
pub fn list(conn: &Connection) -> AppResult<Vec<DocumentSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, virtual_path, revision, content_hash, created_at, updated_at, size
         FROM documents
         WHERE deleted_at IS NULL
         ORDER BY virtual_path, title COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], row_to_summary)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// 取单个未删除文档的元数据。
pub fn get(conn: &Connection, id: &str) -> AppResult<Option<DocumentSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, virtual_path, revision, content_hash, created_at, updated_at, size
         FROM documents
         WHERE id = ?1 AND deleted_at IS NULL",
    )?;
    let mut rows = stmt.query_map([id], row_to_summary)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// 更新正文相关字段并递增 revision。返回受影响行数（0 表示文档不存在）。
pub fn update_content(
    conn: &Connection,
    id: &str,
    content_hash: &str,
    now: &str,
    size: i64,
) -> AppResult<usize> {
    let n = conn.execute(
        "UPDATE documents
         SET content_hash = ?2, updated_at = ?3, size = ?4, revision = revision + 1
         WHERE id = ?1 AND deleted_at IS NULL",
        params![id, content_hash, now, size],
    )?;
    Ok(n)
}

/// 重命名（只改 title，**不改 id、不改磁盘文件名**，见 ARCHITECTURE.md §11）。
pub fn rename(conn: &Connection, id: &str, title: &str, now: &str) -> AppResult<usize> {
    let n = conn.execute(
        "UPDATE documents SET title = ?2, updated_at = ?3
         WHERE id = ?1 AND deleted_at IS NULL",
        params![id, title, now],
    )?;
    Ok(n)
}

/// 软删除：写入 tombstone，供 Phase 3 同步使用（ARCHITECTURE.md §14）。
pub fn soft_delete(conn: &Connection, id: &str, now: &str) -> AppResult<usize> {
    let n = conn.execute(
        "UPDATE documents SET deleted_at = ?2, updated_at = ?2
         WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    Ok(n)
}

fn row_to_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<DocumentSummary> {
    Ok(DocumentSummary {
        id: r.get(0)?,
        title: r.get(1)?,
        virtual_path: r.get(2)?,
        revision: r.get(3)?,
        content_hash: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
        size: r.get(7)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open(&dir.path().join("m.db")).unwrap();
        (dir, conn)
    }

    const ID_A: &str = "01993ab2-0000-7000-8000-00000000000a";
    const ID_B: &str = "01993ab2-0000-7000-8000-00000000000b";

    #[test]
    fn insert_then_list_round_trips() {
        let (_d, conn) = setup();
        insert(&conn, ID_A, "Go Basics", "/", "sha256:a", "2026-01-01T00:00:00Z", 3).unwrap();
        let list = list(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Go Basics");
        assert_eq!(list[0].revision, 1);
        assert_eq!(list[0].virtual_path, "/");
    }

    #[test]
    fn list_is_ordered_by_path_then_title_case_insensitively() {
        let (_d, conn) = setup();
        insert(&conn, ID_A, "zeta", "/b/", "sha256:a", "2026-01-01", 0).unwrap();
        insert(&conn, ID_B, "Alpha", "/a/", "sha256:b", "2026-01-01", 0).unwrap();
        let list = list(&conn).unwrap();
        assert_eq!(list[0].virtual_path, "/a/");
        assert_eq!(list[1].virtual_path, "/b/");
    }

    #[test]
    fn get_returns_none_for_unknown_id() {
        let (_d, conn) = setup();
        assert!(get(&conn, ID_A).unwrap().is_none());
    }

    #[test]
    fn rename_changes_title_but_not_identity() {
        let (_d, conn) = setup();
        insert(&conn, ID_A, "old title", "/", "sha256:a", "2026-01-01", 0).unwrap();
        let n = rename(&conn, ID_A, "new title", "2026-01-02").unwrap();
        assert_eq!(n, 1);
        let got = get(&conn, ID_A).unwrap().unwrap();
        assert_eq!(got.title, "new title");
        assert_eq!(got.id, ID_A, "renaming must not change document identity");
        assert_eq!(got.created_at, "2026-01-01", "created_at must be preserved");
        assert_eq!(got.updated_at, "2026-01-02");
    }

    #[test]
    fn update_content_increments_revision() {
        let (_d, conn) = setup();
        insert(&conn, ID_A, "T", "/", "sha256:a", "2026-01-01", 1).unwrap();
        update_content(&conn, ID_A, "sha256:b", "2026-01-02", 9).unwrap();
        let got = get(&conn, ID_A).unwrap().unwrap();
        assert_eq!(got.revision, 2);
        assert_eq!(got.content_hash, "sha256:b");
        assert_eq!(got.size, 9);
    }

    #[test]
    fn soft_delete_hides_from_list_and_get() {
        let (_d, conn) = setup();
        insert(&conn, ID_A, "T", "/", "sha256:a", "2026-01-01", 0).unwrap();
        assert_eq!(soft_delete(&conn, ID_A, "2026-01-02").unwrap(), 1);
        assert!(list(&conn).unwrap().is_empty());
        assert!(get(&conn, ID_A).unwrap().is_none());
    }

    #[test]
    fn soft_delete_is_not_repeatable() {
        let (_d, conn) = setup();
        insert(&conn, ID_A, "T", "/", "sha256:a", "2026-01-01", 0).unwrap();
        assert_eq!(soft_delete(&conn, ID_A, "2026-01-02").unwrap(), 1);
        assert_eq!(soft_delete(&conn, ID_A, "2026-01-03").unwrap(), 0, "already deleted");
    }

    #[test]
    fn writes_on_missing_document_report_zero_rows() {
        let (_d, conn) = setup();
        assert_eq!(update_content(&conn, ID_A, "sha256:x", "2026-01-01", 0).unwrap(), 0);
        assert_eq!(rename(&conn, ID_A, "x", "2026-01-01").unwrap(), 0);
        assert_eq!(soft_delete(&conn, ID_A, "2026-01-01").unwrap(), 0);
    }

    #[test]
    fn writes_on_deleted_document_report_zero_rows() {
        let (_d, conn) = setup();
        insert(&conn, ID_A, "T", "/", "sha256:a", "2026-01-01", 0).unwrap();
        soft_delete(&conn, ID_A, "2026-01-02").unwrap();
        assert_eq!(rename(&conn, ID_A, "x", "2026-01-03").unwrap(), 0);
        assert_eq!(update_content(&conn, ID_A, "sha256:x", "2026-01-03", 0).unwrap(), 0);
    }

    #[test]
    fn duplicate_insert_is_rejected() {
        let (_d, conn) = setup();
        insert(&conn, ID_A, "T", "/", "sha256:a", "2026-01-01", 0).unwrap();
        assert!(insert(&conn, ID_A, "T2", "/", "sha256:b", "2026-01-01", 0).is_err());
    }
}
```

- [ ] **Step 8: 运行确认通过**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml db::documents
```

预期：`9 passed`。

- [ ] **Step 9: 在 lib.rs 注册模块**

在 `src-tauri/src/lib.rs` 顶部加入：

```rust
pub mod db;
```

- [ ] **Step 10: 提交**

```powershell
git add -A
git commit -m "feat(rust): add metadata db with versioned migrations and document CRUD"
```

---

### Task T1.6: 全文搜索（trigram + LIKE 回退）

**Files:**
- Create: `src-tauri/src/db/search.rs`

这是全计划中最容易写错的一处。**先读第 1.1 节**：默认分词器搜不到中文子串，trigram 又搜不到 1–2 字符。下面的实现与测试已在独立 crate 中实测通过（7/7）。

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/db/search.rs`：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_char_chinese_query_matches() {
        // 中文双字词是最常见的查询形态，必须命中。
        assert!(!needs_like_fallback("并发"));
    }
}
```

- [ ] **Step 2: 运行确认失败**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml two_char_chinese
```

预期：编译失败，`cannot find function needs_like_fallback`。

- [ ] **Step 3: 实现混合搜索**

整个替换 `src-tauri/src/db/search.rs`：

```rust
use rusqlite::{params, Connection};

/// 搜索结果条目。
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub title: String,
    pub snippet: String,
}

/// trigram 分词器按 3 字符切分，长度不足 3 的查询无法生成 trigram，
/// 因此必须回退。中文双字词（"并发"、"信道"、"笔记"）正好落在这个区间。
pub fn needs_like_fallback(query: &str) -> bool {
    query.chars().count() < 3
}

/// 转义 LIKE 的通配符。不转义的话用户搜 `%` 会匹配全部文档。
pub fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// 全文检索：≥3 字符走 FTS5 trigram，<3 字符走 LIKE 回退。
///
/// 两条路径都排除 `deleted_at` 非空的文档，且都返回带高亮标记的片段。
pub fn search(conn: &Connection, query: &str, limit: i64) -> rusqlite::Result<Vec<SearchHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    if needs_like_fallback(q) {
        let pattern = format!("%{}%", escape_like(q));
        let mut stmt = conn.prepare(
            "SELECT d.id, d.title, COALESCE(substr(f.body, 1, 80), '')
             FROM documents d
             JOIN documents_fts f ON f.doc_id = d.id
             WHERE d.deleted_at IS NULL
               AND (f.title LIKE ?1 ESCAPE '\\' OR f.body LIKE ?1 ESCAPE '\\')
             ORDER BY d.updated_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit], |r| {
            Ok(SearchHit { id: r.get(0)?, title: r.get(1)?, snippet: r.get(2)? })
        })?;
        return rows.collect();
    }

    // 整体用双引号包成短语，内部双引号翻倍转义，
    // 使 FTS5 把用户输入当字面量而非查询语法（避免 "AND"、"NEAR(" 等报错）。
    let match_expr = format!("\"{}\"", q.replace('"', "\"\""));
    let mut stmt = conn.prepare(
        "SELECT d.id, d.title, snippet(documents_fts, 2, '[', ']', '...', 12)
         FROM documents_fts f
         JOIN documents d ON d.id = f.doc_id
         WHERE documents_fts MATCH ?1 AND d.deleted_at IS NULL
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![match_expr, limit], |r| {
        Ok(SearchHit { id: r.get(0)?, title: r.get(1)?, snippet: r.get(2)? })
    })?;
    rows.collect()
}

/// 重建单个文档的索引。先删后插，避免重复条目。
pub fn reindex(conn: &Connection, doc_id: &str, title: &str, body: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM documents_fts WHERE doc_id = ?1", [doc_id])?;
    conn.execute(
        "INSERT INTO documents_fts (doc_id, title, body) VALUES (?1, ?2, ?3)",
        params![doc_id, title, body],
    )?;
    Ok(())
}

/// 移除单个文档的索引条目。
pub fn unindex(conn: &Connection, doc_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM documents_fts WHERE doc_id = ?1", [doc_id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    const ID_A: &str = "01993ab2-0000-7000-8000-00000000000a";
    const ID_B: &str = "01993ab2-0000-7000-8000-00000000000b";
    const ID_C: &str = "01993ab2-0000-7000-8000-00000000000c";

    fn setup() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open(&dir.path().join("m.db")).unwrap();

        let docs = [
            (ID_A, "Go 笔记", "并发编程与信道的深入讲解", "2026-01-03"),
            (ID_B, "Rust 笔记", "所有权与借用检查器 ownership", "2026-01-02"),
            (ID_C, "SQL", "sqlite fts5 prefix search", "2026-01-01"),
        ];
        for (id, title, body, updated) in docs {
            conn.execute(
                "INSERT INTO documents
                   (id, title, virtual_path, content_hash, created_at, updated_at, size)
                 VALUES (?1, ?2, '/', 'sha256:x', ?3, ?3, 0)",
                params![id, title, updated],
            )
            .unwrap();
            reindex(&conn, id, title, body).unwrap();
        }
        (dir, conn)
    }

    #[test]
    fn two_char_chinese_query_matches() {
        assert!(needs_like_fallback("并发"));
        assert!(needs_like_fallback("信道"));
        assert!(needs_like_fallback("a"));
        assert!(!needs_like_fallback("并发编"));
        assert!(!needs_like_fallback("abc"));
    }

    #[test]
    fn like_fallback_covers_short_chinese_words() {
        let (_d, conn) = setup();
        // 这些是本计划实测中 trigram 单独无法命中的形态
        assert_eq!(search(&conn, "并发", 10).unwrap().len(), 1);
        assert_eq!(search(&conn, "信道", 10).unwrap().len(), 1);
        assert_eq!(search(&conn, "笔记", 10).unwrap().len(), 2, "matches both titles");
        assert_eq!(search(&conn, "所", 10).unwrap().len(), 1, "single char");
    }

    #[test]
    fn fts_path_covers_long_queries() {
        let (_d, conn) = setup();
        assert_eq!(search(&conn, "并发编程", 10).unwrap().len(), 1);
        assert_eq!(search(&conn, "并发编", 10).unwrap().len(), 1);
        assert_eq!(search(&conn, "own", 10).unwrap().len(), 1, "ascii mid-word");
        assert_eq!(search(&conn, "ownership", 10).unwrap().len(), 1);
    }

    #[test]
    fn snippet_marks_the_hit() {
        let (_d, conn) = setup();
        let hits = search(&conn, "并发编程", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].snippet.contains('['), "snippet = {}", hits[0].snippet);
    }

    #[test]
    fn like_wildcards_are_escaped() {
        let (_d, conn) = setup();
        assert!(search(&conn, "%", 10).unwrap().is_empty(), "'%%' must be literal");
        assert!(search(&conn, "_", 10).unwrap().is_empty());
    }

    #[test]
    fn escape_like_shape() {
        assert_eq!(escape_like("100%"), "100\\%");
        assert_eq!(escape_like("a_b"), "a\\_b");
        assert_eq!(escape_like("c:\\x"), "c:\\\\x");
    }

    #[test]
    fn tombstones_excluded_in_both_paths() {
        let (_d, conn) = setup();
        conn.execute("UPDATE documents SET deleted_at = '2026-09-21' WHERE id = ?1", [ID_A])
            .unwrap();
        assert!(search(&conn, "并发编程", 10).unwrap().is_empty(), "fts path");
        assert!(search(&conn, "并发", 10).unwrap().is_empty(), "like path");
    }

    #[test]
    fn empty_query_returns_empty_not_error() {
        let (_d, conn) = setup();
        for q in ["", "   ", "\t\n"] {
            assert!(search(&conn, q, 10).unwrap().is_empty(), "q = {q:?}");
        }
    }

    #[test]
    fn hostile_input_never_errors() {
        let (_d, conn) = setup();
        let hostile = [
            "\"", "*", "AND", "OR", "NEAR(", "()", "^", "col:val",
            "a-b", "'", "\\", "?", ";DROP TABLE documents_fts;--",
        ];
        for q in hostile {
            let r = search(&conn, q, 10);
            assert!(r.is_ok(), "query {q:?} errored: {:?}", r.err());
        }
    }

    #[test]
    fn reindex_replaces_rather_than_duplicates() {
        let (_d, conn) = setup();
        reindex(&conn, ID_A, "Go 笔记", "完全不同的内容 zzz").unwrap();
        assert_eq!(search(&conn, "并发编程", 10).unwrap().len(), 0, "old body gone");
        assert_eq!(search(&conn, "zzz", 10).unwrap().len(), 1, "new body indexed");
    }

    #[test]
    fn unindex_removes_entry() {
        let (_d, conn) = setup();
        unindex(&conn, ID_A).unwrap();
        assert_eq!(search(&conn, "并发编程", 10).unwrap().len(), 0);
        assert_eq!(search(&conn, "并发", 10).unwrap().len(), 0, "both paths clean");
    }

    #[test]
    fn limit_is_respected() {
        let (_d, conn) = setup();
        assert_eq!(search(&conn, "笔记", 1).unwrap().len(), 1);
    }
}
```

- [ ] **Step 4: 运行确认通过**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml db::search
```

预期：`12 passed`。**若 `like_fallback_covers_short_chinese_words` 失败，说明分词器或回退阈值写错了 —— 回到第 1.1 节核对。**

- [ ] **Step 5: 提交**

```powershell
git add -A
git commit -m "feat(rust): add CJK-aware hybrid full-text search"
```

---

### Task T1.7: 应用状态与 Tauri 命令层

**Files:**
- Create: `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/documents.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`

命令层是**唯一**暴露给前端的入口，每个命令都薄：校验入参 → 调 `workspace`/`db` → 返回结果。

- [ ] **Step 1: 写失败测试**

创建 `src-tauri/src/commands/documents.rs`：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_then_read_round_trips_through_service() {
        let dir = tempfile::tempdir().unwrap();
        let svc = DocumentService::new(dir.path().to_path_buf()).unwrap();
        let created = svc.create("我的第一篇", "/").unwrap();
        assert_eq!(created.title, "我的第一篇");
        assert_eq!(created.revision, 1);

        let loaded = svc.read(&created.id).unwrap();
        assert_eq!(loaded.content, "");
    }
}
```

- [ ] **Step 2: 运行确认失败**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml create_then_read_round_trips
```

预期：编译失败，`cannot find type DocumentService`。

- [ ] **Step 3: 实现服务层（纯 Rust，可单测，不依赖 Tauri 运行时）**

整个替换 `src-tauri/src/commands/documents.rs`。关键设计：业务逻辑放在 `DocumentService` 里，`#[tauri::command]` 函数只是它的薄包装 —— 这样核心逻辑能直接用 `cargo test` 验证，无需启动 WebView。

```rust
use crate::db::{self, documents as docs, search};
use crate::error::{AppError, AppResult};
use crate::model::{CreateDocumentRequest, DocumentPayload, DocumentSummary};
use crate::workspace;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// 文档服务：持有工作区根路径与数据库连接。
///
/// 业务逻辑集中在此，不依赖 Tauri 运行时，因此可被 cargo test 直接驱动。
pub struct DocumentService {
    root: PathBuf,
    conn: Mutex<Connection>,
}

impl DocumentService {
    /// 打开（必要时创建）工作区。
    pub fn new(root: PathBuf) -> AppResult<Self> {
        workspace::ensure_layout(&root)?;
        let conn = db::open(&workspace::db_path(&root))?;
        Ok(Self { root, conn: Mutex::new(conn) })
    }

    pub fn root(&self) -> &std::path::Path {
        &self.root
    }

    fn conn(&self) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| AppError::InvalidInput("db lock poisoned".into()))
    }

    pub fn list(&self) -> AppResult<Vec<DocumentSummary>> {
        docs::list(&self.conn()?)
    }

    /// 新建文档：先在库里登记元数据，再落一个空文件。
    /// 两个动作都成功才算创建完成；落盘失败时回滚元数据。
    pub fn create(&self, title: &str, virtual_path: &str) -> AppResult<DocumentSummary> {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::InvalidInput("title must not be empty".into()));
        }

        let now = workspace::now_iso8601();
        let id = workspace::new_document_id();
        let empty_hash = workspace::content_hash("");

        let conn = self.conn()?;
        docs::insert(&conn, &id, title, virtual_path, &empty_hash, &now, 0)?;
        drop(conn);

        if let Err(e) = workspace::atomic_write(&workspace::note_path(&self.root, &id)?, b"") {
            let conn = self.conn()?;
            let _ = docs::soft_delete(&conn, &id, &workspace::now_iso8601());
            return Err(e);
        }

        let conn = self.conn()?;
        let summary = docs::get(&conn, &id)?.ok_or_else(|| AppError::NotFound(id.clone()))?;
        drop(conn);

        search::reindex(&self.conn()?, &id, title, "")?;
        Ok(summary)
    }

    /// 读取元数据 + 正文。正文从文件读，元数据从库读。
    pub fn read(&self, id: &str) -> AppResult<DocumentPayload> {
        let conn = self.conn()?;
        let summary = docs::get(&conn, id)?.ok_or_else(|| AppError::NotFound(id.to_string()))?;
        drop(conn);

        let content = workspace::read_note(&self.root, id)?;
        Ok(DocumentPayload { summary, content })
    }

    /// 保存正文：先原子写文件，成功后再更新元数据与索引。
    /// 顺序很重要 —— 文件写失败时元数据保持旧值，不会出现「库里有哈希但文件没内容」。
    pub fn save(&self, id: &str, content: &str) -> AppResult<DocumentSummary> {
        let conn = self.conn()?;
        let summary = docs::get(&conn, id)?.ok_or_else(|| AppError::NotFound(id.to_string()))?;
        drop(conn);

        workspace::atomic_write(&workspace::note_path(&self.root, id)?, content.as_bytes())?;

        let now = workspace::now_iso8601();
        let hash = workspace::content_hash(content);
        let size = content.len() as i64;

        let conn = self.conn()?;
        docs::update_content(&conn, id, &hash, &now, size)?;
        let updated = docs::get(&conn, id)?.ok_or_else(|| AppError::NotFound(id.to_string()))?;
        drop(conn);

        search::reindex(&self.conn()?, id, &summary.title, content)?;
        Ok(updated)
    }

    /// 重命名：只改 title，磁盘文件名与 id 均不变（ARCHITECTURE.md §11）。
    pub fn rename(&self, id: &str, title: &str) -> AppResult<DocumentSummary> {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::InvalidInput("title must not be empty".into()));
        }

        let now = workspace::now_iso8601();
        let conn = self.conn()?;
        if docs::rename(&conn, id, title, &now)? == 0 {
            return Err(AppError::NotFound(id.to_string()));
        }
        let updated = docs::get(&conn, id)?.ok_or_else(|| AppError::NotFound(id.to_string()))?;
        drop(conn);

        let content = workspace::read_note(&self.root, id)?;
        search::reindex(&self.conn()?, id, title, &content)?;
        Ok(updated)
    }

    /// 删除：软删除元数据 + 移出索引。正文文件保留，供 Phase 3 同步与恢复。
    pub fn delete(&self, id: &str) -> AppResult<()> {
        // 先做 id 校验，非法 id 直接拒绝而不是静默返回成功。
        let _ = workspace::note_path(&self.root, id)?;

        let now = workspace::now_iso8601();
        let conn = self.conn()?;
        if docs::soft_delete(&conn, id, &now)? == 0 {
            return Err(AppError::NotFound(id.to_string()));
        }
        drop(conn);

        search::unindex(&self.conn()?, id)?;
        Ok(())
    }

    pub fn search(&self, query: &str, limit: i64) -> AppResult<Vec<search::SearchHit>> {
        search::search(&self.conn()?, query, limit).map_err(AppError::from)
    }
}

// ---- Tauri 命令层：只做参数转发与错误转换 ----

#[tauri::command]
pub fn list_documents(svc: tauri::State<'_, DocumentService>) -> AppResult<Vec<DocumentSummary>> {
    svc.list()
}

#[tauri::command]
pub fn create_document(
    svc: tauri::State<'_, DocumentService>,
    request: CreateDocumentRequest,
) -> AppResult<DocumentSummary> {
    svc.create(&request.title, &request.virtual_path)
}

#[tauri::command]
pub fn read_document(svc: tauri::State<'_, DocumentService>, id: String) -> AppResult<DocumentPayload> {
    svc.read(&id)
}

#[tauri::command]
pub fn save_document(
    svc: tauri::State<'_, DocumentService>,
    id: String,
    content: String,
) -> AppResult<DocumentSummary> {
    svc.save(&id, &content)
}

#[tauri::command]
pub fn rename_document(
    svc: tauri::State<'_, DocumentService>,
    id: String,
    title: String,
) -> AppResult<DocumentSummary> {
    svc.rename(&id, &title)
}

#[tauri::command]
pub fn delete_document(svc: tauri::State<'_, DocumentService>, id: String) -> AppResult<()> {
    svc.delete(&id)
}

#[tauri::command]
pub fn search_documents(
    svc: tauri::State<'_, DocumentService>,
    query: String,
    limit: Option<i64>,
) -> AppResult<Vec<search::SearchHit>> {
    svc.search(&query, limit.unwrap_or(50))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn svc() -> (tempfile::TempDir, DocumentService) {
        let dir = tempfile::tempdir().unwrap();
        let s = DocumentService::new(dir.path().to_path_buf()).unwrap();
        (dir, s)
    }

    #[test]
    fn create_then_read_round_trips_through_service() {
        let (_d, svc) = svc();
        let created = svc.create("我的第一篇", "/").unwrap();
        assert_eq!(created.title, "我的第一篇");
        assert_eq!(created.revision, 1);
        assert_eq!(created.size, 0);

        let loaded = svc.read(&created.id).unwrap();
        assert_eq!(loaded.content, "");
        assert_eq!(loaded.summary.id, created.id);
    }

    #[test]
    fn create_writes_a_real_markdown_file() {
        let (d, svc) = svc();
        let created = svc.create("T", "/").unwrap();
        let path = workspace::note_path(d.path(), &created.id).unwrap();
        assert!(path.is_file(), "expected {} to exist", path.display());
    }

    #[test]
    fn create_rejects_blank_title() {
        let (_d, svc) = svc();
        assert!(matches!(svc.create("   ", "/"), Err(AppError::InvalidInput(_))));
        assert!(matches!(svc.create("", "/"), Err(AppError::InvalidInput(_))));
    }

    #[test]
    fn save_persists_content_to_disk_and_db() {
        let (d, svc) = svc();
        let doc = svc.create("T", "/").unwrap();
        let body = "# 标题\n\n内容 with unicode 🦀\n";

        let updated = svc.save(&doc.id, body).unwrap();
        assert_eq!(updated.revision, 2);
        assert_eq!(updated.size, body.len() as i64);
        assert!(updated.content_hash.starts_with("sha256:"));

        let on_disk = std::fs::read_to_string(workspace::note_path(d.path(), &doc.id).unwrap()).unwrap();
        assert_eq!(on_disk, body);
        assert_eq!(svc.read(&doc.id).unwrap().content, body);
    }

    #[test]
    fn save_indexes_content_for_search() {
        let (_d, svc) = svc();
        let doc = svc.create("T", "/").unwrap();
        svc.save(&doc.id, "并发编程与信道").unwrap();
        assert_eq!(svc.search("并发", 10).unwrap().len(), 1, "short CJK query");
        assert_eq!(svc.search("并发编程", 10).unwrap().len(), 1, "long CJK query");
    }

    #[test]
    fn save_on_missing_document_fails_without_creating_a_file() {
        let (d, svc) = svc();
        let ghost = workspace::new_document_id();
        assert!(matches!(svc.save(&ghost, "x"), Err(AppError::NotFound(_))));
        assert!(!workspace::note_path(d.path(), &ghost).unwrap().exists());
    }

    #[test]
    fn rename_keeps_id_and_file_name_stable() {
        let (d, svc) = svc();
        let doc = svc.create("旧标题", "/").unwrap();
        let before = workspace::note_path(d.path(), &doc.id).unwrap();
        svc.save(&doc.id, "body").unwrap();

        let renamed = svc.rename(&doc.id, "新标题").unwrap();
        assert_eq!(renamed.title, "新标题");
        assert_eq!(renamed.id, doc.id, "identity must not change");
        assert!(before.is_file(), "file name must not change on rename");
        assert_eq!(svc.read(&doc.id).unwrap().content, "body", "content preserved");
    }

    #[test]
    fn rename_updates_search_title() {
        let (_d, svc) = svc();
        let doc = svc.create("alpha", "/").unwrap();
        svc.rename(&doc.id, "beta").unwrap();
        assert_eq!(svc.search("beta", 10).unwrap().len(), 1);
    }

    #[test]
    fn rename_rejects_blank_title() {
        let (_d, svc) = svc();
        let doc = svc.create("T", "/").unwrap();
        assert!(matches!(svc.rename(&doc.id, "  "), Err(AppError::InvalidInput(_))));
        assert_eq!(svc.read(&doc.id).unwrap().summary.title, "T", "unchanged");
    }

    #[test]
    fn delete_hides_document_and_removes_it_from_search() {
        let (_d, svc) = svc();
        let doc = svc.create("T", "/").unwrap();
        svc.save(&doc.id, "并发编程").unwrap();

        svc.delete(&doc.id).unwrap();
        assert!(svc.list().unwrap().is_empty());
        assert!(matches!(svc.read(&doc.id), Err(AppError::NotFound(_))));
        assert!(svc.search("并发编程", 10).unwrap().is_empty());
        assert!(svc.search("并发", 10).unwrap().is_empty(), "like path too");
    }

    #[test]
    fn delete_is_idempotent_hostile_id_is_rejected() {
        let (_d, svc) = svc();
        let doc = svc.create("T", "/").unwrap();
        svc.delete(&doc.id).unwrap();
        assert!(matches!(svc.delete(&doc.id), Err(AppError::NotFound(_))));
        assert!(matches!(svc.delete("../../etc/passwd"), Err(AppError::InvalidId(_))));
    }

    #[test]
    fn malicious_ids_are_rejected_on_every_entry_point() {
        let (_d, svc) = svc();
        let evil = "../../../Windows/System32/config/SAM";
        assert!(matches!(svc.read(evil), Err(AppError::InvalidId(_))));
        assert!(matches!(svc.save(evil, "x"), Err(AppError::InvalidId(_))));
        assert!(matches!(svc.rename(evil, "x"), Err(AppError::InvalidId(_))));
        assert!(matches!(svc.delete(evil), Err(AppError::InvalidId(_))));
    }

    #[test]
    fn reopening_the_workspace_preserves_everything() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();

        let id = {
            let svc = DocumentService::new(root.clone()).unwrap();
            let doc = svc.create("持久化测试", "/Notes/").unwrap();
            svc.save(&doc.id, "# 内容\n\n重启后应仍在").unwrap();
            doc.id
        };

        let svc2 = DocumentService::new(root).unwrap();
        let list = svc2.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, id);
        assert_eq!(list[0].title, "持久化测试");
        assert_eq!(list[0].virtual_path, "/Notes/");
        assert_eq!(list[0].revision, 2);
        assert_eq!(svc2.read(&id).unwrap().content, "# 内容\n\n重启后应仍在");
    }

    #[test]
    fn list_is_empty_for_a_fresh_workspace() {
        let (_d, svc) = svc();
        assert!(svc.list().unwrap().is_empty());
    }
}
```

- [ ] **Step 4: 运行确认通过**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml commands::documents
```

预期：`15 passed`。

- [ ] **Step 5: 写模块声明**

创建 `src-tauri/src/commands/mod.rs`：

```rust
pub mod documents;
```

- [ ] **Step 6: 组装 lib.rs**

整个替换 `src-tauri/src/lib.rs`：

```rust
pub mod commands;
pub mod db;
pub mod error;
pub mod model;
pub mod workspace;

use commands::documents::DocumentService;

/// 解析工作区根目录：优先环境变量（便于测试与多工作区），
/// 否则用系统应用数据目录下的 `crab-md/workspace`。
fn resolve_workspace_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, Box<dyn std::error::Error>> {
    if let Ok(custom) = std::env::var("CRAB_MD_WORKSPACE") {
        if !custom.trim().is_empty() {
            return Ok(std::path::PathBuf::from(custom));
        }
    }

    use tauri::Manager;
    let base = app.path().app_data_dir()?;
    Ok(base.join("workspace"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = resolve_workspace_root(app.handle())?;
            let service = DocumentService::new(root)?;
            app.manage(service);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::documents::list_documents,
            commands::documents::create_document,
            commands::documents::read_document,
            commands::documents::save_document,
            commands::documents::rename_document,
            commands::documents::delete_document,
            commands::documents::search_documents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running crab-md");
}
```

- [ ] **Step 7: 让测试也能访问 documents 模块**

在 `src-tauri/src/commands/documents.rs` 顶部确认已有 `use crate::db::{self, documents as docs, search};`。因为 `DocumentService` 被 lib 与测试共用，无需额外改动。

- [ ] **Step 8: 全量跑一次 Rust 测试**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

预期：全部通过（约 54 个测试）。

- [ ] **Step 9: 提交**

```powershell
git add -A
git commit -m "feat(rust): add document service and Tauri command layer"
```

---

### Task T1.8: 前端类型与 API 封装

**Files:**
- Create: `src/types/document.ts`, `src/lib/api.ts`, `src/lib/api.test.ts`

- [ ] **Step 1: 写类型**

创建 `src/types/document.ts`：

```ts
/** 与 Rust `DocumentSummary` 对应（serde camelCase）。 */
export interface DocumentSummary {
  id: string;
  title: string;
  virtualPath: string;
  revision: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  size: number;
}

/** 与 Rust `DocumentPayload` 对应（summary 字段被 flatten）。 */
export interface DocumentPayload extends DocumentSummary {
  content: string;
}

/** 与 Rust `SearchHit` 对应。 */
export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
}

/** 服务端错误信封（ARCHITECTURE.md §16.1）。 */
export interface AppErrorShape {
  code: string;
  message: string;
}
```

- [ ] **Step 2: 写失败测试**

创建 `src/lib/api.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { toAppError } from "./api";

describe("toAppError", () => {
  it("recognises the machine-readable envelope", () => {
    const e = toAppError({ code: "NOT_FOUND", message: "document not found: x" });
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toContain("document not found");
  });

  it("falls back to a generic error for unknown shapes", () => {
    const e = toAppError("boom");
    expect(e.code).toBe("UNKNOWN");
    expect(e.message).toContain("boom");
  });

  it("handles null and undefined without throwing", () => {
    expect(toAppError(null).code).toBe("UNKNOWN");
    expect(toAppError(undefined).code).toBe("UNKNOWN");
  });

  it("surfaces Error instances", () => {
    expect(toAppError(new Error("nope")).message).toContain("nope");
  });
});
```

- [ ] **Step 3: 运行确认失败**

```powershell
npm test -- api
```

预期：失败，`toAppError is not a function`。

- [ ] **Step 4: 实现 API 封装**

创建 `src/lib/api.ts`。前端永远不拼路径、不碰文件系统，只调这些命令（`ARCHITECTURE.md` §19）：

```ts
import { invoke } from "@tauri-apps/api/core";
import type {
  AppErrorShape,
  DocumentPayload,
  DocumentSummary,
  SearchHit,
} from "../types/document";

/**
 * 把 Tauri 抛出的任意值归一成 `{ code, message }`。
 * Rust 侧序列化为稳定错误码，前端据此做分支，而不是匹配文案。
 */
export function toAppError(raw: unknown): AppErrorShape {
  if (raw && typeof raw === "object" && "code" in raw && "message" in raw) {
    const e = raw as AppErrorShape;
    return { code: String(e.code), message: String(e.message) };
  }
  if (raw instanceof Error) {
    return { code: "UNKNOWN", message: raw.message };
  }
  return { code: "UNKNOWN", message: String(raw ?? "unknown error") };
}

/** 统一的命令调用入口：错误一律转成带 code 的对象再抛。 */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw toAppError(raw);
  }
}

export const api = {
  listDocuments: () => call<DocumentSummary[]>("list_documents"),

  createDocument: (title: string, virtualPath = "/") =>
    call<DocumentSummary>("create_document", {
      request: { title, virtualPath },
    }),

  readDocument: (id: string) => call<DocumentPayload>("read_document", { id }),

  saveDocument: (id: string, content: string) =>
    call<DocumentSummary>("save_document", { id, content }),

  renameDocument: (id: string, title: string) =>
    call<DocumentSummary>("rename_document", { id, title }),

  deleteDocument: (id: string) => call<void>("delete_document", { id }),

  searchDocuments: (query: string, limit = 50) =>
    call<SearchHit[]>("search_documents", { query, limit }),
};
```

- [ ] **Step 5: 运行确认通过**

```powershell
npm test -- api
```

预期：`4 passed`。

- [ ] **Step 6: 提交**

```powershell
git add -A
git commit -m "feat(web): add typed document API wrapper"
```

---

### Task T1.9: Markdown 渲染与文件树纯函数

**Files:**
- Create: `src/lib/markdown.ts`, `src/lib/markdown.test.ts`
- Create: `src/lib/fileTree.ts`, `src/lib/fileTree.test.ts`

两个纯函数模块，先测后写，与 UI 解耦。

- [ ] **Step 1: 写 markdown 的失败测试**

创建 `src/lib/markdown.test.ts`。安全要求见 `ARCHITECTURE.md` §19（渲染 HTML 必须消毒）与 `UI_DESIGN_SYSTEM.md` §22：

```ts
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders basic markdown structure", () => {
    const html = renderMarkdown("# Title\n\nSome *text*.");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain("<em>text</em>");
  });

  it("renders tables", () => {
    const html = renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<table>");
  });

  it("renders fenced code blocks", () => {
    const html = renderMarkdown("```js\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
  });

  it("renders Chinese content correctly", () => {
    expect(renderMarkdown("## 中文标题")).toContain("中文标题");
  });

  it("strips script tags from raw HTML", () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert");
  });

  it("strips inline event handlers", () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)">');
    expect(html).not.toContain("onerror");
  });

  it("strips javascript: URLs", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("strips iframes", () => {
    expect(renderMarkdown('<iframe src="https://evil.test"></iframe>')).not.toContain("<iframe");
  });

  it("handles empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```powershell
npm test -- markdown
```

预期：失败，无法解析 `./markdown`。

- [ ] **Step 3: 实现 markdown 渲染**

创建 `src/lib/markdown.ts`：

```ts
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: true,       // 允许 Markdown 中内嵌 HTML……
  linkify: true,
  breaks: false,
  typographer: false,
});

/**
 * 渲染 Markdown 为可安全插入 DOM 的 HTML。
 *
 * `html: true` 是必要的（用户可能写表格/居中标签），但同步内容是不可信输入
 * （ARCHITECTURE.md §19），因此**必须**经 DOMPurify 消毒后再返回，
 * 移除 <script>、内联事件处理器、javascript: URL 等。
 */
export function renderMarkdown(source: string): string {
  if (!source || !source.trim()) {
    return "";
  }
  const raw = md.render(source);
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "style"],
  });
}
```

- [ ] **Step 4: 运行确认通过**

```powershell
npm test -- markdown
```

预期：`9 passed`。

- [ ] **Step 5: 写 fileTree 的失败测试**

创建 `src/lib/fileTree.test.ts`。`UI_DESIGN_SYSTEM.md` §18 要求文件树展示文件夹与文档：

```ts
import { describe, expect, it } from "vitest";
import { buildFileTree } from "./fileTree";
import type { DocumentSummary } from "../types/document";

function doc(id: string, title: string, virtualPath: string): DocumentSummary {
  return {
    id, title, virtualPath, revision: 1,
    contentHash: "sha256:x",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    size: 0,
  };
}

describe("buildFileTree", () => {
  it("returns no nodes for an empty list", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("places root-level documents at the top level", () => {
    const tree = buildFileTree([doc("1", "A", "/")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("document");
    expect(tree[0].name).toBe("A");
  });

  it("creates nested folders from the virtual path", () => {
    const tree = buildFileTree([doc("1", "A", "/Development/Go/")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("folder");
    expect(tree[0].name).toBe("Development");

    const go = tree[0].children![0];
    expect(go.name).toBe("Go");
    expect(go.children![0].name).toBe("A");
    expect(go.children![0].documentId).toBe("1");
  });

  it("groups documents that share a folder", () => {
    const tree = buildFileTree([
      doc("1", "A", "/Notes/"),
      doc("2", "B", "/Notes/"),
    ]);
    expect(tree[0].children).toHaveLength(2);
  });

  it("sorts folders before documents, then alphabetically", () => {
    const tree = buildFileTree([
      doc("1", "zebra", "/"),
      doc("2", "apple", "/"),
      doc("3", "deep", "/Folder/"),
    ]);
    expect(tree.map((n) => n.type)).toEqual(["folder", "document", "document"]);
    expect(tree[1].name).toBe("apple");
    expect(tree[2].name).toBe("zebra");
  });

  it("tolerates paths without leading or trailing slashes", () => {
    expect(buildFileTree([doc("1", "A", "Notes")])[0].name).toBe("Notes");
  });

  it("ignores empty path segments", () => {
    const tree = buildFileTree([doc("1", "A", "//Notes//")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Notes");
  });

  it("keeps folder nodes stable across multiple documents in nested paths", () => {
    const tree = buildFileTree([
      doc("1", "A", "/a/b/c/"),
      doc("2", "B", "/a/b/"),
    ]);
    const b = tree[0].children![0];
    expect(b.name).toBe("b");
    const names = b.children!.map((n) => n.name);
    expect(names).toContain("c");
    expect(names).toContain("B");
  });
});
```

- [ ] **Step 6: 运行确认失败**

```powershell
npm test -- fileTree
```

预期：失败，无法解析 `./fileTree`。

- [ ] **Step 7: 实现 fileTree**

创建 `src/lib/fileTree.ts`：

```ts
import type { DocumentSummary } from "../types/document";

export interface TreeNode {
  /** 树节点稳定标识：文件夹用完整虚拟路径，文档用文档 id。 */
  key: string;
  name: string;
  type: "folder" | "document";
  /** 仅文档节点有值。 */
  documentId?: string;
  children?: TreeNode[];
}

/** 把 `/a/b/` 拆成 `["a","b"]`，忽略空段。 */
function splitPath(virtualPath: string): string[] {
  return virtualPath.split("/").filter((s) => s.length > 0);
}

/**
 * 由扁平文档列表构建文件树。
 *
 * 纯函数、无副作用：相同输入必得相同输出，因此可直接单测。
 * 排序规则：文件夹在前，其后同类按名称不区分大小写升序
 * （与 UI_DESIGN_SYSTEM.md §18 的资源管理器式阅读习惯一致）。
 */
export function buildFileTree(documents: DocumentSummary[]): TreeNode[] {
  const rootChildren: TreeNode[] = [];
  const folderIndex = new Map<string, TreeNode>();

  for (const doc of documents) {
    const segments = splitPath(doc.virtualPath);
    let siblings = rootChildren;
    let pathSoFar = "";

    for (const segment of segments) {
      pathSoFar += `/${segment}`;
      let folder = folderIndex.get(pathSoFar);
      if (!folder) {
        folder = { key: pathSoFar, name: segment, type: "folder", children: [] };
        folderIndex.set(pathSoFar, folder);
        siblings.push(folder);
      }
      siblings = folder.children!;
    }

    siblings.push({
      key: doc.id,
      name: doc.title,
      type: "document",
      documentId: doc.id,
    });
  }

  sortTree(rootChildren);
  return rootChildren;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const node of nodes) {
    if (node.children) {
      sortTree(node.children);
    }
  }
}
```

- [ ] **Step 8: 运行确认通过**

```powershell
npm test -- fileTree
```

预期：`8 passed`。

- [ ] **Step 9: 提交**

```powershell
git add -A
git commit -m "feat(web): add sanitised markdown rendering and file tree builder"
```

---

### Task T1.10: 设计系统基础组件

**Files:**
- Create: `src/components/ui/Button.tsx`, `src/components/ui/Input.tsx`
- Create: `src/components/ui/EmptyState.tsx`, `src/components/ui/Spinner.tsx`
- Create: `src/components/ui/ui.css`
- Create: `src/components/ui/Button.test.tsx`

`UI_DESIGN_SYSTEM.md` §14（按钮变体/尺寸/状态）、§15（输入状态）、§32（空态）、§37（语义化 props 而非样式开关）。

- [ ] **Step 1: 写按钮的失败测试**

创建 `src/components/ui/Button.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its label and is clickable", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies the requested variant and size as data attributes", () => {
    render(<Button variant="danger" size="lg">Delete</Button>);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn).toHaveAttribute("data-variant", "danger");
    expect(btn).toHaveAttribute("data-size", "lg");
  });

  it("blocks clicks while loading", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("marks itself busy for assistive tech while loading", () => {
    render(<Button loading>Saving</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });

  it("does not fire clicks when disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>No</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to secondary/md", () => {
    render(<Button>Plain</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-variant", "secondary");
    expect(btn).toHaveAttribute("data-size", "md");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```powershell
npm test -- Button
```

预期：失败，无法解析 `./Button`。

- [ ] **Step 3: 实现 Button**

创建 `src/components/ui/Button.tsx`：

```tsx
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";
import "./ui.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 进行中：显示 spinner、禁用点击，避免重复提交（UI §14.4）。 */
  loading?: boolean;
  children: ReactNode;
}

/**
 * 语义化按钮。样式全部由 data-variant / data-size 经 CSS 令牌控制，
 * 调用方不传颜色/尺寸数值（UI_DESIGN_SYSTEM.md §37）。
 */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className="ui-button"
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner size={14} />}
      <span>{children}</span>
    </button>
  );
}
```

- [ ] **Step 4: 实现 Spinner**

创建 `src/components/ui/Spinner.tsx`：

```tsx
import "./ui.css";

export interface SpinnerProps {
  size?: number;
  /** 图标旁边的小 spinner 不需要重复朗读。 */
  label?: string;
}

export function Spinner({ size = 16, label }: SpinnerProps) {
  return (
    <span
      className="ui-spinner"
      style={{ width: size, height: size }}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
```

- [ ] **Step 5: 运行确认通过**

```powershell
npm test -- Button
```

预期：`6 passed`。

- [ ] **Step 6: 实现 Input、EmptyState 与样式**

创建 `src/components/ui/Input.tsx`：

```tsx
import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import "./ui.css";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** 辅助说明；与 error 互斥显示。 */
  hint?: string;
  error?: string;
}

/**
 * 带标签的输入框。标签始终可见 —— 占位符不得作为唯一标签
 * （UI_DESIGN_SYSTEM.md §15）。
 */
export function Input({ label, hint, error, id, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        className="ui-input"
        data-invalid={error ? true : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {error ? (
        <p className="ui-field__error" id={`${inputId}-error`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="ui-field__hint" id={`${inputId}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
```

创建 `src/components/ui/EmptyState.tsx`：

```tsx
import type { ReactNode } from "react";
import "./ui.css";

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** 建议的主操作，例如「新建笔记」。 */
  action?: ReactNode;
}

/** 空态（UI_DESIGN_SYSTEM.md §32）。 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      <p className="ui-empty__title">{title}</p>
      {description && <p className="ui-empty__description">{description}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
```

创建 `src/components/ui/ui.css`：

```css
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-family: inherit;
  font-weight: 500;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background-color var(--duration-fast) ease,
    border-color var(--duration-fast) ease;
}

.ui-button[data-size="sm"] { height: 28px; padding: 0 var(--space-3); font-size: var(--text-sm); }
.ui-button[data-size="md"] { height: 34px; padding: 0 var(--space-4); font-size: var(--text-md); }
.ui-button[data-size="lg"] { height: 40px; padding: 0 var(--space-5); font-size: var(--text-lg); }

.ui-button[data-variant="primary"] { background: var(--accent); color: var(--text-inverse); }
.ui-button[data-variant="primary"]:hover:not(:disabled) { background: var(--accent-hover); }
.ui-button[data-variant="primary"]:active:not(:disabled) { background: var(--accent-active); }

.ui-button[data-variant="secondary"] {
  background: var(--bg-surface);
  color: var(--text-primary);
  border-color: var(--border-default);
}
.ui-button[data-variant="secondary"]:hover:not(:disabled) { background: var(--bg-surface-hover); }

.ui-button[data-variant="ghost"] { background: transparent; color: var(--text-secondary); }
.ui-button[data-variant="ghost"]:hover:not(:disabled) {
  background: var(--bg-surface-hover);
  color: var(--text-primary);
}

.ui-button[data-variant="danger"] { background: var(--danger); color: var(--text-inverse); }
.ui-button[data-variant="danger"]:hover:not(:disabled) { filter: brightness(0.92); }

.ui-button:disabled { opacity: 0.5; cursor: not-allowed; }

.ui-field { display: flex; flex-direction: column; gap: var(--space-1); }
.ui-field__label { font-size: var(--text-sm); color: var(--text-secondary); }
.ui-field__hint { margin: 0; font-size: var(--text-xs); color: var(--text-muted); }
.ui-field__error { margin: 0; font-size: var(--text-xs); color: var(--danger); }

.ui-input {
  height: 34px;
  padding: 0 var(--space-3);
  font-family: inherit;
  font-size: var(--text-md);
  color: var(--text-primary);
  background: var(--bg-app);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  transition: border-color var(--duration-fast) ease;
}
.ui-input:hover { border-color: var(--border-strong); }
.ui-input:focus { outline: none; border-color: var(--border-focus); }
.ui-input[data-invalid] { border-color: var(--danger); }
.ui-input:disabled { background: var(--bg-surface); color: var(--text-disabled); cursor: not-allowed; }

.ui-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-8) var(--space-4);
  text-align: center;
}
.ui-empty__title { margin: 0; font-size: var(--text-md); color: var(--text-secondary); }
.ui-empty__description { margin: 0; font-size: var(--text-sm); color: var(--text-muted); }
.ui-empty__action { margin-top: var(--space-2); }

.ui-spinner {
  display: inline-block;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: var(--radius-full);
  animation: ui-spin 600ms linear infinite;
}

@keyframes ui-spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 7: 全量跑前端测试**

```powershell
npm test
```

预期：全部通过。

- [ ] **Step 8: 提交**

```powershell
git add -A
git commit -m "feat(ui): add Button, Input, EmptyState, Spinner primitives"
```

---

### Task T1.11: 工作区状态仓库

**Files:**
- Create: `src/stores/useWorkspaceStore.ts`, `src/stores/useWorkspaceStore.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/stores/useWorkspaceStore.test.ts`。用假的 `api` 注入，不触碰真实 Tauri：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const listDocuments = vi.fn();
const createDocument = vi.fn();
const readDocument = vi.fn();
const saveDocument = vi.fn();
const renameDocument = vi.fn();
const deleteDocument = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    createDocument: (...a: unknown[]) => createDocument(...a),
    readDocument: (...a: unknown[]) => readDocument(...a),
    saveDocument: (...a: unknown[]) => saveDocument(...a),
    renameDocument: (...a: unknown[]) => renameDocument(...a),
    deleteDocument: (...a: unknown[]) => deleteDocument(...a),
  },
}));

import { useWorkspaceStore } from "./useWorkspaceStore";

function summary(id: string, title = "T") {
  return {
    id, title, virtualPath: "/", revision: 1,
    contentHash: "sha256:x",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    size: 0,
  };
}

describe("useWorkspaceStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false,
    });
  });

  it("loads documents", async () => {
    listDocuments.mockResolvedValue([summary("1")]);
    await useWorkspaceStore.getState().loadDocuments();
    expect(useWorkspaceStore.getState().documents).toHaveLength(1);
    expect(useWorkspaceStore.getState().loading).toBe(false);
  });

  it("records an error code when loading fails", async () => {
    listDocuments.mockRejectedValue({ code: "DB_ERROR", message: "boom" });
    await useWorkspaceStore.getState().loadDocuments();
    expect(useWorkspaceStore.getState().error).toBe("DB_ERROR");
    expect(useWorkspaceStore.getState().loading).toBe(false);
  });

  it("opens a document and marks it clean", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "# hi" });
    await useWorkspaceStore.getState().openDocument("1");
    const s = useWorkspaceStore.getState();
    expect(s.activeId).toBe("1");
    expect(s.activeContent).toBe("# hi");
    expect(s.dirty).toBe(false);
  });

  it("creates a document and opens it", async () => {
    createDocument.mockResolvedValue(summary("9", "New"));
    await useWorkspaceStore.getState().createDocument("New");
    const s = useWorkspaceStore.getState();
    expect(createDocument).toHaveBeenCalledWith("New", "/");
    expect(s.activeId).toBe("9");
  });

  it("marks dirty on edit and clears it on save", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "old" });
    saveDocument.mockResolvedValue(summary("1"));
    await useWorkspaceStore.getState().openDocument("1");

    useWorkspaceStore.getState().setContent("new");
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    expect(useWorkspaceStore.getState().activeContent).toBe("new");

    await useWorkspaceStore.getState().saveActive();
    expect(saveDocument).toHaveBeenCalledWith("1", "new");
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });

  it("renames and refreshes the list", async () => {
    renameDocument.mockResolvedValue(summary("1", "Renamed"));
    listDocuments.mockResolvedValue([summary("1", "Renamed")]);
    await useWorkspaceStore.getState().renameDocument("1", "Renamed");
    expect(useWorkspaceStore.getState().documents[0].title).toBe("Renamed");
  });

  it("clears the active document when the open one is deleted", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "x" });
    deleteDocument.mockResolvedValue(undefined);
    listDocuments.mockResolvedValue([]);
    await useWorkspaceStore.getState().openDocument("1");

    await useWorkspaceStore.getState().deleteDocument("1");
    const s = useWorkspaceStore.getState();
    expect(s.activeId).toBeNull();
    expect(s.activeContent).toBe("");
  });

  it("keeps the active document when a different one is deleted", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "x" });
    deleteDocument.mockResolvedValue(undefined);
    listDocuments.mockResolvedValue([summary("1")]);
    await useWorkspaceStore.getState().openDocument("1");

    await useWorkspaceStore.getState().deleteDocument("2");
    expect(useWorkspaceStore.getState().activeId).toBe("1");
  });
});
```

- [ ] **Step 2: 运行确认失败**

```powershell
npm test -- useWorkspaceStore
```

预期：失败，无法解析 `./useWorkspaceStore`。

- [ ] **Step 3: 实现状态仓库**

创建 `src/stores/useWorkspaceStore.ts`：

```ts
import { create } from "zustand";
import { api, toAppError } from "../lib/api";
import type { DocumentSummary } from "../types/document";

export interface WorkspaceState {
  documents: DocumentSummary[];
  activeId: string | null;
  activeContent: string;
  /** 有未保存改动。用于关闭提示与状态栏（UI §26）。 */
  dirty: boolean;
  loading: boolean;
  /** 稳定错误码，供 UI 分支显示；null 表示无错误。 */
  error: string | null;

  loadDocuments: () => Promise<void>;
  openDocument: (id: string) => Promise<void>;
  createDocument: (title: string, virtualPath?: string) => Promise<void>;
  renameDocument: (id: string, title: string) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  saveActive: () => Promise<void>;
  setContent: (content: string) => void;
  clearError: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  documents: [],
  activeId: null,
  activeContent: "",
  dirty: false,
  loading: false,
  error: null,

  loadDocuments: async () => {
    set({ loading: true, error: null });
    try {
      set({ documents: await api.listDocuments(), loading: false });
    } catch (raw) {
      set({ error: toAppError(raw).code, loading: false });
    }
  },

  openDocument: async (id) => {
    set({ error: null });
    try {
      const doc = await api.readDocument(id);
      set({ activeId: doc.id, activeContent: doc.content, dirty: false });
    } catch (raw) {
      set({ error: toAppError(raw).code });
    }
  },

  createDocument: async (title, virtualPath = "/") => {
    set({ error: null });
    try {
      const created = await api.createDocument(title, virtualPath);
      set({ activeId: created.id, activeContent: "", dirty: false });
      await get().loadDocuments();
    } catch (raw) {
      set({ error: toAppError(raw).code });
    }
  },

  renameDocument: async (id, title) => {
    set({ error: null });
    try {
      await api.renameDocument(id, title);
      await get().loadDocuments();
    } catch (raw) {
      set({ error: toAppError(raw).code });
    }
  },

  deleteDocument: async (id) => {
    set({ error: null });
    try {
      await api.deleteDocument(id);
      // 删掉的正是当前打开的文档时清空编辑器，否则保持编辑状态不受影响。
      if (get().activeId === id) {
        set({ activeId: null, activeContent: "", dirty: false });
      }
      await get().loadDocuments();
    } catch (raw) {
      set({ error: toAppError(raw).code });
    }
  },

  saveActive: async () => {
    const { activeId, activeContent } = get();
    if (!activeId) return;
    set({ error: null });
    try {
      await api.saveDocument(activeId, activeContent);
      set({ dirty: false });
      await get().loadDocuments();
    } catch (raw) {
      set({ error: toAppError(raw).code });
    }
  },

  setContent: (content) => set({ activeContent: content, dirty: true }),
  clearError: () => set({ error: null }),
}));
```

- [ ] **Step 4: 运行确认通过**

```powershell
npm test -- useWorkspaceStore
```

预期：`8 passed`。

- [ ] **Step 5: 提交**

```powershell
git add -A
git commit -m "feat(web): add workspace state store"
```

---

### Task T1.12: 编辑器、预览与文件树组件

**Files:**
- Create: `src/components/editor/MarkdownEditor.tsx`, `src/components/editor/MarkdownPreview.tsx`
- Create: `src/components/editor/EditorStatusBar.tsx`, `src/components/workspace/FileTree.tsx`
- Create: `src/components/workspace/FileTree.test.tsx`

- [ ] **Step 1: 写 FileTree 的失败测试**

创建 `src/components/workspace/FileTree.test.tsx`。覆盖 `UI_DESIGN_SYSTEM.md` §18 的选择态与空态：

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";
import type { DocumentSummary } from "../../types/document";

function doc(id: string, title: string, virtualPath = "/"): DocumentSummary {
  return {
    id, title, virtualPath, revision: 1,
    contentHash: "sha256:x",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    size: 0,
  };
}

describe("FileTree", () => {
  it("shows an empty state with a create action when there are no notes", () => {
    render(<FileTree documents={[]} activeId={null} onSelect={() => {}} onCreate={() => {}} />);
    expect(screen.getByText("No notes yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new note/i })).toBeInTheDocument();
  });

  it("renders documents as tree items", () => {
    render(
      <FileTree documents={[doc("1", "Go Basics")]} activeId={null} onSelect={() => {}} onCreate={() => {}} />,
    );
    expect(screen.getByText("Go Basics")).toBeInTheDocument();
  });

  it("calls onSelect with the document id", async () => {
    const onSelect = vi.fn();
    render(
      <FileTree documents={[doc("42", "Notes")]} activeId={null} onSelect={onSelect} onCreate={() => {}} />,
    );
    await userEvent.click(screen.getByText("Notes"));
    expect(onSelect).toHaveBeenCalledWith("42");
  });

  it("marks the active document as selected", () => {
    render(
      <FileTree documents={[doc("1", "Active")]} activeId="1" onSelect={() => {}} onCreate={() => {}} />,
    );
    expect(screen.getByRole("treeitem", { name: /Active/ })).toHaveAttribute("aria-selected", "true");
  });

  it("creates a document from the empty state button", async () => {
    const onCreate = vi.fn();
    render(<FileTree documents={[]} activeId={null} onSelect={() => {}} onCreate={onCreate} />);
    await userEvent.click(screen.getByRole("button", { name: /new note/i }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("nests documents under their folder", () => {
    render(
      <FileTree
        documents={[doc("1", "Deep", "/Folder/")]}
        activeId={null}
        onSelect={() => {}}
        onCreate={() => {}}
      />,
    );
    expect(screen.getByText("Folder")).toBeInTheDocument();
    expect(screen.getByText("Deep")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```powershell
npm test -- FileTree
```

预期：失败，无法解析 `./FileTree`。

- [ ] **Step 3: 实现 FileTree**

创建 `src/components/workspace/FileTree.tsx`。用扁平渲染 + `role="tree"`，保证可访问性与键盘可达：

```tsx
import { useMemo } from "react";
import { FileText, Folder, Plus } from "lucide-react";
import { buildFileTree, type TreeNode } from "../../lib/fileTree";
import type { DocumentSummary } from "../../types/document";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import "./workspace.css";

export interface FileTreeProps {
  documents: DocumentSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function FileTree({ documents, activeId, onSelect, onCreate }: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(documents), [documents]);

  if (documents.length === 0) {
    return (
      <EmptyState
        title="No notes yet"
        description="Create your first Markdown document."
        action={
          <Button variant="primary" size="sm" onClick={onCreate}>
            <Plus size={14} />
            New note
          </Button>
        }
      />
    );
  }

  return (
    <div className="file-tree" role="tree" aria-label="Notes">
      {tree.map((node) => (
        <TreeItem key={node.key} node={node} activeId={activeId} onSelect={onSelect} depth={0} />
      ))}
    </div>
  );
}

interface TreeItemProps {
  node: TreeNode;
  activeId: string | null;
  onSelect: (id: string) => void;
  depth: number;
}

function TreeItem({ node, activeId, onSelect, depth }: TreeItemProps) {
  if (node.type === "folder") {
    return (
      <div className="file-tree__group">
        <div className="file-tree__folder" style={{ paddingLeft: depth * 12 + 8 }}>
          <Folder size={14} aria-hidden />
          <span>{node.name}</span>
        </div>
        {node.children?.map((child) => (
          <TreeItem
            key={child.key}
            node={child}
            activeId={activeId}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ))}
      </div>
    );
  }

  const selected = node.documentId === activeId;
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={selected}
      className="file-tree__item"
      data-selected={selected || undefined}
      style={{ paddingLeft: depth * 12 + 8 }}
      onClick={() => node.documentId && onSelect(node.documentId)}
    >
      <FileText size={14} aria-hidden />
      <span className="file-tree__label">{node.name}</span>
    </button>
  );
}
```

创建 `src/components/workspace/workspace.css`：

```css
.file-tree {
  display: flex;
  flex-direction: column;
  padding: var(--space-1) 0;
  overflow-y: auto;
}

.file-tree__folder {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 26px;
  font-size: var(--text-sm);
  color: var(--text-muted);
  user-select: none;
}

.file-tree__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  height: 28px;
  padding-right: var(--space-2);
  font-family: inherit;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  text-align: left;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.file-tree__item:hover { background: var(--bg-surface-hover); color: var(--text-primary); }

/* 选中态用背景 + 左侧强调条，不只靠颜色（UI §39）。 */
.file-tree__item[data-selected] {
  background: var(--accent-soft);
  color: var(--text-primary);
  font-weight: 500;
  box-shadow: inset 2px 0 0 var(--accent);
}

.file-tree__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: 运行确认通过**

```powershell
npm test -- FileTree
```

预期：`6 passed`。

- [ ] **Step 5: 实现 MarkdownEditor（CodeMirror 6）**

创建 `src/components/editor/MarkdownEditor.tsx`。主题经 CSS 变量注入，不硬编码颜色（`UI_DESIGN_SYSTEM.md` §20）：

```tsx
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { useEffect, useRef } from "react";
import "./editor.css";

export interface MarkdownEditorProps {
  /** 当前文档 id；切换文档时重建编辑器状态。 */
  documentId: string | null;
  value: string;
  onChange: (value: string) => void;
  /** Ctrl+S 回调，用于立即落盘。 */
  onSave?: () => void;
}

/** 让 CodeMirror 读取应用主题令牌，避免出现与外壳无关的配色。 */
const appTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--text-md)",
    backgroundColor: "var(--bg-app)",
    color: "var(--text-primary)",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    lineHeight: "var(--leading-prose)",
    padding: "var(--space-4) 0",
  },
  ".cm-scroller": { overflow: "auto" },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": {
    backgroundColor: "var(--bg-app)",
    color: "var(--text-muted)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--bg-surface)" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--selection-bg)" },
});

export function MarkdownEditor({ documentId, value, onChange, onSave }: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // 用 ref 持有最新回调，避免每次渲染都重建编辑器。
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          markdown(),
          EditorView.lineWrapping,
          appTheme,
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 仅在切换文档时重建；value 变化走下面的同步分支。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  // 外部内容变化（例如切换文档后打开）时同步进编辑器。
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return <div className="markdown-editor" ref={hostRef} data-testid="markdown-editor" />;
}
```

- [ ] **Step 6: 实现 MarkdownPreview 与 EditorStatusBar**

创建 `src/components/editor/MarkdownPreview.tsx`：

```tsx
import { useMemo } from "react";
import { renderMarkdown } from "../../lib/markdown";
import "./editor.css";

export interface MarkdownPreviewProps {
  source: string;
}

export function MarkdownPreview({ source }: MarkdownPreviewProps) {
  // renderMarkdown 已内置 HTML 消毒（ARCHITECTURE.md §19）。
  const html = useMemo(() => renderMarkdown(source), [source]);

  if (!html) {
    return <div className="markdown-preview markdown-preview--empty">Nothing to preview yet.</div>;
  }

  return (
    <div
      className="markdown-preview"
      // 内容已由 DOMPurify 消毒，见 lib/markdown.ts。
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

创建 `src/components/editor/EditorStatusBar.tsx`：

```tsx
import "./editor.css";

export interface EditorStatusBarProps {
  /** 未保存标记；正常状态保持安静（UI §26.1）。 */
  dirty: boolean;
  line: number;
  column: number;
  path: string;
}

export function EditorStatusBar({ dirty, line, column, path }: EditorStatusBarProps) {
  return (
    <div className="editor-status">
      <span className="editor-status__path">{path}</span>
      <span className="editor-status__spacer" />
      <span>Ln {line}, Col {column}</span>
      <span>Markdown</span>
      <span>UTF-8</span>
      <span data-dirty={dirty || undefined}>{dirty ? "Unsaved" : "Saved"}</span>
    </div>
  );
}
```

创建 `src/components/editor/editor.css`：

```css
.markdown-editor { flex: 1; min-height: 0; overflow: hidden; }
.markdown-editor .cm-editor { height: 100%; }

.markdown-preview {
  flex: 1;
  min-height: 0;
  padding: var(--space-6) var(--space-8);
  overflow-y: auto;
  line-height: var(--leading-prose);
  color: var(--text-primary);
}

/* 长文可读性：限制内容宽度（UI §22）。 */
.markdown-preview > * { max-width: 72ch; }

.markdown-preview--empty { color: var(--text-muted); }

.markdown-preview h1, .markdown-preview h2, .markdown-preview h3 {
  margin: var(--space-6) 0 var(--space-3);
  line-height: var(--leading-normal);
}
.markdown-preview h1 { font-size: var(--text-2xl); margin-top: 0; }
.markdown-preview h2 { font-size: var(--text-xl); }
.markdown-preview h3 { font-size: var(--text-lg); }

.markdown-preview p { margin: 0 0 var(--space-4); }

.markdown-preview a { color: var(--accent); }

.markdown-preview code {
  padding: 2px 5px;
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--bg-surface-active);
  border-radius: var(--radius-sm);
}

.markdown-preview pre {
  padding: var(--space-4);
  overflow-x: auto;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}
.markdown-preview pre code { padding: 0; background: none; }

.markdown-preview blockquote {
  margin: 0 0 var(--space-4);
  padding-left: var(--space-4);
  color: var(--text-secondary);
  border-left: 3px solid var(--border-default);
}

/* 窄屏表格横向滚动而非撑破布局（UI §22）。 */
.markdown-preview table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}
.markdown-preview th, .markdown-preview td {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border-subtle);
}

.markdown-preview img { max-width: 100%; height: auto; }

.editor-status {
  display: flex;
  gap: var(--space-4);
  align-items: center;
  height: 24px;
  padding: 0 var(--space-4);
  font-size: var(--text-xs);
  color: var(--text-muted);
  background: var(--bg-surface);
  border-top: 1px solid var(--border-subtle);
}
.editor-status__path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.editor-status__spacer { flex: 1; }
.editor-status [data-dirty] { color: var(--warning); }
```

- [ ] **Step 7: 运行前端测试**

```powershell
npm test
```

预期：全部通过。

- [ ] **Step 8: 提交**

```powershell
git add -A
git commit -m "feat(editor): add CodeMirror editor, sanitised preview and file tree"
```

---

### Task T1.13: 桌面三区布局与交互接线

**Files:**
- Create: `src/components/workspace/AppToolbar.tsx`, `src/components/workspace/Sidebar.tsx`, `src/App.tsx`(替换)
- Create: `src/App.test.tsx`

布局依据 `UI_DESIGN_SYSTEM.md` §11（桌面三区、编辑器为主）；快捷键依据 §29。

- [ ] **Step 1: 写 App 的失败测试**

创建 `src/App.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listDocuments = vi.fn();
vi.mock("./lib/api", () => ({
  api: {
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    createDocument: vi.fn(),
    readDocument: vi.fn(),
    saveDocument: vi.fn(),
    renameDocument: vi.fn(),
    deleteDocument: vi.fn(),
  },
  toAppError: (raw: unknown) =>
    raw && typeof raw === "object" && "code" in raw
      ? raw
      : { code: "UNKNOWN", message: String(raw) },
}));

import App from "./App";

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDocuments.mockResolvedValue([]);
  });

  it("renders the toolbar, sidebar and editor regions", async () => {
    render(<App />);
    expect(await screen.findByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("loads documents on mount", async () => {
    render(<App />);
    await screen.findByRole("tree", { name: /notes/i }).catch(() => null);
    expect(listDocuments).toHaveBeenCalled();
  });

  it("shows the empty state when there are no notes", async () => {
    render(<App />);
    expect(await screen.findByText("No notes yet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```powershell
npm test -- App.test
```

预期：失败（`App` 仍是模板内容，没有这些 role）。

- [ ] **Step 3: 实现 AppToolbar**

创建 `src/components/workspace/AppToolbar.tsx`：

```tsx
import { PanelLeft, Plus, Search } from "lucide-react";
import { Button } from "../ui/Button";
import "./workspace.css";

export interface AppToolbarProps {
  onNewDocument: () => void;
  onToggleSidebar: () => void;
  sidebarVisible: boolean;
}

/** 顶部工具栏。视觉安静，不与编辑器争主体（UI §2.1）。 */
export function AppToolbar({ onNewDocument, onToggleSidebar, sidebarVisible }: AppToolbarProps) {
  return (
    <header className="app-toolbar" role="banner">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleSidebar}
        aria-pressed={sidebarVisible}
        title="Toggle sidebar"
      >
        <PanelLeft size={16} />
        <span className="sr-only">Toggle sidebar</span>
      </Button>

      <span className="app-toolbar__title">crab-md</span>

      <span className="app-toolbar__spacer" />

      <Button variant="ghost" size="sm" title="Search (Ctrl+Shift+F)" disabled>
        <Search size={16} />
        <span className="sr-only">Search</span>
      </Button>

      <Button variant="primary" size="sm" onClick={onNewDocument} title="New document (Ctrl+N)">
        <Plus size={14} />
        New
      </Button>
    </header>
  );
}
```

- [ ] **Step 4: 实现 Sidebar**

创建 `src/components/workspace/Sidebar.tsx`：

```tsx
import { FileTree } from "./FileTree";
import type { DocumentSummary } from "../../types/document";
import "./workspace.css";

export interface SidebarProps {
  documents: DocumentSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function Sidebar({ documents, activeId, onSelect, onCreate }: SidebarProps) {
  return (
    <aside className="app-sidebar" role="complementary" aria-label="Workspace">
      <div className="app-sidebar__header">Notes</div>
      <FileTree documents={documents} activeId={activeId} onSelect={onSelect} onCreate={onCreate} />
    </aside>
  );
}
```

- [ ] **Step 5: 实现 App 装配**

整个替换 `src/App.tsx`：

```tsx
import { useCallback, useEffect, useState } from "react";
import { MarkdownEditor } from "./components/editor/MarkdownEditor";
import { EditorStatusBar } from "./components/editor/EditorStatusBar";
import { MarkdownPreview } from "./components/editor/MarkdownPreview";
import { AppToolbar } from "./components/workspace/AppToolbar";
import { Sidebar } from "./components/workspace/Sidebar";
import { EmptyState } from "./components/ui/EmptyState";
import { Button } from "./components/ui/Button";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewDocument, saveActive]);

  const activeTitle = documents.find((d) => d.id === activeId)?.title ?? "";

  return (
    <div className="app-shell" data-sidebar={sidebarVisible || undefined}>
      <AppToolbar
        onNewDocument={handleNewDocument}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        sidebarVisible={sidebarVisible}
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
```

- [ ] **Step 6: 实现 App 布局样式**

创建 `src/App.css`：

```css
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-app);
}

.app-toolbar {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  height: 40px;
  padding: 0 var(--space-3);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
}
.app-toolbar__title { font-size: var(--text-sm); font-weight: 600; color: var(--text-secondary); }
.app-toolbar__spacer { flex: 1; }

.app-body { display: flex; flex: 1; min-height: 0; }

.app-sidebar {
  display: flex;
  flex-direction: column;
  width: 260px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
}
.app-sidebar__header {
  padding: var(--space-3) var(--space-3) var(--space-2);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* 编辑器是主体：预览可折叠，且编辑区占比更大（UI §11）。 */
.app-main { display: flex; flex-direction: column; flex: 1; min-width: 0; }

.app-panes { display: flex; flex: 1; min-height: 0; }
.app-pane { display: flex; flex-direction: column; min-width: 0; }
.app-pane--editor { flex: 1 1 55%; }
.app-pane--preview {
  flex: 1 1 45%;
  border-left: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}

.app-error {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  color: var(--danger);
  background: var(--danger-soft);
  border-bottom: 1px solid var(--border-subtle);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

- [ ] **Step 7: 运行确认通过**

```powershell
npm test
```

预期：全部通过。

- [ ] **Step 8: 类型检查与构建**

```powershell
npm run build
```

预期：`tsc --noEmit` 无错误，Vite 产出 `dist/`。

- [ ] **Step 9: 提交**

```powershell
git add -A
git commit -m "feat(app): wire three-pane desktop layout with shortcuts"
```

---

### Task T1.14: 端到端验证与验收

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 全量回归**

```powershell
npm test
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

预期：三条命令退出码均为 0。

- [ ] **Step 2: 手动验收 —— 建立基线**

```powershell
$env:CRAB_MD_WORKSPACE = "E:\Documents\my\crab-md\.manual-workspace"
npm run tauri dev
```

在应用内：

1. 点击 **New** → 出现 `Untitled`
2. 在编辑器中输入 `# 标题\n\n并发编程与信道`,
3. 左侧应即时出现预览渲染

- [ ] **Step 3: 手动验收 —— 重启后持久化**

关闭应用窗口，重新执行：

```powershell
$env:CRAB_MD_WORKSPACE = "E:\Documents\my\crab-md\.manual-workspace"
npm run tauri dev
```

预期：文档仍在列表中，点开后内容完整（含中文）。

同时确认磁盘上是标准 Markdown：

```powershell
Get-ChildItem "$env:CRAB_MD_WORKSPACE\notes"
Get-Content (Get-ChildItem "$env:CRAB_MD_WORKSPACE\notes\*.md" | Select-Object -First 1).FullName
```

预期：文件名形如 `<uuid>.md`，内容是纯 Markdown 文本（无私有格式封装）。

- [ ] **Step 4: 手动验收 —— 重命名不改身份**

1. 在侧栏重命名该文档
2. 再次列出文件：

```powershell
Get-ChildItem "$env:CRAB_MD_WORKSPACE\notes" | Select-Object Name
```

预期：**文件名不变**（仍是同一个 UUID），只有标题变了。这是 `ARCHITECTURE.md` §11 与 §26 的硬性验收项。

- [ ] **Step 5: 手动验收 —— 离线可用**

断开网络（或直接确认应用未发出任何请求），重复新建/编辑/保存。

预期：功能完全正常。Phase 1 不含任何网络代码，这天然成立，但需实测确认。

- [ ] **Step 6: 手动验收 —— 双主题**

切换系统主题（Windows 设置 → 个性化 → 颜色），或直接在 DevTools 中给 `<html>` 加 `data-theme="dark"`。

预期：界面与编辑器同步换色，正文对比度充足（`UI_DESIGN_SYSTEM.md` §4.1、§44）。

- [ ] **Step 7: 手动验收 —— 空态**

删除工作区后重启：

```powershell
Remove-Item "$env:CRAB_MD_WORKSPACE" -Recurse -Force
```

预期：显示 "No notes yet" 及 "New note" 按钮（`UI_DESIGN_SYSTEM.md` §32）。

- [ ] **Step 8: 写 README**

整个替换 `README.md`：

```markdown
# crab-md

本地优先的 Markdown 阅读/编辑器。Windows 与 Android 客户端 + Go 服务端按用户隔离同步。

## 现状

**Phase 1（本地编辑器闭环）已完成。** 当前版本可离线完成文档的
新建、编辑、重命名、删除，正文以标准 Markdown 文件保存在本地工作区。

不含网络功能 —— 读、写、搜索全部在本地完成。

## 开发

```bash
npm install
npm run tauri dev      # 启动桌面应用
npm test               # 前端测试
npm run test:rust      # Rust 测试
npm run build          # 类型检查 + 打包
```

### 工作区位置

默认在系统应用数据目录下的 `crab-md/workspace`。设置环境变量可覆盖：

```powershell
$env:CRAB_MD_WORKSPACE = "D:\my-notes"
```

### 目录结构

```
workspace/
├── notes/            # 文档正文，文件名为 <uuid>.md
├── attachments/      # 附件（Phase 4）
└── .app/metadata.db  # 元数据与全文索引
```

文档身份是 UUIDv7，**与标题、路径无关** —— 重命名不会改变文件名。
这使同步与重命名都不依赖路径，避免路径穿越，见 `ARCHITECTURE.md` §11。

## 规范

- `ARCHITECTURE.md` —— 架构与数据所有权（规范性）
- `UI_DESIGN_SYSTEM.md` —— 设计系统与组件（规范性）

实现与规范冲突时，先改规范或在变更说明中显式记录偏差。

## 路线图

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 1 | 本地编辑器闭环 | 已完成 |
| Phase 2 | 认证与服务端存储 | 待开始 |
| Phase 3 | 同步与冲突处理 | 待开始 |
| Phase 4 | 附件、搜索、Android | 待开始 |
| Phase 5 | 打磨与加固 | 待开始 |

详见 `docs/superpowers/plans/2026-09-21-crab-md-roadmap.md`。
```

- [ ] **Step 9: 提交**

```powershell
git add -A
git commit -m "docs: document Phase 1 completion and workspace layout"
```

---

## 4. Phase 1 验收标准

全部满足即视为 Phase 1 完成（对应 `ARCHITECTURE.md` §26 与 `UI_DESIGN_SYSTEM.md` §44）：

- [ ] `npm test` 全绿
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 全绿
- [ ] `npm run build` 通过（类型检查 + 打包）
- [ ] 能离线新建、编辑、重命名、删除 Markdown 文档
- [ ] 本地编辑在应用重启后完整保留
- [ ] 正文是标准 Markdown 文件，可用任意编辑器打开
- [ ] **重命名不改变磁盘文件名与文档 id**
- [ ] 中文长词（≥3 字）与中文双字词（2 字）都能搜到
- [ ] 渲染的 HTML 已消毒：`<script>`、内联事件、`javascript:` URL 均被移除
- [ ] 明暗两套主题下主要组件均正常
- [ ] 空态（无文档、无打开文档）有明确提示与主操作
- [ ] 非法文档 id（如 `../../etc/passwd`）在所有入口都被拒绝，且有测试覆盖

---

## 5. 已知偏差与后续项

已登记的偏差（详见路线图 §4.1），**不在 Phase 1 范围内**：

| 项 | 说明 | 归属 |
| --- | --- | --- |
| Shiki 语法高亮 | `ARCHITECTURE.md` §4.1 的 "where practical"；P1 用 markdown-it 基础高亮 | T5.4 |
| 文件名可读性 | §10 要求文件名是 UUID，用户无法在资源管理器识别 | T5.2 评估 |
| 全局搜索 UI | `db/search.rs` 已就绪，但 UI 入口在 Phase 4 | T4.4 |
| 编辑器行列号 | `EditorStatusBar` 的 line/column 目前硬编码为 1 | 可随时接 CodeMirror 光标监听 |
| 保存去抖 | 当前 Ctrl+S / 切文档时落盘；1–3s 去抖属于同步语义 | T3.5 |

---

## 6. 执行建议

推荐 **Subagent 驱动**：每个任务派一个全新 subagent，任务间做两阶段评审。任务边界已按可独立验证的单元切分，T1.1–T1.6 的 Rust 内核与 T1.9–T1.12 的前端模块都可单独交付。

若选择本会话内联执行，按 `executing-plans` 在 T1.6（搜索）、T1.7（命令层）、T1.13（布局）、T1.14（验收）后设检查点。

