import { invoke } from "@tauri-apps/api/core";
import type {
  AppErrorShape,
  AppSettingsView,
  DocumentPayload,
  DocumentSummary,
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
