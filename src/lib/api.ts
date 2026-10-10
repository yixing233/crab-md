import { invoke } from "@tauri-apps/api/core";
import type {
  AppErrorShape,
  AppSettingsView,
  AttachmentBytes,
  AttachmentId,
  AttachmentMimeType,
  DocumentPayload,
  DocumentSummary,
  ExternalFilePayload,
  ExternalFileView,
  FileRecord,
  FileSearchResult,
  OpenFilePayload,
  RecentFileView,
  SearchHit,
} from "../types/document";

/**
 * 把 Tauri 抛出的任意值归一成 `{ code, message }`。
 * Rust 侧序列化为稳定错误码，前端据此做分支，而不是匹配文案。
 */
export function toAppError(raw: unknown): AppErrorShape {
  if (raw && typeof raw === "object" && "code" in raw && "message" in raw) {
    const e = raw as AppErrorShape;
    return { code: String(e.code), message: String(e.message) };
  }
  if (raw instanceof Error) {
    return { code: "UNKNOWN", message: raw.message };
  }
  return { code: "UNKNOWN", message: String(raw ?? "unknown error") };
}

/** 统一的命令调用入口：错误一律转成带 code 的对象再抛。 */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw toAppError(raw);
  }
}

export const api = {
  listDocuments: () => call<DocumentSummary[]>("list_documents"),

  createDocument: (title: string, virtualPath = "/") =>
    call<DocumentSummary>("create_document", {
      request: { title, virtualPath },
    }),

  readDocument: (id: string) => call<DocumentPayload>("read_document", { id }),

  saveDocument: (id: string, content: string) =>
    call<DocumentSummary>("save_document", { id, content }),

  renameDocument: (id: string, title: string) =>
    call<DocumentSummary>("rename_document", { id, title }),

  deleteDocument: (id: string) => call<void>("delete_document", { id }),

  /** 另存为副本：新身份、独立文件，原标题与原文不动。 */
  duplicateDocument: (id: string, title: string) =>
    call<DocumentSummary>("duplicate_document", { id, title }),

  searchDocuments: (query: string, limit = 50) =>
    call<SearchHit[]>("search_documents", { query, limit }),

  // ---- 导入 / 导出 ----
  //
  // 路径由系统文件对话框得到（前端只拿字符串），真正的读写都在 Rust 侧：
  // ARCHITECTURE.md §7.1 要求所有文件系统访问经由应用层，
  // 因此前端不安装 fs 插件、也不持有任何写盘权限。

  /** 把一篇文档的正文导出到指定路径，返回写入的字节数。 */
  exportDocument: (id: string, targetPath: string) =>
    call<number>("export_document", { id, targetPath }),

  /** 把指定文本或 Markdown 文件打开为**新文档**（新 UUID，不覆盖既有文档）。 */
  importDocument: (sourcePath: string, title?: string, virtualPath = "/") =>
    call<DocumentSummary>("import_document", {
      sourcePath,
      title: title ?? null,
      virtualPath,
    }),

  /** 原位读取外部磁盘文件，不做数据库拷贝。 */
  readExternalFile: (path: string) =>
    call<ExternalFilePayload>("read_external_file", { path }),

  /** 原位保存写回外部磁盘文件。 */
  saveExternalFile: (path: string, content: string) =>
    call<ExternalFilePayload>("save_external_file", { path, content }),

  /**
   * 列出打开过的外部文件（只有元数据，没有正文）。
   *
   * 这是「重启后还能看到」的数据来源：记录存在工作区数据库里，
   * 正文仍只存在于用户磁盘上。
   */
  listExternalFiles: () => call<ExternalFileView[]>("list_external_files"),

  /**
   * 从外部文件列表移除一条记录。
   *
   * 只删记录，**不删除磁盘文件** —— 用户要的是「别占着我的列表」，
   * 而不是丢掉自己的文档。
   */
  forgetExternalFile: (path: string) =>
    call<void>("forget_external_file", { path }),

  // ---- 在系统文件管理器中定位文件 ----
  //
  // 两处都走 Rust：工作区文档的磁盘路径只由应用层掌握（§7.1），
  // 前端不拼 `<root>/notes/<uuid>.md`，也不直接调 opener 插件。

  /** 在系统文件管理器中定位一篇工作区文档。 */
  revealDocument: (id: string) => call<void>("reveal_document", { id }),

  /** 在系统文件管理器中定位一个外部磁盘文件。 */
  revealExternalFile: (path: string) =>
    call<void>("reveal_external_file", { path }),

  // =========================================================================
  // 统一磁盘文件模型（编辑器/阅读器架构：软件不存文件，一切皆磁盘文件）
  // =========================================================================

  /** 打开任意磁盘上的文件（读取正文 + 记录元数据与全文索引）。 */
  openFile: (path: string) => call<OpenFilePayload>("open_file", { path }),

  /** 原位保存磁盘文件，并刷新 SQLite 时间戳与全文索引。 */
  saveFile: (path: string, content: string) =>
    call<FileRecord>("save_file", { path, content }),

  /** 在指定磁盘路径创建新文件（另存为/落盘）。 */
  createFile: (path: string, content: string) =>
    call<FileRecord>("create_file", { path, content }),

  /** 获取按置顶和最近打开时间排序的历史文件清单。 */
  listRecentFiles: () => call<RecentFileView[]>("list_recent_files"),

  /** 从历史清单中移除一个文件（**不删除磁盘物理文件**）。 */
  removeFromHistory: (path: string) =>
    call<void>("remove_from_history", { path }),

  /** 从磁盘上物理删除文件，并同步清理数据库记录。 */
  deleteFileOnDisk: (path: string) =>
    call<void>("delete_file_on_disk", { path }),

  /** 对所有曾打开过的文件进行全文检索（返回带高亮匹配段的搜索命中）。 */
  searchFiles: (query: string) =>
    call<FileSearchResult[]>("search_files", { query }),

  /** 更新文件的阅读/编辑位置会话状态（光标行/列、滚动进度）。 */
  updateFileSession: (
    path: string,
    cursorLine: number,
    cursorCol: number,
    scrollRatio: number,
  ) =>
    call<void>("update_file_session", {
      path,
      cursorLine,
      cursorCol,
      scrollRatio,
    }),

  /** 置顶/取消置顶某个历史文件。 */
  setFilePinned: (path: string, pinned: boolean) =>
    call<void>("set_file_pinned", { path, pinned }),

  /** 在系统文件资源管理器中定位任意磁盘文件。 */
  revealFile: (path: string) => call<void>("reveal_file", { path }),

  // ---- 附件 ----
  //
  // Tauri 命令的 Vec<u8> 通过 JSON 边界传输为 number[]；在 API 边界
  // 统一转换成 Uint8Array，编辑器/预览不需要关心命令序列化细节。

  /** 保存剪贴板图片，返回 Rust 生成的 UUID（不是文件系统路径）。 */
  saveAttachment: (
    bytes: AttachmentBytes | ArrayBuffer | number[],
    mimeType: AttachmentMimeType | string,
  ) => {
    const data = bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes);
    return call<AttachmentId>("save_attachment", {
      data: Array.from(data),
      mimeType,
    });
  },

  /** 读取附件二进制；非法/不存在的 id 由 Rust 转换为稳定错误。 */
  readAttachment: async (id: AttachmentId): Promise<AttachmentBytes> => {
    const data = await call<number[] | Uint8Array>("read_attachment", { id });
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  },

  // ---- 设置（UI_DESIGN_SYSTEM.md §34）----

  getSettings: () => call<AppSettingsView>("get_settings"),

  /** 指定新的数据目录并立即切换。 */
  setWorkspaceRoot: (path: string) =>
    call<AppSettingsView>("set_workspace_root", { path }),

  /** 回到平台默认数据目录。 */
  resetWorkspaceRoot: () => call<AppSettingsView>("reset_workspace_root"),

  /** 平台默认数据目录，用于「恢复默认」时展示目标位置。 */
  defaultWorkspaceRoot: () => call<string>("default_workspace_root"),

  /**
   * 当前运行的二进制版本（后端提供，与更新检查的基准一致）。
   * 不用前端构建期常量：那是另一份可能漂移的版本号。
   */
  appVersion: () => call<string>("app_version"),
};
