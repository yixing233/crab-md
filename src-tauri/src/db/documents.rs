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
