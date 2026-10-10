use crate::error::AppResult;
use crate::model::{FileRecord, FileSearchResult};
use rusqlite::{params, Connection};

fn is_windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    let has_drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    has_drive || path.contains('\\')
}

/// 路径规范化键名：Windows 下转小写且反斜杠统一，POSIX 保持大小写敏感。
pub fn path_key(raw: &str) -> String {
    if is_windows_path(raw) {
        raw.replace('/', "\\").to_lowercase()
    } else {
        raw.replace('\\', "/")
    }
}

/// 转义 LIKE 的通配符（支持短词回退检索）。
pub fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// 记录或刷新一个已打开的磁盘文件元数据，并同步更新全文检索索引。
pub fn upsert_and_index(
    conn: &Connection,
    path: &str,
    name: &str,
    size: i64,
    modified_at: &str,
    opened_at: &str,
    body: Option<&str>,
) -> AppResult<()> {
    let key = path_key(path);

    // 1. 写入/更新 opened_files 元数据表（保留既有的 pinned 和阅读状态）
    conn.execute(
        "INSERT INTO opened_files (path_key, path, name, size, modified_at, opened_at, pinned, cursor_line, cursor_col, scroll_ratio)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 1, 1, 0.0)
         ON CONFLICT(path_key) DO UPDATE SET
             path        = excluded.path,
             name        = excluded.name,
             size        = excluded.size,
             modified_at = excluded.modified_at,
             opened_at   = excluded.opened_at",
        params![key, path, name, size, modified_at, opened_at],
    )?;

    // 2. 如果提供了正文，同步更新 FTS5 全文索引
    if let Some(content) = body {
        conn.execute("DELETE FROM files_fts WHERE path_key = ?1", params![key])?;
        conn.execute(
            "INSERT INTO files_fts (path_key, path, name, body) VALUES (?1, ?2, ?3, ?4)",
            params![key, path, name, content],
        )?;
    }

    Ok(())
}

/// 原位保存文件后刷新时间戳与正文索引（不修改 opened_at 与 session 状态）。
pub fn touch(
    conn: &Connection,
    path: &str,
    size: i64,
    modified_at: &str,
    body: Option<&str>,
) -> AppResult<usize> {
    let key = path_key(path);
    let n = conn.execute(
        "UPDATE opened_files
         SET size = ?2, modified_at = ?3
         WHERE path_key = ?1",
        params![key, size, modified_at],
    )?;

    if let Some(content) = body {
        conn.execute("DELETE FROM files_fts WHERE path_key = ?1", params![key])?;
        // 读取文件名以供 FTS 表使用
        let name: String = conn
            .query_row(
                "SELECT name FROM opened_files WHERE path_key = ?1",
                params![key],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "".to_string());
        conn.execute(
            "INSERT INTO files_fts (path_key, path, name, body) VALUES (?1, ?2, ?3, ?4)",
            params![key, path, name, content],
        )?;
    }

    Ok(n)
}

/// 记录用户在该文件的阅读/编辑会话位置（光标行、列、滚动进度）。
pub fn update_session(
    conn: &Connection,
    path: &str,
    cursor_line: u32,
    cursor_col: u32,
    scroll_ratio: f64,
) -> AppResult<usize> {
    let key = path_key(path);
    let n = conn.execute(
        "UPDATE opened_files
         SET cursor_line = ?2, cursor_col = ?3, scroll_ratio = ?4
         WHERE path_key = ?1",
        params![key, cursor_line, cursor_col, scroll_ratio],
    )?;
    Ok(n)
}

/// 切换置顶状态。
pub fn set_pinned(conn: &Connection, path: &str, pinned: bool) -> AppResult<usize> {
    let key = path_key(path);
    let n = conn.execute(
        "UPDATE opened_files
         SET pinned = ?2
         WHERE path_key = ?1",
        params![key, if pinned { 1 } else { 0 }],
    )?;
    Ok(n)
}

/// 获取按置顶与最近打开排序的全部已记录文件列表。
pub fn list(conn: &Connection) -> AppResult<Vec<FileRecord>> {
    let mut stmt = conn.prepare(
        "SELECT path_key, path, name, size, modified_at, opened_at, pinned, cursor_line, cursor_col, scroll_ratio
         FROM opened_files
         ORDER BY pinned DESC, opened_at DESC",
    )?;

    let rows = stmt.query_map([], |r| {
        let pinned_int: i64 = r.get(6)?;
        Ok(FileRecord {
            path_key: r.get(0)?,
            path: r.get(1)?,
            name: r.get(2)?,
            size: r.get(3)?,
            modified_at: r.get(4)?,
            opened_at: r.get(5)?,
            pinned: pinned_int != 0,
            cursor_line: r.get(7)?,
            cursor_col: r.get(8)?,
            scroll_ratio: r.get(9)?,
        })
    })?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

/// 获取单个文件的元数据与会话状态。
pub fn get(conn: &Connection, path: &str) -> AppResult<Option<FileRecord>> {
    let key = path_key(path);
    let mut stmt = conn.prepare(
        "SELECT path_key, path, name, size, modified_at, opened_at, pinned, cursor_line, cursor_col, scroll_ratio
         FROM opened_files
         WHERE path_key = ?1",
    )?;

    let mut rows = stmt.query_map(params![key], |r| {
        let pinned_int: i64 = r.get(6)?;
        Ok(FileRecord {
            path_key: r.get(0)?,
            path: r.get(1)?,
            name: r.get(2)?,
            size: r.get(3)?,
            modified_at: r.get(4)?,
            opened_at: r.get(5)?,
            pinned: pinned_int != 0,
            cursor_line: r.get(7)?,
            cursor_col: r.get(8)?,
            scroll_ratio: r.get(9)?,
        })
    })?;

    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// 从数据库记录与全文索引中移除某个文件（不删除磁盘文件）。
pub fn remove(conn: &Connection, path: &str) -> AppResult<usize> {
    let key = path_key(path);
    conn.execute("DELETE FROM files_fts WHERE path_key = ?1", params![key])?;
    let n = conn.execute("DELETE FROM opened_files WHERE path_key = ?1", params![key])?;
    Ok(n)
}

/// 对所有打开过的文件进行全文检索（≥3 字符走 FTS5 trigram，<3 字符走 LIKE 回退）。
pub fn search(conn: &Connection, query: &str, limit: i64) -> AppResult<Vec<FileSearchResult>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    if q.chars().count() < 3 {
        let pattern = format!("%{}%", escape_like(q));
        let mut stmt = conn.prepare(
            "SELECT f.path, f.name, COALESCE(substr(f.body, 1, 80), '')
             FROM files_fts f
             WHERE f.name LIKE ?1 ESCAPE '\\' OR f.body LIKE ?1 ESCAPE '\\'
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![pattern, limit], |r| {
            Ok(FileSearchResult {
                path: r.get(0)?,
                name: r.get(1)?,
                snippet: r.get(2)?,
            })
        })?;
        let mut hits = Vec::new();
        for r in rows {
            hits.push(r?);
        }
        return Ok(hits);
    }

    let match_expr = format!("\"{}\"", q.replace('"', "\"\""));
    let mut stmt = conn.prepare(
        "SELECT f.path, f.name, snippet(files_fts, 3, '<mark>', '</mark>', '...', 16)
         FROM files_fts f
         WHERE files_fts MATCH ?1
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![match_expr, limit], |r| {
        Ok(FileSearchResult {
            path: r.get(0)?,
            name: r.get(1)?,
            snippet: r.get(2)?,
        })
    })?;

    let mut hits = Vec::new();
    for r in rows {
        hits.push(r?);
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn test_db() -> Connection {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        db::open(&db_path).unwrap()
    }

    #[test]
    fn path_key_normalizes_windows_paths_case_insensitively() {
        assert_eq!(path_key(r"C:\Notes\A.md"), r"c:\notes\a.md");
        assert_eq!(path_key(r"c:\notes\a.md"), r"c:\notes\a.md");
        assert_eq!(path_key("C:/Notes/A.md"), r"c:\notes\a.md");
    }

    #[test]
    fn path_key_preserves_posix_case() {
        assert_eq!(path_key("/home/u/Notes/A.md"), "/home/u/Notes/A.md");
        assert_ne!(path_key("/home/u/Notes/A.md"), path_key("/home/u/notes/a.md"));
    }

    #[test]
    fn upsert_lists_and_sorts_by_opened_at_and_pinned() {
        let conn = test_db();
        upsert_and_index(&conn, "/a.md", "a.md", 10, "2026-01-01", "2026-01-01T10:00:00", Some("# Hello A")).unwrap();
        upsert_and_index(&conn, "/b.md", "b.md", 20, "2026-01-02", "2026-01-02T10:00:00", Some("# Hello B")).unwrap();

        let list1 = list(&conn).unwrap();
        assert_eq!(list1.len(), 2);
        assert_eq!(list1[0].name, "b.md", "b.md opened later, should be first");

        set_pinned(&conn, "/a.md", true).unwrap();
        let list2 = list(&conn).unwrap();
        assert_eq!(list2[0].name, "a.md", "pinned a.md should bubble to top");
    }

    #[test]
    fn session_state_is_saved_and_retrieved() {
        let conn = test_db();
        upsert_and_index(&conn, "/doc.md", "doc.md", 100, "2026-01-01", "2026-01-01T10:00:00", None).unwrap();
        update_session(&conn, "/doc.md", 42, 5, 0.65).unwrap();

        let rec = get(&conn, "/doc.md").unwrap().unwrap();
        assert_eq!(rec.cursor_line, 42);
        assert_eq!(rec.cursor_col, 5);
        assert!((rec.scroll_ratio - 0.65).abs() < 0.001);
    }

    #[test]
    fn fts_search_finds_content_in_opened_files() {
        let conn = test_db();
        upsert_and_index(
            &conn,
            "/rust.md",
            "rust.md",
            100,
            "2026-01-01",
            "2026-01-01T10:00:00",
            Some("并发编程与信道 channel 深度解析"),
        )
        .unwrap();

        // 搜索短词（<3 字符）通过 LIKE 命中
        let hits_short = search(&conn, "并发", 10).unwrap();
        assert_eq!(hits_short.len(), 1);
        assert_eq!(hits_short[0].name, "rust.md");

        // 搜索长词（>=3 字符）通过 FTS5 trigram 命中
        let hits_trigram = search(&conn, "并发编程", 10).unwrap();
        assert_eq!(hits_trigram.len(), 1);
        assert_eq!(hits_trigram[0].name, "rust.md");
    }

    #[test]
    fn remove_cleans_metadata_and_search_index() {
        let conn = test_db();
        upsert_and_index(&conn, "/x.md", "x.md", 10, "2026-01-01", "2026-01-01T10:00:00", Some("secret content")).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert_eq!(search(&conn, "secret", 10).unwrap().len(), 1);

        remove(&conn, "/x.md").unwrap();
        assert_eq!(list(&conn).unwrap().len(), 0);
        assert_eq!(search(&conn, "secret", 10).unwrap().len(), 0);
    }
}
