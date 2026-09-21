/** 与 Rust `DocumentSummary` 对应（serde camelCase）。 */
export interface DocumentSummary {
  id: string;
  title: string;
  virtualPath: string;
  revision: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  size: number;
}

/** 与 Rust `DocumentPayload` 对应（summary 字段被 flatten）。 */
export interface DocumentPayload extends DocumentSummary {
  content: string;
}

/** 与 Rust `SearchHit` 对应。 */
export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
}

/** 服务端错误信封（ARCHITECTURE.md §16.1）。 */
export interface AppErrorShape {
  code: string;
  message: string;
}
