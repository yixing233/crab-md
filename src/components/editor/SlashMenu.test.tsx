import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SlashMenu, type SlashMenuProps } from "./SlashMenu";

function renderSlashMenu(over: Partial<SlashMenuProps> = {}) {
  const props: SlashMenuProps = {
    open: true,
    x: 100,
    y: 100,
    query: "",
    onClose: vi.fn(),
    onSelect: vi.fn(),
    ...over,
  };
  render(<SlashMenu {...props} />);
  return props;
}

describe("SlashMenu", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <SlashMenu open={false} x={0} y={0} onClose={vi.fn()} onSelect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("lists available slash commands when open", () => {
    renderSlashMenu();
    expect(screen.getByText("快捷插入块")).toBeInTheDocument();
    expect(screen.getByText("一级标题")).toBeInTheDocument();
    expect(screen.getByText("表格")).toBeInTheDocument();
    expect(screen.getByText("代码块")).toBeInTheDocument();
    expect(screen.getByText("任务清单")).toBeInTheDocument();
    expect(screen.getByText("引用段落")).toBeInTheDocument();
  });

  it("filters commands by search query", () => {
    renderSlashMenu({ query: "表格" });
    expect(screen.getByText("表格")).toBeInTheDocument();
    expect(screen.queryByText("任务清单")).not.toBeInTheDocument();
  });

  it("calls onSelect when clicking a command", async () => {
    const props = renderSlashMenu();
    await userEvent.click(screen.getByText("表格"));
    expect(props.onSelect).toHaveBeenCalledOnce();
    expect(props.onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "table", insertText: expect.stringContaining("|") }),
    );
  });

  it("navigates with keyboard and closes on Escape", async () => {
    const props = renderSlashMenu();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(props.onSelect).toHaveBeenCalledOnce();

    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("remembers and restores the last used command on subsequent open", async () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <SlashMenu open={true} x={100} y={100} onClose={vi.fn()} onSelect={onSelect} />,
    );

    await userEvent.click(screen.getByText("代码块"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "code" }));

    unmount();

    render(<SlashMenu open={true} x={100} y={100} onClose={vi.fn()} onSelect={vi.fn()} />);
    const codeItem = screen.getByText("代码块").closest('[role="menuitem"]');
    expect(codeItem).toHaveAttribute("data-selected", "true");
  });
});
