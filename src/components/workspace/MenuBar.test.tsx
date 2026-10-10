import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MenuBar, type MenuBarMenu } from "./MenuBar";

function menus(over: Partial<{ onNew: () => void; onBold: () => void }> = {}): MenuBarMenu[] {
  return [
    {
      id: "file",
      label: "文件",
      items: [
        { id: "new", label: "新建", shortcut: "Ctrl+N", onSelect: over.onNew ?? (() => {}) },
        { id: "sep", separator: true },
        { id: "save", label: "保存", disabled: true, onSelect: () => {} },
      ],
    },
    {
      id: "edit",
      label: "编辑",
      items: [
        {
          id: "format",
          label: "格式",
          submenu: [{ id: "bold", label: "加粗", onSelect: over.onBold ?? (() => {}) }],
        },
      ],
    },
    { id: "view", label: "视图", items: [{ id: "v", label: "分栏", checked: true, onSelect: () => {} }] },
  ];
}

describe("MenuBar", () => {
  it("renders one menubar trigger per menu and keeps menus closed", () => {
    render(<MenuBar menus={menus()} />);

    expect(screen.getByRole("menubar", { name: "主菜单" })).toBeInTheDocument();
    // 菜单未展开时不应有下拉本体 —— 默认状态要「安静」（§2.1）。
    expect(screen.getByRole("menuitem", { name: "文件" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "视图" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens a dropdown with that menu's items and runs one", async () => {
    const onNew = vi.fn();
    render(<MenuBar menus={menus({ onNew })} />);

    await userEvent.click(screen.getByRole("menuitem", { name: "文件" }));

    const item = await screen.findByRole("menuitem", { name: "新建" });
    expect(item).toHaveAttribute("aria-keyshortcuts", "Ctrl+N");
    // 分隔线不该是一个「菜单项」，否则键盘导航会停在它上面。
    expect(screen.queryByRole("menuitem", { name: "" })).not.toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();

    await userEvent.click(item);
    expect(onNew).toHaveBeenCalledOnce();
    // 选中后菜单收起。
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("marks the trigger expanded and collapses when clicked again", async () => {
    render(<MenuBar menus={menus()} />);
    const trigger = screen.getByRole("menuitem", { name: "文件" });

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("menuitem", { name: "新建" })).toBeInTheDocument();

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("switches straight from one open menu to another", async () => {
    // 关键回归：锚点若只包住当前那个按钮，这次点击会被当成「点了菜单外面」，
    // 于是同一个事件先开再关，菜单闪一下就没了。
    render(<MenuBar menus={menus()} />);

    await userEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    expect(await screen.findByRole("menuitem", { name: "新建" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    expect(await screen.findByRole("menuitem", { name: "格式" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "新建" })).not.toBeInTheDocument();
  });

  it("does not run a disabled item", async () => {
    const onNew = vi.fn();
    render(<MenuBar menus={menus({ onNew })} />);
    await userEvent.click(screen.getByRole("menuitem", { name: "文件" }));

    const save = await screen.findByRole("menuitem", { name: "保存" });
    expect(save).toBeDisabled();
    await userEvent.click(save);
    expect(onNew).not.toHaveBeenCalled();
  });

  it("exposes a submenu and runs its nested item", async () => {
    const onBold = vi.fn();
    render(<MenuBar menus={menus({ onBold })} />);

    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "格式" }));

    await userEvent.click(await screen.findByRole("menuitem", { name: "加粗" }));
    expect(onBold).toHaveBeenCalledOnce();
  });

  it("reports checked state as a radio item", async () => {
    render(<MenuBar menus={menus()} />);

    await userEvent.click(screen.getByRole("menuitem", { name: "视图" }));

    // checked 的条目用 menuitemradio，屏幕阅读器才会播报「已选中」。
    const radio = await screen.findByRole("menuitemradio", { name: "分栏", checked: true });
    expect(radio).toBeInTheDocument();
  });

  it("closes when clicking outside", async () => {
    render(
      <div>
        <MenuBar menus={menus()} />
        <button>别处</button>
      </div>,
    );

    await userEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    expect(await screen.findByRole("menuitem", { name: "新建" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "别处" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
