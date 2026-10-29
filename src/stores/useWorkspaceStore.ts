import { create } from "zustand";
import { api, toAppError } from "../lib/api";
import { logFailure } from "../lib/log";
import {
  clearAllRecoveryDrafts,
  clearRecoveryDraft,
  readRecoveryDraft,
  toRecoveryCandidate,
  writeRecoveryDraft,
  type RecoveryCandidate,
} from "../lib/recovery";
import { AUTOSAVE_DELAY_MS, type AutosaveMode } from "../lib/editorSettings";
import type {
  AppSettingsView,
  DocumentSummary,
  ExternalFileView,
  OpenFilePayload,
  RecentFileView,
} from "../types/document";

/**
 * 自动保存模式。编辑停止后按档位去抖落盘，避免每个按键都写文件；
 * `off` 时完全不自动保存（Ctrl+S 仍可用，崩溃恢复草稿独立生效）。
 * `ARCHITECTURE.md` §12.2 允许「立即或短去抖后」本地写入。
 */
let autosaveMode: AutosaveMode = "1s";

/**
 * 应用自动保存档位（App 启动与设置页切换时调用）。
 *
 * 切到 off 时取消待触发的计时器：内容保持 dirty，由用户手动 Ctrl+S，
 * 切走文档 / 关闭窗口时的 flushActive 仍会兜底询问保存。
 */
export function applyAutosaveMode(mode: AutosaveMode): void {
  autosaveMode = mode;
  if (mode === "off") clearAutosave();
}

/** 仅测试用：直接设去抖毫秒数，让用例不必真等真实档位的时长。 */
export function __setAutosaveDelay(ms: number): void {
  autosaveMode = "1s";
  autosaveDelayOverrideMs = ms;
}

/** 测试用的去抖覆盖值；null 表示按 autosaveMode 的档位表取值。 */
let autosaveDelayOverrideMs: number | null = null;

/** 当前生效的去抖毫秒数。 */
function effectiveAutosaveDelayMs(): number {
  if (autosaveDelayOverrideMs !== null) return autosaveDelayOverrideMs;
  return autosaveMode === "off" ? 0 : AUTOSAVE_DELAY_MS[autosaveMode];
}

/** 待触发的自动保存计时器。放在模块级，不参与渲染。 */
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
/** 防止快速切换文档时旧的异步 read 响应覆盖新文档。 */
let openRequestToken = 0;

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
  /**
   * 打开过的外部文件（磁盘上原位编辑的那些）。
   *
   * 只有元数据与存在性，**没有正文** —— 正文永远从磁盘现读。
   * 这份清单来自工作区数据库，因此重启后依然存在；也正是它让
   * 「上次打开的外部文件」不必再走一遍文件选择器。
   */
  externalFiles: ExternalFileView[];
  /**
   * 外部文件清单是否已成功加载过一次。
   *
   * 界面据此决定能不能清理失效的外部标签页：清单还没读回来之前
   * 所有记录都「不存在」，此时清理会把用户重启前的标签全部误删。
   */
  externalFilesLoaded: boolean;
  /**
   * 当前激活的外部文件的磁盘基准内容（最后一次读写磁盘时的值）。
   *
   * 仅当 `activeId` 是 `ext:` 标签页时有效。编辑它与 `activeContent`
   * 不等即为「有未保存改动」，`saveActive` 据此写回原文件而不是工作区。
   */
  externalBaseline: string | null;
  /** 打开文档时发现的本地未保存草稿；必须由用户明确选择恢复或放弃。 */
  recoveryCandidate: RecoveryCandidate | null;

  // =========================================================================
  // 统一磁盘文件模型（编辑器/阅读器模式）
  // =========================================================================

  /** 统一历史记录：打开过的所有本地磁盘文件列表。 */
  recentFiles: RecentFileView[];
  /** 历史记录是否已加载完成。 */
  recentFilesLoaded: boolean;
  /** 加载历史文件清单。 */
  loadRecentFiles: () => Promise<void>;
  /** 打开任意本地磁盘文件。 */
  openDiskFile: (path: string) => Promise<OpenFilePayload | null>;
  /** 保存文件到磁盘。 */
  saveDiskFile: (path: string, content: string) => Promise<boolean>;
  /** 创建并保存新文件到磁盘。 */
  createDiskFile: (path: string, content: string) => Promise<boolean>;
  /** 从历史列表中移除记录（不删除磁盘文件）。 */
  removeRecentFile: (path: string) => Promise<boolean>;
  /** 彻底从磁盘删除文件，并清理历史记录。 */
  deleteDiskFile: (path: string) => Promise<boolean>;
  /** 置顶/取消置顶某个历史文件。 */
  setFilePinned: (path: string, pinned: boolean) => Promise<void>;
  /** 保存阅读/编辑位置会话状态。 */
  updateFileSession: (
    path: string,
    line: number,
    col: number,
    scrollRatio: number,
  ) => Promise<void>;

  loadDocuments: () => Promise<void>;
  openDocument: (id: string) => Promise<void>;
  createDocument: (title: string, virtualPath?: string) => Promise<void>;
  renameDocument: (id: string, title: string) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  /** 另存为副本；成功后打开新副本，符合「另存为后我就在编辑它」的预期。 */
  duplicateDocument: (id: string, title: string) => Promise<void>;

  /** 导出到指定路径（由系统对话框取得）。返回是否成功。 */
  exportDocument: (id: string, targetPath: string) => Promise<boolean>;
  /** 打开文本或 Markdown 文件为新文档并打开；失败返回 null。 */
  importDocument: (sourcePath: string) => Promise<DocumentSummary | null>;

  /** 读取已打开过的外部文件清单（来自工作区数据库）。 */
  loadExternalFiles: () => Promise<void>;
  /**
   * 把一条外部文件从清单里移除（只删记录，**不删磁盘文件**）。
   * 失败返回 false，调用方据此提示。
   */
  forgetExternalFile: (path: string) => Promise<boolean>;
  /**
   * 打开外部文件：内容由调用方（App）从磁盘读出并登记，
   * 这里只负责把编辑区切过去。
   *
   * `baseline` 是刚从磁盘读到的原文，用于判断有无未保存改动。
   */
  openExternal: (path: string, content: string) => void;

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
  restoreRecovery: () => void;
  discardRecovery: () => void;
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
  externalFiles: [],
  externalFilesLoaded: false,
  recentFiles: [],
  recentFilesLoaded: false,
  externalBaseline: null,
  recoveryCandidate: null,

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
    const requestToken = ++openRequestToken;
    // 切换前先把当前文档落盘。否则未保存的编辑会被下面的 set 静默覆盖。
    if (!(await get().flushActive())) return;
    if (requestToken !== openRequestToken) return;

    set({ error: null, recoveryCandidate: null });
    try {
      const doc = await api.readDocument(id);
      // 快速连续点击时，旧请求即使后返回也不能覆盖最新选择。
      if (requestToken !== openRequestToken) return;

      const draft = readRecoveryDraft(doc.id);
      const candidate = draft
        ? toRecoveryCandidate(draft, doc, doc.content)
        : null;
      if (draft && !candidate) clearRecoveryDraft(doc.id);

      set({
        activeId: doc.id,
        activeContent: doc.content,
        dirty: false,
        externalBaseline: null,
        recoveryCandidate: candidate,
      });
    } catch (raw) {
      if (requestToken !== openRequestToken) return;
      const code = toAppError(raw).code;
      logFailure({ op: "openDocument", code, documentId: id }, raw);
      set({ error: code, recoveryCandidate: null });
    }
  },

  createDocument: async (title, virtualPath = "/") => {
    const requestToken = ++openRequestToken;
    // 新建也会切走当前文档，同样先落盘。
    if (!(await get().flushActive())) return;
    if (requestToken !== openRequestToken) return;

    set({ error: null, recoveryCandidate: null });
    try {
      const created = await api.createDocument(title, virtualPath);
      if (requestToken !== openRequestToken) return;
      set({
        activeId: created.id,
        activeContent: "",
        dirty: false,
        externalBaseline: null,
        recoveryCandidate: null,
      });
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
    openRequestToken += 1;
    // 删除是用户显式确认过的破坏性操作，此时丢弃编辑是符合意图的，
    // 但要先取消待触发的自动保存，避免删除后又把内容写回去。
    if (get().activeId === id) clearAutosave();

    set({ error: null });
    try {
      await api.deleteDocument(id);
      clearRecoveryDraft(id);
      // 删掉的正是当前打开的文档时清空编辑器，否则保持编辑状态不受影响。
      if (get().activeId === id) {
        set({
          activeId: null,
          activeContent: "",
          dirty: false,
          externalBaseline: null,
          recoveryCandidate: null,
        });
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
   * 打开外部文本或 Markdown 文件，收进工作区成为**新文档**并打开它。
   *
   * 先 flush 当前文档：打开文件会切换 activeId，未保存的编辑会被覆盖。
   */
  importDocument: async (sourcePath) => {
    if (!(await get().flushActive())) return null;
    set({ error: null });
    try {
      const fileName = sourcePath.split(/[\\/]/).pop() || undefined;
      const created = await api.importDocument(sourcePath, fileName);
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

  /**
   * 读取已打开过的外部文件清单。
   *
   * 读不出来只记日志、不设 error：这是列表数据，失败最多让面板暂时空着，
   * 不该把整个界面顶成错误态（`documents` 才是主列表）。
   */
  loadExternalFiles: async () => {
    try {
      set({ externalFiles: await api.listExternalFiles(), externalFilesLoaded: true });
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "listExternalFiles", code }, raw);
    }
  },

  // =========================================================================
  // 统一磁盘文件模型实现（编辑器/阅读器模式）
  // =========================================================================

  loadRecentFiles: async () => {
    try {
      set({ recentFiles: await api.listRecentFiles(), recentFilesLoaded: true });
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "listRecentFiles", code }, raw);
    }
  },

  openDiskFile: async (path: string) => {
    const requestToken = ++openRequestToken;
    if (!(await get().flushActive())) return null;
    if (requestToken !== openRequestToken) return null;

    set({ error: null });
    try {
      const result = await api.openFile(path);
      if (requestToken !== openRequestToken) return null;
      set({
        activeId: `ext:${path}`,
        activeContent: result.content,
        externalBaseline: result.content,
        dirty: false,
        recoveryCandidate: null,
      });
      await get().loadRecentFiles();
      return result;
    } catch (raw) {
      if (requestToken !== openRequestToken) return null;
      const code = toAppError(raw).code;
      logFailure({ op: "openDiskFile", code, documentId: path }, raw);
      set({ error: code });
      return null;
    }
  },

  saveDiskFile: async (path: string, content: string) => {
    clearAutosave();
    set({ error: null });
    try {
      await api.saveFile(path, content);
      const current = get();
      if (current.activeId === `ext:${path}` && current.activeContent === content) {
        set({ dirty: false, externalBaseline: content });
      } else {
        set({ externalBaseline: content });
      }
      await get().loadRecentFiles();
      return true;
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "saveDiskFile", code, documentId: path }, raw);
      set({ error: code });
      return false;
    }
  },

  createDiskFile: async (path: string, content: string) => {
    set({ error: null });
    try {
      await api.createFile(path, content);
      set({
        activeId: `ext:${path}`,
        activeContent: content,
        externalBaseline: content,
        dirty: false,
      });
      await get().loadRecentFiles();
      return true;
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "createDiskFile", code, documentId: path }, raw);
      set({ error: code });
      return false;
    }
  },

  removeRecentFile: async (path: string) => {
    set({ error: null });
    try {
      await api.removeFromHistory(path);
      // 两张登记表都要重拉。Rust 侧同时清了 opened_files 与 external_files，
      // 但界面合并的列表来自**两份内存副本**：只刷 recentFiles 的话，
      // externalFiles 里那条旧记录会把刚删掉的条目原样合并回来 ——
      // 用户看到的就是「点了移除，条目还在」（而且没有任何报错）。
      await Promise.all([get().loadRecentFiles(), get().loadExternalFiles()]);
      return true;
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "removeRecentFile", code }, raw);
      set({ error: code });
      return false;
    }
  },

  deleteDiskFile: async (path: string) => {
    set({ error: null });
    try {
      await api.deleteFileOnDisk(path);
      const { activeId } = get();
      if (activeId === `ext:${path}`) {
        set({ activeId: null, activeContent: "", dirty: false, externalBaseline: null });
      }
      // 同 removeRecentFile：两份清单是一起合并展示的，只刷一份会留下残影。
      await Promise.all([get().loadRecentFiles(), get().loadExternalFiles()]);
      return true;
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "deleteDiskFile", code }, raw);
      set({ error: code });
      return false;
    }
  },

  setFilePinned: async (path: string, pinned: boolean) => {
    try {
      await api.setFilePinned(path, pinned);
      await get().loadRecentFiles();
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "setFilePinned", code }, raw);
    }
  },

  updateFileSession: async (path: string, line: number, col: number, scrollRatio: number) => {
    try {
      await api.updateFileSession(path, line, col, scrollRatio);
    } catch (raw) {
      // 纯阅读状态更新，静默失败
    }
  },

  forgetExternalFile: async (path) => {
    set({ error: null });
    try {
      await api.forgetExternalFile(path);
      await get().loadExternalFiles();
      return true;
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "forgetExternalFile", code }, raw);
      set({ error: code });
      return false;
    }
  },

  /**
   * 切到某个外部文件。
   *
   * 正文由调用方从磁盘读出后传入（读盘失败不会走到这里），
   * 记进 `activeContent` 的同时留一份 `externalBaseline` 作对比基准 ——
   * 用户在编辑区改字后，两者不等即表示需要写回原文件。
   */
  openExternal: (path, content) => {
    // 切走当前文档前先把未保存的编辑落盘，否则会被下面的 set 覆盖。
    // （调用方已 await flushActive，这里只做状态切换。）
    set({
      activeId: `ext:${path}`,
      activeContent: content,
      externalBaseline: content,
      dirty: false,
      error: null,
      recoveryCandidate: null,
    });
  },

  saveActive: async () => {
    const { activeId, activeContent } = get();
    if (!activeId) return;
    const savedId = activeId;
    const savedContent = activeContent;
    const extPath = savedId.startsWith("ext:") ? savedId.slice(4) : null;

    // 显式保存（Ctrl+S）与自动保存共用此路径，先取消防抖避免重复写。
    clearAutosave();
    set({ error: null });
    try {
      if (extPath !== null) {
        // 外部文件写回**用户自己的磁盘文件**，绝不进工作区（原位编辑）。
        await api.saveExternalFile(extPath, savedContent);
        // 保存期间用户可能继续输入：旧响应不能把新内容误标成已保存。
        const current = get();
        if (current.activeId === savedId && current.activeContent === savedContent) {
          set({ dirty: false, externalBaseline: savedContent });
        } else {
          // 内容又变了，但基准必须前移 —— 否则已落盘的那一版永远算「未保存」。
          set({ externalBaseline: savedContent });
        }
        // 刷新列表里的大小/时间戳与磁盘存在性（不影响「最近打开」的顺序）。
        // 统一历史（文件树的数据源）同样要拉：保存也会刷新那边的记录。
        await Promise.all([get().loadExternalFiles(), get().loadRecentFiles()]);
        return;
      }

      await api.saveDocument(savedId, savedContent);
      // 保存期间用户可能继续输入，或已经切到另一篇文档。
      // 旧响应不能把新内容误标成已保存，也不能删除新草稿。
      const current = get();
      if (current.activeId === savedId && current.activeContent === savedContent) {
        clearRecoveryDraft(savedId);
        set({ dirty: false });
      }
      await get().loadDocuments();
    } catch (raw) {
      const code = toAppError(raw).code;
      // 只记录 id 与错误码；正文一律不进日志（ARCH §23 MUST NOT）。
      logFailure({ op: "saveActive", code, documentId: savedId }, raw);
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
    const { activeId, documents, externalBaseline } = get();
    const isExternal = activeId !== null && activeId.startsWith("ext:");
    if (activeId && !isExternal) {
      const summary = documents.find((document) => document.id === activeId);
      if (summary) {
        // 先写本地草稿，再等待正式文件的去抖保存；进程在窗口期崩溃时仍可恢复。
        writeRecoveryDraft({
          documentId: activeId,
          content,
          baseRevision: summary.revision,
          baseContentHash: summary.contentHash,
          updatedAt: Date.now(),
        });
      }
    }
    // 外部文件没有本地草稿机制：它的权威副本就是磁盘上那个文件，
    // 所以 dirty 只能由「与磁盘基准是否一致」推出，不能一律标脏。
    const nextDirty = isExternal ? content !== externalBaseline : true;
    set({ activeContent: content, dirty: nextDirty, recoveryCandidate: null });
    if (!nextDirty) {
      clearAutosave();
      return;
    }
    // 自动保存关闭时不排程：内容保持 dirty，等用户 Ctrl+S 或切换时的兜底。
    if (autosaveMode === "off") {
      clearAutosave();
      return;
    }
    // 每次编辑都重置计时器：停止输入设定档位的毫秒数后才落盘。
    clearAutosave();
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      // 落盘失败时 dirty 保持 true，error 已设置，UI 会提示。
      void get().saveActive();
    }, effectiveAutosaveDelayMs());
  },

  restoreRecovery: () => {
    const candidate = get().recoveryCandidate;
    if (!candidate || get().activeId !== candidate.documentId) return;
    // 显式恢复也要走 setContent：重新进入自动保存流程，并把候选清掉。
    get().setContent(candidate.content);
    set({ recoveryCandidate: null });
  },

  discardRecovery: () => {
    const candidate = get().recoveryCandidate;
    if (!candidate) return;
    clearRecoveryDraft(candidate.documentId);
    set({ recoveryCandidate: null });
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
    const requestToken = ++openRequestToken;
    // 切换前先把当前编辑落盘，否则会跟着旧工作区一起被换掉。
    if (!(await get().flushActive())) return false;
    if (requestToken !== openRequestToken) return false;

    set({ error: null });
    try {
      const settings = await api.setWorkspaceRoot(path);
      if (requestToken !== openRequestToken) return false;
      clearAllRecoveryDrafts();
      // 换目录等于换了一整套文档：清空编辑器，重新拉列表。
      // 外部文件记录也在工作区库里，同样必须重拉（否则会带着旧工作区的清单）。
      set({
        settings,
        activeId: null,
        activeContent: "",
        dirty: false,
        externalBaseline: null,
        recoveryCandidate: null,
        externalFiles: [],
        externalFilesLoaded: false,
      });
      await get().loadDocuments();
      await get().loadExternalFiles();
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
    const requestToken = ++openRequestToken;
    if (!(await get().flushActive())) return false;
    if (requestToken !== openRequestToken) return false;

    set({ error: null });
    try {
      const settings = await api.resetWorkspaceRoot();
      if (requestToken !== openRequestToken) return false;
      clearAllRecoveryDrafts();
      set({
        settings,
        activeId: null,
        activeContent: "",
        dirty: false,
        externalBaseline: null,
        recoveryCandidate: null,
        externalFiles: [],
        externalFilesLoaded: false,
      });
      await get().loadDocuments();
      await get().loadExternalFiles();
      return true;
    } catch (raw) {
      const code = toAppError(raw).code;
      logFailure({ op: "resetWorkspaceRoot", code }, raw);
      set({ error: code });
      return false;
    }
  },
}));
