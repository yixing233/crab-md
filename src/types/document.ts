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

/** 外部磁盘文件（原位查看/编辑，不进行拷贝）。 */
export interface ExternalFilePayload {
  path: string;
  name: string;
  content: string;
  size: number;
  modifiedAt: string;
}

/** 服务端错误信封（ARCHITECTURE.md §16.1）。 */
export interface AppErrorShape {
  code: string;
  message: string;
}

/** 与 Rust `AppSettingsView` 对应（设置页只读视图）。 */
export interface AppSettingsView {
  /** 用户设置的自定义数据目录；null 表示用默认位置。 */
  workspaceRoot: string | null;
  /** 实际生效的数据目录。 */
  effectiveWorkspaceRoot: string;
  /**
   * 生效路径是否来自 `CRAB_MD_WORKSPACE` 环境变量。
   * 若为 true，界面上改设置也不会立刻生效 —— 必须如实告知用户。
   */
  workspaceRootIsFromEnv: boolean;
  /** 设置文件位置，便于备份或排查。 */
  configPath: string;
  version: number;
}

/** 服务端生成的附件标识；它不是文件系统路径。 */
export type AttachmentId = string;

/** 粘贴/读取附件时允许的图片 MIME 类型。 */
export type AttachmentMimeType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** Rust `read_attachment` 返回的二进制数据在前端的表示。 */
export type AttachmentBytes = Uint8Array;
