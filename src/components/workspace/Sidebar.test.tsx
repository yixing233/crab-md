import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import type { ExternalFileView, RecentFileView } from "../../types/document";

function file(path: string, name: string, exists = true): RecentFileView {
  return {
    pathKey: path.toLowerCase(),
    path,
    name,
    size: 128,
    modifiedAt: "2026-01-01T00:00:00Z",
    openedAt: "2026-01-02T00:00:00Z",
    pinned: false,
    cursorLine: 1,
    cursorCol: 1,
    scrollRatio: 0,
    exists,
  };
}

function external(path: string, name: string, missing = false): ExternalFileView {
  return {
    path,
    name,
    size: 64,
    modifiedAt: "2026-01-01T00:00:00Z",
    openedAt: "2026-01-03T00:00:00Z",
    missing,
  };
}

function renderSidebar(over: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props: Parameters<typeof Sidebar>[0] = {
    documents: [],
    recentFiles: [file("E:\\notes\\a.md", "a.md")],
    activeId: null,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onExport: vi.fn(),
    onReveal: vi.fn(),
    onOpenFile: vi.fn(),
    onRequestDelete: vi.fn(),
    onOpenExternal: vi.fn(),
    onRevealExternal: vi.fn(),
    onForgetExternal: vi.fn(),
    onRemoveRecentFile: vi.fn(),
    onDeleteDiskFile: vi.fn(),
    onTogglePin: vi.fn(),
    tab: "notes",
    onChangeTab: vi.fn(),
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
    renderSidebar({ recentFiles: [] });
    expect(screen.getByRole("button", { name: "打开文件…" })).toBeInTheDocument();
  });
});

describe("Sidebar panels (大纲 / 文件)", () => {
  it("shows the files panel when that tab is active", () => {
    renderSidebar({ tab: "notes" });

    expect(screen.getByRole("tab", { name: "文件" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "大纲" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("region", { name: "文件列表" })).toBeInTheDocument();
    expect(screen.getByText("a.md")).toBeInTheDocument();
  });

  it("shows the outline panel when that tab is active", () => {
    renderSidebar({ tab: "outline", activeId: "1", activeContent: "# 一\n## 二" });

    expect(screen.getByRole("tab", { name: "大纲" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("navigation", { name: "文档大纲" })).toBeInTheDocument();
    // 两个面板互斥：切到大纲时不再渲染文件列表。
    expect(screen.queryByRole("region", { name: "文件列表" })).not.toBeInTheDocument();
  });

  it("reports tab switches to the parent", async () => {
    const props = renderSidebar({ tab: "notes" });

    await userEvent.click(screen.getByRole("tab", { name: "大纲" }));

    expect(props.onChangeTab).toHaveBeenCalledWith("outline");
  });

  it("shows the outline empty state when there is no document", () => {
    renderSidebar({ tab: "outline", activeId: null });

    expect(screen.getByText("暂无文档大纲")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "文档大纲" })).not.toBeInTheDocument();
  });

  it("links each tab to its panel for screen readers", () => {
    renderSidebar({ tab: "notes" });

    const tab = screen.getByRole("tab", { name: "文件" });
    const panel = document.getElementById(tab.getAttribute("aria-controls")!);
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
  });
});

describe("Sidebar unified recent files", () => {
  it("renders the unified recent files in the files panel", () => {
    renderSidebar({ tab: "notes", recentFiles: [file("E:\\notes\\a.md", "a.md")] });
    expect(screen.getByRole("region", { name: "文件列表" })).toBeInTheDocument();
  });

  it("reports opening a file with its path", async () => {
    const props = renderSidebar({
      tab: "notes",
      recentFiles: [file("E:\\notes\\a.md", "a.md")],
    });

    await userEvent.click(screen.getByText("a.md"));

    expect(props.onOpenExternal).toHaveBeenCalledWith("E:\\notes\\a.md");
  });

  it("shows an empty state that still lets the user open or create a file", async () => {
    const props = renderSidebar({ tab: "notes", recentFiles: [] });

    expect(screen.getByText("还没有打开过文档")).toBeInTheDocument();
    const newButtons = screen.getAllByRole("button", { name: "新建笔记" });
    await userEvent.click(newButtons[0]);
    expect(props.onCreate).toHaveBeenCalled();
  });

  it("marks a file that vanished from disk with missing indicator", () => {
    renderSidebar({
      tab: "notes",
      recentFiles: [file("E:\\notes\\gone.md", "gone.md", false)],
    });

    expect(screen.getByText("gone.md")).toBeInTheDocument();
    expect(screen.getByLabelText("文件不存在")).toBeInTheDocument();
  });

  it("shows an external-only file even when the unified history is non-empty", () => {
    // 文件关联打开的文件先登记在旧外部清单里：统一历史非空时它也必须可见，
    // 否则「标签开了、文件树里找不到」。
    renderSidebar({
      tab: "notes",
      recentFiles: [file("E:\\notes\\a.md", "a.md")],
      externalFiles: [external("E:\\docs\\b.md", "b.md")],
    });

    expect(screen.getByText("a.md")).toBeInTheDocument();
    expect(screen.getByText("b.md")).toBeInTheDocument();
  });

  it("does not duplicate a file that is in both histories", () => {
    renderSidebar({
      tab: "notes",
      recentFiles: [file("E:\\notes\\a.md", "a.md")],
      externalFiles: [external("E:/notes/a.md", "a.md")],
    });

    expect(screen.getAllByText("a.md")).toHaveLength(1);
  });

  it("opens a merged external-only file through its disk path", async () => {
    const props = renderSidebar({
      tab: "notes",
      recentFiles: [file("E:\\notes\\a.md", "a.md")],
      externalFiles: [external("E:\\docs\\b.md", "b.md")],
    });

    await userEvent.click(screen.getByText("b.md"));

    expect(props.onOpenExternal).toHaveBeenCalledWith("E:\\docs\\b.md");
  });
});

/** 打开某一行的右键菜单，返回菜单项（含禁用状态）。 */
async function openRowMenu(rowIndex = 0) {
  const row = document.querySelectorAll(".recent-file-row")[rowIndex] as HTMLElement;
  await userEvent.click(row.querySelector(".recent-file-more") as HTMLElement);
  return Array.from(
    document.querySelectorAll("button[role='menuitem']"),
  ) as HTMLButtonElement[];
}

describe("Sidebar missing / workspace rows can actually be removed", () => {
  it("keeps 「从磁盘彻底删除」 enabled for a file that already vanished", async () => {
    // 文件不在了，磁盘那步是空操作 —— 但记录必须能清掉。
    // 原先这个按钮被禁用，用户看到的就是「失效了却删不掉」。
    renderSidebar({
      tab: "notes",
      recentFiles: [file("E:\\notes\\gone.md", "gone.md", false)],
    });

    const items = await openRowMenu();
    const del = items.find((i) => i.textContent?.includes("从磁盘彻底删除"));

    expect(del).toBeDefined();
    expect(del!.disabled).toBe(false);
  });

  it("offers 「删除笔记」 instead of a no-op history action for a workspace document", async () => {
    // 工作区文档的 path 是文档 id：拿它去删历史表永远匹配 0 行。
    const props = renderSidebar({
      tab: "notes",
      recentFiles: [],
      documents: [
        {
          id: "01a0e60f-e597-74e4-b74d-65164fdb3cdf",
          title: "测试",
          virtualPath: "/",
          revision: 1,
          contentHash: "sha256:x",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
          size: 170,
        },
      ],
    });

    const items = await openRowMenu();
    const labels = items.map((i) => i.textContent ?? "");
    expect(labels.some((l) => l.includes("从历史记录中移除"))).toBe(false);

    const del = items.find((i) => i.textContent?.includes("删除笔记"));
    expect(del).toBeDefined();
    await userEvent.click(del!);

    // 直接上报给外层：删除确认框由 App 持有（Sidebar 不自己弹）。
    expect(props.onRequestDelete).toHaveBeenCalledWith(
      "01a0e60f-e597-74e4-b74d-65164fdb3cdf",
      "测试",
    );
    // 关键：绝不能再落到历史表删除（那条路径对文档 id 永远匹配 0 行）。
    expect(props.onRemoveRecentFile).not.toHaveBeenCalled();
    expect(props.onDeleteDiskFile).not.toHaveBeenCalled();
  });
});
