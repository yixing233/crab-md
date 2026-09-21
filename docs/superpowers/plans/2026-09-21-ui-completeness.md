# crab-md UI 完整性设计（缺口清单与补齐计划）

> 来源：2026-09-21 对 `ARCHITECTURE.md` + `UI_DESIGN_SYSTEM.md` 的系统性对照审计（逐文件实读取证）
> 背景：Phase 1 后端与核心链路已完成且测试充分，但 UI 层是「按最小可运行」拼出来的，**不是按规范完整设计**。
> 本文件的作用：把「缺什么」一次列全，避免逐个被使用者发现。

---

## 0. 为什么会有这份文档

Phase 1 的实现方式是「一个任务做一个组件」，而不是「先完整设计 UI 再实现」。
后果是规范里明确要求、但没有被任何任务覆盖的东西全部漏掉了：

- 规范 §13 要求 21 个必备组件 → 只做了 4 个（Button / Input / EmptyState / Spinner）
- 规范 §19 列出 10 个编辑器组件 → 只做了 3 个
- 规范 §17 列出 7 个导航组件 → 只做了 3 个
- 规范 §29 列出 10 个快捷键 → 只做了 4 个

**这不是「还没做」，而是「没被规划」。** 下面把它们全部登记。

---

## 1. 数据安全缺口（最高优先级）

这两条违反 `ARCHITECTURE.md` §18.1 的 **MUST**（"Closing or backgrounding the app MUST NOT intentionally discard unsaved content"），是会真正丢用户数据的缺陷。

### G1. 切换文档时静默丢弃未保存内容

**现状**：`useWorkspaceStore` 跟踪 `dirty` 标志，但**没有任何地方消费它**。
`openDocument()` 直接 `set({ activeId, activeContent, dirty: false })` —— 未保存的编辑被无声覆盖。

**复现**：打开文档 A → 输入一段话（不按 Ctrl+S）→ 点侧栏文档 B → A 的新内容永久丢失，且无任何提示。

**要求**：`ARCHITECTURE.md` §18.1；`UI_DESIGN_SYSTEM.md` §42.10（"Do not silently discard unsaved content during navigation"）

**修法**：切换前若 `dirty`，先自动落盘（推荐，本地写盘极快），失败才弹确认。

### G2. 无自动保存，只有 Ctrl+S 落盘

**现状**：`EditorView.updateListener` 只更新 store，无去抖定时器。断电 / 崩溃 / 强杀丢全部编辑。

**要求**：`ARCHITECTURE.md` §12.2（"Client writes the content locally immediately or after a short editor debounce"）、§18.1

**修法**：`setContent` 后启动 800ms–1.5s 去抖；切文档 / 失焦 / 关窗时强制 flush。

---

## 2. 功能缺口

| # | 缺口 | 规范依据 | 影响 |
| --- | --- | --- | --- |
| G3 | 编辑器**无可见语法高亮**（`markdown()` 只装解析器，未装 `syntaxHighlighting` + `HighlightStyle`） | UI §20 | 编辑 Markdown 却无任何着色，观感"毛坯" |
| G4 | 状态栏行列号**硬编码 `line={1} column={1}`**，无光标监听 | UI §28 | 永远显示"第 1 行，第 1 列" |
| G5 | **OutlineTree 完全不存在**，无 heading 抽取与跳转 | UI §19、§23 | 长文档无法导航 |
| G6 | **Breadcrumb 与 DocumentTabs 不存在** | UI §17、§19、§43 | 无法知道当前文档在哪个目录；无多标签页 |
| G7 | CodeMirror **内置搜索面板全英文**（Find/Replace/match case…） | UI §2.5、§24 | 中文产品里冒出英文面板 |
| G8 | `MarkdownPreview` 硬编码 `"Nothing to preview yet."` | UI §2.5 | 用户可见英文 |
| G9 | **无任何加载态**（`loading` 被写但从不被读；初始 `listDocuments` 期间界面空白） | UI §32 | 冷启动像是卡死 |
| G10 | 错误条直接把机器码给用户：`出错了：NOT_FOUND`，无中文解释、无"本地数据安全"说明、无重试 | UI §32 | 用户不知道发生了什么、数据是否安全 |
| G11 | 快捷键缺 5 条：`Ctrl+P`（快速打开）、`Ctrl+F`（文档内查找，未全局注册）、`Ctrl+,`（设置）、`Ctrl+Shift+P`（命令面板）、`Ctrl+Shift+F`（全局搜索） | UI §29 | 键盘用户预期落空 |
| G12 | **客户端零日志**（无 `console.*`、无 `tracing`），`AppError` 不落盘 | ARCH §23 | 排查问题只能靠复现 |
| G13 | FileTree **无拖放**（`dragging`/`drop-target` 状态无实现） | UI §18、§18.3 | 无法拖动整理 |
| G14 | **无响应式断点**（全仓只有 `prefers-reduced-motion` 媒体查询） | UI §10 | 窄窗口布局不降级（目前靠 `minWidth:900` 掩盖） |
| G15 | **无 pane 缩放**（三栏固定 55%/45%） | UI §11 | 无法按内容调宽度 |
| G16 | `bracketMatching()` 未装；`markdown()` 未传 `codeLanguages`（`@codemirror/language-data` 在依赖里但**零引用**） | UI §20 | 括号不配对提示；代码块无高亮 |

---

## 3. 组件与结构缺口

### 3.1 缺失的共享组件（UI §13 必备清单）

已有 4 个：`Button`（含 IconButton 能力）、`Input`、`EmptyState`、`Spinner` + `Tooltip`、`Dialog`。

**缺 13 个**：

| 组件 | 是否有消费方 | 归属 |
| --- | --- | --- |
| `Toast` | 有（保存成功/失败、导出完成，§33） | P1 补 |
| `ContextMenu` | 有（FileTree 右键，目前是自造裸 div） | P1 补 |
| `TextArea` | 无（设置页会用到） | P5 |
| `Select` / `Checkbox` / `Switch` | 无（设置页会用到） | P5 |
| `Tabs` | 有（DocumentTabs 会用到） | P1 补骨架 |
| `DropdownMenu` | 有（"更多操作"可用它替换 ContextMenu 复用） | P1 补 |
| `Divider` / `Badge` | 无 | 用到再补 |
| `Drawer` / `BottomSheet` | 无（Android / 窄屏） | P4 |
| `Avatar` / `Progress` | 无 | 用到再补 |

### 3.2 绕过设计系统的自造控件（违反 UI §2.4）

| 位置 | 现状 | 应改为 |
| --- | --- | --- |
| `FileTree` 行内重命名 | 裸 `<input class="file-tree__rename">`，样式定义在 `workspace.css` | 复用共享 `Input`（或抽 `InlineEdit` 原语） |
| `FileTree` 右键菜单 | 裸 `<div class="context-menu">` + `<button>` | 抽为共享 `ui/ContextMenu.tsx`（或 `DropdownMenu` 的定位模式） |

规范 §2.4：*"Pages MUST NOT create one-off button/input/dialog styles solely for local use."*

### 3.3 导航与编辑器组件缺口（UI §17 / §19）

- 已有：`AppToolbar`、`Sidebar`、`FileTree`、`MarkdownEditor`、`EditorToolbar`、`MarkdownPreview`、`EditorStatusBar`
- 缺：`Breadcrumb`、`DocumentTabs`、`OutlineTree`、`FindPanel`（用 CM 内置替代，需中文化）、`CommandPalette`（P4）、`SyncIndicator`（P3）、`ConflictDialog`（P3）、`MobileDrawer`（P4）

---

## 4. 工程细节缺口

| 项 | 现状 | 应为 |
| --- | --- | --- |
| ~~`index.html`~~ | ✅ 已修 | `lang="zh-CN"`、`<title>crab-md</title>` |
| `markdownActions.ts` 的 `EDITOR_ACTIONS[].label` | 英文串（当前未被渲染，属死数据） | 删除该字段或改引用 i18n 键 |
| 主题切换入口 | 仅工具栏循环按钮 | 设置页里给显式三选一（§34，P5） |

---

## 4.5 实施进度（2026-09-21 更新）

批次 A、B 已全部完成；批次 C 除下列几项外已完成。每一项都有配套测试。

### ✅ 已完成

| 批次 | 内容 | 提交 |
| --- | --- | --- |
| A1–A4 | 自动保存（1s 去抖）、切文档/新建前 flush（失败则阻止切换并保留内容）、Rust 侧关窗拦截 + 兜底放行、数据安全回归测试 | `ff0242b` |
| B1 | 语法高亮（`syntaxHighlighting` + 走主题令牌的 `HighlightStyle`，明暗自适应） | `3934624` |
| B2 | 状态栏真实行列号（**部分**：未做「选中字数」） | `3934624` |
| B3 | 冷启动加载态（spinner + `role="status"`） | `3934624` |
| B4 | 错误态中文化：错误码 → 中文解释 + 「内容仍保存在本机」+ 可关闭 | `3934624` |
| B5 | `MarkdownPreview` 空态走 i18n | `3934624` |
| B6 | CodeMirror 搜索面板中文化（`EditorState.phrases`） | `3934624` |
| B7 | 括号匹配 + 代码块语言高亮（`codeLanguages`，此前依赖已装却零引用） | `3934624` |
| B8 | `index.html` 元信息（`lang="zh-CN"`、标题、图标） | `3934624` |
| C1 | `ui/ContextMenu.tsx` 抽取；FileTree 改用（含键盘上下键、视口收边、`aria-keyshortcuts`） | `bb3bc77` |
| C2 | `ui/InlineEdit.tsx` 抽取；移除 FileTree 的自造输入与自造菜单 CSS | `bb3bc77` |
| C3 | `ui/Toast.tsx` + 保存反馈接线（成功自动消失、错误常驻） | `bb3bc77` |
| C4 | `lib/outline.ts` 纯函数 + `OutlineTree` + 工具栏开关 + Ctrl+Shift+O | `bb3bc77` |
| C5 | `Breadcrumb`（虚拟路径 → 分段，`aria-current` 标注当前项） | `bb3bc77` |
| C6 | Ctrl+F 全局注册（编辑器未聚焦时也生效） | `bb3bc77` |
| C7 | 响应式断点 <900（侧栏收窄、大纲浮层）/ <600（单栏、侧栏浮层） | `bb3bc77` |
| C8 | pane 拖拽缩放（指针拖拽 + 方向键/Home/End + 双击复位 + 宽度持久化） | `ac0605f` |
| C9 | 客户端日志（**部分**：前端 `lib/log.ts` 记录稳定错误码与文档 id，不含正文；未接入 Tauri 文件日志） | `bb3bc77` |

### ⬜ 未完成（有意留待后续）

| 项 | 原因 |
| --- | --- |
| B2 的「选中字数」 | 需要额外订阅选区变化，价值低于已完成部分，留待需要时补 |
| C6 的 `Ctrl+P` / `Ctrl+Shift+F` | 二者都依赖 `CommandPalette` 与全局搜索，属 P4（与同步/检索一起做更合理） |
| C9 的后端日志落盘 | Rust 侧 `tracing` 与前端上报需要一个「诊断」入口，属 P5 |
| `Tabs` 组件与 `DocumentTabs` | 多标签页是独立特性，不在本次 UI 补齐范围（§43 排在后续批次） |
| `TextArea` / `Select` / `Checkbox` / `Switch` / `Drawer` / `BottomSheet` / `Avatar` / `Progress` / `Badge` / `Divider` | 当前无消费方；按 §43 的交付顺序随使用场景补，避免造无人用的组件 |

---

## 5. 实施顺序

按「用户可感知的严重度 × 修复成本」排序，分三批。

### 批次 A：数据安全（必须先做）

| 任务 | 内容 |
| --- | --- |
| A1 | 自动保存：`setContent` 后 1s 去抖落盘；`flush()` 供切文档/关窗调用 |
| A2 | 切文档前 flush 未保存内容（失败才提示） |
| A3 | 关窗拦截：Rust `WindowEvent::CloseRequested` → 先 flush 再关闭 |
| A4 | 针对 A1–A3 的测试（含"切文档不丢内容"回归） |

### 批次 B：立即可感的 UI 完善

| 任务 | 内容 |
| --- | --- |
| B1 | 编辑器语法高亮（`syntaxHighlighting` + 走主题令牌的 `HighlightStyle`） |
| B2 | 状态栏真实行列号 + 选中字数 |
| B3 | 加载态（侧栏骨架 + `aria-busy`） |
| B4 | 错误态中文化：错误码 → 中文文案 + "本地数据安全" + 重试 |
| B5 | `MarkdownPreview` 空态文案走 i18n |
| B6 | CodeMirror 搜索面板中文化（`EditorState.phrases`） |
| B7 | 括号匹配 + 代码块语言高亮（`codeLanguages`） |
| B8 | `index.html` 元信息修正 |

### 批次 C：结构补全

| 任务 | 内容 |
| --- | --- |
| C1 | `ui/ContextMenu.tsx` 抽取；FileTree 改用它 |
| C2 | 行内重命名改用共享 `Input`（消除自造控件） |
| C3 | `ui/Toast.tsx` + 接线（保存成功/失败提示） |
| C4 | `OutlineTree` + `lib/outline.ts`（纯函数抽 heading）+ 三栏可切换显示 |
| C5 | `Breadcrumb`（虚拟路径 → 面包屑） |
| C6 | 快捷键补齐（`Ctrl+F` 全局注册、`Ctrl+P` 快速打开） |
| C7 | 响应式断点（<900 收窄侧栏、<600 单栏 + 抽屉） |
| C8 | pane 拖拽缩放 |
| C9 | 客户端日志（`tracing` + 前端错误上报到后端日志） |

---

## 6. 验收标准（本文件范围内）

- [x] 切换文档、关闭应用都不丢未保存内容（有测试覆盖）
- [x] 编辑 1s 后自动落盘（无 Ctrl+S 也不丢）
- [x] 编辑器有语法高亮、状态栏行列号真实、括号匹配生效
- [x] 冷启动有加载态，不出现空白界面
- [x] 界面内**不再出现任何英文用户文案**（含 CodeMirror 内置面板）
- [x] 错误提示是中文 + 说明本地数据安全
- [x] `src/components/ui/` 下无自造的一次性控件；`FileTree` 复用共享原语
- [x] 缺失的必备组件按需要补齐（`Toast`、`ContextMenu`、`InlineEdit`）
- [x] `OutlineTree` / `Breadcrumb` 可用
- [x] §29 快捷键在编辑器聚焦/失焦两种状态下都按预期工作（Ctrl+F 已全局注册）
- [x] 窄窗口（<900）布局降级正常，编辑器仍可用

遗留（见 §4.5「未完成」）：选中字数、`Ctrl+P`/`Ctrl+Shift+F`、后端日志落盘、`DocumentTabs`、以及暂无消费方的其余 §13 原语。
