import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TableFloatingBar, type TableFloatingBarProps } from "./TableFloatingBar";

function renderTableBar(over: Partial<TableFloatingBarProps> = {}) {
  const props: TableFloatingBarProps = {
    visible: true,
    x: 100,
    y: 100,
    onAddRow: vi.fn(),
    onDeleteRow: vi.fn(),
    onAddCol: vi.fn(),
    onDeleteCol: vi.fn(),
    onAlign: vi.fn(),
    ...over,
  };
  render(<TableFloatingBar {...props} />);
  return props;
}

describe("TableFloatingBar", () => {
  it("renders nothing when visible is false", () => {
    const { container } = render(
      <TableFloatingBar
        visible={false}
        x={0}
        y={0}
        onAddRow={vi.fn()}
        onDeleteRow={vi.fn()}
        onAddCol={vi.fn()}
        onDeleteCol={vi.fn()}
        onAlign={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders table modification buttons when visible", () => {
    renderTableBar();
    expect(screen.getByRole("button", { name: "新增行" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除行" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新增列" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除列" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "格式化对齐表格" })).toBeInTheDocument();
  });

  it("calls corresponding handlers on button click", async () => {
    const props = renderTableBar();

    await userEvent.click(screen.getByRole("button", { name: "新增行" }));
    expect(props.onAddRow).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "删除行" }));
    expect(props.onDeleteRow).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "新增列" }));
    expect(props.onAddCol).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "删除列" }));
    expect(props.onDeleteCol).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "格式化对齐表格" }));
    expect(props.onAlign).toHaveBeenCalledOnce();
  });
});
