# crab-md 开发路线图（总纲）

> **For agentic workers:** 本文件是总纲，不直接执行。逐步骤实现计划见 `2026-09-21-phase1-local-editor.md`（Phase 1）。Phase 2–5 在进入时各自展开为同粒度的详细计划。步骤使用 `- [ ]` 复选框语法跟踪。

**Goal:** 把 `ARCHITECTURE.md` 与 `UI_DESIGN_SYSTEM.md` 两份基线规范落成可运行的本地优先 Markdown 阅读/编辑器：Windows 客户端先行，Go 服务端提供按用户隔离的同步，Android 后置。

**Architecture:** Tauri 2 客户端（React 19 + TypeScript + CodeMirror 6 + 本地 SQLite），本地工作区以 `<uuid>.md` 存储文档正文、`.app/metadata.db` 存元数据；所有文件与数据库访问都经 Rust 命令层，前端不直接触盘。Go 单二进制服务端（纯 Go SQLite，CGO_ENABLED=0 交叉编译）按 `data/users/<user-uuid>/` 隔离，systemd 服务化 + nginx TLS 反代。

**Tech Stack:** Tauri 2 / React 19 / TypeScript 5.9 / Vite 8 / CodeMirror 6 / rusqlite(bundled) / Zustand 5 / markdown-it + DOMPurify / Go 1.27 + modernc.org/sqlite / SQLite / nginx + certbot。

---

## 1. 验收标准映射

`ARCHITECTURE.md` §26 的 10 条 v1 验收标准，以及 `UI_DESIGN_SYSTEM.md` §44 的 UI 验收标准，按阶段归属：

| 验收项（来源） | 归属阶段 |
| --- | --- |
| Windows 离线编辑 Markdown | P1 |
| 本地编辑跨重启持久化 | P1 |
| 重命名不改文档身份 | P1 |
| Windows / Android 同族观感、双主题 | P1（Windows）/ P4（Android） |
| 桌面三区、手机无永久侧栏 | P1（桌面）/ P4（手机） |
| 键盘焦点可见、空/加载/错误态齐备 | P1 |
| 用户间数据不可越权访问 | P2 |
| 同账号跨设备同步 | P3 |
| 冲突保留而非静默覆盖 | P3 |
| 服务端重启不丢数据 | P2/P3 |
| 不依赖 Redis/PG/MQ/对象存储，跑在 2C2G | 全程约束 |
| Android 离线编辑 | P4 |

---

## 2. 已验证的环境事实（2026-09-21 实测）

这些是**实测结论**，不是假设。后续计划可直接依赖。

### 2.1 Windows 开发机

| 项 | 结论 |
| --- | --- |
| Node / npm / pnpm | v24.20.0 / 11.19.0 / 10.24.0 |
| Rust | rustc & cargo 1.91.1 (stable-x86_64-pc-windows-msvc) |
| MSVC 链接器 | **可用**，rustc 自动发现 `E:\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207\bin\HostX64\x64\link.exe`。搜索 `link.exe` 找不到它（VS 未在 PATH 里），但 `cargo build` 正常 |
| Tauri 2 全链路 | **已实测通过**：`create-tauri-app` react-ts 模板 + `npm run tauri build --no-bundle` → 4m04s 产出 `probe.exe` |
| WebView2 运行时 | 140.0.3485.66 已安装 |
| rusqlite bundled | **已实测通过**：编译无需 INCLUDE/LIB 环境变量，内置 SQLite 3.50.2，**FTS5 可用** |
| Go | 1.27.0（`C:\Program Files\Go\bin\go.exe`）；另有 1.26.8 于 `E:\Dev\Go` |
| Go 交叉编译 | **已实测通过**：`GOOS=linux GOARCH=amd64 CGO_ENABLED=0` + `modernc.org/sqlite` → 8.9 MB Linux 二进制 |
| Android SDK | `C:\Users\Administrator\AppData\Local\Android\Sdk`；platforms 35/36/37、build-tools 34–37、NDK 25.2 & 27.2 |
| cargo-ndk | 4.1.2 已装；rustup 四个 android target 全部已安装 |
| JDK | Temurin 21.0.10（`C:\Program Files\Eclipse Adoptium`）**注意**：PATH 里默认 `java` 是 1.8，需显式指向 21 |
| ANDROID_HOME / JAVA_HOME | **均未设置** —— P4 开工第一件事 |
| 网络 | npm registry 走 `registry.npmmirror.com`（PONG 783ms）；crates.io 200；proxy.golang.org 200 |
| 代理 | `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7890` |

### 2.2 生产服务器 47.116.39.247

| 项 | 结论 |
| --- | --- |
| 系统 | Ubuntu 22.04.5 LTS，**2 核**，1608 MB 内存 + 2303 MB swap，`/` 40G 已用 65% |
| 接入 | 密钥登录可用。**必须用 Git 自带 ssh**：`D:\Program Files\Git\usr\bin\ssh.exe`。Windows 系统 OpenSSH 9.5.2 **损坏**（任何调用都 exit 255 且零输出）；Git 的 OpenSSH_10.2p1 正常 |
| nginx | 1.18.0，已带 `http_ssl_module` + `http_v2_module`；已有 28 个站点，`nginx -t` 通过 |
| TLS | certbot 5.8.0 + **nginx 插件已装**；`/etc/letsencrypt/live/` 下 29 张证书；`certbot.timer` 每 12h 跑 |
| ACME | `/var/www/certbot` 已存在且被 `we.157342.xyz` 用作 webroot |
| SQLite CLI | 3.37.2 |
| 空闲端口 | **8091–8095 均空闲**（已占：22 25 53 80 443 587 631 3366 3456 5033 5244 5566 7000 7500 7777 7890 8000 8088 8787 9090 18080） |
| 参考服务 | **`couple-server.service`** —— 现成的 Go 后端范本：`/opt/couple-server`、`/var/lib/couple-server`、系统用户 `couple`(uid 997, nologin)、加固 systemd 单元（`ProtectSystem=strict` / `NoNewPrivileges` / `MemoryMax=256M` / `StateDirectory`）、nginx `we.157342.xyz` → `127.0.0.1:8088` |
| 已有 Go 工具链 | **服务端没有 go**（本地交叉编译后上传二进制，正合 `couple-server` 的做法） |
| DNS | `157342.xyz` 子域走 Cloudflare 代理（A 记录解析到 172.67.x / 104.21.x）。候选子域 `crabmd/md/crab.157342.xyz` **均不存在**，且**无泛解析** |
| Cloudflare API Token | **服务器上没有**，无法用 certbot DNS-01 自动签 |

### 2.3 由此确定的关键约束

1. **服务端不装 Go**：本地 `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build` → scp 二进制 → systemd 起。与 `couple-server` 完全一致。
2. **静态链接 SQLite**：服务端用 `modernc.org/sqlite`（纯 Go），避免在服务器上装 gcc。
3. **TLS 用 certbot nginx 插件（HTTP-01）**：需要先手工在 Cloudflare 加一条 **DNS only（灰云）** 的 A 记录指向 `47.116.39.247`，签发后再按需切回橙云。
4. **内存预算**：目标机可用内存仅约 600 MB，新服务必须像 `couple-server` 一样设 `MemoryMax`，建议 **192 MB**。
5. **Windows 上跑 ssh 一律用 Git 的 ssh.exe**，计划中的命令都写全路径。

---

## 3. 仓库结构（单仓 monorepo）

```
crab-md/
├── ARCHITECTURE.md               # 规范（只读基线）
├── UI_DESIGN_SYSTEM.md           # 规范（只读基线）
├── docs/superpowers/plans/       # 计划文档
├── package.json                  # 客户端包（仓库根 = Tauri 前端）
├── vite.config.ts
├── vitest.setup.ts
├── tsconfig.json
├── index.html
├── src/                          # React 客户端
│   ├── main.tsx
│   ├── App.tsx
│   ├── styles/                   # tokens.css / theme-light.css / theme-dark.css / globals.css
│   ├── components/ui/            # 设计系统原语
│   ├── components/editor/        # MarkdownEditor / MarkdownPreview / OutlineTree / EditorToolbar / EditorStatusBar
│   ├── components/workspace/     # AppToolbar / Sidebar / FileTree / SyncIndicator
│   ├── features/                 # documents / search / settings / sync（按功能分）
│   ├── lib/                      # api（Tauri 命令绑定）/ markdown / filesystem
│   ├── stores/                   # Zustand
│   ├── hooks/
│   └── types/
├── src-tauri/                    # Rust 客户端后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── icons/
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── error.rs
│       ├── model.rs
│       ├── workspace.rs          # 路径解析 + 原子写
│       ├── db/                   # mod.rs / migrations.rs / documents.rs
│       └── commands/             # mod.rs / documents.rs / workspace.rs
└── server/                       # Go 服务端（P2 起）
    ├── go.mod
    ├── cmd/crab-md-server/main.go
    ├── internal/{auth,users,documents,attachments,sync,storage,httpapi}/
    ├── migrations/
    └── deploy/                   # crab-md-server.service / nginx.conf / deploy.ps1
```

沿用 `ARCHITECTURE.md` §6 的模块边界，未新增框架或数据存储。

---

## 4. 已锁定的设计决策

这些决策会贯穿全部阶段；改动其一必须同步更新 `ARCHITECTURE.md` 或 `UI_DESIGN_SYSTEM.md`（§27 / §45 变更策略）。

| # | 决策 | 依据 |
| --- | --- | --- |
| D1 | 文档身份 = **UUIDv7**（`uuid` crate feature `v7`），文件名即 `<uuidv7>.md` | §11 可排序抗碰撞；§10 指定 `<document-uuid>.md` |
| D2 | 前端**从不直接访问文件系统**，全部经 Rust 命令 | §19 不向客户端暴露内部路径；比 `tauri-plugin-fs` 白名单更收敛 |
| D3 | 本地元数据 = `workspace/.app/metadata.db`，`rusqlite` **bundled**，WAL，`PRAGMA user_version` 做版本化迁移 | §10、§18.3；实测 bundled+FTS5 可用 |
| D4 | 写盘一律 **临时文件 → fsync → rename** | §18.2 |
| D5 | ID 在进入任何路径拼接前必须 `Uuid::parse_str` 校验 | §16.1 路径穿越防护 |
| D6 | 服务端 = **单个 Go 静态二进制** + `modernc.org/sqlite`，systemd 托管，不用容器编排 | §3.4 小系统偏好；实测交叉编译通过 |
| D7 | 服务端授权只从 **token 派生的 `current_user_id`** 取值，路由形如 `/api/notes` 而非 `/api/users/:id/notes` | §8.4、§24.3 |
| D8 | TLS 交给**现成 nginx + certbot**，不引入 Caddy | 服务器已跑 nginx 且证书体系成熟；避免第二个 web server 抢 80/443 |
| D9 | 内存上限：新服务 `MemoryMax=192M`，`Restart=on-failure` | 目标机 2C2G、可用内存约 600 MB |
| D10 | 主题经 **CSS 变量**注入 CodeMirror（`EditorView.theme` 读 `var(--text-primary)` 等），不硬编码颜色 | UI §3、§20 |
| D11 | 预览把**单个换行**渲染为换行（markdown-it `breaks: true`），即"严格换行"关闭 | UI §22；理由见下表偏差登记 |

### 4.1 与规范的显式偏差（已在计划中登记）

| 偏差 | 说明 | 处置 |
| --- | --- | --- |
| Shiki 代码高亮延后 | §4.1 原文是 "Shiki for code highlighting **where practical**"。Shiki 体积大且异步，会干扰 P1 的 TDD 步骤粒度 | P1 先做 markdown-it + DOMPurify；Shiki 单列为 **T5.4** |
| 本地工作区文件名是 UUID | §10 明确要求 `notes/<document-uuid>.md`，但用户无法在资源管理器里认出笔记 | ✅ **已交付**：工作区根已可在设置页更改（见 §34.1）。"人类可读文件名"模式仍列为 **T5.2** 评估（需先确认不与 §11 身份规则冲突） |
| Caddy 未采用 | §4.2 列了 Caddy 作为 TLS 终止 | 见 D8。若 T5.7 判定需要再切换，届时按 §4.3 补迁移理由 |
| **偏离严格 CommonMark 的 soft break** | CommonMark 规定单个换行是 "soft break"（渲染为空格）。但编辑器按 `\n` 分行显示，用户看到三行、预览却只有一行，**编辑器与预览自相矛盾**；Obsidian 的"严格换行"默认也是关闭的。 | 采用 `breaks: true`（D11）。**只影响渲染，不改磁盘内容**，文件里仍是 `\n`，故不违反 §24 第 5 条"保留标准 Markdown 文件"。已由 `markdown.test.ts` 的 "soft line breaks" 一组用例固定，防止被"修回"标准行为 |
| Settings 提前到 P1 落地（原 §43 排在 P5） | §43 把 Settings 列在 Phase 5。但"数据目录可配置"是 P1 承诺项，且用户看不到自己的数据存在哪、无法改，属实际可用性缺口 | ✅ **已交付**：设置页含 **外观 / 编辑器 / 文件与数据 / 关于** 四组（左侧分组导航）。已实现的设置项：数据目录（可改/可恢复默认/可在文件管理器中打开）、主题、编辑器字号、默认视图。**账号与设备**仍留 P5，届时新增分组即可（导航用稳定 id，插入分组不会串页） |
| 设置项分两处存储 | 若全部塞进后端 `settings.json`，主题/字号/视图模式要经 IPC 读取，启动时会闪一下错误主题 | 按**何时需要该值**划分（§34.2）：后端配置（数据目录）放 app config dir；纯展示偏好（主题/字号/视图模式）放 localStorage。不为"集中管理"牺牲启动平滑 |

---

## 5. 阶段计划

### Phase 1 — 本地编辑器闭环（详细计划已就绪）

**目标：** 不连网就能新建/编辑/重命名/删除 Markdown，内容以标准 `.md` 落在本地工作区，元数据入库，重启后原样恢复；桌面三区布局 + 双主题可跑。

**详细分解：** `2026-09-21-phase1-local-editor.md`（14 个任务，逐步骤 TDD）。

**出口条件（DoD）：**
- `npm test`（vitest）与 `npm run test:rust`（cargo test）全绿
- `npm run build` 类型检查 + 打包通过
- 手工验证：新建 → 编辑 → 关窗 → 重启 → 内容与标题都在；重命名后 `notes/` 下文件名不变
- 无网络时功能完整（P1 全部功能本就无网络依赖）

---

### Phase 2 — 认证与服务端存储

**目标：** Go 服务端上线，管理员建账号，客户端能登录拿到可吊销的设备 token；每个用户在服务端有独立数据根；越权访问被拒。

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| T2.1 | `server/` Go 模块骨架、配置（env）、结构化日志、`/healthz` | `go build` 通过；`GET /healthz` 返回 `{"status":"ok"}` |
| T2.2 | `auth.db` 迁移 v1：`users` / `devices`（字段依 §8.3） | 迁移幂等，重复启动不改 schema |
| T2.3 | Argon2id 哈希 + 校验（`argon2` crate 对应 Go 侧 `golang.org/x/crypto/argon2`） | 同密码两次哈希不同；校验通过；错误密码拒绝 |
| T2.4 | 会话 token：随机 32 字节 → 客户端持有明文，服务端**只存 SHA-256** | 库里搜不到明文 token |
| T2.5 | 认证中间件：解析 `Authorization: Bearer`，派生 `current_user_id` 注入 context | 无/错 token → 401 |
| T2.6 | 管理员 CLI：`user add` / `passwd` / `device revoke` | 命令行建号后能登录 |
| T2.7 | 每用户数据根解析 + 路径校验（复用 D5 思路） | `../` 输入被拒 |
| T2.8 | 用户 `metadata.db` 迁移：`documents` / `attachments` / `sync_log`（§9） | 与客户端 schema 字段名对齐 |
| T2.9 | 端点：`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/devices`、`DELETE /api/devices/:id` | 依 §16 契约 |
| T2.10 | **隔离性测试**：用户 A 的 token 对 B 的任何资源均 404/403 | 这是 §26 的硬验收项，必须有自动化用例 |
| T2.11 | 部署：交叉编译 → scp → `/opt/crab-md-server` + `/var/lib/crab-md-server` + 系统用户 + 加固 systemd 单元（对齐 `couple-server`） | `systemctl is-active` **且**日志无错 **且** `/healthz` 200 |
| T2.12 | nginx server block + certbot 签证书（需先加灰云 A 记录） | `curl https://<域名>/healthz` 返回 200，证书链有效 |

---

### Phase 3 — 同步

**目标：** 同账号多设备收敛到同一份内容；离线可继续编辑；冲突双方都留。

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| T3.1 | 客户端 sync 状态机 + 持久化待传队列（落 `metadata.db`） | 杀进程重启后队列不丢 |
| T3.2 | `GET /api/sync/manifest`（§12.4）+ 客户端 revision/hash 比对 | 无变化时不产生下载 |
| T3.3 | `PUT /api/notes/:id` 携带 base revision；不匹配返回 `SYNC_CONFLICT`（§12.5、§16.1） | 过时 base 被拒而非覆盖 |
| T3.4 | `GET/DELETE /api/notes/:id`；删除走 tombstone + revision（§14） | 旧设备不会复活已删文档 |
| T3.5 | 上传/下载引擎 + 1–3s 去抖 + 指数退避重试（§12.2、§12.3） | 断网期间编辑不丢；恢复后自动收敛 |
| T3.6 | 触发点接线：启动 / 回前台 / 登录成功 / 保存去抖 / 手动 / 网络重连 | 六个触发点逐一验证 |
| T3.7 | 冲突落盘（保留双方）+ `ConflictDialog`（UI §27） | 冲突后两份内容都在，用户可 keep local/remote/both |
| T3.8 | `SyncIndicator` 接线到 §26 词汇表（Saved/Syncing/Offline/Sync failed/Conflict） | 正常同步视觉安静，不显示 revision/hash |
| T3.9 | 端到端：Windows 双实例模拟两设备往返 | 内容一致、冲突可复现且可解 |

---

### Phase 4 — 附件、搜索与 Android

| 任务 | 内容 | 验收 |
| --- | --- | --- |
| T4.1 | 服务端附件 `POST/GET/DELETE /api/attachments`，含可配置大小上限（§15） | 超限返回稳定错误码 |
| T4.2 | 客户端附件落盘 + Markdown 以 app 解析的稳定 ID 引用 | 附件不内嵌进 `.md` |
| T4.3 | 全局搜索接 P1 已建的 FTS5 索引（§17） | 索引更新不阻塞编辑 |
| T4.4 | 全局搜索 UI + `Ctrl+Shift+F`（UI §24） | 结果含标题/路径/片段 |
| T4.5 | **Android 构建链**：设 `ANDROID_HOME`/`JAVA_HOME`(JDK21) → `tauri android init` → 真机/模拟器跑通 | 产出 APK 并能装 |
| T4.6 | Android 平台适配：返回键消解顺序（UI §30）、44–48px 触达（§31）、抽屉取代侧栏（§12） | 按 UI §30 优先级逐项验证 |
| T4.7 | Android 离线编辑 + 跨端同步 | §26 的 "Android 离线编辑" 与 "跨端同步" 两条 |

---

### Phase 5 — 打磨与加固

| 任务 | 内容 |
| --- | --- |
| T5.1 | 设备/会话管理 UI（合并进"账户与设备"设置页，UI §34） |
| T5.2 | 备份/导出：一键导出用户目录归档；评估人类可读文件名模式（见 §4.1 偏差） |
| T5.3 | 诊断视图：显式展示 revision / hash / 队列长度（仅调试入口，UI §26） |
| T5.4 | Shiki 代码高亮接入预览（懒加载，见 §4.1 偏差） |
| T5.5 | 视觉精修 + 全组件双主题回归（UI §44） |
| T5.6 | 边界加固：大文件、并发写、迁移失败恢复、软删除保留期清理（§14、§18.3） |
| T5.7 | 评估 nginx → Caddy（§4.2）是否为净收益；若否，在文档中固化 D8 |

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Cloudflare 橙云导致 HTTP-01 签证书失败 | P2.12 卡住 | 先加 **DNS only** 记录签发，再切橙云；计划中已写明 |
| 服务器可用内存仅 ~600 MB | 新服务 OOM 或被 OOM killer 干掉 | `MemoryMax=192M`；上线后观测 `journalctl` 与 `free -m` |
| 2 核共跑 nginx + 多个 node + Go | 交叉编译/部署期负载 | Go 服务本身极轻；部署后核对 `ss -tlnp` 与负载 |
| Windows 系统 OpenSSH 损坏 | 部署脚本假失败 | 全部命令硬编码 `D:\Program Files\Git\usr\bin\ssh.exe` |
| 服务端无 Go 工具链 | 无法就地编译 | 本地 `CGO_ENABLED=0` 交叉编译，scp 二进制（已实测） |
| TypeScript 7.0.2 已是 latest（Go 重写版） | 装到不兼容编译器 | **锁定 `typescript@^5.9.3`**，与已验证的 `vibe-todo` 一致 |
| Android 环境变量未设置、PATH 里 java 是 1.8 | P4 起步即失败 | T4.5 第一步显式导出 `ANDROID_HOME` 与 JDK21 路径 |
| 工作区 UUID 文件名影响可浏览性 | 产品体验 | 计划中登记为 T5.2，P1 先保证工作区根可配置 |

---

## 7. 执行方式

Phase 1 已展开为逐步骤计划，可立即执行。两种执行方式：

1. **Subagent 驱动（推荐）** —— 每个任务派一个全新 subagent，任务间做两阶段评审，迭代快、上下文干净。
2. **本会话内联执行** —— 用 `executing-plans` 技能批量执行并在检查点暂停评审。

Phase 2 起，先回顾本路线图对应阶段，再按 Phase 1 相同的粒度（每步 2–5 分钟、含真实代码与预期输出）展开为独立计划文件，避免单份计划篇幅过大。
