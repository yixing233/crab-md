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
        let conn = self.conn()?;
        docs::list(&conn)
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

        let conn = self.conn()?;
        search::reindex(&conn, &id, title, "")?;
        Ok(summary)
    }

    /// 读取元数据 + 正文。正文从文件读，元数据从库读。
    pub fn read(&self, id: &str) -> AppResult<DocumentPayload> {
        // 先做 id 校验：非法 id 应报 INVALID_ID，而不是被查库的 NOT_FOUND 掩盖。
        let _ = workspace::note_path(&self.root, id)?;

        let conn = self.conn()?;
        let summary = docs::get(&conn, id)?.ok_or_else(|| AppError::NotFound(id.to_string()))?;
        drop(conn);

        let content = workspace::read_note(&self.root, id)?;
        Ok(DocumentPayload { summary, content })
    }

    /// 保存正文：先原子写文件，成功后再更新元数据与索引。
    /// 顺序很重要 —— 文件写失败时元数据保持旧值，不会出现「库里有哈希但文件没内容」。
    pub fn save(&self, id: &str, content: &str) -> AppResult<DocumentSummary> {
        // 先做 id 校验：非法 id 应报 INVALID_ID，而不是被查库的 NOT_FOUND 掩盖。
        let _ = workspace::note_path(&self.root, id)?;

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

        let conn = self.conn()?;
        search::reindex(&conn, id, &summary.title, content)?;
        Ok(updated)
    }

    /// 重命名：只改 title，磁盘文件名与 id 均不变（ARCHITECTURE.md §11）。
    pub fn rename(&self, id: &str, title: &str) -> AppResult<DocumentSummary> {
        let title = title.trim();
        if title.is_empty() {
            return Err(AppError::InvalidInput("title must not be empty".into()));
        }

        let now = workspace::now_iso8601();
        // 先做 id 校验：非法 id 应报 INVALID_ID，而不是被查库的 NOT_FOUND 掩盖。
        let _ = workspace::note_path(&self.root, id)?;

        let conn = self.conn()?;
        if docs::rename(&conn, id, title, &now)? == 0 {
            return Err(AppError::NotFound(id.to_string()));
        }
        let updated = docs::get(&conn, id)?.ok_or_else(|| AppError::NotFound(id.to_string()))?;
        drop(conn);

        let content = workspace::read_note(&self.root, id)?;
        let conn = self.conn()?;
        search::reindex(&conn, id, title, &content)?;
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

        let conn = self.conn()?;
        search::unindex(&conn, id)?;
        Ok(())
    }

    pub fn search(&self, query: &str, limit: i64) -> AppResult<Vec<search::SearchHit>> {
        let conn = self.conn()?;
        search::search(&conn, query, limit).map_err(AppError::from)
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
