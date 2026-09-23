import { create } from "zustand";
import { api, toAppError } from "../lib/api";
import { logFailure } from "../lib/log";
import type { AppSettingsView, DocumentSummary } from "../types/document";

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
  /** 设置视图（数据目录等）。加载失败时为 null，设置页据此显示错误。 */
  settings: AppSettingsView | null;

  loadDocuments: () => Promise<void>;
  openDocument: (id: string) => Promise<void>;
  createDocument: (title: string, virtualPath?: string) => Promise<void>;
  renameDocument: (id: string, title: string) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  /** 另存为副本；成功后打开新副本，符合「另存为后我就在编辑它」的预期。 */
  duplicateDocument: (id: string, title: string) => Promise<void>;

  /** 导出到指定路径（由系统对话框取得）。返回是否成功。 */
  exportDocument: (id: string, targetPath: string) => Promise<boolean>;
  /** 导入文件为新文档并打开；失败返回 null。 */
  importDocument: (sourcePath: string) => Promise<DocumentSummary | null>;

  /** 读取设置（数据目录等）。 */
  loadSettings: () => Promise<void>;
  /**
   * 切换数据目录并重新载入文档列表。
   *
   * 失败时**不清空当前文档**：后端的切换是「先验证后交换」，
   * 失败意味着旧工作区仍完好，界面就不该表现成"什么都没有了"。
   */
  setWorkspaceRoot: (path: string) => Promise<boolean>;
  /** 回到平台默认数据目录。 */
  resetWorkspaceRoot: () => Promise<boolean>;
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
  settings: null,

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

  duplicateDocument: async (id, title) => {
    set({ error: null });
    try {
      const copy = await api.duplicateDocument(id, title);
      await get().loadDocuments();
      // 打开新副本：另存为之后用户预期正在编辑那份副本。
      // openDocument 会读回正文（副本内容即原文），无需在这里预置。
      await get().openDocument(copy.id);
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "duplicateDocument", code, documentId: id }, raw);
      set({ error: code });
    }
  },

  /**
   * 导出到指定路径。返回是否成功 —— 调用方据此决定要不要提示「已导出」。
   *
   * 导出前先 flush：交给别人的文件必须是磁盘上最新那份内容，
   * 否则会导出上一次保存的旧版本（用户刚改的部分丢失）。
   */
  exportDocument: async (id, targetPath) => {
    if (!(await get().flushActive())) return false;
    set({ error: null });
    try {
      await api.exportDocument(id, targetPath);
      return true;
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "exportDocument", code, documentId: id }, raw);
      set({ error: code });
      return false;
    }
  },

  /**
   * 导入文件为**新文档**并打开它。
   *
   * 先 flush 当前文档：导入会切换 activeId，未保存的编辑会被覆盖。
   */
  importDocument: async (sourcePath) => {
    if (!(await get().flushActive())) return null;
    set({ error: null });
    try {
      const created = await api.importDocument(sourcePath);
      await get().loadDocuments();
      await get().openDocument(created.id);
      return created;
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "importDocument", code }, raw);
      set({ error: code });
      return null;
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

  loadSettings: async () => {
    try {
      set({ settings: await api.getSettings() });
    } catch (raw) {
      // 设置读不出来不该让整个界面报错；设置页会显示它自己的失败态。
      const code = toAppError(raw).code;
      logFailure({ op: "getSettings", code }, raw);
    }
  },

  setWorkspaceRoot: async (path) => {
    // 切换前先把当前编辑落盘，否则会跟着旧工作区一起被换掉。
    if (!(await get().flushActive())) return false;

    set({ error: null });
    try {
      const settings = await api.setWorkspaceRoot(path);
      // 换目录等于换了一整套文档：清空编辑器，重新拉列表。
      set({ settings, activeId: null, activeContent: "", dirty: false });
      await get().loadDocuments();
      return true;
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "setWorkspaceRoot", code }, raw);
      // 只设错误，不动 documents/activeId —— 后端已保证旧工作区完好。
      set({ error: code });
      return false;
    }
  },

  resetWorkspaceRoot: async () => {
    if (!(await get().flushActive())) return false;

    set({ error: null });
    try {
      const settings = await api.resetWorkspaceRoot();
      set({ settings, activeId: null, activeContent: "", dirty: false });
      await get().loadDocuments();
      return true;
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "resetWorkspaceRoot", code }, raw);
      set({ error: code });
      return false;
    }
  },
}));
