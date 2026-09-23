use crate::db::{self, documents as docs, search};
use crate::error::{AppError, AppResult};
use crate::model::{CreateDocumentRequest, DocumentPayload, DocumentSummary};
use crate::settings;
use crate::workspace;
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

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

    /// 从工作区外的任意路径导入一个 Markdown 文件为**新文档**。
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

/// 导入：把用户选定的 Markdown 文件作为**新文档**收进工作区。
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
}
