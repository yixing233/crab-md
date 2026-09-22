import { beforeEach, describe, expect, it, vi } from "vitest";

const listDocuments = vi.fn();
const createDocument = vi.fn();
const readDocument = vi.fn();
const saveDocument = vi.fn();
const renameDocument = vi.fn();
const deleteDocument = vi.fn();
const duplicateDocument = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    createDocument: (...a: unknown[]) => createDocument(...a),
    readDocument: (...a: unknown[]) => readDocument(...a),
    saveDocument: (...a: unknown[]) => saveDocument(...a),
    renameDocument: (...a: unknown[]) => renameDocument(...a),
    deleteDocument: (...a: unknown[]) => deleteDocument(...a),
    duplicateDocument: (...a: unknown[]) => duplicateDocument(...a),
  },
  toAppError: (raw: unknown) =>
    raw && typeof raw === "object" && "code" in raw
      ? raw
      : { code: "UNKNOWN", message: String(raw) },
}));

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
    useWorkspaceStore.setState({
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false,
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
    // 去抖调长，确保用例不会因为自动保存提前触发而失真。
    __setAutosaveDelay(60_000);
    useWorkspaceStore.setState({
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false,
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
    useWorkspaceStore.setState({
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false,
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

/**
 * 另存为副本（ARCHITECTURE.md §11：副本必须是独立身份）。
 */
describe("useWorkspaceStore duplicateDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __setAutosaveDelay(60_000);
    vi.spyOn(console, "error").mockImplementation(() => {});
    useWorkspaceStore.setState({
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false,
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
