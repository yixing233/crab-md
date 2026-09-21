import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Toast } from "./Toast";

describe("Toast", () => {
  it("renders nothing when there is no message", () => {
    render(<Toast message={null} onDismiss={() => {}} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the message", () => {
    render(<Toast message="已保存" onDismiss={() => {}} />);
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("is announced politely rather than interrupting (UI §33)", () => {
    render(<Toast message="已保存" onDismiss={() => {}} />);
    // §33：轻提示不打断操作 → 不用 role=alert。
    const el = screen.getByRole("status");
    expect(el).toHaveAttribute("aria-live", "polite");
  });

  it("dismisses on the close button", async () => {
    const onDismiss = vi.fn();
    render(<Toast message="已保存" onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole("button", { name: /关闭/ }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("auto-dismisses a success toast", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="已保存" tone="success" onDismiss={onDismiss} />);
    vi.advanceTimersByTime(2400);
    expect(onDismiss).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("keeps an error toast until the user acts (duration 0)", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="保存失败" tone="error" onDismiss={onDismiss} />);
    vi.advanceTimersByTime(10_000);
    // 错误不该自己消失，否则用户看不到出了什么问题。
    expect(onDismiss).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("honours an explicit duration override", async () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="完成" tone="error" duration={100} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(150);
    expect(onDismiss).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("is distinct per tone for styling", () => {
    const { rerender } = render(<Toast message="x" tone="success" onDismiss={() => {}} />);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "success");
    rerender(<Toast message="x" tone="error" onDismiss={() => {}} />);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "error");
  });
});
