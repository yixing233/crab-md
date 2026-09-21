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

import { useWorkspaceStore } from "./useWorkspaceStore";

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
