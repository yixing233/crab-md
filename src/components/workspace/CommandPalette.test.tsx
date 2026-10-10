import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette, type CommandPaletteProps } from "./CommandPalette";

function renderPalette(over: Partial<CommandPaletteProps> = {}) {
  const props: CommandPaletteProps = {
    open: true,
    onClose: vi.fn(),
    documents: [
      {
        id: "d1",
        title: "项目架构设计",
        virtualPath: "/工作/",
        revision: 1,
        contentHash: "sha256:abc",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T10:00:00Z",
        size: 2048,
      },
    ],
    onOpenDocument: vi.fn(),
    onNewDocument: vi.fn(),
    onOpenFile: vi.fn(),
    onSaveActive: vi.fn(),
    onToggleSidebar: vi.fn(),
    onCycleTheme: vi.fn(),
    onChangeViewMode: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAbout: vi.fn(),
    onPrint: vi.fn(),
    ...over,
  };
  render(<CommandPalette {...props} />);
  return props;
}

describe("CommandPalette", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <CommandPalette
        open={false}
        onClose={vi.fn()}
        documents={[]}
        onOpenDocument={vi.fn()}
        onNewDocument={vi.fn()}
        onOpenFile={vi.fn()}
        onToggleSidebar={vi.fn()}
        onCycleTheme={vi.fn()}
        onChangeViewMode={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenAbout={vi.fn()}
        onPrint={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("lists documents and commands when open", () => {
    renderPalette();
    expect(screen.getByText("项目架构设计.md")).toBeInTheDocument();
    expect(screen.getByText("新建笔记")).toBeInTheDocument();
    expect(screen.getByText("切换明暗主题")).toBeInTheDocument();
  });

  it("filters documents when typing a query", async () => {
    const props = renderPalette();
    const input = screen.getByPlaceholderText(/搜索文档跳转/);

    await userEvent.type(input, "架构");
    expect(screen.getByText("项目架构设计.md")).toBeInTheDocument();
    expect(screen.queryByText("切换明暗主题")).not.toBeInTheDocument();

    await userEvent.click(screen.getByText("项目架构设计.md"));
    expect(props.onOpenDocument).toHaveBeenCalledWith("d1");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("filters commands exclusively when query starts with >", async () => {
    const props = renderPalette();
    const input = screen.getByPlaceholderText(/搜索文档跳转/);

    await userEvent.type(input, "> 主题");
    expect(screen.queryByText("项目架构设计.md")).not.toBeInTheDocument();
    expect(screen.getByText("切换明暗主题")).toBeInTheDocument();

    await userEvent.click(screen.getByText("切换明暗主题"));
    expect(props.onCycleTheme).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape key", async () => {
    const props = renderPalette();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("reaches the about dialog and the settings page as separate destinations", async () => {
    const props = renderPalette();
    const input = screen.getByPlaceholderText(/搜索文档跳转/);

    // 「关于」不再是设置页里的一个分组，两者是并列命令。
    await userEvent.type(input, "> 关于");
    await userEvent.click(screen.getByText("关于 crab-md"));
    expect(props.onOpenAbout).toHaveBeenCalledOnce();
    expect(props.onOpenSettings).not.toHaveBeenCalled();

    await userEvent.clear(input);
    await userEvent.type(input, "> 设置");
    await userEvent.click(screen.getByText("设置"));

    expect(props.onOpenSettings).toHaveBeenCalledOnce();
  });
});
