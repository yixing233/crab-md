pub mod documents;

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
