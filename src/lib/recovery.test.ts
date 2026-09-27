import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllRecoveryDrafts,
  clearRecoveryDraft,
  readRecoveryDraft,
  recoveryStorageKey,
  toRecoveryCandidate,
  writeRecoveryDraft,
} from "./recovery";

const draft = {
  documentId: "doc-1",
  content: "未保存内容",
  baseRevision: 2,
  baseContentHash: "sha256:old",
  updatedAt: 1_725_000_000_000,
};

const document = {
  id: "doc-1",
  title: "测试",
  virtualPath: "/",
  revision: 2,
  contentHash: "sha256:old",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  size: 3,
};

describe("recovery drafts", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a versioned draft", () => {
    expect(writeRecoveryDraft(draft)).toBe(true);
    expect(localStorage.getItem(recoveryStorageKey("doc-1"))).toContain('"version":1');
    expect(readRecoveryDraft("doc-1")).toEqual(draft);
  });

  it("removes malformed drafts instead of throwing", () => {
    localStorage.setItem(recoveryStorageKey("doc-1"), "not-json");
    expect(readRecoveryDraft("doc-1")).toBeNull();
    expect(localStorage.getItem(recoveryStorageKey("doc-1"))).toBeNull();
  });

  it("does not offer a candidate when the disk content is already current", () => {
    expect(toRecoveryCandidate(draft, document, draft.content)).toBeNull();
  });

  it("marks a candidate as a conflict when the base document changed", () => {
    const candidate = toRecoveryCandidate(draft, { ...document, revision: 3 }, "磁盘版本");
    expect(candidate).toMatchObject({ title: "测试", conflict: true, currentRevision: 3 });
  });

  it("clears one draft and can clear the whole namespace", () => {
    writeRecoveryDraft(draft);
    writeRecoveryDraft({ ...draft, documentId: "doc-2" });
    localStorage.setItem("unrelated", "keep");

    clearRecoveryDraft("doc-1");
    expect(readRecoveryDraft("doc-1")).toBeNull();
    expect(readRecoveryDraft("doc-2")).not.toBeNull();

    clearAllRecoveryDrafts();
    expect(readRecoveryDraft("doc-2")).toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });
});
