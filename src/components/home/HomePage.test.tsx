import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomePage, type HomePageProps } from "./HomePage";
import type { ExternalFileView, RecentFileView } from "../../types/document";

function diskFile(path: string, name: string, openedAt = "2026-01-03T00:00:00Z"): RecentFileView {
  return {
    pathKey: path.toLowerCase(),
    path,
    name,
    size: 512,
    modifiedAt: "2026-01-01T00:00:00Z",
    openedAt,
    pinned: false,
    cursorLine: 1,
    cursorCol: 1,
    scrollRatio: 0,
    exists: true,
  };
}

function externalFile(path: string, name: string): ExternalFileView {
  return {
    path,
    name,
    size: 64,
    modifiedAt: "2026-01-01T00:00:00Z",
    openedAt: "2026-01-04T00:00:00Z",
    missing: false,
  };
}

function renderHomePage(over: Partial<HomePageProps> = {}) {
  const props: HomePageProps = {
    documents: [
      {
        id: "1",
        title: "指南.md",
        virtualPath: "/工作/",
        revision: 1,
        contentHash: "sha256:abc",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T10:00:00Z",
        size: 1024,
      },
    ],
    onOpenDocument: vi.fn(),
    onNewDocument: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenSettings: vi.fn(),
    workspacePath: "E:/notes",
    ...over,
  };
  render(<HomePage {...props} />);
  return props;
}

describe("HomePage", () => {
  it("renders quick action cards and responds to click", async () => {
    const props = renderHomePage();
    const openCard = screen.getByRole("button", { name: /导入本地文件/ });
    await userEvent.click(openCard);
    expect(props.onOpenFile).toHaveBeenCalledOnce();

    const settingsCard = screen.getByRole("button", { name: /打开设置页/ });
    await userEvent.click(settingsCard);
    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });

  it("shows recent notes and opens note when clicked", async () => {
    const props = renderHomePage();
    expect(screen.getByText(/指南\.md/)).toBeInTheDocument();
    await userEvent.click(screen.getByText(/指南\.md/));
    expect(props.onOpenDocument).toHaveBeenCalledWith("1");
  });

  it("shows empty state when there are no documents", () => {
    renderHomePage({ documents: [] });
    expect(screen.getByText("还没有笔记")).toBeInTheDocument();
  });

  it("searches documents by full-text query and displays matching snippets", async () => {
    const onSearchFullText = vi.fn().mockResolvedValue([
      {
        id: "1",
        title: "指南.md",
        snippet: "这是包含[关键字]的详细正文说明",
      },
    ]);

    const props = renderHomePage({ onSearchFullText });
    const searchInput = screen.getByLabelText("全局全文搜索");

    await userEvent.type(searchInput, "关键字");

    await waitFor(() => {
      expect(screen.getByText(/搜索结果/)).toBeInTheDocument();
      expect(screen.getByText("关键字")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText(/指南\.md/));
    expect(props.onOpenDocument).toHaveBeenCalledWith("1");
  });

  it("shows workspace documents alongside the disk history", () => {
    // 统一历史非空时工作区文档也不能消失：主页是完整的文件列表。
    renderHomePage({
      recentFiles: [diskFile("E:\\notes\\磁盘笔记.md", "磁盘笔记.md")],
    });

    expect(screen.getByText("磁盘笔记.md")).toBeInTheDocument();
    expect(screen.getByText("指南.md")).toBeInTheDocument();
  });

  it("merges external-only files into the list", () => {
    renderHomePage({
      recentFiles: [diskFile("E:\\notes\\a.md", "a.md")],
      externalFiles: [externalFile("E:\\docs\\外部.md", "外部.md")],
    });

    expect(screen.getByText("a.md")).toBeInTheDocument();
    expect(screen.getByText("外部.md")).toBeInTheDocument();
  });

  it("does not duplicate a file present in both histories", () => {
    renderHomePage({
      recentFiles: [diskFile("E:\\notes\\a.md", "a.md")],
      externalFiles: [externalFile("E:/notes/a.md", "a.md")],
    });

    expect(screen.getAllByText("a.md")).toHaveLength(1);
  });

  it("opens a disk file through its path", async () => {
    const props = renderHomePage({
      recentFiles: [diskFile("E:\\notes\\a.md", "a.md")],
      onOpenPath: vi.fn(),
    });

    await userEvent.click(screen.getByText("a.md"));

    expect(props.onOpenPath).toHaveBeenCalledWith("E:\\notes\\a.md");
  });

  it("renders the complete list instead of only the first ten entries", () => {
    const recentFiles = Array.from({ length: 12 }, (_, i) =>
      diskFile(`E:\\notes\\f${i}.md`, `f${i}.md`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`),
    );
    // oldest.md 排在第 13 位 —— 旧的 slice(0, 10) 会把它截掉。
    recentFiles.push(diskFile("E:\\notes\\oldest.md", "oldest.md", "2025-12-01T00:00:00Z"));

    renderHomePage({ recentFiles });

    expect(screen.getByText("oldest.md")).toBeInTheDocument();
    // 12 个磁盘文件 + oldest.md + 默认 props 里的工作区文档「指南.md」。
    expect(screen.getByText("14 篇文档")).toBeInTheDocument();
  });
});

describe("HomePage 文件操作入口", () => {
  function renderWithDisk(over: Partial<HomePageProps> = {}) {
    return renderHomePage({
      documents: [],
      recentFiles: [diskFile("E:\\notes\\a.md", "a.md")],
      onTogglePin: vi.fn(),
      onDuplicateFile: vi.fn(),
      onRenameFile: vi.fn(),
      onRevealFile: vi.fn(),
      onRemoveFromHistory: vi.fn(),
      onDeleteFromDisk: vi.fn(),
      onDeleteDocument: vi.fn(),
      ...over,
    });
  }

  /** 点某一行的「更多」按钮，返回菜单项。 */
  async function openMenu() {
    const row = document.querySelector(".home-note-row") as HTMLElement;
    await userEvent.click(row.querySelector(".home-note-row__more") as HTMLElement);
    return Array.from(
      document.querySelectorAll("button[role='menuitem']"),
    ) as HTMLButtonElement[];
  }

  it("offers the full file menu on a disk file row", async () => {
    // 主页此前只能「点开看」，重命名/副本/置顶/定位/删除一个都没有。
    renderWithDisk();
    const labels = (await openMenu()).map((i) => i.textContent ?? "");

    expect(labels.some((l) => l.includes("置顶文档"))).toBe(true);
    expect(labels.some((l) => l.includes("另存为副本"))).toBe(true);
    expect(labels.some((l) => l.includes("重命名"))).toBe(true);
    expect(labels.some((l) => l.includes("打开文件所在位置"))).toBe(true);
    expect(labels.some((l) => l.includes("从历史记录中移除"))).toBe(true);
    expect(labels.some((l) => l.includes("从磁盘彻底删除"))).toBe(true);
  });

  it("routes each menu action to its handler with the disk path", async () => {
    const props = renderWithDisk();
    let items = await openMenu();
    await userEvent.click(items.find((i) => i.textContent?.includes("置顶文档"))!);
    expect(props.onTogglePin).toHaveBeenCalledWith("E:\\notes\\a.md", true);

    items = await openMenu();
    await userEvent.click(items.find((i) => i.textContent?.includes("重命名"))!);
    expect(props.onRenameFile).toHaveBeenCalledWith("E:\\notes\\a.md", "a.md");

    items = await openMenu();
    await userEvent.click(items.find((i) => i.textContent?.includes("另存为副本"))!);
    expect(props.onDuplicateFile).toHaveBeenCalledWith("E:\\notes\\a.md", "a.md");
  });

  it("keeps delete-from-disk usable for a file that vanished", async () => {
    // 失效条目的唯一出路就是它；禁用等于「失效了却删不掉」。
    renderWithDisk({
      recentFiles: [{ ...diskFile("E:\\notes\\gone.md", "gone.md"), exists: false }],
    });
    const items = await openMenu();
    const del = items.find((i) => i.textContent?.includes("从磁盘彻底删除"));

    expect(del).toBeDefined();
    expect(del!.disabled).toBe(false);
    expect(screen.getByLabelText("文件不存在")).toBeInTheDocument();
  });

  it("marks a vanished file instead of hiding it", () => {
    renderWithDisk({
      recentFiles: [{ ...diskFile("E:\\notes\\gone.md", "gone.md"), exists: false }],
    });
    const row = document.querySelector(".home-note-row") as HTMLElement;

    expect(row).toHaveAttribute("data-missing");
    expect(screen.getByText("gone.md")).toBeInTheDocument();
  });

  it("offers 删除笔记 (not a no-op history removal) for a workspace document", async () => {
    // 文档条目的 path 是文档 id：拿它删历史表永远匹配 0 行。
    renderHomePage({
      onDeleteDocument: vi.fn(),
      onRemoveFromHistory: vi.fn(),
      onDeleteFromDisk: vi.fn(),
    });
    const row = document.querySelector(".home-note-row") as HTMLElement;
    await userEvent.click(row.querySelector(".home-note-row__more") as HTMLElement);
    const items = Array.from(
      document.querySelectorAll("button[role='menuitem']"),
    ) as HTMLButtonElement[];
    const labels = items.map((i) => i.textContent ?? "");

    expect(labels.some((l) => l.includes("从历史记录中移除"))).toBe(false);
    const del = items.find((i) => i.textContent?.includes("删除笔记"));
    expect(del).toBeDefined();
  });

  it("opens the menu on right click too", async () => {
    renderWithDisk();
    const row = document.querySelector(".home-note-row") as HTMLElement;
    await userEvent.pointer({ target: row, keys: "[MouseRight]" });

    expect(
      screen.getByRole("menuitem", { name: /置顶文档/ }),
    ).toBeInTheDocument();
  });
});
