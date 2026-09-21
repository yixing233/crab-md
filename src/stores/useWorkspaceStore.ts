import { create } from "zustand";
import { api, toAppError } from "../lib/api";
import { logFailure } from "../lib/log";
import type { DocumentSummary } from "../types/document";

/**
 * 自动保存去抖时长。编辑停止后才落盘，避免每个按键都写文件。
 * `ARCHITECTURE.md` §12.2 允许「立即或短去抖后」本地写入。
 */
let autosaveDelayMs = 1000;

/** 仅测试用：调整去抖时长，让用例不必真等 1 秒。 */
export function __setAutosaveDelay(ms: number): void {
  autosaveDelayMs = ms;
}

/** 待触发的自动保存计时器。放在模块级，不参与渲染。 */
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutosave(): void {
  if (autosaveTimer !== null) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
}

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
  /**
   * 立即落盘未保存内容（取消防抖等待）。
   * 返回是否已安全落盘 —— 调用方据此决定能否继续切换/关闭，
   * 因为「静默丢内容」是 MUST NOT（ARCHITECTURE.md §18.1、UI §42.10）。
   */
  flushActive: () => Promise<boolean>;
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
      const code = toAppError(raw).code;
      logFailure({ op: "listDocuments", code }, raw);
      set({ error: code, loading: false });
    }
  },

  openDocument: async (id) => {
    // 切换前先把当前文档落盘。否则未保存的编辑会被下面的 set 静默覆盖。
    if (!(await get().flushActive())) return;

    set({ error: null });
    try {
      const doc = await api.readDocument(id);
      set({ activeId: doc.id, activeContent: doc.content, dirty: false });
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "openDocument", code, documentId: id }, raw);
      set({ error: code });
    }
  },

  createDocument: async (title, virtualPath = "/") => {
    // 新建也会切走当前文档，同样先落盘。
    if (!(await get().flushActive())) return;

    set({ error: null });
    try {
      const created = await api.createDocument(title, virtualPath);
      set({ activeId: created.id, activeContent: "", dirty: false });
      await get().loadDocuments();
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "createDocument", code }, raw);
      set({ error: code });
    }
  },

  renameDocument: async (id, title) => {
    set({ error: null });
    try {
      await api.renameDocument(id, title);
      await get().loadDocuments();
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "renameDocument", code, documentId: id }, raw);
      set({ error: code });
    }
  },

  deleteDocument: async (id) => {
    // 删除是用户显式确认过的破坏性操作，此时丢弃编辑是符合意图的，
    // 但要先取消待触发的自动保存，避免删除后又把内容写回去。
    if (get().activeId === id) clearAutosave();

    set({ error: null });
    try {
      await api.deleteDocument(id);
      // 删掉的正是当前打开的文档时清空编辑器，否则保持编辑状态不受影响。
      if (get().activeId === id) {
        set({ activeId: null, activeContent: "", dirty: false });
      }
      await get().loadDocuments();
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "deleteDocument", code, documentId: id }, raw);
      set({ error: code });
    }
  },

  saveActive: async () => {
    const { activeId, activeContent } = get();
    if (!activeId) return;

    // 显式保存（Ctrl+S）与自动保存共用此路径，先取消防抖避免重复写。
    clearAutosave();
    set({ error: null });
    try {
      await api.saveDocument(activeId, activeContent);
      set({ dirty: false });
      await get().loadDocuments();
    } catch (raw) {
      const code = toAppError(raw).code;
      // 只记录 id 与错误码；正文一律不进日志（ARCH §23 MUST NOT）。
      logFailure({ op: "saveDocument", code, documentId: activeId }, raw);
      set({ error: code });
    }
  },

  flushActive: async () => {
    clearAutosave();
    if (!get().dirty) return true;
    await get().saveActive();
    // saveActive 失败时会写入 error 且 dirty 仍为 true —— 据此返回未落盘。
    return !get().dirty;
  },

  setContent: (content) => {
    set({ activeContent: content, dirty: true });
    // 每次编辑都重置计时器：停止输入 autosaveDelayMs 后才落盘。
    clearAutosave();
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      // 落盘失败时 dirty 保持 true，error 已设置，UI 会提示。
      void get().saveActive();
    }, autosaveDelayMs);
  },

  clearError: () => set({ error: null }),
}));
