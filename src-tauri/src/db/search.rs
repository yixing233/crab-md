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
