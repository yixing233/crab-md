import { beforeEach, describe, expect, it, vi } from "vitest";

const listDocuments = vi.fn();
const createDocument = vi.fn();
const readDocument = vi.fn();
const saveDocument = vi.fn();
const renameDocument = vi.fn();
const deleteDocument = vi.fn();

vi.mock("../lib/api", () => ({
  api: {
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    createDocument: (...a: unknown[]) => createDocument(...a),
    readDocument: (...a: unknown[]) => readDocument(...a),
    saveDocument: (...a: unknown[]) => saveDocument(...a),
    renameDocument: (...a: unknown[]) => renameDocument(...a),
    deleteDocument: (...a: unknown[]) => deleteDocument(...a),
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
