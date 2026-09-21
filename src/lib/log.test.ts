import { afterEach, describe, expect, it, vi } from "vitest";
import { __clearLogs, logFailure, logInfo, recentLogs } from "./log";

describe("client logging (ARCH §23)", () => {
  afterEach(() => {
    __clearLogs();
    vi.restoreAllMocks();
  });

  it("records the operation and stable error code", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logFailure({ op: "saveDocument", code: "IO_ERROR" });
    expect(recentLogs()[0]).toContain("saveDocument");
    expect(recentLogs()[0]).toContain("IO_ERROR");
  });

  it("includes the document id, which is a UUID rather than user content", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logFailure({ op: "openDocument", code: "NOT_FOUND", documentId: "abc-123" });
    expect(recentLogs()[0]).toContain("doc=abc-123");
  });

  it("caps the buffer so a failure loop cannot grow it without bound", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 80; i++) logFailure({ op: `op${i}`, code: "X" });
    const logs = recentLogs();
    expect(logs.length).toBe(50);
    // 保留的是最近的：早期条目已被挤出。
    expect(logs[logs.length - 1]).toContain("op79");
    expect(logs.some((l) => l.includes("op0 "))).toBe(false);
  });

  it("returns a copy, so callers cannot mutate internal state", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logFailure({ op: "x", code: "Y" });
    recentLogs().push("injected");
    expect(recentLogs()).toHaveLength(1);
  });

  it("logs informational events too", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    logInfo("workspace ready", "v1");
    expect(recentLogs()[0]).toContain("workspace ready");
  });
});
