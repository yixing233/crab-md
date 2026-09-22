use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// 设置文件名。放在**应用配置目录**，不是工作区里。
///
/// 为什么不能放工作区：工作区根路径本身就是要被这个文件配置的东西，
/// 放进去就成鸡生蛋 —— 连"去哪个工作区读配置"都不知道。
pub const SETTINGS_FILE: &str = "settings.json";

/// 设置文件的当前版本。将来字段结构变化时据此迁移。
pub const SETTINGS_VERSION: u32 = 1;

/// 应用设置（当前只有一项，但保留 version 以便演进）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u32,
    /// 用户指定的工作区根目录。`None` 表示用默认位置。
    ///
    /// 存字符串而非 PathBuf：跨平台 JSON 表示更稳定，
    /// 且 Windows 路径的反斜杠不会成为转义问题。
    pub workspace_root: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self { version: SETTINGS_VERSION, workspace_root: None }
    }
}

impl Settings {
    /// 规范化后的工作区根：去掉首尾空白，空白视作未设置。
    pub fn workspace_root_clean(&self) -> Option<&str> {
        self.workspace_root
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }
}

/// 设置文件路径（`<config_dir>/settings.json`）。
pub fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join(SETTINGS_FILE)
}

/// 读取设置。
///
/// 文件缺失、无法读取、JSON 损坏、版本不认识 —— 一律回退到默认值
/// 而不是报错：设置损坏绝不该让应用起不来。用户只是丢失偏好，
/// 文档数据完好无损。
pub fn load(config_dir: &Path) -> Settings {
    let path = settings_path(config_dir);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Settings::default();
    };

    match serde_json::from_str::<Settings>(&raw) {
        // 版本比当前新：不猜测语义，回退默认值以免误读。
        Ok(s) if s.version > SETTINGS_VERSION => Settings::default(),
        Ok(s) => s,
        Err(_) => Settings::default(),
    }
}

/// 原子写入设置（复用 `workspace::atomic_write` 的 tmp → fsync → rename）。
pub fn save(config_dir: &Path, settings: &Settings) -> AppResult<()> {
    std::fs::create_dir_all(config_dir)?;
    let json = serde_json::to_vec_pretty(settings)?;
    crate::workspace::atomic_write(&settings_path(config_dir), &json)
}

/// 校验用户选定的工作区根目录。
///
/// 只接受**绝对路径**：相对路径的基准是进程 cwd，换个启动方式就漂移，
/// 会导致"上次还能打开、这次找不到笔记"。
pub fn validate_workspace_root(raw: &str) -> AppResult<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("workspace path must not be empty".into()));
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(AppError::InvalidInput(format!(
            "workspace path must be absolute: {trimmed}"
        )));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn missing_file_yields_defaults() {
        let d = tmp();
        let s = load(d.path());
        assert_eq!(s.workspace_root, None);
        assert_eq!(s.version, SETTINGS_VERSION);
    }

    #[test]
    fn round_trips_through_disk() {
        let d = tmp();
        let s = Settings {
            version: SETTINGS_VERSION,
            workspace_root: Some("E:/notes".into()),
        };
        save(d.path(), &s).unwrap();
        assert_eq!(load(d.path()), s);
    }

    #[test]
    fn corrupt_json_falls_back_to_defaults_instead_of_failing() {
        let d = tmp();
        std::fs::write(settings_path(d.path()), "{ this is not json").unwrap();
        // 设置损坏绝不能让应用起不来。
        assert_eq!(load(d.path()), Settings::default());
    }

    #[test]
    fn a_newer_version_is_not_guessed_at() {
        let d = tmp();
        std::fs::write(
            settings_path(d.path()),
            r#"{"version":999,"workspaceRoot":"E:/future"}"#,
        )
        .unwrap();
        assert_eq!(load(d.path()), Settings::default());
    }

    #[test]
    fn unknown_fields_are_ignored_so_older_builds_keep_working() {
        let d = tmp();
        std::fs::write(
            settings_path(d.path()),
            r#"{"version":1,"workspaceRoot":"E:/notes","futureField":true}"#,
        )
        .unwrap();
        assert_eq!(load(d.path()).workspace_root.as_deref(), Some("E:/notes"));
    }

    #[test]
    fn blank_workspace_root_is_treated_as_unset() {
        let s = Settings { version: 1, workspace_root: Some("   ".into()) };
        assert_eq!(s.workspace_root_clean(), None);
    }

    #[test]
    fn trims_whitespace_around_the_path() {
        let s = Settings { version: 1, workspace_root: Some("  E:/notes  ".into()) };
        assert_eq!(s.workspace_root_clean(), Some("E:/notes"));
    }

    #[test]
    fn save_is_idempotent_and_leaves_no_temp_files() {
        let d = tmp();
        let s = Settings { version: 1, workspace_root: Some("E:/notes".into()) };
        save(d.path(), &s).unwrap();
        save(d.path(), &s).unwrap();

        let leftovers: Vec<_> = std::fs::read_dir(d.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(".tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "atomic_write must clean up its temp file");
    }

    #[test]
    fn save_creates_the_config_dir_if_absent() {
        let d = tmp();
        let nested = d.path().join("a").join("b");
        save(&nested, &Settings::default()).unwrap();
        assert!(settings_path(&nested).is_file());
    }

    #[test]
    fn accepts_absolute_paths() {
        let p = validate_workspace_root("E:/notes").unwrap();
        assert!(p.is_absolute());
    }

    #[test]
    fn rejects_relative_paths_so_a_changed_cwd_cannot_strand_the_user() {
        let err = validate_workspace_root("notes").unwrap_err();
        assert_eq!(err.code(), "INVALID_INPUT");
    }

    #[test]
    fn rejects_blank_paths() {
        assert_eq!(validate_workspace_root("   ").unwrap_err().code(), "INVALID_INPUT");
    }
}
