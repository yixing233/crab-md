use serde::{Serialize, Serializer};

/// 面向客户端的错误。序列化为 `{ "code": "...", "message": "..." }`，
/// code 稳定可编程判断，message 供日志与排查。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("document not found: {0}")]
    NotFound(String),
    #[error("invalid document id: {0}")]
    InvalidId(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("workspace not initialised")]
    WorkspaceMissing,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "NOT_FOUND",
            AppError::InvalidId(_) => "INVALID_ID",
            AppError::InvalidInput(_) => "INVALID_INPUT",
            AppError::WorkspaceMissing => "WORKSPACE_MISSING",
            AppError::Io(_) => "IO_ERROR",
            AppError::Db(_) => "DB_ERROR",
            AppError::Serde(_) => "SERDE_ERROR",
        }
    }

    pub fn message(&self) -> String {
        self.to_string()
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.message())?;
        st.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_serializes_to_machine_readable_code() {
        let e = AppError::InvalidId("../etc/passwd".to_string());
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["code"], "INVALID_ID");
        assert!(json["message"].as_str().unwrap().contains("etc/passwd"));
    }

    #[test]
    fn every_variant_has_uppercase_snake_code() {
        let cases = [
            AppError::NotFound("x".into()),
            AppError::InvalidId("x".into()),
            AppError::InvalidInput("x".into()),
            AppError::WorkspaceMissing,
            AppError::Io(std::io::Error::other("x")),
        ];
        for e in cases {
            let code = e.code();
            assert!(!code.is_empty());
            assert_eq!(code, code.to_uppercase(), "code must be uppercase: {code}");
            assert!(!code.contains(' '), "code must not contain spaces: {code}");
        }
    }
}
