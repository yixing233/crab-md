import { render, screen } from "@testing-library/react";
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
});
