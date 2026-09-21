import { invoke } from "@tauri-apps/api/core";
import type {
  AppErrorShape,
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

  searchDocuments: (query: string, limit = 50) =>
    call<SearchHit[]>("search_documents", { query, limit }),
};
