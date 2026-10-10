import { describe, expect, it } from "vitest";
import {
  baseName,
  EXTERNAL_TAB_PREFIX,
  externalPathOf,
  externalTabId,
  samePath,
} from "./externalFiles";

describe("external file tab ids", () => {
  it("round-trips a path through the tab id", () => {
    const path = "E:\\notes\\外部.md";
    const tabId = externalTabId(path);
    expect(tabId).toBe(`${EXTERNAL_TAB_PREFIX}${path}`);
    expect(externalPathOf(tabId)).toBe(path);
  });

  it("keeps the whole path, including colons after the prefix", () => {
    // 路径自带盘符冒号，`ext:` 只是前缀 —— 用 split(":") 解析会把路径截断。
    expect(externalPathOf(externalTabId("C:\\a\\b\\c.md"))).toBe("C:\\a\\b\\c.md");
  });

  it("reports null for a workspace document id", () => {
    // 工作区文档 id 是 UUID（或测试里的 "d1"），不能被误当成外部标签。
    expect(externalPathOf("01993ab2-0000-7000-8000-000000000001")).toBeNull();
    expect(externalPathOf("d1")).toBeNull();
    expect(externalPathOf("")).toBeNull();
  });
});

describe("baseName", () => {
  it("takes the last segment for either separator", () => {
    expect(baseName("E:\\notes\\a.md")).toBe("a.md");
    expect(baseName("E:/notes/a.md")).toBe("a.md");
    expect(baseName("/home/u/a.md")).toBe("a.md");
  });

  it("falls back to the whole string when there is no separator", () => {
    expect(baseName("a.md")).toBe("a.md");
  });
});

describe("samePath", () => {
  it("treats both separators as the same file", () => {
    expect(samePath("E:\\notes\\a.md", "E:/notes/a.md")).toBe(true);
  });

  it("ignores case on a Windows path", () => {
    // 同一个文件在列表里出现两行、标签高亮对不上，都源于这里没归一。
    expect(samePath("E:\\Notes\\A.md", "e:\\notes\\a.md")).toBe(true);
  });

  it("keeps case sensitivity for a POSIX path", () => {
    // Linux 上 A.md 与 a.md 是两个不同文件，折叠大小写会误合并。
    expect(samePath("/home/u/A.md", "/home/u/a.md")).toBe(false);
  });

  it("distinguishes genuinely different files", () => {
    expect(samePath("E:\\notes\\a.md", "E:\\notes\\b.md")).toBe(false);
    expect(samePath("E:\\notes\\a.md", "E:\\other\\a.md")).toBe(false);
  });
});
