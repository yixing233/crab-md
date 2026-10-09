import { describe, expect, it, vi } from "vitest";
import { canOpenExternally, openExternalLink } from "./openExternalLink";

describe("canOpenExternally", () => {
  it("accepts http(s) and mailto", () => {
    expect(canOpenExternally("https://kitty.fo/register?invite=2P6SVT55")).toBe(true);
    expect(canOpenExternally("http://example.com")).toBe(true);
    expect(canOpenExternally("mailto:someone@example.com")).toBe(true);
    // 前后空白不该影响判断（Markdown 里 `<url>` 写法常见）
    expect(canOpenExternally("  https://example.com  ")).toBe(true);
  });

  it("rejects in-document navigation and relative paths", () => {
    expect(canOpenExternally("#标题")).toBe(false);
    expect(canOpenExternally("./note.md")).toBe(false);
    expect(canOpenExternally("../a/b.md")).toBe(false);
    expect(canOpenExternally("")).toBe(false);
    expect(canOpenExternally("   ")).toBe(false);
  });

  it("rejects dangerous or unsupported protocols", () => {
    // 白名单的意义就在这里：这些地址一旦真的交给系统打开，后果不止是没反应。
    expect(canOpenExternally("javascript:alert(1)")).toBe(false);
    expect(canOpenExternally("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(canOpenExternally("file:///C:/Windows/System32/calc.exe")).toBe(false);
    expect(canOpenExternally("vbscript:msgbox(1)")).toBe(false);
  });
});

describe("openExternalLink", () => {
  it("does not touch the opener plugin for URLs that fail the whitelist", async () => {
    const openUrl = vi.fn();
    vi.doMock("@tauri-apps/plugin-opener", () => ({ openUrl }));

    await expect(openExternalLink("javascript:alert(1)")).resolves.toBe(false);
    expect(openUrl).not.toHaveBeenCalled();

    vi.doUnmock("@tauri-apps/plugin-opener");
  });

  it("resolves false instead of throwing when there is no Tauri runtime", async () => {
    // jsdom 里没有 @tauri-apps/api 的原生 IPC，动态 import 会失败 —— 必须
    // 静默降级，不能把一次点击变成未捕获的 Promise 异常。
    await expect(openExternalLink("https://example.com")).resolves.toBe(false);
  });
});
