import { createRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

function items(over: Partial<{ onRename: () => void; onDelete: () => void }> = {}) {
  return [
    { id: "rename", label: "重命名", shortcut: "F2", onSelect: over.onRename ?? (() => {}) },
    { id: "delete", label: "删除", danger: true, onSelect: over.onDelete ?? (() => {}) },
  ];
}

describe("ContextMenu", () => {
  it("renders nothing when closed", () => {
    render(<ContextMenu open={false} x={0} y={0} items={items()} onClose={() => {}} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders the items with menuitem roles", () => {
    render(<ContextMenu open x={10} y={10} items={items()} onClose={() => {}} />);
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });

  it("renders a label in the item's own font when fontFamily is given", () => {
    // 字体菜单靠这个把「宋体」两个字用宋体渲染出来。
    render(
      <ContextMenu
        open
        x={0}
        y={0}
        items={[{ id: "f", label: "宋体", fontFamily: "SimSun, serif", onSelect: () => {} }]}
        onClose={() => {}}
      />,
    );
    const labelEl = screen.getByRole("menuitem", { name: "宋体" }).querySelector(
      ".ui-menu__label",
    ) as HTMLElement;
    expect(labelEl.style.fontFamily).toContain("SimSun");
  });

  it("leaves ordinary menu labels unstyled", () => {
    render(<ContextMenu open x={0} y={0} items={items()} onClose={() => {}} />);
    const labelEl = screen.getByRole("menuitem", { name: "重命名" }).querySelector(
      ".ui-menu__label",
    ) as HTMLElement;
    expect(labelEl.style.fontFamily).toBe("");
  });

  it("calls the item handler and closes", async () => {
    const onRename = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu open x={0} y={0} items={items({ onRename })} onClose={onClose} />);
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    expect(onRename).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("marks dangerous items with danger semantics (UI §14.4)", () => {
    render(<ContextMenu open x={0} y={0} items={items()} onClose={() => {}} />);
    expect(screen.getByRole("menuitem", { name: "删除" })).toHaveAttribute("data-danger");
  });

  it("exposes the shortcut via aria-keyshortcuts, not the accessible name", () => {
    render(<ContextMenu open x={0} y={0} items={items()} onClose={() => {}} />);
    const item = screen.getByRole("menuitem", { name: "重命名" });
    // 可见的快捷键文字对辅助技术隐藏，因此可访问名称仍是「重命名」。
    expect(item).toHaveAttribute("aria-keyshortcuts", "F2");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<ContextMenu open x={0} y={0} items={items()} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on an outside click", async () => {
    const onClose = vi.fn();
    render(
      <div>
        <button>外面</button>
        <ContextMenu open x={0} y={0} items={items()} onClose={onClose} />
      </div>,
    );
    await userEvent.click(screen.getByRole("button", { name: "外面" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("focuses the first item on open, for keyboard users", async () => {
    render(<ContextMenu open x={0} y={0} items={items()} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveFocus(),
    );
  });

  it("moves focus with arrow keys", async () => {
    render(<ContextMenu open x={0} y={0} items={items()} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveFocus(),
    );
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "删除" })).toHaveFocus();
    // 从最后一项继续向下应回到第一项。
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "重命名" })).toHaveFocus();
  });

  it("renders in a portal on document.body, escaping overflow ancestors", () => {
    render(
      <div style={{ overflow: "hidden" }}>
        <ContextMenu open x={0} y={0} items={items()} onClose={() => {}} />
      </div>,
    );
    expect(screen.getByRole("menu").parentElement).toBe(document.body);
  });

  it("ignores a press inside the anchor, so the trigger can toggle itself", async () => {
    // 关键回归：触发按钮在菜单外部。若把落在锚点内的按下也算「点到了外面」，
    // mousedown 会先关闭、按钮的 onClick 紧接着又打开 —— 表现为怎么点都关不上。
    const onClose = vi.fn();
    const anchor = createRef<HTMLButtonElement>();
    render(
      <div>
        <button ref={anchor}>字体</button>
        <ContextMenu
          open
          x={0}
          y={0}
          items={items()}
          onClose={onClose}
          anchorRef={anchor}
        />
      </div>,
    );

    await userEvent.click(screen.getByRole("button", { name: "字体" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("still closes for a press outside both menu and anchor", async () => {
    const onClose = vi.fn();
    const anchor = createRef<HTMLButtonElement>();
    render(
      <div>
        <button ref={anchor}>字体</button>
        <button>别处</button>
        <ContextMenu
          open
          x={0}
          y={0}
          items={items()}
          onClose={onClose}
          anchorRef={anchor}
        />
      </div>,
    );

    await userEvent.click(screen.getByRole("button", { name: "别处" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
