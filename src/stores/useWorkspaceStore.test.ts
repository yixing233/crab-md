import { beforeEach, describe, expect, it, vi } from "vitest";

const listDocuments = vi.fn();
const createDocument = vi.fn();
const readDocument = vi.fn();
const saveDocument = vi.fn();
const renameDocument = vi.fn();
const deleteDocument = vi.fn();
const duplicateDocument = vi.fn();
const getSettings = vi.fn();
const setWorkspaceRootApi = vi.fn();
const resetWorkspaceRootApi = vi.fn();
const listExternalFiles = vi.fn();
const forgetExternalFile = vi.fn();
const saveExternalFile = vi.fn();
const listRecentFiles = vi.fn();
const removeFromHistory = vi.fn();
const deleteFileOnDisk = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    createDocument: (...a: unknown[]) => createDocument(...a),
    readDocument: (...a: unknown[]) => readDocument(...a),
    saveDocument: (...a: unknown[]) => saveDocument(...a),
    renameDocument: (...a: unknown[]) => renameDocument(...a),
    deleteDocument: (...a: unknown[]) => deleteDocument(...a),
    duplicateDocument: (...a: unknown[]) => duplicateDocument(...a),
    getSettings: (...a: unknown[]) => getSettings(...a),
    setWorkspaceRoot: (...a: unknown[]) => setWorkspaceRootApi(...a),
    resetWorkspaceRoot: (...a: unknown[]) => resetWorkspaceRootApi(...a),
    listExternalFiles: (...a: unknown[]) => listExternalFiles(...a),
    forgetExternalFile: (...a: unknown[]) => forgetExternalFile(...a),
    saveExternalFile: (...a: unknown[]) => saveExternalFile(...a),
    listRecentFiles: (...a: unknown[]) => listRecentFiles(...a),
    removeFromHistory: (...a: unknown[]) => removeFromHistory(...a),
    deleteFileOnDisk: (...a: unknown[]) => deleteFileOnDisk(...a),
  },
  toAppError: (raw: unknown) =>
    raw && typeof raw === "object" && "code" in raw
      ? raw
      : { code: "UNKNOWN", message: String(raw) },
}));

import { readRecoveryDraft, writeRecoveryDraft } from "../lib/recovery";
import { useWorkspaceStore, __setAutosaveDelay } from "./useWorkspaceStore";

function summary(id: string, title = "T") {
  return {
    id, title, virtualPath: "/", revision: 1,
    contentHash: "sha256:x",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    size: 0,
  };
}

describe("useWorkspaceStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 失败路径会经 lib/log 写 console.error；那是预期行为，
    // 但会把测试输出淹掉，故在断言层面之外静音。
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.clear();
    useWorkspaceStore.setState({
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false, recoveryCandidate: null,
      externalFiles: [], externalFilesLoaded: false, externalBaseline: null,
    });
  });

  it("loads documents", async () => {
    listDocuments.mockResolvedValue([summary("1")]);
    await useWorkspaceStore.getState().loadDocuments();
    expect(useWorkspaceStore.getState().documents).toHaveLength(1);
    expect(useWorkspaceStore.getState().loading).toBe(false);
  });

  it("records an error code when loading fails", async () => {
    listDocuments.mockRejectedValue({ code: "DB_ERROR", message: "boom" });
    await useWorkspaceStore.getState().loadDocuments();
    expect(useWorkspaceStore.getState().error).toBe("DB_ERROR");
    expect(useWorkspaceStore.getState().loading).toBe(false);
  });

  it("opens a document and marks it clean", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "# hi" });
    await useWorkspaceStore.getState().openDocument("1");
    const s = useWorkspaceStore.getState();
    expect(s.activeId).toBe("1");
    expect(s.activeContent).toBe("# hi");
    expect(s.dirty).toBe(false);
  });

  it("creates a document and opens it", async () => {
    createDocument.mockResolvedValue(summary("9", "New"));
    await useWorkspaceStore.getState().createDocument("New");
    const s = useWorkspaceStore.getState();
    expect(createDocument).toHaveBeenCalledWith("New", "/");
    expect(s.activeId).toBe("9");
  });

  it("marks dirty on edit and clears it on save", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "old" });
    saveDocument.mockResolvedValue(summary("1"));
    await useWorkspaceStore.getState().openDocument("1");

    useWorkspaceStore.getState().setContent("new");
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    expect(useWorkspaceStore.getState().activeContent).toBe("new");

    await useWorkspaceStore.getState().saveActive();
    expect(saveDocument).toHaveBeenCalledWith("1", "new");
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });

  it("renames and refreshes the list", async () => {
    renameDocument.mockResolvedValue(summary("1", "Renamed"));
    listDocuments.mockResolvedValue([summary("1", "Renamed")]);
    await useWorkspaceStore.getState().renameDocument("1", "Renamed");
    expect(useWorkspaceStore.getState().documents[0].title).toBe("Renamed");
  });

  it("clears the active document when the open one is deleted", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "x" });
    deleteDocument.mockResolvedValue(undefined);
    listDocuments.mockResolvedValue([]);
    await useWorkspaceStore.getState().openDocument("1");

    await useWorkspaceStore.getState().deleteDocument("1");
    const s = useWorkspaceStore.getState();
    expect(s.activeId).toBeNull();
    expect(s.activeContent).toBe("");
  });

  it("keeps the active document when a different one is deleted", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "x" });
    deleteDocument.mockResolvedValue(undefined);
    listDocuments.mockResolvedValue([summary("1")]);
    await useWorkspaceStore.getState().openDocument("1");

    await useWorkspaceStore.getState().deleteDocument("2");
    expect(useWorkspaceStore.getState().activeId).toBe("1");
  });
});

/**
 * 数据安全回归（ARCHITECTURE.md §18.1 MUST NOT discard unsaved content；
 * UI_DESIGN_SYSTEM.md §42.10）。这组用例存在的意义就是防止「静默丢内容」回归。
 */
describe("unsaved content is never silently discarded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.clear();
    // 去抖调长，确保用例不会因为自动保存提前触发而失真。
    __setAutosaveDelay(60_000);
    useWorkspaceStore.setState({
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false, recoveryCandidate: null,
      externalFiles: [], externalFilesLoaded: false, externalBaseline: null,
    });
  });

  it("saves the dirty document before switching to another", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "old" });
    saveDocument.mockResolvedValue(summary("1"));
    listDocuments.mockResolvedValue([summary("1"), summary("2")]);

    await useWorkspaceStore.getState().openDocument("1");
    useWorkspaceStore.getState().setContent("被编辑但未按 Ctrl+S 的内容");

    // 切到文档 2 —— 这是原先会丢内容的路径。
    readDocument.mockResolvedValue({ ...summary("2"), content: "doc2" });
    await useWorkspaceStore.getState().openDocument("2");

    expect(saveDocument).toHaveBeenCalledWith("1", "被编辑但未按 Ctrl+S 的内容");
  });

  it("blocks the switch when the save fails, so content is not lost", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "old" });
    saveDocument.mockRejectedValue({ code: "IO_ERROR", message: "disk full" });
    listDocuments.mockResolvedValue([summary("1"), summary("2")]);

    await useWorkspaceStore.getState().openDocument("1");
    useWorkspaceStore.getState().setContent("重要内容");

    readDocument.mockClear();
    await useWorkspaceStore.getState().openDocument("2");

    // 没有切走：内容仍在编辑器里，dirty 保持。
    const s = useWorkspaceStore.getState();
    expect(s.activeId).toBe("1");
    expect(s.activeContent).toBe("重要内容");
    expect(s.dirty).toBe(true);
    expect(s.error).toBe("IO_ERROR");
    expect(readDocument).not.toHaveBeenCalled();
  });

  it("saves before creating a new document too", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "old" });
    saveDocument.mockResolvedValue(summary("1"));
    createDocument.mockResolvedValue(summary("9", "New"));
    listDocuments.mockResolvedValue([summary("1")]);

    await useWorkspaceStore.getState().openDocument("1");
    useWorkspaceStore.getState().setContent("新建前的编辑");
    await useWorkspaceStore.getState().createDocument("New");

    expect(saveDocument).toHaveBeenCalledWith("1", "新建前的编辑");
  });

  it("flushes and reports success", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "old" });
    saveDocument.mockResolvedValue(summary("1"));
    await useWorkspaceStore.getState().openDocument("1");

    useWorkspaceStore.getState().setContent("未保存");
    const ok = await useWorkspaceStore.getState().flushActive();

    expect(ok).toBe(true);
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });

  it("flush is a no-op when nothing changed", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "clean" });
    await useWorkspaceStore.getState().openDocument("1");

    const ok = await useWorkspaceStore.getState().flushActive();
    expect(ok).toBe(true);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("does not write back content after the document was deleted", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "x" });
    deleteDocument.mockResolvedValue(undefined);
    listDocuments.mockResolvedValue([]);
    __setAutosaveDelay(20);

    await useWorkspaceStore.getState().openDocument("1");
    useWorkspaceStore.getState().setContent("删除前的编辑");
    await useWorkspaceStore.getState().deleteDocument("1");

    // 等过自动保存窗口，确认没有把内容写回已删除的文档。
    await new Promise((r) => setTimeout(r, 60));
    expect(saveDocument).not.toHaveBeenCalled();
  });
});

describe("autosave debounce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.clear();
    useWorkspaceStore.setState({
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false, recoveryCandidate: null,
      externalFiles: [], externalFilesLoaded: false, externalBaseline: null,
    });
  });

  it("writes to disk after the debounce without any explicit save", async () => {
    __setAutosaveDelay(20);
    readDocument.mockResolvedValue({ ...summary("1"), content: "old" });
    saveDocument.mockResolvedValue(summary("1"));
    listDocuments.mockResolvedValue([summary("1")]);

    await useWorkspaceStore.getState().openDocument("1");
    useWorkspaceStore.getState().setContent("自动保存我");

    expect(saveDocument).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 60));
    expect(saveDocument).toHaveBeenCalledWith("1", "自动保存我");
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });

  it("collapses rapid typing into a single write", async () => {
    __setAutosaveDelay(30);
    readDocument.mockResolvedValue({ ...summary("1"), content: "old" });
    saveDocument.mockResolvedValue(summary("1"));
    listDocuments.mockResolvedValue([summary("1")]);

    await useWorkspaceStore.getState().openDocument("1");
    const setContent = useWorkspaceStore.getState().setContent;
    setContent("a");
    setContent("ab");
    setContent("abc");

    await new Promise((r) => setTimeout(r, 80));
    expect(saveDocument).toHaveBeenCalledTimes(1);
    expect(saveDocument).toHaveBeenCalledWith("1", "abc");
  });
});

describe("useWorkspaceStore recovery drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setAutosaveDelay(60_000);
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.clear();
    useWorkspaceStore.setState({
      documents: [summary("1")],
      activeId: null,
      activeContent: "",
      loading: false,
      error: null,
      dirty: false,
      recoveryCandidate: null,
    });
  });

  it("writes a draft immediately and removes it after the matching save", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "old" });
    saveDocument.mockResolvedValue(summary("1"));
    await useWorkspaceStore.getState().openDocument("1");

    useWorkspaceStore.getState().setContent("crash-safe");
    expect(readRecoveryDraft("1")?.content).toBe("crash-safe");

    await useWorkspaceStore.getState().saveActive();
    expect(readRecoveryDraft("1")).toBeNull();
  });

  it("offers a candidate without replacing the saved document", async () => {
    writeRecoveryDraft({
      documentId: "1",
      content: "本地草稿",
      baseRevision: 1,
      baseContentHash: "sha256:x",
      updatedAt: Date.now(),
    });
    readDocument.mockResolvedValue({ ...summary("1"), content: "磁盘正文" });

    await useWorkspaceStore.getState().openDocument("1");
    expect(useWorkspaceStore.getState().activeContent).toBe("磁盘正文");
    expect(useWorkspaceStore.getState().dirty).toBe(false);
    expect(useWorkspaceStore.getState().recoveryCandidate?.content).toBe("本地草稿");

    useWorkspaceStore.getState().restoreRecovery();
    expect(useWorkspaceStore.getState().activeContent).toBe("本地草稿");
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    expect(useWorkspaceStore.getState().recoveryCandidate).toBeNull();
  });

  it("discarding a candidate removes its local copy", async () => {
    writeRecoveryDraft({
      documentId: "1",
      content: "放弃我",
      baseRevision: 1,
      baseContentHash: "sha256:x",
      updatedAt: Date.now(),
    });
    readDocument.mockResolvedValue({ ...summary("1"), content: "磁盘正文" });

    await useWorkspaceStore.getState().openDocument("1");
    useWorkspaceStore.getState().discardRecovery();
    expect(readRecoveryDraft("1")).toBeNull();
    expect(useWorkspaceStore.getState().activeContent).toBe("磁盘正文");
  });

  it("does not clear a newer edit when an older save resolves", async () => {
    readDocument.mockResolvedValue({ ...summary("1"), content: "old" });
    await useWorkspaceStore.getState().openDocument("1");

    let resolveSave!: (value: unknown) => void;
    saveDocument.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    useWorkspaceStore.getState().setContent("first");
    const saving = useWorkspaceStore.getState().saveActive();
    useWorkspaceStore.getState().setContent("second");
    resolveSave(summary("1"));
    await saving;

    expect(useWorkspaceStore.getState().dirty).toBe(true);
    expect(readRecoveryDraft("1")?.content).toBe("second");
  });
});

/**
 * 另存为副本（ARCHITECTURE.md §11：副本必须是独立身份）。
 */
describe("useWorkspaceStore duplicateDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setAutosaveDelay(60_000);
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.clear();
    useWorkspaceStore.setState({
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false, recoveryCandidate: null,
      externalFiles: [], externalFilesLoaded: false, externalBaseline: null,
    });
  });

  it("calls the backend with the id and the new title", async () => {
    duplicateDocument.mockResolvedValue(summary("copy", "原名 副本"));
    listDocuments.mockResolvedValue([summary("orig", "原名"), summary("copy", "原名 副本")]);
    readDocument.mockResolvedValue({ ...summary("copy", "原名 副本"), content: "正文" });

    await useWorkspaceStore.getState().duplicateDocument("orig", "原名 副本");
    expect(duplicateDocument).toHaveBeenCalledWith("orig", "原名 副本");
  });

  it("opens the new copy so the user is editing it right away", async () => {
    duplicateDocument.mockResolvedValue(summary("copy", "副本"));
    listDocuments.mockResolvedValue([summary("orig", "原本"), summary("copy", "副本")]);
    readDocument.mockResolvedValue({ ...summary("copy", "副本"), content: "复制来的正文" });

    await useWorkspaceStore.getState().duplicateDocument("orig", "副本");

    const s = useWorkspaceStore.getState();
    expect(s.activeId).toBe("copy");
    expect(s.activeContent).toBe("复制来的正文");
  });

  it("keeps the original document untouched", async () => {
    readDocument.mockResolvedValue({ ...summary("orig", "原本"), content: "原文" });
    saveDocument.mockResolvedValue(summary("orig"));
    listDocuments.mockResolvedValue([summary("orig", "原本")]);
    await useWorkspaceStore.getState().openDocument("orig");

    duplicateDocument.mockResolvedValue(summary("copy", "副本"));
    listDocuments.mockResolvedValue([summary("orig", "原本"), summary("copy", "副本")]);
    readDocument.mockResolvedValue({ ...summary("copy", "副本"), content: "原文" });

    await useWorkspaceStore.getState().duplicateDocument("orig", "副本");

    // 原文档从未被写入，只是被读取过。
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("flushes unsaved edits first, so the copy includes what the user sees", async () => {
    // 这是关键语义：另存为必须复制眼前的内容，而不是上次保存的版本。
    readDocument.mockResolvedValue({ ...summary("orig", "原本"), content: "旧" });
    saveDocument.mockResolvedValue(summary("orig"));
    listDocuments.mockResolvedValue([summary("orig", "原本")]);
    await useWorkspaceStore.getState().openDocument("orig");
    useWorkspaceStore.getState().setContent("刚编辑的新内容");

    duplicateDocument.mockResolvedValue(summary("copy", "副本"));

    await useWorkspaceStore.getState().duplicateDocument("orig", "原本 副本");

    expect(saveDocument).toHaveBeenCalledWith("orig", "刚编辑的新内容");
  });

  it("records an error code when the copy fails", async () => {
    duplicateDocument.mockRejectedValue({ code: "IO_ERROR", message: "disk full" });
    await useWorkspaceStore.getState().duplicateDocument("orig", "副本");
    expect(useWorkspaceStore.getState().error).toBe("IO_ERROR");
  });

  it("refreshes the list so the copy shows up in the sidebar", async () => {
    duplicateDocument.mockResolvedValue(summary("copy", "副本"));
    listDocuments.mockResolvedValue([summary("orig", "原本"), summary("copy", "副本")]);
    readDocument.mockResolvedValue({ ...summary("copy", "副本"), content: "" });

    await useWorkspaceStore.getState().duplicateDocument("orig", "副本");

    expect(useWorkspaceStore.getState().documents).toHaveLength(2);
  });
});

/** 数据目录设置（UI §34）。 */
describe("useWorkspaceStore settings", () => {
  const view = (over: Record<string, unknown> = {}) => ({
    workspaceRoot: null,
    effectiveWorkspaceRoot: "E:/default/workspace",
    workspaceRootIsFromEnv: false,
    configPath: "E:/config/settings.json",
    version: 1,
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    __setAutosaveDelay(60_000);
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.clear();
    useWorkspaceStore.setState({
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false, recoveryCandidate: null, settings: null,
    });
  });

  it("loads settings", async () => {
    getSettings.mockResolvedValue(view());
    await useWorkspaceStore.getState().loadSettings();
    expect(useWorkspaceStore.getState().settings?.effectiveWorkspaceRoot)
      .toBe("E:/default/workspace");
  });

  it("a failed settings read does not break the rest of the app", async () => {
    getSettings.mockRejectedValue({ code: "IO_ERROR", message: "boom" });
    await useWorkspaceStore.getState().loadSettings();
    // 设置读不出来不该让整个界面报错。
    expect(useWorkspaceStore.getState().settings).toBeNull();
    expect(useWorkspaceStore.getState().error).toBeNull();
  });

  it("switches the workspace root and reloads documents", async () => {
    setWorkspaceRootApi.mockResolvedValue(view({ workspaceRoot: "E:/notes" }));
    listDocuments.mockResolvedValue([summary("new", "新目录的笔记")]);

    const ok = await useWorkspaceStore.getState().setWorkspaceRoot("E:/notes");

    expect(ok).toBe(true);
    expect(setWorkspaceRootApi).toHaveBeenCalledWith("E:/notes");
    expect(useWorkspaceStore.getState().settings?.workspaceRoot).toBe("E:/notes");
    expect(useWorkspaceStore.getState().documents).toHaveLength(1);
  });

  it("clears the open document after switching, since it belongs to the old root", async () => {
    readDocument.mockResolvedValue({ ...summary("old", "旧目录的笔记"), content: "旧内容" });
    listDocuments.mockResolvedValue([summary("old", "旧目录的笔记")]);
    await useWorkspaceStore.getState().openDocument("old");
    expect(useWorkspaceStore.getState().activeId).toBe("old");

    setWorkspaceRootApi.mockResolvedValue(view({ workspaceRoot: "E:/notes" }));
    listDocuments.mockResolvedValue([]);
    await useWorkspaceStore.getState().setWorkspaceRoot("E:/notes");

    const s = useWorkspaceStore.getState();
    expect(s.activeId).toBeNull();
    expect(s.activeContent).toBe("");
  });

  it("keeps the current documents when switching fails", async () => {
    // 后端是「先验证后交换」：失败时旧工作区完好，界面不该表现成空。
    listDocuments.mockResolvedValue([summary("keep", "还在的笔记")]);
    await useWorkspaceStore.getState().loadDocuments();

    setWorkspaceRootApi.mockRejectedValue({ code: "IO_ERROR", message: "nope" });
    const ok = await useWorkspaceStore.getState().setWorkspaceRoot("E:/broken");

    expect(ok).toBe(false);
    expect(useWorkspaceStore.getState().error).toBe("IO_ERROR");
    expect(useWorkspaceStore.getState().documents).toHaveLength(1);
  });

  it("flushes unsaved edits before switching directories", async () => {
    readDocument.mockResolvedValue({ ...summary("d1", "甲"), content: "old" });
    saveDocument.mockResolvedValue(summary("d1", "甲"));
    listDocuments.mockResolvedValue([summary("d1", "甲")]);
    await useWorkspaceStore.getState().openDocument("d1");
    useWorkspaceStore.getState().setContent("未保存的编辑");

    setWorkspaceRootApi.mockResolvedValue(view({ workspaceRoot: "E:/notes" }));
    await useWorkspaceStore.getState().setWorkspaceRoot("E:/notes");

    // 换目录前必须先落盘，否则这份编辑会跟着旧工作区一起被换掉。
    expect(saveDocument).toHaveBeenCalledWith("d1", "未保存的编辑");
  });

  it("does not switch when the flush fails", async () => {
    readDocument.mockResolvedValue({ ...summary("d1", "甲"), content: "old" });
    saveDocument.mockRejectedValue({ code: "IO_ERROR", message: "disk full" });
    listDocuments.mockResolvedValue([summary("d1", "甲")]);
    await useWorkspaceStore.getState().openDocument("d1");
    useWorkspaceStore.getState().setContent("重要内容");

    const ok = await useWorkspaceStore.getState().setWorkspaceRoot("E:/notes");

    expect(ok).toBe(false);
    expect(setWorkspaceRootApi).not.toHaveBeenCalled();
    // 内容仍在编辑器里。
    expect(useWorkspaceStore.getState().activeContent).toBe("重要内容");
  });

  it("resets back to the platform default directory", async () => {
    resetWorkspaceRootApi.mockResolvedValue(view());
    listDocuments.mockResolvedValue([]);

    const ok = await useWorkspaceStore.getState().resetWorkspaceRoot();

    expect(ok).toBe(true);
    expect(useWorkspaceStore.getState().settings?.workspaceRoot).toBeNull();
  });

  it("records an error when the reset fails", async () => {
    resetWorkspaceRootApi.mockRejectedValue({ code: "IO_ERROR", message: "nope" });
    const ok = await useWorkspaceStore.getState().resetWorkspaceRoot();
    expect(ok).toBe(false);
    expect(useWorkspaceStore.getState().error).toBe("IO_ERROR");
  });
});

/**
 * 外部文件（从磁盘原位打开的文件）。
 *
 * 记录存在工作区数据库里，因此重启后仍能看到 —— 这是用户报告的核心诉求。
 * 库里只有路径/名称等元信息，正文永远从磁盘现读。
 */
describe("external files", () => {
  const PATH = "E:\\notes\\外部.md";
  const TAB = `ext:${PATH}`;

  function record(over: Partial<Record<string, unknown>> = {}) {
    return {
      path: PATH,
      name: "外部.md",
      size: 4,
      modifiedAt: "2026-01-01T00:00:00Z",
      openedAt: "2026-01-02T00:00:00Z",
      missing: false,
      ...over,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.clear();
    useWorkspaceStore.setState({
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false, recoveryCandidate: null,
      externalFiles: [], externalFilesLoaded: false, externalBaseline: null,
    });
  });

  it("loads the remembered list and flags that it has loaded once", async () => {
    listExternalFiles.mockResolvedValue([record()]);

    await useWorkspaceStore.getState().loadExternalFiles();

    const s = useWorkspaceStore.getState();
    expect(s.externalFiles).toHaveLength(1);
    expect(s.externalFiles[0].path).toBe(PATH);
    expect(s.externalFilesLoaded).toBe(true);
  });

  it("does not flip the loaded flag when the list cannot be read", async () => {
    // 读失败时绝不能标成「已加载」：那会让界面把重启前的标签当成失效记录删掉。
    listExternalFiles.mockRejectedValue({ code: "DB_ERROR", message: "boom" });

    await useWorkspaceStore.getState().loadExternalFiles();

    expect(useWorkspaceStore.getState().externalFilesLoaded).toBe(false);
    // 这不是主列表的失败，不该把整个界面顶成错误态。
    expect(useWorkspaceStore.getState().error).toBeNull();
  });

  it("opens an external file without touching the workspace", async () => {
    useWorkspaceStore.getState().openExternal(PATH, "磁盘上的内容");

    const s = useWorkspaceStore.getState();
    expect(s.activeId).toBe(TAB);
    expect(s.activeContent).toBe("磁盘上的内容");
    expect(s.externalBaseline).toBe("磁盘上的内容");
    expect(s.dirty).toBe(false);
  });

  it("marks edits dirty against the on-disk baseline", async () => {
    useWorkspaceStore.getState().openExternal(PATH, "磁盘上的内容");

    useWorkspaceStore.getState().setContent("改过的内容");
    expect(useWorkspaceStore.getState().dirty).toBe(true);

    // 改回磁盘上的原文 -> 不再算脏（外部文件的权威副本就是那个文件）。
    useWorkspaceStore.getState().setContent("磁盘上的内容");
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });

  it("saves an external file back to its own path, not the workspace", async () => {
    saveExternalFile.mockResolvedValue({
      path: PATH, name: "外部.md", content: "改过的内容", size: 5,
      modifiedAt: "2026-01-02T00:00:00Z",
    });
    listExternalFiles.mockResolvedValue([record()]);
    useWorkspaceStore.getState().openExternal(PATH, "磁盘上的内容");
    useWorkspaceStore.getState().setContent("改过的内容");

    await useWorkspaceStore.getState().saveActive();

    expect(saveExternalFile).toHaveBeenCalledWith(PATH, "改过的内容");
    expect(saveDocument).not.toHaveBeenCalled();
    const s = useWorkspaceStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.externalBaseline).toBe("改过的内容");
  });

  it("keeps dirty after a failed external save so nothing is silently lost", async () => {
    saveExternalFile.mockRejectedValue({ code: "IO_ERROR", message: "read-only" });
    useWorkspaceStore.getState().openExternal(PATH, "原文");
    useWorkspaceStore.getState().setContent("没写进去的内容");

    const ok = await useWorkspaceStore.getState().flushActive();

    expect(ok).toBe(false);
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    expect(useWorkspaceStore.getState().activeContent).toBe("没写进去的内容");
    expect(useWorkspaceStore.getState().error).toBe("IO_ERROR");
  });

  it("forgets a record without deleting anything on disk", async () => {
    forgetExternalFile.mockResolvedValue(undefined);
    listExternalFiles.mockResolvedValue([]);

    const ok = await useWorkspaceStore.getState().forgetExternalFile(PATH);

    expect(ok).toBe(true);
    expect(forgetExternalFile).toHaveBeenCalledWith(PATH);
    expect(useWorkspaceStore.getState().externalFiles).toEqual([]);
  });

  it("reports a failed forget instead of pretending it worked", async () => {
    forgetExternalFile.mockRejectedValue({ code: "DB_ERROR", message: "locked" });

    const ok = await useWorkspaceStore.getState().forgetExternalFile(PATH);

    expect(ok).toBe(false);
    expect(useWorkspaceStore.getState().error).toBe("DB_ERROR");
  });

  it("refreshes both catalogs when a record is removed from history", async () => {
    // 侧栏/主页的列表是 recentFiles + externalFiles 按路径合并出来的。
    // 只刷 recentFiles 会让 externalFiles 里的旧记录把刚删掉的条目合并回来，
    // 表现就是「点了从历史移除，条目还在，也没有报错」。
    removeFromHistory.mockResolvedValue(undefined);
    listRecentFiles.mockResolvedValue([]);
    listExternalFiles.mockResolvedValue([]);

    const ok = await useWorkspaceStore.getState().removeRecentFile(PATH);

    expect(ok).toBe(true);
    expect(removeFromHistory).toHaveBeenCalledWith(PATH);
    expect(listRecentFiles).toHaveBeenCalled();
    expect(listExternalFiles).toHaveBeenCalled();
  });

  it("refreshes both catalogs when a file is deleted from disk", async () => {
    deleteFileOnDisk.mockResolvedValue(undefined);
    listRecentFiles.mockResolvedValue([]);
    listExternalFiles.mockResolvedValue([]);

    const ok = await useWorkspaceStore.getState().deleteDiskFile(PATH);

    expect(ok).toBe(true);
    expect(deleteFileOnDisk).toHaveBeenCalledWith(PATH);
    expect(listRecentFiles).toHaveBeenCalled();
    expect(listExternalFiles).toHaveBeenCalled();
  });

  it("clears the external catalog when the workspace changes", async () => {
    setWorkspaceRootApi.mockResolvedValue({
      workspaceRoot: "E:/other",
      effectiveWorkspaceRoot: "E:/other",
      workspaceRootIsFromEnv: false,
      configPath: "E:/config/settings.json",
      version: 1,
    });
    listDocuments.mockResolvedValue([]);
    listExternalFiles.mockResolvedValue([]);
    useWorkspaceStore.setState({
      externalFiles: [record()],
      externalFilesLoaded: true,
    });

    await useWorkspaceStore.getState().setWorkspaceRoot("E:/other");

    // 记录在工作区库里：换目录后必须重拉，而不是带着旧工作区的清单。
    expect(listExternalFiles).toHaveBeenCalled();
    expect(useWorkspaceStore.getState().externalFilesLoaded).toBe(true);
  });
});
