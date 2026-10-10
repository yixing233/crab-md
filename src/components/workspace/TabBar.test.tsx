import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TabBar, type TabBarProps } from "./TabBar";

function renderTabBar(over: Partial<TabBarProps> = {}) {
  const props: TabBarProps = {
    tabs: [
      { id: "1", title: "笔记一.md", dirty: false },
      { id: "2", title: "笔记二.md", dirty: true },
    ],
    activeId: "1",
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onNewTab: vi.fn(),
    onCloseOtherTabs: vi.fn(),
    onCloseRightTabs: vi.fn(),
    onCloseAllTabs: vi.fn(),
    ...over,
  };
  render(<TabBar {...props} />);
  return props;
}

describe("TabBar", () => {
  it("renders the home tab and document tabs", () => {
    renderTabBar();
    expect(screen.getByRole("tab", { name: /主页/ })).toBeInTheDocument();
    expect(screen.getByText("笔记一.md")).toBeInTheDocument();
    expect(screen.getByText("笔记二.md")).toBeInTheDocument();
  });

  it("marks the active tab correctly", () => {
    renderTabBar({ activeId: "1" });
    const tab1 = screen.getByTitle("笔记一.md");
    expect(tab1).toHaveAttribute("aria-selected", "true");
    expect(tab1).toHaveAttribute("data-active");

    const homeTab = screen.getByRole("tab", { name: /主页/ });
    expect(homeTab).toHaveAttribute("aria-selected", "false");
  });

  it("marks home tab active when activeId is null", () => {
    renderTabBar({ activeId: null });
    const homeTab = screen.getByRole("tab", { name: /主页/ });
    expect(homeTab).toHaveAttribute("aria-selected", "true");
    expect(homeTab).toHaveAttribute("data-active");
  });

  it("shows dirty indicator on unsaved tabs", () => {
    renderTabBar();
    const dirtyMarker = screen.getByLabelText("未保存");
    expect(dirtyMarker).toBeInTheDocument();
  });

  it("calls onSelectTab when a tab or home is clicked", async () => {
    const props = renderTabBar();
    await userEvent.click(screen.getByText("笔记二.md"));
    expect(props.onSelectTab).toHaveBeenCalledWith("2");

    await userEvent.click(screen.getByRole("tab", { name: /主页/ }));
    expect(props.onSelectTab).toHaveBeenCalledWith(null);
  });

  it("calls onCloseTab when clicking the close button", async () => {
    const props = renderTabBar();
    const closeBtn = screen.getByLabelText("关闭 笔记一.md");
    await userEvent.click(closeBtn);
    expect(props.onCloseTab).toHaveBeenCalledWith("1");
  });

  it("calls onNewTab when clicking the plus button", async () => {
    const props = renderTabBar();
    const newBtn = screen.getByRole("button", { name: "新建" });
    await userEvent.click(newBtn);
    expect(props.onNewTab).toHaveBeenCalledOnce();
  });

  it("opens context menu with rename, duplicate, export, and close submenu", async () => {
    const props = renderTabBar({
      onDuplicateTab: vi.fn(),
      onExportTab: vi.fn(),
      onRenameTab: vi.fn(),
    });

    const tab = screen.getByText("笔记一.md");
    fireEvent.contextMenu(tab, { clientX: 50, clientY: 50 });

    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "另存为副本" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "导出为 Markdown…" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "关闭标签页" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "另存为副本" }));
    expect(props.onDuplicateTab).toHaveBeenCalledWith("1", "笔记一.md");
  });

  it("offers 打开文件所在位置 and reports the tab it belongs to", async () => {
    const props = renderTabBar({ onRevealTab: vi.fn() });

    fireEvent.contextMenu(screen.getByText("笔记二.md"), { clientX: 50, clientY: 50 });
    const item = screen.getByRole("menuitem", { name: "打开文件所在位置" });
    expect(item).not.toHaveAttribute("data-danger");

    await userEvent.click(item);
    expect(props.onRevealTab).toHaveBeenCalledWith("2", "笔记二.md");
  });

  it("handles inline renaming from context menu", async () => {
    const props = renderTabBar({
      onRenameTab: vi.fn(),
    });

    const tab = screen.getByText("笔记一.md");
    fireEvent.contextMenu(tab, { clientX: 50, clientY: 50 });

    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));

    const input = screen.getByLabelText("笔记名称");
    expect(input).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, "新名字.md{Enter}");

    expect(props.onRenameTab).toHaveBeenCalledWith("1", "新名字.md");
  });

  it("opens close submenu and executes close actions", async () => {
    const props = renderTabBar({
      onCloseTab: vi.fn(),
    });

    const tab = screen.getByText("笔记一.md");
    fireEvent.contextMenu(tab, { clientX: 50, clientY: 50 });

    const closeItem = screen.getByRole("menuitem", { name: /关闭标签页/ });
    expect(closeItem).toBeInTheDocument();

    // 直接点击“关闭标签页”，默认触发关闭当前标签页
    await userEvent.click(closeItem);
    expect(props.onCloseTab).toHaveBeenCalledWith("1");
  });

  it("expands close submenu on arrow click to reveal other close options", async () => {
    const props = renderTabBar({
      onCloseOtherTabs: vi.fn(),
    });

    const tab = screen.getByText("笔记一.md");
    fireEvent.contextMenu(tab, { clientX: 50, clientY: 50 });

    const arrow = screen.getByRole("menuitem", { name: /关闭标签页/ }).querySelector(".ui-menu__submenu-indicator") as HTMLElement;
    expect(arrow).not.toBeNull();
    await userEvent.click(arrow);

    const closeOthers = await screen.findByRole("menuitem", { name: "关闭其他标签页" });
    expect(closeOthers).toBeInTheDocument();
    await userEvent.click(closeOthers);
    expect(props.onCloseOtherTabs).toHaveBeenCalledWith("1");
  });
});
