/** 统一磁盘文件记录（与 Rust `FileRecord` 对应，serde camelCase）。 */
export interface FileRecord {
  pathKey: string;
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  openedAt: string;
  pinned: boolean;
  cursorLine: number;
  cursorCol: number;
  scrollRatio: number;
}

/** 最近打开文件视图（携带磁盘存在性状态）。 */
export interface RecentFileView {
  pathKey: string;
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  openedAt: string;
  pinned: boolean;
  cursorLine: number;
  cursorCol: number;
  scrollRatio: number;
  exists: boolean;
}

/** 打开文件的返回载荷：正文 + 文件记录。 */
export interface OpenFilePayload extends FileRecord {
  content: string;
}

/** 磁盘全文检索结果。 */
export interface FileSearchResult {
  path: string;
  name: string;
  snippet: string;
}

/** 纯内存未命名草稿（如未保存的新建文档）。 */
export interface DraftDocument {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

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

/**
 * 外部文件的**元数据**记录（数据库里只有这一份，没有正文）。
 *
 * 正文永远从磁盘现读：库只记录「这个文件在哪、叫什么」，
 * 让它在重启后仍出现在列表里，而不是把文件内容复制进应用。
 */
export interface ExternalFileView {
  path: string;
  name: string;
  size: number;
  /** 磁盘上的最后修改时间（RFC 3339）。 */
  modifiedAt: string;
  /** 最近一次打开的时间，列表按它倒序。 */
  openedAt: string;
  /** 文件已不在磁盘上（被移动或删除）。 */
  missing: boolean;
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
