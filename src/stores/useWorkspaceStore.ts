import { create } from "zustand";
import { api, toAppError } from "../lib/api";
import type { DocumentSummary } from "../types/document";

export interface WorkspaceState {
  documents: DocumentSummary[];
  activeId: string | null;
  activeContent: string;
  /** 有未保存改动。用于关闭提示与状态栏（UI §26）。 */
  dirty: boolean;
  loading: boolean;
  /** 稳定错误码，供 UI 分支显示；null 表示无错误。 */
  error: string | null;

  loadDocuments: () => Promise<void>;
  openDocument: (id: string) => Promise<void>;
  createDocument: (title: string, virtualPath?: string) => Promise<void>;
  renameDocument: (id: string, title: string) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  saveActive: () => Promise<void>;
  setContent: (content: string) => void;
  clearError: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  documents: [],
  activeId: null,
  activeContent: "",
  dirty: false,
  loading: false,
  error: null,

  loadDocuments: async () => {
    set({ loading: true, error: null });
    try {
      set({ documents: await api.listDocuments(), loading: false });
    } catch (raw) {
      set({ error: toAppError(raw).code, loading: false });
    }
  },

  openDocument: async (id) => {
    set({ error: null });
    try {
      const doc = await api.readDocument(id);
      set({ activeId: doc.id, activeContent: doc.content, dirty: false });
    } catch (raw) {
      set({ error: toAppError(raw).code });
    }
  },

  createDocument: async (title, virtualPath = "/") => {
    set({ error: null });
    try {
      const created = await api.createDocument(title, virtualPath);
      set({ activeId: created.id, activeContent: "", dirty: false });
      await get().loadDocuments();
    } catch (raw) {
      set({ error: toAppError(raw).code });
    }
  },

  renameDocument: async (id, title) => {
    set({ error: null });
    try {
      await api.renameDocument(id, title);
      await get().loadDocuments();
    } catch (raw) {
      set({ error: toAppError(raw).code });
    }
  },

  deleteDocument: async (id) => {
    set({ error: null });
    try {
      await api.deleteDocument(id);
      // 删掉的正是当前打开的文档时清空编辑器，否则保持编辑状态不受影响。
      if (get().activeId === id) {
        set({ activeId: null, activeContent: "", dirty: false });
      }
      await get().loadDocuments();
    } catch (raw) {
      set({ error: toAppError(raw).code });
    }
  },

  saveActive: async () => {
    const { activeId, activeContent } = get();
    if (!activeId) return;
    set({ error: null });
    try {
      await api.saveDocument(activeId, activeContent);
      set({ dirty: false });
      await get().loadDocuments();
    } catch (raw) {
      set({ error: toAppError(raw).code });
    }
  },

  setContent: (content) => set({ activeContent: content, dirty: true }),
  clearError: () => set({ error: null }),
}));
