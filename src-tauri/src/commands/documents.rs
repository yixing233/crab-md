use crate::db::{self, documents as docs, external_files, opened_files, search};
use crate::error::{AppError, AppResult};
use crate::model::{
    CreateDocumentRequest, DocumentPayload, DocumentSummary, FileRecord, FileSearchResult,
    OpenFilePayload,
};
use crate::settings;
use crate::workspace;
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 已打开磁盘文件列表的视图投影（携带一次磁盘存在性检测）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFileView {
    #[serde(flatten)]
    pub record: FileRecord,
    pub exists: bool,
}

/// 设置页读取的视图（只读投影，避免把内部结构直接暴露给前端）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsView {
    /// 用户设置的自定义路径；None 表示用默认位置。
    pub workspace_root: Option<String>,
    /// 实际生效的工作区根（可能是默认值，也可能被环境变量覆盖）。
    pub effective_workspace_root: String,
    /// 生效路径是否来自 `CRAB_MD_WORKSPACE` 环境变量。
    /// 若是，界面上改了设置也不会立刻生效，必须如实告知用户。
    pub workspace_root_is_from_env: bool,
    /// 设置文件位置，方便用户备份或排查。
    pub config_path: String,
    pub version: u32,
}

/// 外部文件列表的只读投影：库里的元数据 + 一次磁盘存在性检查。
///
/// 为什么不直接把 `ExternalFileSummary` 发给前端：库里的记录可能已经
/// 指向一个被移动/删除的文件（用户在外面删了、U 盘拔了）。界面需要如实
/// 显示「已失效」，而不是等用户点开才报错 —— 但库本身不该存这个状态，
/// 它每时每刻都在变，只适合在读取时现算。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileView {
    pub path: String,
    pub name: String,
    pub size: i64,
    pub modified_at: String,
    pub opened_at: String,
    /// 文件当前不在磁盘上。
    pub missing: bool,
}

/// 文档服务：持有工作区根路径与数据库连接。
///
/// 业务逻辑集中在此，不依赖 Tauri 运行时，因此可被 cargo test 直接驱动。
///
/// root 与 conn 放在**同一个锁**下：切换工作区时两者必须一起换，
/// 分成两把锁就会出现「新路径配旧连接」的中间态。
pub struct DocumentService {
    state: Mutex<ServiceState>,
}

struct ServiceState {
    root: PathBuf,
    conn: Connection,
}

impl DocumentService {
    /// 打开（必要时创建）工作区。
    pub fn new(root: PathBuf) -> AppResult<Self> {
        let state = Self::open_state(&root)?;
        Ok(Self { state: Mutex::new(state) })
    }
    /// 打开一个工作区：建目录结构 + 开库。不修改 self，供「先验证后交换」使用。
    fn open_state(root: &Path) -> AppResult<ServiceState> {
        workspace::ensure_layout(root)?;
        let conn = db::open(&workspace::db_path(root))?;
        Ok(ServiceState { root: root.to_path_buf(), conn })
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, ServiceState>> {
        self.state
            .lock()
            .map_err(|_| AppError::InvalidInput("db lock poisoned".into()))
    }

    pub fn root(&self) -> AppResult<PathBuf> {
        Ok(self.lock()?.root.clone())
    }

    /// 解析一篇文档在磁盘上的真实路径，供「打开文件所在位置」等只读操作使用。
    ///
    /// 放在 Rust 而不是前端拼 `<root>/notes/<uuid>.md`：§7.1 要求文件系统
    /// 布局只由应用层掌握，另外这里要顺带做两件前端无法做的校验 ——
    /// 非法 id 报 INVALID_ID（而不是让 `ext:` 之类的前缀漏进文件系统），
    /// 文件已被删除时提前报 NOT_FOUND，让界面能给出可理解的失败提示。
    pub fn note_path(&self, id: &str) -> AppResult<PathBuf> {
        let st = self.lock()?;

        // 先做 id 校验：非法 id 应报 INVALID_ID，而不是被查库的 NOT_FOUND 掩盖。
        let path = workspace::note_path(&st.root, id)?;
        if !path.is_file() {
            return Err(AppError::NotFound(id.to_string()));
        }
        Ok(path)
    }

    /// 切换到另一个工作区根目录。
    ///
    /// **先验证、后交换**：先把新工作区完整打开（建目录、开库），只有成功
    /// 才替换当前状态。因此失败时当前工作区分毫未动，无需回滚 ——
    /// 也不会出现「配置已改但数据库连不上」的半死状态。
    pub fn switch_workspace(&self, new_root: PathBuf) -> AppResult<PathBuf> {
        // 已经是同一个目录就没必要折腾（比较规范化后的路径）。
        let current = self.lock()?.root.clone();
        if current == new_root {
            return Ok(current);
        }

        // 这一步可能失败；失败时直接返回，self 未被触碰。
        let fresh = Self::open_state(&new_root)?;

        let mut guard = self.lock()?;
        // 替换时旧的 Connection 随之 drop（关闭 SQLite 句柄）。
        guard.root = fresh.root;
        guard.conn = fresh.conn;
        Ok(guard.root.clone())
    }

    pub fn list(&self) -> AppResult<Vec<DocumentSummary>> {
        let st = self.lock()?;
        docs::list(&st.conn)
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

        // 全程持锁：root 与 conn 必须来自同一份状态，否则切换工作区时
        // 可能出现「把文件写进旧目录、元数据记进新库」。
        // std::sync::Mutex 不可重入，故此处不得调用其它会加锁的方法。
        let st = self.lock()?;

        docs::insert(&st.conn, &id, title, virtual_path, &empty_hash, &now, 0)?;

        if let Err(e) = workspace::atomic_write(&workspace::note_path(&st.root, &id)?, b"") {
            let _ = docs::soft_delete(&st.conn, &id, &workspace::now_iso8601());
            return Err(e);
        }

        let summary = docs::get(&st.conn, &id)?.ok_or_else(|| AppError::NotFound(id.clone()))?;
        search::reindex(&st.conn, &id, title, "")?;
        Ok(summary)
    }

    /// 读取元数据 + 正文。正文从文件读，元数据从库读。
    pub fn read(&self, id: &str) -> AppResult<DocumentPayload> {
        let st = self.lock()?;

        // 先做 id 校验：非法 id 应报 INVALID_ID，而不是被查库的 NOT_FOUND 掩盖。
        let _ = workspace::note_path(&st.root, id)?;

        let summary = docs::get(&st.conn, id)?.ok_or_else(|| AppError::NotFound(id.to_string()))?;
        let content = workspace::read_note(&st.root, id)?;
        Ok(DocumentPayload { summary, content })
    }

    /// 保存正文：先原子写文件，成功后再更新元数据与索引。
    /// 顺序很重要 —— 文件写失败时元数据保持旧值，不会出现「库里有哈希但文件没内容」。
    pub fn save(&self, id: &str, content: &str) -> AppResult<DocumentSummary> {
        let st = self.lock()?;

        // 先做 id 校验：非法 id 应报 INVALID_ID，而不是被查库的 NOT_FOUND 掩盖。
        let _ = workspace::note_path(&st.root, id)?;

        let summary = docs::get(&st.conn, id)?.ok_or_else(|| AppError::NotFound(id.to_string()))?;

        workspace::atomic_write(&workspace::note_path(&st.root, id)?, content.as_bytes())?;

        let now = workspace::now_iso8601();
        let hash = workspace::content_hash(content);
        let size = content.len() as i64;

        docs::update_content(&st.conn, id, &hash, &now, size)?;
        let updated = docs::get(&st.conn, id)?.ok_or_else(|| AppError::NotFound(id.to_string()))?;
        search::reindex(&st.conn, id, &summary.title, content)?;
        Ok(updated)
    }

    /// 重命名：只改 title，磁盘文件名与 id 均不变（ARCHITECTURE.md §11）。
    pub fn rename(&self, id: &str, title: &str) -> AppResult<DocumentSummary> {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::InvalidInput("title must not be empty".into()));
        }

        let now = workspace::now_iso8601();
        let st = self.lock()?;

        // 先做 id 校验：非法 id 应报 INVALID_ID，而不是被查库的 NOT_FOUND 掩盖。
        let _ = workspace::note_path(&st.root, id)?;

        if docs::rename(&st.conn, id, title, &now)? == 0 {
            return Err(AppError::NotFound(id.to_string()));
        }
        let updated = docs::get(&st.conn, id)?.ok_or_else(|| AppError::NotFound(id.to_string()))?;

        let content = workspace::read_note(&st.root, id)?;
        search::reindex(&st.conn, id, title, &content)?;
        Ok(updated)
    }

    /// 删除：软删除元数据 + 移出索引。正文文件保留，供 Phase 3 同步与恢复。
    pub fn delete(&self, id: &str) -> AppResult<()> {
        let now = workspace::now_iso8601();
        let st = self.lock()?;

        // 先做 id 校验，非法 id 直接拒绝而不是静默返回成功。
        let _ = workspace::note_path(&st.root, id)?;

        if docs::soft_delete(&st.conn, id, &now)? == 0 {
            return Err(AppError::NotFound(id.to_string()));
        }
        search::unindex(&st.conn, id)?;
        Ok(())
    }

    /// 另存为副本：以新 UUID 复制一篇文档，原标题与原文**完全不动**。
    ///
    /// 为什么不复用文件名：文档身份是 UUID（ARCHITECTURE.md §11、§7.1），
    /// 副本必须是独立身份，不能与原文档共享任何标识或磁盘文件。
    ///
    /// title 由调用方给出（界面文案属前端 i18n 职责）。
    /// 文件夹跟随原文档，符合「副本就在我手边」的预期。
    pub fn duplicate(&self, id: &str, title: &str) -> AppResult<DocumentSummary> {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::InvalidInput("title must not be empty".into()));
        }

        // 先取原文与元数据；失败的写操作一律不做，避免留下半成品。
        // read() 内部会加锁，故此处不能已持锁（Mutex 不可重入）。
        let original = self.read(id)?;
        let new_id = workspace::new_document_id();
        let now = workspace::now_iso8601();
        let content = original.content;
        let hash = workspace::content_hash(&content);
        let virtual_path = original.summary.virtual_path;

        let st = self.lock()?;

        docs::insert(&st.conn, &new_id, title, &virtual_path, &hash, &now, content.len() as i64)?;

        // 落盘失败时回滚元数据，不留下一篇读不出内容的空文档。
        if let Err(e) = workspace::atomic_write(
            &workspace::note_path(&st.root, &new_id)?,
            content.as_bytes(),
        ) {
            let _ = docs::soft_delete(&st.conn, &new_id, &workspace::now_iso8601());
            return Err(e);
        }

        let created = docs::get(&st.conn, &new_id)?.ok_or_else(|| AppError::NotFound(new_id.clone()))?;
        search::reindex(&st.conn, &new_id, title, &content)?;
        Ok(created)
    }

    pub fn search(&self, query: &str, limit: i64) -> AppResult<Vec<search::SearchHit>> {
        let st = self.lock()?;
        search::search(&st.conn, query, limit).map_err(AppError::from)
    }

    /// 把一篇文档的正文导出到工作区**之外**的任意路径。
    ///
    /// 导出的是**纯正文**，不含任何应用私有元数据：磁盘上的 `.md` 本来就是
    /// 可移植的标准 Markdown（ARCHITECTURE.md §24），导出只是把它复制出去。
    /// 因此用户在别的编辑器里打开导出文件，看到的就是他写的东西。
    ///
    /// 为什么要在 Rust 里做，而不是前端拿内容再调 fs 插件：
    /// ARCHITECTURE.md §7.1 要求所有文件系统访问经由应用层。对话框只负责
    /// **选路径**，读写始终在这里。
    pub fn export(&self, id: &str, target: &Path) -> AppResult<u64> {
        let payload = self.read(id)?;

        // 拒绝导出到工作区内部：那会把一份文档写到应用自己的数据区，
        // 绕过 UUID 命名规则，制造出库与磁盘不一致的孤儿文件。
        let root = self.root()?;
        if workspace::is_inside_workspace(&root, target) {
            return Err(AppError::InvalidInput(
                "target must be outside the workspace".into(),
            ));
        }

        let bytes = payload.content.as_bytes();
        check_transfer_size(bytes.len() as u64)?;
        workspace::atomic_write(target, bytes)?;
        Ok(bytes.len() as u64)
    }

    /// 从工作区外的任意路径打开一个文本或 Markdown 文件为**新文档**。
    ///
    /// 新文档拿到全新的 UUID，与来源文件无关（§11：身份由 UUID 承载，
    /// 不依赖路径或文件名）。因此重复导入同一文件会得到多篇文档，
    /// 而不是覆盖已有文档 —— 这是有意的：导入不该悄悄改掉既有内容。
    #[allow(clippy::too_many_arguments)]
    pub fn import(
        &self,
        source: &Path,
        title: Option<&str>,
        virtual_path: &str,
    ) -> AppResult<DocumentSummary> {
        let root = self.root()?;
        if workspace::is_inside_workspace(&root, source) {
            return Err(AppError::InvalidInput(
                "source must be outside the workspace".into(),
            ));
        }

        let meta = std::fs::metadata(source)?;
        if !meta.is_file() {
            return Err(AppError::InvalidInput("source is not a file".into()));
        }
        // 先看大小再读，避免把超大文件整个读进内存。
        check_transfer_size(meta.len())?;

        let content = std::fs::read_to_string(source)?;

        // 标题优先用调用方给的（界面上可编辑）；否则退回归档文件名（去扩展名）。
        // 文件名可能为空或全是空白，故仍要做一次兜底。
        let fallback = source
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let title = title.map(str::trim).filter(|t| !t.is_empty()).unwrap_or(&fallback);
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::InvalidInput("title must not be empty".into()));
        }

        let now = workspace::now_iso8601();
        let new_id = workspace::new_document_id();
        let hash = workspace::content_hash(&content);
        let size = content.len() as i64;

        let st = self.lock()?;
        docs::insert(&st.conn, &new_id, title, virtual_path, &hash, &now, size)?;

        // 与 create/duplicate 同一套路：落盘失败就回滚元数据，
        // 不让库里留下一篇读不出内容的文档。
        if let Err(e) = workspace::atomic_write(
            &workspace::note_path(&st.root, &new_id)?,
            content.as_bytes(),
        ) {
            let _ = docs::soft_delete(&st.conn, &new_id, &workspace::now_iso8601());
            return Err(e);
        }

        let created =
            docs::get(&st.conn, &new_id)?.ok_or_else(|| AppError::NotFound(new_id.clone()))?;
        search::reindex(&st.conn, &new_id, title, &content)?;
        Ok(created)
    }

    // ---- 外部文件（原位打开，库里只记元数据）----
    //
    // 与 import 的根本区别：import 把正文复制进工作区、给一个新的 UUID 身份；
    // 这里**不复制任何东西**，用户编辑的始终是磁盘上那个原文件。
    // 因此库里记的是路径 —— 外部文件的身份就是它所在的位置（§11 只约束
    // 工作区文档，它们的文件名由应用分配）。正文永不入库，这正是用户要求。

    /// 读取外部文件正文，并把它的元数据记进库（供重启后再次打开）。
    ///
    /// 读取成功后立即登记：能读到文件才算「打开过」，读取失败（不存在、太
    /// 大、非 UTF-8）不该在列表里留下一条点不开的记录。
    pub fn read_external(&self, path: &str) -> AppResult<crate::model::ExternalFilePayload> {
        let p = Path::new(path);
        let meta = std::fs::metadata(p)?;
        if !meta.is_file() {
            return Err(AppError::InvalidInput("path is not a file".into()));
        }
        // 先看大小再读，避免把超大文件整个读进内存。
        check_transfer_size(meta.len())?;
        let content = std::fs::read_to_string(p)?;

        let name = external_file_name(p);
        let modified_at = external_file_modified_at(&meta);
        let now = workspace::now_iso8601();

        // 登记失败不该让「打开」失败：用户要的是看到内容，元数据是次要的。
        // 所以这里忽略写库错误（真出错时列表少一条，比打不开文件轻得多）。
        //
        // 两张表各管一事，缺一不可：
        // - `external_files`：标签页重启恢复的依据（App 按 `ext:` 路径核对记录）；
        // - `opened_files`：侧栏文件列表 / 置顶 / 会话位置 / 全文检索的统一登记表。
        //   只写前者的话，文件关联打开的文件能开标签却永远进不了左侧文件树。
        {
            let st = self.lock()?;
            let _ = external_files::upsert(
                &st.conn,
                path,
                &name,
                meta.len() as i64,
                &modified_at,
                &now,
            );
            let _ = opened_files::upsert_and_index(
                &st.conn,
                path,
                &name,
                meta.len() as i64,
                &modified_at,
                &now,
                Some(&content),
            );
        }

        Ok(crate::model::ExternalFilePayload {
            path: path.to_string(),
            name,
            content,
            size: meta.len() as i64,
            modified_at,
        })
    }

    /// 外部文件列表：库里记着的全部记录 + 当前磁盘存在性。
    ///
    /// **不返回正文**：列表只需要名字和状态，把每个文件的正文都读进内存
    /// 纯属浪费（用户可能开着几十个外部文件）。
    pub fn list_external(&self) -> AppResult<Vec<ExternalFileView>> {
        let st = self.lock()?;
        let records = external_files::list(&st.conn)?;
        Ok(records
            .into_iter()
            .map(|r| ExternalFileView {
                missing: !Path::new(&r.path).is_file(),
                path: r.path,
                name: r.name,
                size: r.size,
                modified_at: r.modified_at,
                opened_at: r.opened_at,
            })
            .collect())
    }

    /// 原位保存外部文件，并刷新库里的元数据。
    ///
    /// 写盘用原子替换（§18.2）：用户编辑的是**他自己的**文件，一次断电
    /// 把原文件截断成半截是不可接受的。
    ///
    /// 若该文件从未登记过（例如经文件关联直接传入且读取失败过），保存时
    /// 顺带补登记 —— 用户已经在这份内容上工作了，它理应出现在列表里。
    pub fn save_external(
        &self,
        path: &str,
        content: &str,
    ) -> AppResult<crate::model::ExternalFilePayload> {
        let p = Path::new(path);
        if let Some(parent) = p.parent() {
            if !parent.exists() {
                return Err(AppError::InvalidInput(
                    "parent directory does not exist".into(),
                ));
            }
        }

        let bytes = content.as_bytes();
        check_transfer_size(bytes.len() as u64)?;
        workspace::atomic_write(p, bytes)?;

        let meta = std::fs::metadata(p)?;
        let name = external_file_name(p);
        let modified_at = external_file_modified_at(&meta);

        {
            let st = self.lock()?;
            let touched = external_files::touch(
                &st.conn,
                path,
                meta.len() as i64,
                &modified_at,
            )?;
            if touched == 0 {
                let now = workspace::now_iso8601();
                external_files::upsert(
                    &st.conn,
                    path,
                    &name,
                    meta.len() as i64,
                    &modified_at,
                    &now,
                )?;
            }
            // 统一登记表同步刷新：大小/时间戳要跟上，全文索引也要换成新正文，
            // 否则搜索会命中保存前的旧内容。从未打开过就补登记（与上面一致）。
            let unified = opened_files::touch(
                &st.conn,
                path,
                meta.len() as i64,
                &modified_at,
                Some(content),
            )?;
            if unified == 0 {
                opened_files::upsert_and_index(
                    &st.conn,
                    path,
                    &name,
                    meta.len() as i64,
                    &modified_at,
                    &workspace::now_iso8601(),
                    Some(content),
                )?;
            }
        }

        Ok(crate::model::ExternalFilePayload {
            path: path.to_string(),
            name,
            content: content.to_string(),
            size: meta.len() as i64,
            modified_at,
        })
    }

    /// 从列表移除一个外部文件记录。
    ///
    /// **只删记录，不动磁盘上的文件** —— 用户想要的往往是「别让它占着我的
    /// 列表」，而不是删掉他的文档。幂等：没记录过也算成功。
    /// 统一登记表里那条同样清掉，否则文件树里还留着同名条目。
    pub fn forget_external(&self, path: &str) -> AppResult<()> {
        let st = self.lock()?;
        external_files::remove(&st.conn, path)?;
        opened_files::remove(&st.conn, path)?;
        Ok(())
    }

    /// 解析外部文件在磁盘上的路径供「打开文件所在位置」使用。
    ///
    /// 与工作区文档走同一套校验顺序：文件不在了要提前报 NOT_FOUND，
    /// 让界面能给出可理解的失败，而不是把失败留给文件管理器。
    pub fn external_path(&self, path: &str) -> AppResult<PathBuf> {
        let p = Path::new(path);
        if !p.is_file() {
            return Err(AppError::NotFound(path.to_string()));
        }
        Ok(p.to_path_buf())
    }
    // =========================================================================
    // 统一纯磁盘文件模型（编辑器/阅读器架构：软件不存文件，一切皆磁盘文件）
    // =========================================================================

    /// 打开任意磁盘上的 Markdown 文件，并在 SQLite 注册/更新打开记录与 FTS 索引。
    pub fn open_disk_file(&self, path: &str) -> AppResult<OpenFilePayload> {
        let p = Path::new(path);
        if !p.is_file() {
            return Err(AppError::NotFound(path.to_string()));
        }
        let meta = std::fs::metadata(p)?;
        check_transfer_size(meta.len())?;

        let bytes = std::fs::read(p)?;
        let content = String::from_utf8(bytes)
            .map_err(|e| AppError::InvalidInput(format!("file is not valid UTF-8: {e}")))?;

        let name = external_file_name(p);
        let modified_at = external_file_modified_at(&meta);
        let now = workspace::now_iso8601();

        {
            let st = self.lock()?;
            opened_files::upsert_and_index(
                &st.conn,
                path,
                &name,
                meta.len() as i64,
                &modified_at,
                &now,
                Some(&content),
            )?;
        }

        let record = {
            let st = self.lock()?;
            opened_files::get(&st.conn, path)?
                .unwrap_or(FileRecord {
                    path_key: opened_files::path_key(path),
                    path: path.to_string(),
                    name,
                    size: meta.len() as i64,
                    modified_at,
                    opened_at: now,
                    pinned: false,
                    cursor_line: 1,
                    cursor_col: 1,
                    scroll_ratio: 0.0,
                })
        };

        Ok(OpenFilePayload { content, record })
    }

    /// 保存文件到磁盘原位（原子写盘），并刷新时间戳与全文索引。
    pub fn save_disk_file(&self, path: &str, content: &str) -> AppResult<FileRecord> {
        let p = Path::new(path);
        if let Some(parent) = p.parent() {
            if !parent.exists() {
                return Err(AppError::InvalidInput("parent directory does not exist".into()));
            }
        }

        let bytes = content.as_bytes();
        check_transfer_size(bytes.len() as u64)?;
        workspace::atomic_write(p, bytes)?;

        let meta = std::fs::metadata(p)?;
        let name = external_file_name(p);
        let modified_at = external_file_modified_at(&meta);

        {
            let st = self.lock()?;
            let touched = opened_files::touch(
                &st.conn,
                path,
                meta.len() as i64,
                &modified_at,
                Some(content),
            )?;
            if touched == 0 {
                let now = workspace::now_iso8601();
                opened_files::upsert_and_index(
                    &st.conn,
                    path,
                    &name,
                    meta.len() as i64,
                    &modified_at,
                    &now,
                    Some(content),
                )?;
            }
        }

        let record = {
            let st = self.lock()?;
            opened_files::get(&st.conn, path)?
                .unwrap_or(FileRecord {
                    path_key: opened_files::path_key(path),
                    path: path.to_string(),
                    name,
                    size: meta.len() as i64,
                    modified_at,
                    opened_at: workspace::now_iso8601(),
                    pinned: false,
                    cursor_line: 1,
                    cursor_col: 1,
                    scroll_ratio: 0.0,
                })
        };

        Ok(record)
    }

    /// 在指定磁盘位置创建新文件（如用户对未保存草稿执行另存为落盘）。
    pub fn create_disk_file(&self, path: &str, content: &str) -> AppResult<FileRecord> {
        let p = Path::new(path);
        if p.exists() {
            return Err(AppError::AlreadyExists(format!("file already exists: {path}")));
        }
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        self.save_disk_file(path, content)
    }

    /// 获取按置顶与最近打开排序的历史文件列表（附带实时磁盘存在性判断）。
    pub fn list_recent_files(&self) -> AppResult<Vec<RecentFileView>> {
        let st = self.lock()?;
        let records = opened_files::list(&st.conn)?;
        let mut views = Vec::with_capacity(records.len());
        for rec in records {
            let exists = Path::new(&rec.path).is_file();
            views.push(RecentFileView { record: rec, exists });
        }
        Ok(views)
    }

    /// 从数据库历史与全文索引中移除记录（**绝对不删除磁盘物理文件**）。
    ///
    /// 新旧两张登记表都清：同一条目可能只在旧 `external_files` 表里
    /// （历史版本记录的），只清 `opened_files` 会让「从历史移除」看似无效。
    pub fn remove_recent_file(&self, path: &str) -> AppResult<()> {
        let st = self.lock()?;
        opened_files::remove(&st.conn, path)?;
        external_files::remove(&st.conn, path)?;
        Ok(())
    }

    /// 从磁盘上彻底删除物理文件，并同步清理数据库记录。
    pub fn delete_disk_file(&self, path: &str) -> AppResult<()> {
        let p = Path::new(path);
        if p.is_file() {
            std::fs::remove_file(p)?;
        }
        let st = self.lock()?;
        opened_files::remove(&st.conn, path)?;
        external_files::remove(&st.conn, path)?;
        Ok(())
    }

    /// 全文检索所有已打开过的文件。
    pub fn search_disk_files(&self, query: &str) -> AppResult<Vec<FileSearchResult>> {
        let st = self.lock()?;
        opened_files::search(&st.conn, query, 30)
    }

    /// 更新阅读/编辑位置会话状态。
    pub fn update_file_session(
        &self,
        path: &str,
        line: u32,
        col: u32,
        scroll_ratio: f64,
    ) -> AppResult<()> {
        let st = self.lock()?;
        opened_files::update_session(&st.conn, path, line, col, scroll_ratio)?;
        Ok(())
    }

    /// 置顶/取消置顶历史文件。
    pub fn set_file_pinned(&self, path: &str, pinned: bool) -> AppResult<()> {
        {
            let st = self.lock()?;
            if opened_files::set_pinned(&st.conn, path, pinned)? > 0 {
                return Ok(());
            }
        }

        // 没匹配到历史记录：条目来自两个来源之一 ——
        // - 旧工作区文档：列表以文档 id 充当路径展示（见 Sidebar 的合并逻辑），
        //   它从未进过 opened_files 历史表，直接 UPDATE 匹配 0 行；
        // - 旧版本登记的外部文件：手里只有真实磁盘路径，同样不在历史表里
        //   （现在打开时会双写登记，但旧记录要等下一次打开才补上）。
        // 两者都按「用户打开过它一次」补记一条历史再置顶，不让置顶静默无效。
        let (record_path, title) = {
            let st = self.lock()?;
            match workspace::note_path(&st.root, path) {
                // 工作区文档：解析出真实磁盘路径，标题沿用文档表的 title，
                // 不让 UUID 文件名漏进界面。
                Ok(note) => {
                    let title = docs::get(&st.conn, path)?
                        .map(|d| d.title)
                        .unwrap_or_else(|| external_file_name(&note));
                    (note, title)
                }
                // 不是 UUID：这就是外部文件的磁盘路径本身。
                Err(_) => (PathBuf::from(path), external_file_name(Path::new(path))),
            }
        };

        let meta = std::fs::metadata(&record_path)?;
        let modified_at = external_file_modified_at(&meta);
        let st = self.lock()?;
        opened_files::upsert_and_index(
            &st.conn,
            &record_path.to_string_lossy(),
            &title,
            meta.len() as i64,
            &modified_at,
            &workspace::now_iso8601(),
            None,
        )?;
        opened_files::set_pinned(&st.conn, &record_path.to_string_lossy(), pinned)?;
        Ok(())
    }
}

/// 外部文件的显示名（取文件名；极端情况下路径以分隔符结尾）。
fn external_file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "document".into())
}

/// 外部文件的修改时间（RFC 3339）；取不到时退回当前时间。
fn external_file_modified_at(meta: &std::fs::Metadata) -> String {
    meta.modified()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
        .unwrap_or_else(|_| workspace::now_iso8601())
}

/// 导入/导出的体积校验。
///
/// 单独抽出来是为了让两侧共用同一条规则，也便于直接单测边界值。
fn check_transfer_size(bytes: u64) -> AppResult<()> {
    if bytes > workspace::MAX_TRANSFER_BYTES {
        return Err(AppError::InvalidInput(format!(
            "file is too large: {bytes} bytes (limit {} bytes)",
            workspace::MAX_TRANSFER_BYTES
        )));
    }
    Ok(())
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
pub fn duplicate_document(
    svc: tauri::State<'_, DocumentService>,
    id: String,
    title: String,
) -> AppResult<DocumentSummary> {
    svc.duplicate(&id, &title)
}

#[tauri::command]
pub fn search_documents(
    svc: tauri::State<'_, DocumentService>,
    query: String,
    limit: Option<i64>,
) -> AppResult<Vec<search::SearchHit>> {
    svc.search(&query, limit.unwrap_or(50))
}

// ---- 导入 / 导出（ARCHITECTURE.md §24 可移植 Markdown）----
//
// 路径由前端用系统文件对话框取得（tauri-plugin-dialog 只返回路径字符串），
// 真正的读写始终发生在这里 —— §7.1 要求所有文件系统访问经由应用层，
// 前端不持有 fs 权限。

/// 导出：把一篇文档的正文写到用户选定的路径，返回写入字节数。
#[tauri::command]
pub fn export_document(
    svc: tauri::State<'_, DocumentService>,
    id: String,
    target_path: String,
) -> AppResult<u64> {
    svc.export(&id, Path::new(&target_path))
}

/// 打开：把用户选定的文本或 Markdown 文件作为**新文档**收进工作区。
/// title 为 None 时用文件名（去扩展名）作为标题。
#[tauri::command]
pub fn import_document(
    svc: tauri::State<'_, DocumentService>,
    source_path: String,
    title: Option<String>,
    virtual_path: Option<String>,
) -> AppResult<DocumentSummary> {
    svc.import(
        Path::new(&source_path),
        title.as_deref(),
        virtual_path.as_deref().unwrap_or("/"),
    )
}

/// 直接读取外部磁盘文件内容（原位查看/编辑，不进行拷贝），并登记元数据。
#[tauri::command]
pub fn read_external_file(
    svc: tauri::State<'_, DocumentService>,
    path: String,
) -> AppResult<crate::model::ExternalFilePayload> {
    svc.read_external(&path)
}

/// 直接保存写回外部磁盘文件（原位保存，不拷贝进工作区），并刷新元数据。
#[tauri::command]
pub fn save_external_file(
    svc: tauri::State<'_, DocumentService>,
    path: String,
    content: String,
) -> AppResult<crate::model::ExternalFilePayload> {
    svc.save_external(&path, &content)
}

/// 列出打开过的外部文件（只有元数据与存在性，没有正文）。
#[tauri::command]
pub fn list_external_files(
    svc: tauri::State<'_, DocumentService>,
) -> AppResult<Vec<ExternalFileView>> {
    svc.list_external()
}

/// 从列表中移除一个外部文件记录（**不删除磁盘文件**）。
#[tauri::command]
pub fn forget_external_file(
    svc: tauri::State<'_, DocumentService>,
    path: String,
) -> AppResult<()> {
    svc.forget_external(&path)
}

// =========================================================================
// 文档内引用的本地资产（相对路径图片预览 / 笔记互链跳转）
// =========================================================================

/// 预览本地图片允许的扩展名（小写比较）。
const LOCAL_IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico",
];

/// 笔记互链允许的文档扩展名（与文件关联白名单一致）。
const LOCAL_DOCUMENT_EXTENSIONS: &[&str] = &["md", "markdown", "txt"];

/// 解析文档内部引用的本地路径。
///
/// 相对引用（`./imgs/x.png`、`../shared/y.md`）基于**文档所在目录**；
/// 绝对引用由 `Path::join` 语义直接生效（绝对路径会整体替换基目录）。
/// 不做 canonicalize：是否存在的判断交给调用方按需进行。
fn resolve_local_reference(document_path: &str, reference: &str) -> AppResult<PathBuf> {
    let reference = reference.trim();
    if reference.is_empty() {
        return Err(AppError::InvalidInput("empty local reference".into()));
    }
    let base = Path::new(document_path)
        .parent()
        .ok_or_else(|| AppError::InvalidInput(format!("document path has no parent: {document_path}")))?;
    Ok(base.join(reference))
}

fn local_extension(path: &Path) -> Option<String> {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
}

/// 读取文档引用的本地图片字节（预览相对路径图片用）。
///
/// 安全边界：只放行图片扩展名与传输体积上限，纯只读 —— 借这条命令
/// 既写不了盘，也读不到任意扩展名的文件。
#[tauri::command]
pub fn read_local_asset(document_path: String, reference: String) -> AppResult<Vec<u8>> {
    let path = resolve_local_reference(&document_path, &reference)?;
    if !path.is_file() {
        return Err(AppError::NotFound(path.to_string_lossy().into_owned()));
    }
    let ext = local_extension(&path).unwrap_or_default();
    if !LOCAL_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(AppError::InvalidInput(format!("not an image asset: {ext}")));
    }
    let meta = std::fs::metadata(&path)?;
    check_transfer_size(meta.len())?;
    Ok(std::fs::read(path)?)
}

/// 解析文档内部链接指向的本地 Markdown/文本文件，返回规范绝对路径。
///
/// canonicalize 清理 `..` 段与盘符大小写 —— 返回值进「最近文件」登记表时，
/// `path_key` 才与正常打开同一文件的记录一致。Windows 的 canonicalize
/// 带 `\\?\` 前缀，必须剥掉，否则同一文件会出现两种拼写的记录。
#[tauri::command]
pub fn resolve_local_link(document_path: String, reference: String) -> AppResult<String> {
    let path = resolve_local_reference(&document_path, &reference)?;
    if !path.is_file() {
        return Err(AppError::NotFound(path.to_string_lossy().into_owned()));
    }
    let ext = local_extension(&path).unwrap_or_default();
    if !LOCAL_DOCUMENT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(AppError::InvalidInput(format!(
            "not a supported document: {ext}"
        )));
    }
    let canonical = path.canonicalize()?;
    let mut text = canonical.to_string_lossy().into_owned();
    if let Some(stripped) = text.strip_prefix(r"\\?\") {
        text = stripped.to_string();
    }
    Ok(text)
}

// ---- 在系统文件管理器中定位文件（右键菜单「打开文件所在位置」）----

/// 调起系统文件管理器并选中目标文件。
///
/// 只做「揭示」，不做任何读写；失败必须冒泡给界面：`reveal_item_in_dir`
/// 会先规范化路径，文件已被移走或删除时它会报错，而一个静默失败的菜单项
/// 与坏掉的菜单项在用户眼里没有区别。
fn reveal_path(app: &tauri::AppHandle, path: &Path) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;

    app.opener().reveal_item_in_dir(path).map_err(|e| {
        AppError::Io(std::io::Error::other(format!(
            "cannot reveal in file manager: {e}"
        )))
    })
}

/// 在工作区文档所在目录中定位它（路径由应用层解析，前端不拼路径）。
#[tauri::command]
pub fn reveal_document(
    app: tauri::AppHandle,
    svc: tauri::State<'_, DocumentService>,
    id: String,
) -> AppResult<()> {
    reveal_path(&app, &svc.note_path(&id)?)
}

/// 在外部磁盘文件所在目录中定位它（`ext:` 标签页原位打开的文件）。
#[tauri::command]
pub fn reveal_external_file(
    app: tauri::AppHandle,
    svc: tauri::State<'_, DocumentService>,
    path: String,
) -> AppResult<()> {
    reveal_path(&app, &svc.external_path(&path)?)
}

// =========================================================================
// 统一磁盘文件 Tauri 命令（编辑器/阅读器模式）
// =========================================================================

#[tauri::command]
pub fn open_file(
    svc: tauri::State<'_, DocumentService>,
    path: String,
) -> AppResult<OpenFilePayload> {
    svc.open_disk_file(&path)
}

#[tauri::command]
pub fn save_file(
    svc: tauri::State<'_, DocumentService>,
    path: String,
    content: String,
) -> AppResult<FileRecord> {
    svc.save_disk_file(&path, &content)
}

#[tauri::command]
pub fn create_file(
    svc: tauri::State<'_, DocumentService>,
    path: String,
    content: String,
) -> AppResult<FileRecord> {
    svc.create_disk_file(&path, &content)
}

#[tauri::command]
pub fn list_recent_files(
    svc: tauri::State<'_, DocumentService>,
) -> AppResult<Vec<RecentFileView>> {
    svc.list_recent_files()
}

#[tauri::command]
pub fn remove_from_history(
    svc: tauri::State<'_, DocumentService>,
    path: String,
) -> AppResult<()> {
    svc.remove_recent_file(&path)
}

#[tauri::command]
pub fn delete_file_on_disk(
    svc: tauri::State<'_, DocumentService>,
    path: String,
) -> AppResult<()> {
    svc.delete_disk_file(&path)
}

#[tauri::command]
pub fn search_files(
    svc: tauri::State<'_, DocumentService>,
    query: String,
) -> AppResult<Vec<FileSearchResult>> {
    svc.search_disk_files(&query)
}

#[tauri::command]
pub fn update_file_session(
    svc: tauri::State<'_, DocumentService>,
    path: String,
    cursor_line: u32,
    cursor_col: u32,
    scroll_ratio: f64,
) -> AppResult<()> {
    svc.update_file_session(&path, cursor_line, cursor_col, scroll_ratio)
}

#[tauri::command]
pub fn set_file_pinned(
    svc: tauri::State<'_, DocumentService>,
    path: String,
    pinned: bool,
) -> AppResult<()> {
    svc.set_file_pinned(&path, pinned)
}

#[tauri::command]
pub fn reveal_file(app: tauri::AppHandle, path: String) -> AppResult<()> {
    reveal_path(&app, Path::new(&path))
}

// ---- 应用设置（UI_DESIGN_SYSTEM.md §34）----
//
// 配置与应用状态的关系：
// - 工作区根路径存在**应用配置目录**，而不是工作区里 —— 否则成鸡生蛋。
// - 切换工作区走 DocumentService::switch_workspace 的「先验证后交换」。

/// 「媒体/文档」等平台默认目录，作为设置页里「恢复默认」的落点。
#[tauri::command]
pub fn default_workspace_root(app: tauri::AppHandle) -> AppResult<String> {
    use tauri::Manager;
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::InvalidInput(format!("cannot resolve app data dir: {e}")))?;
    Ok(base.join("workspace").to_string_lossy().into_owned())
}

/// 读取当前设置 + 实际生效的工作区根（含默认值与来源）。
#[tauri::command]
pub fn get_settings(
    app: tauri::AppHandle,
    svc: tauri::State<'_, DocumentService>,
) -> AppResult<AppSettingsView> {
    let (settings, config_dir) = read_settings(&app)?;
    let effective = svc.root()?;
    Ok(AppSettingsView {
        workspace_root: settings.workspace_root,
        effective_workspace_root: effective.to_string_lossy().into_owned(),
        // 环境变量优先于设置文件，界面要能如实说明来源。
        workspace_root_is_from_env: std::env::var("CRAB_MD_WORKSPACE")
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false),
        config_path: settings::settings_path(&config_dir).to_string_lossy().into_owned(),
        version: settings.version,
    })
}

/// 指定新的工作区根并立即切换。
#[tauri::command]
pub fn set_workspace_root(
    app: tauri::AppHandle,
    svc: tauri::State<'_, DocumentService>,
    path: String,
) -> AppResult<AppSettingsView> {
    let validated = settings::validate_workspace_root(&path)?;
    let (mut settings, config_dir) = read_settings(&app)?;

    // 先切换服务（内部会真正打开新工作区，失败则原状态毫发无损），
    // 只有切换成功才落盘配置 —— 顺序反了会出现「配置指向打不开的目录」。
    svc.switch_workspace(validated.clone())?;

    settings.workspace_root = Some(validated.to_string_lossy().into_owned());
    settings::save(&config_dir, &settings)?;

    get_settings(app, svc)
}

/// 清除自定义路径，回到平台默认位置。
#[tauri::command]
pub fn reset_workspace_root(
    app: tauri::AppHandle,
    svc: tauri::State<'_, DocumentService>,
) -> AppResult<AppSettingsView> {
    let (mut settings, config_dir) = read_settings(&app)?;
    settings.workspace_root = None;

    // 默认位置来自 app_data_dir；用与启动相同的规则推出来。
    let default_root = {
        use tauri::Manager;
        let base = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::InvalidInput(format!("cannot resolve app data dir: {e}")))?;
        base.join("workspace")
    };
    svc.switch_workspace(default_root)?;

    settings::save(&config_dir, &settings)?;
    get_settings(app, svc)
}

/// 读取设置文件与其所在目录。配置目录取不到时返回默认设置 +
/// 应用数据目录作为兜底，保证设置页仍能打开而不是整页报错。
fn read_settings(app: &tauri::AppHandle) -> AppResult<(settings::Settings, PathBuf)> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|e| AppError::InvalidInput(format!("cannot resolve config dir: {e}")))?;
    Ok((settings::load(&dir), dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 工作区外的独立临时目录，用于放置导入来源/导出目标。
    /// 被测的工作区本身是另一个 tempdir —— 混用会让「在工作区外」的守卫误判。
    fn outside() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

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
    fn pinning_a_workspace_document_creates_its_history_record() {
        let (_d, svc) = svc();
        let created = svc.create("开题笔记", "/").unwrap();

        // 文档从未打开过（历史表为空）：置顶不得静默无效，
        // 而是补建历史记录并置顶。
        svc.set_file_pinned(&created.id, true).unwrap();

        let recent = svc.list_recent_files().unwrap();
        assert_eq!(recent.len(), 1);
        assert!(recent[0].record.pinned, "pinned should be true");
        assert_eq!(recent[0].record.name, "开题笔记", "界面显示文档标题，不是 UUID 文件名");
        assert!(recent[0].record.path.contains(&created.id));
        assert!(recent[0].exists, "补记的历史指向真实磁盘文件");

        // 取消置顶：这次按补记出的真实路径走 UPDATE，同样要生效。
        svc.set_file_pinned(&created.id, false).unwrap();
        let recent = svc.list_recent_files().unwrap();
        assert!(!recent[0].record.pinned);
    }

    #[test]
    fn pinning_a_legacy_external_path_creates_its_history_record() {
        // 旧版本只登记在 external_files 里的条目：手里是磁盘路径而不是文档 id，
        // 置顶同样不得静默无效（合并进文件树之后用户点得到它）。
        let (_d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "legacy.md", "x");
        let path = file.to_string_lossy().into_owned();

        svc.set_file_pinned(&path, true).unwrap();

        let recent = svc.list_recent_files().unwrap();
        assert_eq!(recent.len(), 1);
        assert!(recent[0].record.pinned);
        assert_eq!(recent[0].record.path, path);
        assert_eq!(recent[0].record.name, "legacy.md");
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
        assert!(matches!(svc.note_path(evil), Err(AppError::InvalidId(_))));
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

    // ---- 另存为副本（duplicate）----

    #[test]
    fn duplicate_copies_content_under_a_new_identity() {
        let (_d, svc) = svc();
        let original = svc.create("原本", "/").unwrap();
        svc.save(&original.id, "# 正文\n\n内容").unwrap();

        let copy = svc.duplicate(&original.id, "原本 副本").unwrap();

        assert_ne!(copy.id, original.id, "副本必须是新身份（§11）");
        assert_eq!(copy.title, "原本 副本");
        assert_eq!(svc.read(&copy.id).unwrap().content, "# 正文\n\n内容");
    }

    #[test]
    fn duplicate_leaves_the_original_untouched() {
        let (_d, svc) = svc();
        let original = svc.create("原本", "/").unwrap();
        svc.save(&original.id, "原始内容").unwrap();
        let before = svc.read(&original.id).unwrap();

        svc.duplicate(&original.id, "副本").unwrap();

        let after = svc.read(&original.id).unwrap();
        assert_eq!(after.content, "原始内容", "原文档内容不得改变");
        assert_eq!(after.summary.title, "原本", "原标题不得改变");
        assert_eq!(after.summary.revision, before.summary.revision, "原版本号不得改变");
        assert_eq!(after.summary.content_hash, before.summary.content_hash);
    }

    #[test]
    fn duplicate_writes_its_own_file_on_disk() {
        let (d, svc) = svc();
        let original = svc.create("A", "/").unwrap();
        svc.save(&original.id, "body").unwrap();

        let copy = svc.duplicate(&original.id, "B").unwrap();

        let orig_path = workspace::note_path(d.path(), &original.id).unwrap();
        let copy_path = workspace::note_path(d.path(), &copy.id).unwrap();
        assert!(orig_path.is_file() && copy_path.is_file());
        assert_ne!(orig_path, copy_path, "两者必须是不同文件");
        // 两份文件内容一致，但各自独立。
        assert_eq!(std::fs::read_to_string(&copy_path).unwrap(), "body");
        assert_eq!(std::fs::read_to_string(&orig_path).unwrap(), "body");
    }

    #[test]
    fn duplicate_keeps_the_virtual_folder() {
        let (_d, svc) = svc();
        let original = svc.create("A", "/笔记/Go/").unwrap();
        let copy = svc.duplicate(&original.id, "B").unwrap();
        assert_eq!(copy.virtual_path, "/笔记/Go/", "副本应留在同一文件夹");
    }

    #[test]
    fn duplicate_starts_at_revision_one() {
        let (_d, svc) = svc();
        let original = svc.create("A", "/").unwrap();
        // 把原文改到 revision 3，副本仍应是全新的第 1 版。
        svc.save(&original.id, "v2").unwrap();
        svc.save(&original.id, "v3").unwrap();
        let copy = svc.duplicate(&original.id, "B").unwrap();
        assert_eq!(copy.revision, 1);
    }

    #[test]
    fn duplicate_records_the_right_size_and_hash() {
        let (_d, svc) = svc();
        let original = svc.create("A", "/").unwrap();
        let body = "内容 with unicode 🦀";
        svc.save(&original.id, body).unwrap();

        let copy = svc.duplicate(&original.id, "B").unwrap();
        assert_eq!(copy.size, body.len() as i64);
        assert_eq!(copy.content_hash, workspace::content_hash(body));
    }

    #[test]
    fn duplicate_makes_the_copy_searchable_under_its_new_title() {
        let (_d, svc) = svc();
        let original = svc.create("alpha", "/").unwrap();
        svc.save(&original.id, "并发编程与信道").unwrap();

        svc.duplicate(&original.id, "beta").unwrap();

        // 副本的标题与正文都要进索引。
        assert_eq!(svc.search("beta", 10).unwrap().len(), 1, "副本标题应可检索");
        assert_eq!(svc.search("并发", 10).unwrap().len(), 2, "原文与副本各一条");
    }

    #[test]
    fn duplicate_appears_in_the_list_alongside_the_original() {
        let (_d, svc) = svc();
        let original = svc.create("A", "/").unwrap();
        svc.duplicate(&original.id, "B").unwrap();
        assert_eq!(svc.list().unwrap().len(), 2);
    }

    #[test]
    fn duplicate_rejects_a_blank_title() {
        let (_d, svc) = svc();
        let original = svc.create("A", "/").unwrap();
        assert!(matches!(svc.duplicate(&original.id, "  "), Err(AppError::InvalidInput(_))));
        assert_eq!(svc.list().unwrap().len(), 1, "被拒绝时不得留下副本");
    }

    #[test]
    fn duplicate_of_a_missing_document_fails_without_writing_anything() {
        let (d, svc) = svc();
        let ghost = workspace::new_document_id();
        assert!(matches!(svc.duplicate(&ghost, "X"), Err(AppError::NotFound(_))));
        assert!(svc.list().unwrap().is_empty());
        assert!(!workspace::note_path(d.path(), &ghost).unwrap().exists());
    }

    #[test]
    fn duplicate_rejects_hostile_ids() {
        let (_d, svc) = svc();
        assert!(matches!(
            svc.duplicate("../../etc/passwd", "X"),
            Err(AppError::InvalidId(_))
        ));
    }

    #[test]
    fn duplicate_survives_a_workspace_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();

        let copy_id = {
            let svc = DocumentService::new(root.clone()).unwrap();
            let original = svc.create("原本", "/").unwrap();
            svc.save(&original.id, "# 要保留的内容").unwrap();
            svc.duplicate(&original.id, "副本").unwrap().id
        };

        let svc2 = DocumentService::new(root).unwrap();
        assert_eq!(svc2.read(&copy_id).unwrap().content, "# 要保留的内容");
        assert_eq!(svc2.list().unwrap().len(), 2);
    }

    // ---- 切换工作区（数据目录可配置）----

    #[test]
    fn switch_workspace_moves_to_the_new_root() {
        let (d, svc) = svc();
        let other = d.path().join("other");

        let landed = svc.switch_workspace(other.clone()).unwrap();

        assert_eq!(landed, other);
        assert_eq!(svc.root().unwrap(), other);
    }

    #[test]
    fn switch_workspace_shows_the_other_workspaces_documents() {
        let (d, svc) = svc();
        svc.create("旧工作区的笔记", "/").unwrap();

        let other = d.path().join("other");
        svc.switch_workspace(other.clone()).unwrap();

        // 新工作区是空的，看不到旧工作区的文档。
        assert!(svc.list().unwrap().is_empty());

        // 在新工作区建的文档，切回去看不到。
        svc.create("新工作区的笔记", "/").unwrap();
        assert_eq!(svc.list().unwrap().len(), 1);
    }

    #[test]
    fn switching_back_restores_the_original_documents() {
        let (d, svc) = svc();
        let first_root = d.path().join("first");
        let second_root = d.path().join("second");

        svc.switch_workspace(first_root.clone()).unwrap();
        let saved = svc.create("留在 first 的笔记", "/").unwrap();
        svc.save(&saved.id, "正文").unwrap();

        svc.switch_workspace(second_root).unwrap();
        assert!(svc.list().unwrap().is_empty(), "second 应独立为空");

        svc.switch_workspace(first_root).unwrap();
        let list = svc.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, saved.id);
        assert_eq!(svc.read(&saved.id).unwrap().content, "正文");
    }

    #[test]
    fn switching_to_a_new_directory_creates_the_workspace_layout() {
        let (d, svc) = svc();
        let fresh = d.path().join("brand-new");

        svc.switch_workspace(fresh.clone()).unwrap();

        assert!(fresh.join("notes").is_dir());
        assert!(fresh.join("attachments").is_dir());
        assert!(fresh.join(".app").is_dir());
    }

    #[test]
    fn switching_to_the_same_root_is_a_no_op() {
        let (d, svc) = svc();
        let root = d.path().join("same");

        svc.switch_workspace(root.clone()).unwrap();
        let doc = svc.create("保留我", "/").unwrap();

        // 再切到同一目录不应清空或重建任何东西。
        svc.switch_workspace(root).unwrap();
        assert_eq!(svc.list().unwrap().len(), 1);
        assert_eq!(svc.list().unwrap()[0].id, doc.id);
    }

    #[test]
    fn a_failed_switch_leaves_the_current_workspace_untouched() {
        // 用一个**文件**充当工作区根：建目录会失败，切换必须整体失败。
        let (d, svc) = svc();
        let keeper = d.path().join("keeper");
        svc.switch_workspace(keeper.clone()).unwrap();
        let doc = svc.create("不能丢", "/").unwrap();

        let blocker = d.path().join("blocker");
        std::fs::write(&blocker, b"i am a file").unwrap();

        let result = svc.switch_workspace(blocker);

        assert!(result.is_err(), "在文件上建工作区必须失败");
        // 关键：失败后当前工作区仍然可用，文档还在。
        assert_eq!(svc.root().unwrap(), keeper);
        assert_eq!(svc.list().unwrap().len(), 1);
        assert_eq!(svc.read(&doc.id).unwrap().summary.title, "不能丢");
    }

    #[test]
    fn documents_written_after_a_switch_land_in_the_new_root() {
        let (d, svc) = svc();
        let other = d.path().join("other");
        svc.switch_workspace(other.clone()).unwrap();

        let doc = svc.create("新文档", "/").unwrap();
        svc.save(&doc.id, "内容").unwrap();

        // 文件必须落在新工作区，而不是旧工作区。
        let path = workspace::note_path(&other, &doc.id).unwrap();
        assert!(path.is_file(), "expected {} to exist", path.display());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "内容");
    }

    #[test]
    fn search_works_against_the_switched_workspace() {
        let (d, svc) = svc();
        let other = d.path().join("other");
        svc.switch_workspace(other).unwrap();

        let doc = svc.create("检索目标", "/").unwrap();
        svc.save(&doc.id, "并发编程与信道").unwrap();

        // 新工作区的索引必须可用（不是沿用旧库的索引）。
        assert_eq!(svc.search("并发", 10).unwrap().len(), 1);
    }

    // ---- 导入 / 导出 ----

    #[test]
    fn export_writes_the_exact_document_body() {
        let (d, svc) = svc();
        let doc = svc.create("导出的文档", "/").unwrap();
        let body = "# 标题\n\n并发编程与信道 🦀\n";
        svc.save(&doc.id, body).unwrap();

        let out = outside();
        let target = out.path().join("out.md");
        let written = svc.export(&doc.id, &target).unwrap();

        assert_eq!(written, body.len() as u64);
        // 导出的必须是**纯正文**：不带任何应用私有元数据。
        assert_eq!(std::fs::read_to_string(&target).unwrap(), body);
    }

    #[test]
    fn export_refuses_a_target_inside_the_workspace() {
        // 写进工作区会绕过 UUID 命名规则，制造库与磁盘不一致的孤儿文件。
        let (d, svc) = svc();
        let doc = svc.create("x", "/").unwrap();
        let inside = d.path().join(workspace::NOTES_DIR).join("sneaky.md");

        let err = svc.export(&doc.id, &inside).unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
        assert!(!inside.exists(), "must not have written anything");
    }

    #[test]
    fn export_reports_not_found_for_unknown_id() {
        let (d, svc) = svc();
        let out = outside();
        let target = out.path().join("out.md");
        let err = svc
            .export("01993ab2-0000-7000-8000-000000000000", &target)
            .unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");
        assert!(!target.exists());
    }

    #[test]
    fn export_rejects_an_invalid_document_id() {
        let (d, svc) = svc();
        let err = svc
            .export("../../etc/passwd", &outside().path().join("out.md"))
            .unwrap_err();
        assert_eq!(err.code(), "INVALID_ID");
    }

    #[test]
    fn import_creates_a_new_document_with_the_file_body() {
        let (d, svc) = svc();
        let src = outside();
        let source = src.path().join("incoming.md");
        std::fs::write(&source, "# 导入的笔记\n\n正文").unwrap();

        let created = svc.import(&source, None, "/").unwrap();

        assert_eq!(created.title, "incoming");
        assert_eq!(created.revision, 1);
        assert_eq!(created.size, "# 导入的笔记\n\n正文".len() as i64);
        assert_eq!(svc.read(&created.id).unwrap().content, "# 导入的笔记\n\n正文");
        // 索引也要更新，否则导入的内容搜不到。
        assert_eq!(svc.search("导入", 10).unwrap().len(), 1);
    }

    #[test]
    fn import_accepts_plain_text_files() {
        let (d, svc) = svc();
        let src = outside();
        let source = src.path().join("plain.txt");
        std::fs::write(&source, "纯文本内容").unwrap();

        let created = svc.import(&source, None, "/").unwrap();

        assert_eq!(created.title, "plain");
        assert_eq!(svc.read(&created.id).unwrap().content, "纯文本内容");
    }

    #[test]
    fn import_uses_the_explicit_title_when_given() {
        let (d, svc) = svc();
        let src = outside();
        let source = src.path().join("whatever.md");
        std::fs::write(&source, "x").unwrap();

        let created = svc.import(&source, Some("我的标题"), "/").unwrap();
        assert_eq!(created.title, "我的标题");
    }

    #[test]
    fn import_falls_back_to_filename_when_title_is_blank() {
        // 空白标题必须回退，否则会建出一篇没有标题的文档。
        let (d, svc) = svc();
        let src = outside();
        let source = src.path().join("note.md");
        std::fs::write(&source, "x").unwrap();

        let created = svc.import(&source, Some("   "), "/").unwrap();
        assert_eq!(created.title, "note");
    }

    #[test]
    fn import_gets_a_fresh_identity_detached_from_the_source_file() {
        // §11：身份由 UUID 承载，不依赖来源路径或文件名。
        let (d, svc) = svc();
        let src = outside();
        let source = src.path().join("same.md");
        std::fs::write(&source, "内容").unwrap();

        let first = svc.import(&source, None, "/").unwrap();
        let second = svc.import(&source, None, "/").unwrap();

        assert_ne!(first.id, second.id, "each import is an independent document");
        // 重复导入不该覆盖既有文档。
        assert_eq!(svc.list().unwrap().len(), 2);
    }

    #[test]
    fn import_refuses_a_source_inside_the_workspace() {
        let (d, svc) = svc();
        let source = d.path().join(workspace::NOTES_DIR).join("already.md");
        std::fs::write(&source, "x").unwrap();

        let err = svc.import(&source, None, "/").unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
    }

    #[test]
    fn import_rejects_a_directory() {
        let (d, svc) = svc();
        let src = outside();
        let dir = src.path().join("a-directory");
        std::fs::create_dir(&dir).unwrap();

        let err = svc.import(&dir, None, "/").unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
    }

    #[test]
    fn import_reports_io_error_for_a_missing_file() {
        let (d, svc) = svc();
        let src = outside();
        let err = svc.import(&src.path().join("nope.md"), None, "/").unwrap_err();
        assert_eq!(err.code(), "IO_ERROR");
    }

    #[test]
    fn transfer_size_limit_accepts_the_boundary_and_rejects_beyond() {
        // 边界必须精确：正好等于上限可通过，多一字节就拒绝。
        assert!(check_transfer_size(workspace::MAX_TRANSFER_BYTES).is_ok());
        let err = check_transfer_size(workspace::MAX_TRANSFER_BYTES + 1).unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
    }

    #[test]
    fn import_rejects_a_file_over_the_size_limit() {
        // 不先看大小就 read_to_string，等于把「选中一个巨大文件」变成 OOM。
        let (d, svc) = svc();
        let src = outside();
        let source = src.path().join("huge.md");
        let big = vec![b'a'; (workspace::MAX_TRANSFER_BYTES + 1) as usize];
        std::fs::write(&source, &big).unwrap();

        let err = svc.import(&source, None, "/").unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
        assert!(svc.list().unwrap().is_empty(), "nothing may be recorded");
    }

    #[test]
    fn export_rejects_a_document_over_the_size_limit() {
        let (d, svc) = svc();
        let doc = svc.create("大文档", "/").unwrap();
        // 直接写文件绕过 save（save 无大小限制，只有导入导出才有）。
        let big = "a".repeat((workspace::MAX_TRANSFER_BYTES + 1) as usize);
        workspace::atomic_write(&workspace::note_path(d.path(), &doc.id).unwrap(), big.as_bytes())
            .unwrap();

        let out = outside();
        let target = out.path().join("out.md");
        let err = svc.export(&doc.id, &target).unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
        assert!(!target.exists(), "must not leave a partial file");
    }

    #[test]
    fn imported_document_survives_reopening_the_workspace() {
        // 导入的正文必须真正落到 notes/ 下的 UUID 文件里，
        // 而不是只存在内存或数据库里。
        let (d, svc) = svc();
        let src = outside();
        let source = src.path().join("persist.md");
        std::fs::write(&source, "持久化内容").unwrap();
        let created = svc.import(&source, None, "/").unwrap();

        let reopened = DocumentService::new(d.path().to_path_buf()).unwrap();
        assert_eq!(reopened.read(&created.id).unwrap().content, "持久化内容");
    }

    // ---- note_path：为「打开文件所在位置」解析磁盘路径 ----

    #[test]
    fn note_path_resolves_a_real_document_to_its_file() {
        let (d, svc) = svc();
        let created = svc.create("定位我", "/").unwrap();

        let resolved = svc.note_path(&created.id).unwrap();
        assert_eq!(
            resolved,
            workspace::note_path(d.path(), &created.id).unwrap()
        );
        assert!(
            resolved.is_file(),
            "expected {} to exist",
            resolved.display()
        );
    }

    #[test]
    fn note_path_rejects_a_hostile_id_before_touching_the_filesystem() {
        // 前端的 `ext:` 标签页 id 就是「绝对路径前缀」，绝不能拼进工作区路径。
        let (_d, svc) = svc();
        let err = svc.note_path("ext:E:\\notes\\外部.md").unwrap_err();
        assert_eq!(err.code(), "INVALID_ID");
    }

    #[test]
    fn note_path_reports_not_found_when_the_file_is_gone() {
        // 文件被外部删除时，定位必须给出可理解的失败，而不是静默无反应。
        let (d, svc) = svc();
        let created = svc.create("会被删掉", "/").unwrap();
        std::fs::remove_file(workspace::note_path(d.path(), &created.id).unwrap()).unwrap();

        let err = svc.note_path(&created.id).unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");
    }

    // ---- 外部文件：原位打开 + 元数据入库（重启后仍可见）----

    /// 在工作区**之外**写一个真实文件，返回其路径。
    fn external_file(dir: &tempfile::TempDir, name: &str, body: &str) -> PathBuf {
        let p = dir.path().join(name);
        std::fs::write(&p, body).unwrap();
        p
    }

    #[test]
    fn opening_an_external_file_records_metadata_but_not_content() {
        let (_d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "外部笔记.md", "# 标题\n正文");
        let path = file.to_string_lossy().into_owned();

        let payload = svc.read_external(&path).unwrap();
        assert_eq!(payload.content, "# 标题\n正文");
        assert_eq!(payload.name, "外部笔记.md");

        let listed = svc.list_external().unwrap();
        assert_eq!(listed.len(), 1, "opened file must be recorded");
        assert_eq!(listed[0].path, path);
        assert_eq!(listed[0].name, "外部笔记.md");
        assert!(!listed[0].missing);
    }

    #[test]
    fn an_external_file_is_still_listed_after_reopening_the_workspace() {
        // 用户报告的核心问题：重启后必须还能看到、还能打开，
        // 而不是重新走一遍文件选择器。
        let (d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "persist.md", "第一版");
        let path = file.to_string_lossy().into_owned();
        svc.read_external(&path).unwrap();
        drop(svc);

        let reopened = DocumentService::new(d.path().to_path_buf()).unwrap();
        let listed = reopened.list_external().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].path, path);

        // 重新打开走的还是磁盘上的原文件，内容是最新的（可能已被别的程序改过）。
        std::fs::write(&file, "第二版").unwrap();
        assert_eq!(reopened.read_external(&path).unwrap().content, "第二版");
    }

    #[test]
    fn opening_the_same_external_file_twice_keeps_one_record() {
        let (_d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "dup.md", "x");
        let path = file.to_string_lossy().into_owned();

        svc.read_external(&path).unwrap();
        svc.read_external(&path).unwrap();
        assert_eq!(svc.list_external().unwrap().len(), 1);
    }

    #[test]
    fn an_external_open_also_enters_the_unified_history() {
        // 用户报告的核心问题：文件关联打开的文件必须出现在左侧文件树。
        // 文件树读的是 opened_files 统一登记表 —— 打开时必须双写。
        let (_d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "关联打开.md", "独一无二的关键词");
        let path = file.to_string_lossy().into_owned();

        svc.read_external(&path).unwrap();

        let recent = svc.list_recent_files().unwrap();
        assert_eq!(recent.len(), 1, "external open must register in opened_files");
        assert_eq!(recent[0].record.path, path);
        assert_eq!(recent[0].record.name, "关联打开.md");
        assert!(recent[0].exists);

        // 正文同时进全文索引，与 open_file 的行为一致。
        let hits = svc.search_disk_files("独一无二").unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, path);
    }

    #[test]
    fn saving_an_external_file_refreshes_the_unified_history() {
        let (_d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "save.md", "旧内容");
        let path = file.to_string_lossy().into_owned();
        svc.read_external(&path).unwrap();

        svc.save_external(&path, "全新的正文").unwrap();

        let recent = svc.list_recent_files().unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].record.size, "全新的正文".len() as i64);
        // 全文索引换成新正文后，旧内容不再命中。
        assert!(svc.search_disk_files("旧内容").unwrap().is_empty());
    }

    #[test]
    fn removing_from_history_clears_both_registries() {
        // 侧栏「从历史记录中移除」只清 opened_files 的话，
        // 只登记在旧外部清单里的条目会永远删不掉。
        let (_d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "remove-me.md", "x");
        let path = file.to_string_lossy().into_owned();
        svc.read_external(&path).unwrap();

        svc.remove_recent_file(&path).unwrap();

        assert!(svc.list_recent_files().unwrap().is_empty());
        assert!(svc.list_external().unwrap().is_empty());
    }

    // ---- 文档内引用的本地资产（相对路径图片 / 笔记互链）----

    #[test]
    fn reading_a_local_asset_resolves_relative_to_the_document() {
        let base = tempfile::tempdir().unwrap();
        let imgs = base.path().join("images");
        std::fs::create_dir(&imgs).unwrap();
        let img = imgs.join("pic.png");
        std::fs::write(&img, b"\x89PNG bytes").unwrap();
        let doc = base.path().join("note.md");
        std::fs::write(&doc, "").unwrap();
        let doc_path = doc.to_string_lossy().into_owned();

        let bytes = read_local_asset(doc_path.clone(), "./images/pic.png".into()).unwrap();
        assert_eq!(bytes, b"\x89PNG bytes".to_vec());

        // `../` 与不带 `./` 前缀的引用同样基于文档目录。
        let other = base.path().join("other.jpg");
        std::fs::write(&other, b"jpeg").unwrap();
        assert_eq!(
            read_local_asset(doc_path, "other.jpg".into()).unwrap(),
            b"jpeg".to_vec()
        );
    }

    #[test]
    fn an_absolute_asset_reference_wins_over_the_document_directory() {
        let base = tempfile::tempdir().unwrap();
        let doc = base.path().join("note.md");
        std::fs::write(&doc, "").unwrap();

        let elsewhere = tempfile::tempdir().unwrap();
        let img = elsewhere.path().join("abs.png");
        std::fs::write(&img, b"abs").unwrap();

        let bytes = read_local_asset(
            doc.to_string_lossy().into_owned(),
            img.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(bytes, b"abs".to_vec());
    }

    #[test]
    fn a_local_asset_refuse_non_images_and_missing_files() {
        let base = tempfile::tempdir().unwrap();
        let doc = base.path().join("note.md");
        std::fs::write(&doc, "").unwrap();
        let secret = base.path().join("secret.md");
        std::fs::write(&secret, "text").unwrap();
        let doc_path = doc.to_string_lossy().into_owned();

        // 只放行图片扩展名：这条命令不能变成「读任意文件」。
        let err = read_local_asset(doc_path.clone(), "secret.md".into()).unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");

        let err = read_local_asset(doc_path.clone(), "images/missing.png".into()).unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");

        let err = read_local_asset(doc_path, "   ".into()).unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
    }

    #[test]
    fn a_local_asset_refuses_oversized_files() {
        let base = tempfile::tempdir().unwrap();
        let doc = base.path().join("note.md");
        std::fs::write(&doc, "").unwrap();
        let huge = base.path().join("huge.png");
        // 稀疏文件：不真写 10MB，只把长度撑过上限。
        std::fs::File::create(&huge)
            .unwrap()
            .set_len(workspace::MAX_TRANSFER_BYTES + 1)
            .unwrap();

        let err = read_local_asset(
            doc.to_string_lossy().into_owned(),
            huge.to_string_lossy().into_owned(),
        )
        .unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
    }

    #[test]
    fn resolving_a_local_link_returns_a_clean_absolute_path() {
        let base = tempfile::tempdir().unwrap();
        let doc = base.path().join("note.md");
        std::fs::write(&doc, "").unwrap();
        let sibling = base.path().join("其他笔记.md");
        std::fs::write(&sibling, "# 下一节").unwrap();
        let doc_path = doc.to_string_lossy().into_owned();

        let resolved = resolve_local_link(doc_path, "其他笔记.md".into()).unwrap();
        let expected = sibling.canonicalize().unwrap().to_string_lossy().into_owned();
        let expected = expected.strip_prefix(r"\\?\").unwrap_or(&expected).to_string();
        assert_eq!(Path::new(&resolved), Path::new(&expected));
        assert!(!resolved.starts_with(r"\\?\"), "canonicalize 的 UNC 前缀必须剥掉");
    }

    #[test]
    fn resolving_a_local_link_rejects_missing_and_non_documents() {
        let base = tempfile::tempdir().unwrap();
        let doc = base.path().join("note.md");
        std::fs::write(&doc, "").unwrap();
        let img = base.path().join("pic.png");
        std::fs::write(&img, b"png").unwrap();
        let doc_path = doc.to_string_lossy().into_owned();

        let err = resolve_local_link(doc_path.clone(), "missing.md".into()).unwrap_err();
        assert_eq!(err.code(), "NOT_FOUND");

        let err = resolve_local_link(doc_path.clone(), "pic.png".into()).unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
    }

    #[test]
    fn a_failed_open_leaves_no_record() {
        // 读取失败（文件不存在）不该在列表里留下一条点不开的记录。
        let (_d, svc) = svc();
        let outside = outside();
        let ghost = outside.path().join("missing.md");

        assert!(svc.read_external(&ghost.to_string_lossy()).is_err());
        assert!(svc.list_external().unwrap().is_empty());
    }

    #[test]
    fn saving_an_external_file_updates_it_on_disk_and_in_the_catalog() {
        let (_d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "save.md", "旧内容");
        let path = file.to_string_lossy().into_owned();
        svc.read_external(&path).unwrap();

        let saved = svc.save_external(&path, "新内容 with 🦀").unwrap();
        assert_eq!(saved.size, "新内容 with 🦀".len() as i64);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "新内容 with 🦀");

        let listed = svc.list_external().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].size, "新内容 with 🦀".len() as i64);
    }

    #[test]
    fn saving_an_external_file_never_touches_the_workspace() {
        // 原位保存只写用户那个文件；工作区里不得多出任何文档。
        let (d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "outside.md", "x");
        let path = file.to_string_lossy().into_owned();

        svc.save_external(&path, "y").unwrap();
        assert!(svc.list().unwrap().is_empty(), "no workspace document created");
        let notes: Vec<_> = std::fs::read_dir(d.path().join(workspace::NOTES_DIR))
            .unwrap()
            .filter_map(|e| e.ok())
            .collect();
        assert!(notes.is_empty(), "notes/ must stay empty");
    }

    #[test]
    fn saving_an_external_file_over_the_size_limit_writes_nothing() {
        let (_d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "big.md", "original");
        let path = file.to_string_lossy().into_owned();

        let big = "a".repeat((workspace::MAX_TRANSFER_BYTES + 1) as usize);
        let err = svc.save_external(&path, &big).unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "original",
            "must not leave a partial or truncated file"
        );
    }

    #[test]
    fn saving_an_external_file_with_a_missing_parent_fails() {
        let (_d, svc) = svc();
        let outside = outside();
        let target = outside.path().join("no-such-dir").join("x.md");
        let err = svc.save_external(&target.to_string_lossy(), "x").unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
    }

    #[test]
    fn forgetting_an_external_file_keeps_the_file_on_disk() {
        let (_d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "forget.md", "还在");
        let path = file.to_string_lossy().into_owned();
        svc.read_external(&path).unwrap();

        svc.forget_external(&path).unwrap();
        assert!(svc.list_external().unwrap().is_empty());
        assert!(file.is_file(), "forget must not delete the user's file");
        // 幂等：再移除一次不报错。
        svc.forget_external(&path).unwrap();
    }

    #[test]
    fn a_file_deleted_outside_is_marked_missing_instead_of_disappearing() {
        // 记录还在、文件没了：界面要显示「已失效」，用户才能自己清理。
        let (_d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "gone.md", "x");
        let path = file.to_string_lossy().into_owned();
        svc.read_external(&path).unwrap();
        std::fs::remove_file(&file).unwrap();

        let listed = svc.list_external().unwrap();
        assert_eq!(listed.len(), 1, "record must stay until the user removes it");
        assert!(listed[0].missing);
    }

    #[test]
    fn external_path_resolves_and_reports_a_deleted_file() {
        let (_d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "reveal.md", "x");
        let path = file.to_string_lossy().into_owned();
        assert_eq!(svc.external_path(&path).unwrap(), file);

        std::fs::remove_file(&file).unwrap();
        assert_eq!(svc.external_path(&path).unwrap_err().code(), "NOT_FOUND");
    }

    #[test]
    fn external_file_operations_are_independent_of_the_workspace_switch() {
        // 外部文件记录存在**工作区自己的**库里：换目录等于换一套记录，
        // 与文档列表的行为一致，而不是把上一个工作区的记录带过去。
        let (d, svc) = svc();
        let outside = outside();
        let file = external_file(&outside, "ws.md", "x");
        let path = file.to_string_lossy().into_owned();
        svc.read_external(&path).unwrap();
        assert_eq!(svc.list_external().unwrap().len(), 1);

        let other = tempfile::tempdir().unwrap();
        svc.switch_workspace(other.path().to_path_buf()).unwrap();
        assert!(svc.list_external().unwrap().is_empty(), "new workspace, new catalog");

        svc.switch_workspace(d.path().to_path_buf()).unwrap();
        assert_eq!(svc.list_external().unwrap().len(), 1, "switching back restores it");
    }

    #[test]
    fn hostile_paths_never_escape_the_filesystem_contract() {
        // 外部路径来自文件对话框或数据库，仍要做存在性检查而不是盲目读写。
        let (_d, svc) = svc();
        assert!(svc.read_external("").is_err());
        assert!(svc.read_external("C:\\no\\such\\file.md").is_err());
    }
}
