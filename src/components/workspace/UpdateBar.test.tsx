import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateBar } from "./UpdateBar";
import { useUpdateStore, type UpdateState } from "../../stores/useUpdateStore";

/** 只覆盖状态字段（动作保持 store 里的真实实现）。 */
function setStatus(over: Partial<UpdateState>) {
  useUpdateStore.setState(over as UpdateState);
}

beforeEach(() => {
  vi.clearAllMocks();
  useUpdateStore.setState({
    status: { kind: "idle" },
    barDismissed: false,
    dismissedVersion: null,
  });
});

describe("UpdateBar (UI §33: persistent UI for user choices)", () => {
  it("renders nothing when there is no update", () => {
    render(<UpdateBar onInstall={vi.fn()} />);
    // 没有更新时不应占用任何空间 —— 也不该从编辑器抢注意力（§2.1）。
    expect(screen.queryByTestId("update-bar")).not.toBeInTheDocument();
  });

  it("shows a persistent bar with the version when an update exists", () => {
    setStatus({
      status: { kind: "available", version: "1.2.3", notes: null },
    });
    render(<UpdateBar onInstall={vi.fn()} />);

    expect(screen.getByTestId("update-bar")).toBeInTheDocument();
    expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument();
    // 关键：这是常驻提示，不是会消失的 toast（§33 把「需要用户选择」
    // 列为 toast 的反例）。
    expect(screen.getByRole("button", { name: /下载并安装/ })).toBeInTheDocument();
  });

  it("hides once the user dismissed this version", () => {
    useUpdateStore.setState({
      status: { kind: "available", version: "1.2.3", notes: null },
      barDismissed: true,
    });
    render(<UpdateBar onInstall={vi.fn()} />);

    expect(screen.queryByTestId("update-bar")).not.toBeInTheDocument();
  });

  it("dismisses through the store so the toolbar badge agrees", async () => {
    setStatus({
      status: { kind: "available", version: "1.2.3", notes: null },
    });
    render(<UpdateBar onInstall={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "暂不更新" }));

    expect(useUpdateStore.getState().barDismissed).toBe(true);
  });

  it("calls onInstall when the user accepts", async () => {
    const onInstall = vi.fn();
    setStatus({
      status: { kind: "available", version: "1.2.3", notes: null },
    });
    render(<UpdateBar onInstall={onInstall} />);

    await userEvent.click(screen.getByRole("button", { name: /下载并安装/ }));

    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("stays visible while downloading and shows progress", () => {
    setStatus({
      status: { kind: "downloading", version: "1.2.3", downloaded: 50, total: 100 },
    });
    render(<UpdateBar onInstall={vi.fn()} />);

    expect(screen.getByTestId("update-bar")).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
  });

  it("does not fake a percentage when the total size is unknown", () => {
    setStatus({
      status: { kind: "downloading", version: "1.2.3", downloaded: 1024, total: null },
    });
    render(<UpdateBar onInstall={vi.fn()} />);

    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    // 也不能留一个 "undefined%" 之类的东西。
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("removes the dismiss button while busy, so a started install is not lost", () => {
    setStatus({
      status: { kind: "downloading", version: "1.2.3", downloaded: 10, total: 100 },
    });
    render(<UpdateBar onInstall={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "暂不更新" })).not.toBeInTheDocument();
  });
});
