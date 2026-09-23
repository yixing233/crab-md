use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

pub const NOTES_DIR: &str = "notes";
pub const ATTACHMENTS_DIR: &str = "attachments";
pub const APP_DIR: &str = ".app";
pub const DB_FILE: &str = "metadata.db";

/// 解析文档在磁盘上的真实路径。
///
/// 安全性：id 必须先通过 UUID 解析，才能参与路径拼接。
/// 这从根上排除了 `../`、绝对路径、分隔符注入等穿越手段
/// （ARCHITECTURE.md §7.1 / §16.1），也使文档身份与标题解耦（§11）。
pub fn note_path(root: &Path, id: &str) -> AppResult<PathBuf> {
    let uuid = uuid::Uuid::parse_str(id).map_err(|_| AppError::InvalidId(id.to_string()))?;
    Ok(root.join(NOTES_DIR).join(format!("{uuid}.md")))
}

/// 工作区内的元数据数据库路径。
pub fn db_path(root: &Path) -> PathBuf {
    root.join(APP_DIR).join(DB_FILE)
}

/// 生成新的文档 ID（UUIDv7：按时间可排序，便于按创建顺序列出）。
pub fn new_document_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// 正文内容哈希，格式 `sha256:<hex>`。
pub fn content_hash(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(content.as_bytes());
    format!("sha256:{}", hex::encode(h.finalize()))
}

/// 当前时间戳（RFC 3339，UTC）。
pub fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// 原子写入：先写同目录临时文件 → fsync → rename 覆盖目标。
///
/// 直接覆写目标文件在崩溃或断电时可能留下截断内容；
/// 同目录 rename 在 NTFS 上是原子的，因此读者要么看到旧内容、要么看到新内容
/// （ARCHITECTURE.md §18.2）。
pub fn atomic_write(target: &Path, data: &[u8]) -> AppResult<()> {
    use std::io::Write;

    let dir = target
        .parent()
        .ok_or_else(|| AppError::InvalidInput(format!("path has no parent: {}", target.display())))?;
    std::fs::create_dir_all(dir)?;

    let tmp = dir.join(format!(".tmp-{}", uuid::Uuid::now_v7()));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }

    match std::fs::rename(&tmp, target) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(AppError::Io(e))
        }
    }
}

/// 读取文档正文；文档缺失时返回空串（新建后尚未落盘的文档视作空文档）。
pub fn read_note(root: &Path, id: &str) -> AppResult<String> {
    let path = note_path(root, id)?;
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// 初始化工作区目录结构（幂等）。
pub fn ensure_layout(root: &Path) -> AppResult<()> {
    std::fs::create_dir_all(root.join(NOTES_DIR))?;
    std::fs::create_dir_all(root.join(ATTACHMENTS_DIR))?;
    std::fs::create_dir_all(root.join(APP_DIR))?;
    Ok(())
}

/// 导入/导出的单文件大小上限（10 MB）。
///
/// 不设上限就等于把「选中一个巨大文件」变成 OOM：
/// `fs::read_to_string` 会一次性把整个文件读进内存。导出侧同理 ——
/// 超大文档在导出前就该被拒绝，而不是写完再报错。
pub const MAX_TRANSFER_BYTES: u64 = 10 * 1024 * 1024;

/// 目标路径是否落在工作区的某个子目录内。
///
/// 用于阻止**导入导出**写到应用自己的数据区：`notes/<uuid>.md` 是文档身份的
/// 载体（§11），`.app/metadata.db` 是元数据库，被外部写入会造成
/// 「库里有记录但文件不是那份内容」。用户从对话框里完全可以导航到这里，
/// 所以必须在写之前拦住，而不是指望用户不会点错。
pub fn is_inside_workspace(root: &Path, target: &Path) -> bool {
    // 两侧都规范化：调用方给的路径可能带 `..` 或不同的分隔符。
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    // 目标可能还不存在（导出新文件），此时规范化它的父目录再拼上文件名。
    let probe = match target.canonicalize() {
        Ok(p) => p,
        Err(_) => match target.parent() {
            Some(p) => match p.canonicalize() {
                Ok(p) => p.join(target.file_name().unwrap_or_default()),
                Err(_) => return false,
            },
            None => return false,
        },
    };
    probe.starts_with(&root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn tmp_root() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        ensure_layout(&root).unwrap();
        (dir, root)
    }

    #[test]
    fn rejects_path_traversal_via_id() {
        let root = Path::new("C:/ws");
        assert!(matches!(note_path(root, "../../etc/passwd"), Err(AppError::InvalidId(_))));
        assert!(matches!(note_path(root, ".."), Err(AppError::InvalidId(_))));
        assert!(matches!(note_path(root, "a/b"), Err(AppError::InvalidId(_))));
        assert!(matches!(note_path(root, ""), Err(AppError::InvalidId(_))));
        assert!(matches!(note_path(root, "C:/Windows/System32"), Err(AppError::InvalidId(_))));
    }

    #[test]
    fn note_path_stays_inside_notes_dir() {
        let root = Path::new("C:/ws");
        let id = new_document_id();
        let p = note_path(root, &id).unwrap();
        assert!(p.starts_with(root.join(NOTES_DIR)));
        assert_eq!(p.file_name().unwrap().to_str().unwrap(), format!("{id}.md"));
    }

    #[test]
    fn id_is_uuid_v7_and_sortable() {
        let a = new_document_id();
        let b = new_document_id();
        assert!(uuid::Uuid::parse_str(&a).is_ok());
        assert_eq!(uuid::Uuid::parse_str(&a).unwrap().get_version_num(), 7);
        assert!(a < b, "v7 must be time-sortable: {a} vs {b}");
    }

    #[test]
    fn atomic_write_creates_and_replaces() {
        let (_d, root) = tmp_root();
        let id = new_document_id();
        let p = note_path(&root, &id).unwrap();

        atomic_write(&p, b"first").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "first");

        atomic_write(&p, b"second").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "second");
    }

    #[test]
    fn atomic_write_leaves_no_temp_files() {
        let (_d, root) = tmp_root();
        let id = new_document_id();
        let p = note_path(&root, &id).unwrap();
        atomic_write(&p, b"x").unwrap();

        let leftovers: Vec<_> = std::fs::read_dir(root.join(NOTES_DIR))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "temp files leaked: {leftovers:?}");
    }

    #[test]
    fn atomic_write_handles_unicode_content() {
        let (_d, root) = tmp_root();
        let id = new_document_id();
        let p = note_path(&root, &id).unwrap();
        let text = "# 中文标题\n\n并发编程与信道 🦀\n";
        atomic_write(&p, text.as_bytes()).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), text);
    }

    #[test]
    fn read_note_returns_empty_for_missing_file() {
        let (_d, root) = tmp_root();
        assert_eq!(read_note(&root, &new_document_id()).unwrap(), "");
    }

    #[test]
    fn read_note_round_trips() {
        let (_d, root) = tmp_root();
        let id = new_document_id();
        atomic_write(&note_path(&root, &id).unwrap(), "hello 世界".as_bytes()).unwrap();
        assert_eq!(read_note(&root, &id).unwrap(), "hello 世界");
    }

    #[test]
    fn content_hash_is_stable_and_prefixed() {
        assert_eq!(content_hash("x"), content_hash("x"));
        assert_ne!(content_hash("x"), content_hash("y"));
        assert!(content_hash("x").starts_with("sha256:"));
        assert_eq!(content_hash("x").len(), "sha256:".len() + 64);
    }

    #[test]
    fn ensure_layout_is_idempotent() {
        let (_d, root) = tmp_root();
        ensure_layout(&root).unwrap();
        assert!(root.join(NOTES_DIR).is_dir());
        assert!(root.join(ATTACHMENTS_DIR).is_dir());
        assert!(root.join(APP_DIR).is_dir());
    }

    #[test]
    fn now_iso8601_is_parseable() {
        let s = now_iso8601();
        assert!(chrono::DateTime::parse_from_rfc3339(&s).is_ok(), "bad ts: {s}");
    }

    #[test]
    fn detects_paths_inside_the_workspace() {
        let (_d, root) = tmp_root();
        // 工作区内的文件必须被认出，否则外部写入能破坏文档身份。
        assert!(is_inside_workspace(&root, &root.join(NOTES_DIR).join("x.md")));
        assert!(is_inside_workspace(&root, &root.join(APP_DIR).join(DB_FILE)));
        assert!(is_inside_workspace(&root, &root.join("new-file.md")));
    }

    #[test]
    fn allows_paths_outside_the_workspace() {
        let (_d, root) = tmp_root();
        let outside = tempfile::tempdir().unwrap();
        assert!(!is_inside_workspace(&root, &outside.path().join("x.md")));
    }

    #[test]
    fn rejects_parent_traversal_out_of_the_workspace() {
        let (_d, root) = tmp_root();
        // `notes/../../escape.md` 字面上在工作区内，规范化后必须判定为外部。
        let escape = root.join(NOTES_DIR).join("..").join("..").join("escape.md");
        assert!(!is_inside_workspace(&root, &escape));
    }

    #[test]
    fn rejects_nonexistent_directory() {
        // 目标目录不存在时无从判断归属，保守返回 false（拒绝）。
        let (_d, root) = tmp_root();
        assert!(!is_inside_workspace(&root, Path::new("no/such/dir/x.md")));
    }
}
