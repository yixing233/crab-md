# crab-md

本地优先的 Markdown 阅读/编辑器。Windows 与 Android 客户端 + Go 服务端按用户隔离同步。

## 现状

**Phase 1（本地编辑器闭环）已完成。** 当前版本可离线完成文档的
新建、编辑、重命名、删除，正文以标准 Markdown 文件保存在本地工作区。

不含网络功能 —— 读、写、搜索全部在本地完成。

## 开发

```bash
npm install
npm run tauri dev      # 启动桌面应用（开发模式）
npm test               # 前端测试
npm run test:rust      # Rust 测试
npm run build          # 类型检查 + 打包
```

首次 `cargo` 编译约 4 分钟，之后增量编译很快。

### 工作区位置

默认在系统应用数据目录下的 `crab-md/workspace`。设置环境变量可覆盖：

```powershell
$env:CRAB_MD_WORKSPACE = "D:\my-notes"
npm run tauri dev
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

### 快捷键

```
Ctrl+N   新建文档
Ctrl+S   保存（立即落盘）
Ctrl+\   切换预览面板
```

## 搜索

标题与正文用 SQLite FTS5 索引。中文搜索经过特别处理：
默认的 `unicode61` 分词器会把整段中文当成一个 token（搜「并发」找不到
「并发编程与信道」），因此改用 `trigram`；而 `trigram` 又要求查询至少 3 个字符，
所以 1–2 字的中文短词（并发、信道、笔记）走 `LIKE` 回退。
见 `docs/superpowers/plans/2026-09-21-phase1-local-editor.md` T1.6。

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
