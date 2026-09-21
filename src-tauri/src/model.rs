use serde::{Deserialize, Serialize};

/// 文档元数据（对应 ARCHITECTURE.md §9 的 documents 表）。
/// id 是 UUIDv7 字符串，与 title / virtual_path 解耦（§11）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub title: String,
    pub virtual_path: String,
    pub revision: i64,
    pub content_hash: String,
    pub created_at: String,
    pub updated_at: String,
    pub size: i64,
}

/// 元数据 + 正文，用于打开单个文档。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    #[serde(flatten)]
    pub summary: DocumentSummary,
    pub content: String,
}

/// 新建文档的请求体。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocumentRequest {
    pub title: String,
    #[serde(default = "default_virtual_path")]
    pub virtual_path: String,
}

fn default_virtual_path() -> String {
    "/".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> DocumentSummary {
        DocumentSummary {
            id: "01993ab2-0000-7000-8000-000000000000".into(),
            title: "Go Basics".into(),
            virtual_path: "/Development/Go/".into(),
            revision: 1,
            content_hash: "sha256:aa".into(),
            created_at: "2026-09-21T00:00:00Z".into(),
            updated_at: "2026-09-21T00:00:00Z".into(),
            size: 12,
        }
    }

    #[test]
    fn summary_serializes_with_camel_case_for_frontend() {
        let json = serde_json::to_value(sample()).unwrap();
        assert!(json.get("virtualPath").is_some(), "frontend expects camelCase");
        assert!(json.get("virtual_path").is_none());
        assert_eq!(json["revision"], 1);
    }

    #[test]
    fn payload_flattens_summary_fields() {
        let p = DocumentPayload { summary: sample(), content: "# hi".into() };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["title"], "Go Basics");
        assert_eq!(json["content"], "# hi");
        assert!(json.get("summary").is_none(), "must flatten, not nest");
    }

    #[test]
    fn create_request_defaults_virtual_path() {
        let r: CreateDocumentRequest = serde_json::from_str(r#"{"title":"x"}"#).unwrap();
        assert_eq!(r.virtual_path, "/");
    }
}
