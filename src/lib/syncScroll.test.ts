import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SYNC_SCROLL,
  readStoredSyncScroll,
  setupSyncScroll,
  SYNC_SCROLL_KEY,
} from "./syncScroll";

function createMockScrollElement(scrollHeight: number, clientHeight: number) {
  const el = document.createElement("div");
  let currentScrollTop = 0;

  Object.defineProperty(el, "scrollHeight", {
    get: () => scrollHeight,
    configurable: true,
  });
  Object.defineProperty(el, "clientHeight", {
    get: () => clientHeight,
    configurable: true,
  });
  Object.defineProperty(el, "scrollTop", {
    get: () => currentScrollTop,
    set: (v: number) => {
      currentScrollTop = v;
      // 模拟真实浏览器在赋值 scrollTop 时触发的 scroll 事件
      el.dispatchEvent(new Event("scroll"));
    },
    configurable: true,
  });

  return el;
}

describe("syncScroll persistence and preference reading", () => {
  it("defaults to enabled (true) on first launch or null", () => {
    expect(DEFAULT_SYNC_SCROLL).toBe(true);
    expect(readStoredSyncScroll(null)).toBe(true);
    expect(readStoredSyncScroll("")).toBe(true);
  });

  it("reads false for disabled markers", () => {
    expect(readStoredSyncScroll("false")).toBe(false);
    expect(readStoredSyncScroll("disabled")).toBe(false);
    expect(readStoredSyncScroll("0")).toBe(false);
  });

  it("reads true for enabled markers or unknown strings", () => {
    expect(readStoredSyncScroll("true")).toBe(true);
    expect(readStoredSyncScroll("enabled")).toBe(true);
    expect(readStoredSyncScroll("unknown")).toBe(true);
  });

  it("has a stable storage key", () => {
    expect(SYNC_SCROLL_KEY).toBe("crab-md.sync-scroll");
  });
});

describe("setupSyncScroll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("synchronizes preview when editor is scrolled", () => {
    // editor: maxScroll = 1000 - 500 = 500
    // preview: maxScroll = 2500 - 500 = 2000
    const editor = createMockScrollElement(1000, 500);
    const preview = createMockScrollElement(2500, 500);

    const cleanup = setupSyncScroll(editor, preview);

    // 滚动编辑器到 50% (250 / 500)
    editor.scrollTop = 250;

    // 预览应跟随到 50% (0.5 * 2000 = 1000)
    expect(preview.scrollTop).toBe(1000);

    cleanup();
  });

  it("synchronizes editor when preview is scrolled", () => {
    const editor = createMockScrollElement(1000, 500); // max 500
    const preview = createMockScrollElement(2500, 500); // max 2000

    const cleanup = setupSyncScroll(editor, preview);

    // 滚动预览区到 25% (500 / 2000)
    preview.scrollTop = 500;

    // 编辑器应跟随到 25% (0.25 * 500 = 125)
    expect(editor.scrollTop).toBe(125);

    cleanup();
  });

  it("prevents feedback loops and jitter between panes", () => {
    const editor = createMockScrollElement(1000, 500);
    const preview = createMockScrollElement(2000, 500);

    const editorScrollSpy = vi.fn();
    editor.addEventListener("scroll", editorScrollSpy);

    const cleanup = setupSyncScroll(editor, preview);
    editorScrollSpy.mockClear();

    // 用户滚动编辑器
    editor.scrollTop = 200;

    // 编辑器本身触发了 1 次 scroll
    // 预览区被设置为对应位置，触发了预览区的 scroll
    // 但防循环锁会拦截预览区反弹触发编辑器的再次滚动
    expect(preview.scrollTop).toBe(600); // 200 / 500 * 1500 = 600
    expect(editorScrollSpy).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("resets active lock after scrolling stops so user can seamlessly scroll the other pane", () => {
    const editor = createMockScrollElement(1000, 500); // max 500
    const preview = createMockScrollElement(2000, 500); // max 1500

    const cleanup = setupSyncScroll(editor, preview);

    // 编辑器先滚
    editor.scrollTop = 100;
    expect(preview.scrollTop).toBe(300);

    // 推进定时器 100ms 释放锁
    vi.advanceTimersByTime(120);

    // 用户接着滚动预览区到底部
    preview.scrollTop = 1500;
    expect(editor.scrollTop).toBe(500);

    cleanup();
  });

  it("handles boundary extremes (top 0% and bottom 100%) accurately", () => {
    const editor = createMockScrollElement(1200, 600); // max 600
    const preview = createMockScrollElement(3600, 600); // max 3000

    const cleanup = setupSyncScroll(editor, preview);

    // 滚到底部 100%
    editor.scrollTop = 600;
    expect(preview.scrollTop).toBe(3000);

    vi.advanceTimersByTime(120);

    // 滚到顶部 0%
    preview.scrollTop = 0;
    expect(editor.scrollTop).toBe(0);

    cleanup();
  });

  it("handles non-scrollable panes gracefully without NaN or errors", () => {
    // 编辑器无可滚动高度
    const editor = createMockScrollElement(500, 500); // max 0
    const preview = createMockScrollElement(1500, 500); // max 1000

    const cleanup = setupSyncScroll(editor, preview);

    expect(() => {
      editor.scrollTop = 0;
      preview.scrollTop = 200;
    }).not.toThrow();

    cleanup();
  });

  it("detaches all event listeners when cleaned up", () => {
    const editor = createMockScrollElement(1000, 500);
    const preview = createMockScrollElement(2000, 500);

    const cleanup = setupSyncScroll(editor, preview);

    // 正常同步
    editor.scrollTop = 100;
    expect(preview.scrollTop).toBe(300);

    // 清理销毁
    cleanup();
    vi.advanceTimersByTime(120);

    // 再次滚动，不再发生同步
    editor.scrollTop = 250;
    expect(preview.scrollTop).toBe(300); // 维持原样

    preview.scrollTop = 900;
    expect(editor.scrollTop).toBe(250); // 维持原样
  });
});
