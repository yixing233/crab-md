import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import type { DocumentSummary } from "../../types/document";

function doc(id: string, title: string): DocumentSummary {
  return {
    id, title, virtualPath: "/", revision: 1,
    contentHash: "sha256:x",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    size: 0,
  };
}

function renderSidebar(over: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props: Parameters<typeof Sidebar>[0] = {
    documents: [doc("1", "甲")],
    activeId: null,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onExport: vi.fn(),
    onOpenFile: vi.fn(),
    onRequestDelete: vi.fn(),
    ...over,
  };
  render(<Sidebar {...props} />);
  return props;
}

describe("Sidebar open-file entry", () => {
  it("offers an open-file control", () => {
    renderSidebar();
    expect(screen.getByRole("button", { name: "打开文件…" })).toBeInTheDocument();
  });

  it("reports opening a file to the parent", async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: "打开文件…" }));
    expect(props.onOpenFile).toHaveBeenCalledOnce();
  });

  it("offers open-file even when there are no notes yet", () => {
    // 空工作区恰恰是最需要打开文件的时候，入口不能跟着列表一起消失。
    renderSidebar({ documents: [] });
    expect(screen.getByRole("button", { name: "打开文件…" })).toBeInTheDocument();
  });
});
