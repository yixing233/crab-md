import { describe, expect, it } from "vitest";
import { buildFileTree } from "./fileTree";
import type { DocumentSummary } from "../types/document";

function doc(id: string, title: string, virtualPath: string): DocumentSummary {
  return {
    id, title, virtualPath, revision: 1,
    contentHash: "sha256:x",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    size: 0,
  };
}

describe("buildFileTree", () => {
  it("returns no nodes for an empty list", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("places root-level documents at the top level", () => {
    const tree = buildFileTree([doc("1", "A", "/")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("document");
    expect(tree[0].name).toBe("A");
  });

  it("creates nested folders from the virtual path", () => {
    const tree = buildFileTree([doc("1", "A", "/Development/Go/")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe("folder");
    expect(tree[0].name).toBe("Development");

    const go = tree[0].children![0];
    expect(go.name).toBe("Go");
    expect(go.children![0].name).toBe("A");
    expect(go.children![0].documentId).toBe("1");
  });

  it("groups documents that share a folder", () => {
    const tree = buildFileTree([
      doc("1", "A", "/Notes/"),
      doc("2", "B", "/Notes/"),
    ]);
    expect(tree[0].children).toHaveLength(2);
  });

  it("sorts folders before documents, then alphabetically", () => {
    const tree = buildFileTree([
      doc("1", "zebra", "/"),
      doc("2", "apple", "/"),
      doc("3", "deep", "/Folder/"),
    ]);
    expect(tree.map((n) => n.type)).toEqual(["folder", "document", "document"]);
    expect(tree[1].name).toBe("apple");
    expect(tree[2].name).toBe("zebra");
  });

  it("tolerates paths without leading or trailing slashes", () => {
    expect(buildFileTree([doc("1", "A", "Notes")])[0].name).toBe("Notes");
  });

  it("ignores empty path segments", () => {
    const tree = buildFileTree([doc("1", "A", "//Notes//")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Notes");
  });

  it("keeps folder nodes stable across multiple documents in nested paths", () => {
    const tree = buildFileTree([
      doc("1", "A", "/a/b/c/"),
      doc("2", "B", "/a/b/"),
    ]);
    const b = tree[0].children![0];
    expect(b.name).toBe("b");
    const names = b.children!.map((n) => n.name);
    expect(names).toContain("c");
    expect(names).toContain("B");
  });
});
