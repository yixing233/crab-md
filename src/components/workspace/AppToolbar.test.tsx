import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppToolbar } from "./AppToolbar";

function props(over: Partial<Parameters<typeof AppToolbar>[0]> = {}) {
  return {
    onNewDocument: vi.fn(),
    onToggleSidebar: vi.fn(),
    sidebarVisible: true,
    onOpenSettings: vi.fn(),
    pendingVersion: null,
    onOpenUpdate: vi.fn(),
    themePreference: "system" as const,
    onCycleTheme: vi.fn(),
    ...over,
  };
}

describe("AppToolbar update entry", () => {
  it("stays quiet when there is no update (UI §2.1)", () => {
    render(<AppToolbar {...props()} />);

    // 没有更新时不应出现任何更新入口 —— 工具栏不与编辑器争注意力。
    expect(screen.queryByText(/有新版本/)).not.toBeInTheDocument();
  });

  it("shows a persistent badge with the version when an update exists", () => {
    render(<AppToolbar {...props({ pendingVersion: "1.2.3" })} />);

    const entry = screen.getByRole("button", { name: /有新版本 1\.2\.3/ });
    expect(entry).toBeInTheDocument();
    // 版本号本身要可见，不能只靠 tooltip。
    expect(entry).toHaveTextContent("1.2.3");
  });

  it("opens the update destination when clicked", async () => {
    const onOpenUpdate = vi.fn();
    render(<AppToolbar {...props({ pendingVersion: "1.2.3", onOpenUpdate })} />);

    await userEvent.click(screen.getByRole("button", { name: /有新版本/ }));

    expect(onOpenUpdate).toHaveBeenCalledOnce();
  });

  it("keeps the settings button separate from the update entry", () => {
    render(<AppToolbar {...props({ pendingVersion: "1.2.3" })} />);

    // 两个入口语义不同：一个进设置，一个直接去安装。
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /有新版本/ })).toBeInTheDocument();
  });

  it("no longer hosts the document view controls", () => {
    render(<AppToolbar {...props()} />);

    // 视图模式与大纲属于「当前文档怎么看」，已移到文档栏。
    // 留在这里会让工具栏混入文档级控制，层次不清（§2.1）。
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "大纲" })).not.toBeInTheDocument();
  });
});
