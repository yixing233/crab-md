import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocumentBar } from "./DocumentBar";
import { Breadcrumb } from "./Breadcrumb";

function renderBar(over: Partial<Parameters<typeof DocumentBar>[0]> = {}) {
  const props = {
    viewMode: "split" as const,
    onChangeViewMode: vi.fn(),
    outlineVisible: false,
    onToggleOutline: vi.fn(),
    ...over,
  };
  render(
    <DocumentBar {...props}>
      <Breadcrumb virtualPath="/笔记/" title="示例.md" />
    </DocumentBar>,
  );
  return props;
}

describe("DocumentBar", () => {
  it("shows the document name it was given", () => {
    renderBar();
    expect(screen.getByText("示例.md")).toBeInTheDocument();
  });

  it("hosts the view mode switch (moved out of the toolbar)", () => {
    renderBar();
    // 视图模式属于「当前文档怎么看」，应与文件名同一行。
    expect(screen.getByRole("radiogroup", { name: "视图" })).toBeInTheDocument();
  });

  it("reports view mode changes", async () => {
    const props = renderBar();

    await userEvent.click(screen.getByRole("radio", { name: "仅阅读" }));

    expect(props.onChangeViewMode).toHaveBeenCalledWith("preview");
  });

  it("hosts the outline toggle and reflects its state", async () => {
    const props = renderBar({ outlineVisible: false });

    const toggle = screen.getByRole("button", { name: "大纲" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle);
    expect(props.onToggleOutline).toHaveBeenCalledOnce();
  });

  it("marks the outline toggle as pressed when the outline is visible", () => {
    renderBar({ outlineVisible: true });
    expect(screen.getByRole("button", { name: "大纲" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps the breadcrumb and controls in one row", () => {
    const { container } = render(
      <DocumentBar
        viewMode="split"
        onChangeViewMode={vi.fn()}
        outlineVisible={false}
        onToggleOutline={vi.fn()}
      >
        <Breadcrumb virtualPath="/" title="A.md" />
      </DocumentBar>,
    );

    // 同一个容器内既有文件名也有视图控制 —— 这是本次移动的目的。
    const bar = container.querySelector(".document-bar");
    expect(bar).not.toBeNull();
    expect(bar?.querySelector(".breadcrumb")).not.toBeNull();
    expect(bar?.querySelector(".ui-segmented")).not.toBeNull();
  });

  describe("sync scroll toggle button", () => {
    it("renders sync scroll button in split mode and reflects active state", () => {
      renderBar({ viewMode: "split", syncScroll: true, onToggleSyncScroll: vi.fn() });
      const btn = screen.getByRole("button", { name: "同步滚动" });
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute("aria-pressed", "true");
      expect(btn).toHaveAttribute("data-active", "true");
    });

    it("reflects inactive state when syncScroll is false", () => {
      renderBar({ viewMode: "split", syncScroll: false, onToggleSyncScroll: vi.fn() });
      const btn = screen.getByRole("button", { name: "同步滚动" });
      expect(btn).toHaveAttribute("aria-pressed", "false");
      expect(btn).not.toHaveAttribute("data-active");
    });

    it("calls onToggleSyncScroll when clicked", async () => {
      const onToggle = vi.fn();
      renderBar({ viewMode: "split", syncScroll: true, onToggleSyncScroll: onToggle });
      await userEvent.click(screen.getByRole("button", { name: "同步滚动" }));
      expect(onToggle).toHaveBeenCalledOnce();
    });

    it("hides sync scroll button when in edit mode", () => {
      renderBar({ viewMode: "edit", onToggleSyncScroll: vi.fn() });
      expect(screen.queryByRole("button", { name: "同步滚动" })).not.toBeInTheDocument();
    });

    it("hides sync scroll button when in preview mode", () => {
      renderBar({ viewMode: "preview", onToggleSyncScroll: vi.fn() });
      expect(screen.queryByRole("button", { name: "同步滚动" })).not.toBeInTheDocument();
    });
  });
});
