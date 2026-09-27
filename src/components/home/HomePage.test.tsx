import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomePage, type HomePageProps } from "./HomePage";

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
  it("renders welcome header and brand", () => {
    renderHomePage();
    expect(screen.getByText(/欢迎使用 Crab-MD/)).toBeInTheDocument();
  });

  it("renders quick action cards and responds to click", async () => {
    const props = renderHomePage();
    const newCard = screen.getByRole("button", { name: /创建新笔记/ });
    await userEvent.click(newCard);
    expect(props.onNewDocument).toHaveBeenCalledOnce();

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
});
