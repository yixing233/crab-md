import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview render debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the first document immediately and defers typing updates", () => {
    const { container, rerender } = render(<MarkdownPreview source="# 第一版" resetKey="doc-1" />);
    expect(container.textContent).toContain("第一版");

    // 模拟连续键入：同一文档内的新正文在去抖窗口内不渲染（不重跑渲染管线）。
    rerender(<MarkdownPreview source="# 第二版" resetKey="doc-1" />);
    expect(container.textContent).not.toContain("第二版");

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(container.textContent).toContain("第二版");
  });

  it("switches documents immediately when resetKey changes", () => {
    const { container, rerender } = render(<MarkdownPreview source="# 甲" resetKey="doc-1" />);

    rerender(<MarkdownPreview source="# 乙" resetKey="doc-2" />);
    expect(container.textContent).toContain("乙");
    expect(container.textContent).not.toContain("甲");
  });
});
