import { describe, expect, it, vi } from "vitest";
import {
  runExport,
  runImport,
  suggestedFileName,
  type TransferDeps,
} from "./transfer";

describe("suggestedFileName", () => {
  it("appends .md when missing", () => {
    expect(suggestedFileName("我的笔记")).toBe("我的笔记.md");
  });

  it("does not double the extension", () => {
    // 否则会得到 `笔记.md.md`。
    expect(suggestedFileName("笔记.md")).toBe("笔记.md");
    expect(suggestedFileName("笔记.MD")).toBe("笔记.MD");
  });

  it("replaces characters that are illegal in Windows file names", () => {
    // 标题里完全可以有 `:` 或 `/`，直接当文件名会失败。
    expect(suggestedFileName("问题: 答案/补充")).toBe("问题_ 答案_补充.md");
    expect(suggestedFileName('a<b>c"d|e?f*g')).toBe("a_b_c_d_e_f_g.md");
  });

  it("falls back to a placeholder for an empty title", () => {
    // 空白标题会得到一个没有名字的文件。
    expect(suggestedFileName("   ")).toBe("未命名.md");
    expect(suggestedFileName("")).toBe("未命名.md");
  });

  it("collapses whitespace so the name stays readable", () => {
    expect(suggestedFileName("a    b")).toBe("a b.md");
  });

  it("keeps CJK characters intact", () => {
    expect(suggestedFileName("并发编程与信道")).toBe("并发编程与信道.md");
  });
});

/** 造一份可控的依赖，用来分别驱动「成功 / 取消 / 失败」三条路径。 */
function deps(over: Partial<TransferDeps> = {}): TransferDeps {
  return {
    pickExport: vi.fn(async () => "/tmp/out.md"),
    pickImport: vi.fn(async () => "/tmp/in.md"),
    exportDocument: vi.fn(async () => true),
    importDocument: vi.fn(async () => ({ title: "导入的笔记" })),
    ...over,
  };
}

describe("runExport", () => {
  it("exports to the chosen path and reports success", async () => {
    const d = deps();
    const outcome = await runExport(d, "doc-1", "标题");

    expect(outcome).toEqual({ kind: "ok", title: "标题" });
    expect(d.exportDocument).toHaveBeenCalledWith("doc-1", "/tmp/out.md");
  });

  it("reports cancelled — not failed — when the user dismisses the dialog", async () => {
    // 用户取消只是改了主意，不该弹错误提示。
    const d = deps({ pickExport: vi.fn(async () => null) });
    const outcome = await runExport(d, "doc-1", "标题");

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(d.exportDocument).not.toHaveBeenCalled();
  });

  it("reports failed when the write itself fails", async () => {
    const d = deps({ exportDocument: vi.fn(async () => false) });
    expect(await runExport(d, "doc-1", "标题")).toEqual({ kind: "failed" });
  });

  it("passes the title through so the dialog can suggest a filename", async () => {
    const d = deps();
    await runExport(d, "doc-1", "并发编程");
    expect(d.pickExport).toHaveBeenCalledWith("并发编程");
  });
});

describe("runImport", () => {
  it("imports the chosen file and reports the new title", async () => {
    const d = deps();
    const outcome = await runImport(d);

    expect(outcome).toEqual({ kind: "ok", title: "导入的笔记" });
    expect(d.importDocument).toHaveBeenCalledWith("/tmp/in.md");
  });

  it("reports cancelled when the user dismisses the dialog", async () => {
    const d = deps({ pickImport: vi.fn(async () => null) });
    const outcome = await runImport(d);

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(d.importDocument).not.toHaveBeenCalled();
  });

  it("reports failed when the import itself fails", async () => {
    const d = deps({ importDocument: vi.fn(async () => null) });
    expect(await runImport(d)).toEqual({ kind: "failed" });
  });
});
