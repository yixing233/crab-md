use crate::error::AppResult;
use crate::model::ExternalFileSummary;
use rusqlite::{params, Connection};

/// 路径是否属于 Windows 语义。
///
/// 判据是路径**本身**的形态（盘符或反斜杠），而不是运行平台：
/// 前端 `src/lib/externalFiles.ts` 的 `samePath` 用同一套规则。
/// 两层若各按各的规则归一，会出现「界面认为是两个文件、库里只有一行」
/// （或反过来）的不一致 —— 那么去重、标签高亮、重启恢复都会各自出错。
fn is_windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    let has_drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    has_drive || path.contains('\\')
}

/// 外部文件在库中的身份键：规范化后的路径。
///
/// 外部文件没有 UUID 身份 —— §11 只约束**工作区文档**（它们的磁盘文件名由
/// 应用自己分配）。外部文件的位置本来就是它唯一的身份，用户移动文件后
/// 那也不再是同一个文件了。
///
/// 之所以还要折一层 key：Windows 路径大小写不敏感，`C:\Notes\A.md` 与
/// `c:\notes\a.md` 是同一个文件，若不归一就会在列表里出现两行，且关闭一行
/// 后另一行还在。
///
/// POSIX 路径**保持大小写敏感**：`/home/u/A.md` 与 `/home/u/a.md` 是两个
/// 不同的文件，折叠会把他们错误地合并成一条记录。
pub fn path_key(raw: &str) -> String {
    if is_windows_path(raw) {
        raw.replace('/', "\\").to_lowercase()
    } else {
        raw.replace('\\', "/")
    }
}

/// 记录（或刷新）一个外部文件的元数据，按路径去重。
///
/// **正文绝不入库**：这里只有路径/名称/大小/时间。正文始终留在用户磁盘上，
/// 库只回答「这个文件在哪、叫什么」，供重启后重新打开（用户明确要求）。
pub fn upsert(
    conn: &Connection,
    path: &str,
    name: &str,
    size: i64,
    modified_at: &str,
    opened_at: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO external_files (path_key, path, name, size, modified_at, opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(path_key) DO UPDATE SET
             path        = excluded.path,
             name        = excluded.name,
             size        = excluded.size,
             modified_at = excluded.modified_at,
             opened_at   = excluded.opened_at",
        params![path_key(path), path, name, size, modified_at, opened_at],
    )?;
    Ok(())
}

/// 刷新已记录文件的大小/时间戳（原位保存后调用）。
///
/// 只更新已存在的行：保存一个从未打开过的文件不该凭空多出一条记录。
/// **不动 `opened_at`** —— 那是「最近打开」的排序依据，保存不是打开，
/// 否则每敲一次自动保存都会把列表顺序搅乱。返回受影响行数。
pub fn touch(
    conn: &Connection,
    path: &str,
    size: i64,
    modified_at: &str,
) -> AppResult<usize> {
    let n = conn.execute(
        "UPDATE external_files
         SET size = ?2, modified_at = ?3
         WHERE path_key = ?1",
        params![path_key(path), size, modified_at],
    )?;
    Ok(n)
}

/// 列出全部外部文件记录，最近打开的在前。
pub fn list(conn: &Connection) -> AppResult<Vec<ExternalFileSummary>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, size, modified_at, opened_at
         FROM external_files
         ORDER BY opened_at DESC, name COLLATE NOCASE",
    )?;
    let rows = stmt.query_map([], row_to_summary)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// 取单条记录（按路径，大小写归一）。
pub fn get(conn: &Connection, path: &str) -> AppResult<Option<ExternalFileSummary>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, size, modified_at, opened_at
         FROM external_files
         WHERE path_key = ?1",
    )?;
    let mut rows = stmt.query_map([path_key(path)], row_to_summary)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// 删除记录。删除是幂等的：没记录过也返回成功，用户点「从列表移除」不该报错。
pub fn remove(conn: &Connection, path: &str) -> AppResult<usize> {
    let n = conn.execute(
        "DELETE FROM external_files WHERE path_key = ?1",
        params![path_key(path)],
    )?;
    Ok(n)
}

fn row_to_summary(r: &rusqlite::Row<'_>) -> rusqlite::Result<ExternalFileSummary> {
    Ok(ExternalFileSummary {
        path: r.get(0)?,
        name: r.get(1)?,
        size: r.get(2)?,
        modified_at: r.get(3)?,
        opened_at: r.get(4)?,
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

    #[test]
    fn upsert_then_list_round_trips() {
        let (_d, conn) = setup();
        upsert(&conn, r"E:\notes\a.md", "a.md", 12, "2026-01-01", "2026-01-02").unwrap();

        let list = list(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].path, r"E:\notes\a.md");
        assert_eq!(list[0].name, "a.md");
        assert_eq!(list[0].size, 12);
        assert_eq!(list[0].modified_at, "2026-01-01");
        assert_eq!(list[0].opened_at, "2026-01-02");
    }

    #[test]
    fn reopening_the_file_updates_instead_of_duplicating() {
        let (_d, conn) = setup();
        upsert(&conn, r"E:\notes\a.md", "a.md", 12, "2026-01-01", "2026-01-02").unwrap();
        upsert(&conn, r"E:\notes\a.md", "a.md", 99, "2026-02-01", "2026-02-02").unwrap();

        let list = list(&conn).unwrap();
        assert_eq!(list.len(), 1, "same path must not create a second row");
        assert_eq!(list[0].size, 99);
        assert_eq!(list[0].modified_at, "2026-02-01");
        assert_eq!(list[0].opened_at, "2026-02-02");
    }

    #[test]
    fn the_same_file_in_a_different_case_is_one_record() {
        // Windows 路径大小写不敏感：两种写法是同一个文件，列表里只能出现一次。
        let (_d, conn) = setup();
        upsert(&conn, r"C:\Notes\A.md", "A.md", 1, "t", "t1").unwrap();
        upsert(&conn, r"c:/notes/a.md", "a.md", 2, "t", "t2").unwrap();

        let list = list(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].size, 2);
        assert_eq!(list[0].path, r"c:/notes/a.md", "newest spelling wins");
    }

    #[test]
    fn posix_paths_stay_case_sensitive() {
        // Linux 上 A.md 与 a.md 是两个不同文件，折叠大小写会合并错。
        let (_d, conn) = setup();
        upsert(&conn, "/home/u/A.md", "A.md", 1, "t", "t1").unwrap();
        upsert(&conn, "/home/u/a.md", "a.md", 2, "t", "t2").unwrap();
        assert_eq!(list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn path_key_matches_the_frontend_rule() {
        // 前端 `samePath` 与本函数必须给出同样的等价关系，
        // 否则标签高亮与库里的去重会各说各话。
        assert_eq!(path_key(r"E:\Notes\A.md"), path_key(r"e:/notes/a.md"));
        assert_ne!(path_key("/home/u/A.md"), path_key("/home/u/a.md"));
        // 反斜杠在 POSIX 路径里是普通字符，转成正斜杠与前端一致。
        assert_eq!(path_key("/home/u/a.md"), "/home/u/a.md");
    }

    #[test]
    fn list_orders_most_recently_opened_first() {
        let (_d, conn) = setup();
        upsert(&conn, r"E:\a.md", "a.md", 0, "t", "2026-01-01").unwrap();
        upsert(&conn, r"E:\b.md", "b.md", 0, "t", "2026-03-01").unwrap();
        upsert(&conn, r"E:\c.md", "c.md", 0, "t", "2026-02-01").unwrap();

        let list = list(&conn).unwrap();
        let names: Vec<_> = list.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["b.md", "c.md", "a.md"]);
    }

    #[test]
    fn get_finds_by_path_regardless_of_case() {
        let (_d, conn) = setup();
        upsert(&conn, r"E:\notes\A.md", "A.md", 1, "t", "t").unwrap();
        assert!(get(&conn, r"e:\NOTES\a.MD").unwrap().is_some());
        assert!(get(&conn, r"E:\notes\missing.md").unwrap().is_none());
    }

    #[test]
    fn touch_updates_only_existing_rows() {
        let (_d, conn) = setup();
        upsert(&conn, r"E:\a.md", "a.md", 1, "m1", "o1").unwrap();

        assert_eq!(touch(&conn, r"E:\a.md", 5, "m2").unwrap(), 1);
        let got = get(&conn, r"E:\a.md").unwrap().unwrap();
        assert_eq!(got.size, 5);
        assert_eq!(got.modified_at, "m2");
        assert_eq!(got.opened_at, "o1", "saving is not opening; order must hold");

        assert_eq!(
            touch(&conn, r"E:\never-opened.md", 1, "m").unwrap(),
            0,
            "saving an unrecorded file must not create a row"
        );
        assert!(list(&conn).unwrap().len() == 1);
    }

    #[test]
    fn remove_deletes_and_is_idempotent() {
        let (_d, conn) = setup();
        upsert(&conn, r"E:\a.md", "a.md", 1, "t", "t").unwrap();

        assert_eq!(remove(&conn, r"E:\a.md").unwrap(), 1);
        assert!(list(&conn).unwrap().is_empty());
        assert_eq!(remove(&conn, r"E:\a.md").unwrap(), 0, "already gone, still ok");
    }

    #[test]
    fn records_survive_reopening_the_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("m.db");
        {
            let conn = db::open(&path).unwrap();
            upsert(&conn, r"E:\persist.md", "persist.md", 7, "m", "o").unwrap();
        }
        let conn = db::open(&path).unwrap();
        let list = list(&conn).unwrap();
        assert_eq!(list.len(), 1, "restart must keep the file visible");
        assert_eq!(list[0].path, r"E:\persist.md");
    }

    #[test]
    fn table_stores_no_content_column() {
        // 用户要求：库里只放路径/名称等信息，绝不复制正文。
        let (_d, conn) = setup();
        let mut stmt = conn.prepare("PRAGMA table_info(external_files)").unwrap();
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|c| c.unwrap())
            .collect();
        assert_eq!(
            cols,
            vec!["path_key", "path", "name", "size", "modified_at", "opened_at"]
        );
        assert!(!cols.iter().any(|c| c.contains("content") || c.contains("body")));
    }
}
