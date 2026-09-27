use crate::commands::documents::DocumentService;
use crate::error::{AppError, AppResult};
use crate::workspace;
use std::path::{Path, PathBuf};

/// 附件单文件大小上限（10 MiB）。
///
/// 粘贴事件会把图片一次性读进内存；在服务端先拒绝超限数据，避免把
/// 一个异常大的剪贴板对象直接写入工作区。
pub const MAX_ATTACHMENT_BYTES: u64 = 10 * 1024 * 1024;

/// 当前闭环支持的图片 MIME 类型。
const SUPPORTED_IMAGE_MIME_TYPES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
];

/// 把附件 id 解析成工作区内的安全路径。
///
/// 附件文件名完全由服务端生成，读取端只接受 UUID，因而不会把用户输入
/// 当成路径片段，也不会允许 `..`、绝对路径或分隔符穿越到工作区之外。
pub fn attachment_path(root: &Path, id: &str) -> AppResult<PathBuf> {
    let uuid = uuid::Uuid::parse_str(id).map_err(|_| AppError::InvalidId(id.to_string()))?;
    Ok(root.join(workspace::ATTACHMENTS_DIR).join(uuid.to_string()))
}

fn validate_mime_type(mime_type: &str) -> AppResult<()> {
    if SUPPORTED_IMAGE_MIME_TYPES.contains(&mime_type) {
        Ok(())
    } else {
        Err(AppError::InvalidInput(format!(
            "unsupported attachment MIME type: {mime_type}"
        )))
    }
}

fn check_attachment_size(size: u64) -> AppResult<()> {
    if size > MAX_ATTACHMENT_BYTES {
        return Err(AppError::InvalidInput(format!(
            "attachment is too large: {size} bytes (limit {} bytes)",
            MAX_ATTACHMENT_BYTES
        )));
    }
    Ok(())
}

/// 保存一张图片并返回由服务端生成的 UUID。
///
/// `mime_type` 只用于能力校验；文件名不来自 MIME 或前端文件名，始终是
/// 新生成的 UUID。落盘统一复用工作区的原子写入实现。
pub fn save(service: &DocumentService, data: &[u8], mime_type: &str) -> AppResult<String> {
    validate_mime_type(mime_type)?;
    check_attachment_size(data.len() as u64)?;

    let root = service.root()?;
    let id = workspace::new_document_id();
    let path = attachment_path(&root, &id)?;
    workspace::atomic_write(&path, data)?;
    Ok(id)
}

/// 读取一张已保存的图片。
///
/// 即使调用者构造了恶意 id，也会先经过 UUID 解析，再进行任何文件系统
/// 操作；缺失附件转换为稳定的 NOT_FOUND 错误。
pub fn read(service: &DocumentService, id: &str) -> AppResult<Vec<u8>> {
    let root = service.root()?;
    let path = attachment_path(&root, id)?;
    match std::fs::read(&path) {
        Ok(data) => {
            // 工作区可能由旧版本或外部操作产生异常大文件，读取端也要有
            // 同一条边界，避免预览阶段无上限分配内存。
            check_attachment_size(data.len() as u64)?;
            Ok(data)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(AppError::NotFound(id.to_string()))
        }
        Err(error) => Err(AppError::Io(error)),
    }
}

// ---- Tauri command layer ----

#[tauri::command]
pub fn save_attachment(
    service: tauri::State<'_, DocumentService>,
    data: Vec<u8>,
    mime_type: String,
) -> AppResult<String> {
    save(&service, &data, &mime_type)
}

#[tauri::command]
pub fn read_attachment(
    service: tauri::State<'_, DocumentService>,
    id: String,
) -> AppResult<Vec<u8>> {
    read(&service, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace;

    fn service() -> (tempfile::TempDir, DocumentService) {
        let dir = tempfile::tempdir().unwrap();
        let service = DocumentService::new(dir.path().to_path_buf()).unwrap();
        (dir, service)
    }

    #[test]
    fn save_and_read_round_trip_with_server_generated_uuid_name() {
        let (dir, service) = service();
        let bytes = b"fake-but-small-png-payload";
        let id = save(&service, bytes, "image/png").unwrap();

        assert!(uuid::Uuid::parse_str(&id).is_ok());
        let path = attachment_path(dir.path(), &id).unwrap();
        assert!(path.is_file());
        assert_eq!(path.file_name().unwrap().to_string_lossy(), id);
        assert_eq!(read(&service, &id).unwrap(), bytes);
    }

    #[test]
    fn accepts_all_supported_image_mime_types() {
        for mime_type in SUPPORTED_IMAGE_MIME_TYPES {
            let (_dir, service) = service();
            let id = save(&service, b"image", mime_type).unwrap();
            assert_eq!(read(&service, &id).unwrap(), b"image");
        }
    }

    #[test]
    fn rejects_unsupported_mime_types_before_writing() {
        let (dir, service) = service();
        let error = save(&service, b"payload", "image/svg+xml").unwrap_err();
        assert_eq!(error.code(), "INVALID_INPUT");
        assert!(
            std::fs::read_dir(dir.path().join(workspace::ATTACHMENTS_DIR))
                .unwrap()
                .next()
                .is_none()
        );
    }

    #[test]
    fn rejects_payload_over_the_limit() {
        let (_dir, service) = service();
        let data = vec![0_u8; (MAX_ATTACHMENT_BYTES + 1) as usize];
        let error = save(&service, &data, "image/png").unwrap_err();
        assert_eq!(error.code(), "INVALID_INPUT");
    }

    #[test]
    fn rejects_path_traversal_and_missing_ids() {
        let (_dir, service) = service();
        assert!(matches!(
            read(&service, "../../outside"),
            Err(AppError::InvalidId(_))
        ));
        assert!(matches!(
            read(&service, "00000000-0000-7000-8000-000000000000"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn attachment_path_stays_inside_attachment_directory() {
        let root = Path::new("C:/workspace");
        let id = workspace::new_document_id();
        let path = attachment_path(root, &id).unwrap();
        assert!(path.starts_with(root.join(workspace::ATTACHMENTS_DIR)));
        assert_eq!(path.file_name().unwrap().to_string_lossy(), id);
    }
}
