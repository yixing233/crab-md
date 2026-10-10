import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "antd";
import { Dialog } from "./Dialog";

// Dialog 内部是 antd Modal；与 App 一样需要 ConfigProvider 提供中文 locale 与
// button 配置（autoInsertSpaceInButton），否则可访问名称会变成「取 消」。
function renderWithProvider(ui: ReactElement) {
  return render(<ConfigProvider button={{ autoInsertSpace: false }} locale={undefined}>{ui}</ConfigProvider>);
}

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    renderWithProvider(
      <Dialog
        open={false}
        title="删除笔记"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders a titled modal dialog when open (UI §16)", () => {
    renderWithProvider(
      <Dialog
        open
        title="删除笔记"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={() => {}}
        onCancel={() => {}}
      >
        确定要删除「X」吗？
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("删除笔记")).toBeInTheDocument();
    expect(screen.getByText("确定要删除「X」吗？")).toBeInTheDocument();
  });

  it("calls onConfirm with the confirm button", async () => {
    const onConfirm = vi.fn();
    renderWithProvider(
      <Dialog
        open
        title="删除笔记"
        confirmLabel="删除"
        cancelLabel="取消"
        destructive
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel with the cancel button", async () => {
    const onCancel = vi.fn();
    renderWithProvider(
      <Dialog
        open
        title="删除笔记"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels on Escape (UI §16 requires desktop escape handling)", async () => {
    const onCancel = vi.fn();
    renderWithProvider(
      <Dialog
        open
        title="删除笔记"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels when the overlay is clicked", async () => {
    const onCancel = vi.fn();
    renderWithProvider(
      <Dialog
        open
        title="删除笔记"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    // 覆盖层是对话框的父节点。
    const overlay = screen.getByRole("dialog").parentElement!;
    await userEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does not cancel when the panel itself is clicked", async () => {
    const onCancel = vi.fn();
    renderWithProvider(
      <Dialog
        open
        title="删除笔记"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={() => {}}
        onCancel={onCancel}
      >
        内容
      </Dialog>,
    );
    await userEvent.click(screen.getByText("内容"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog on open (focus management)", async () => {
    renderWithProvider(
      <Dialog
        open
        title="删除笔记"
        confirmLabel="删除"
        cancelLabel="取消"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // antd Modal 把初始焦点放在对话框容器（tabindex="-1"）上，
    // 行为语义与原实现一致：打开后焦点在对话框内，Tab 从头遍历动作按钮。
    const dialog = screen.getByRole("dialog");
    await vi.waitFor(() => {
      expect(
        dialog.contains(document.activeElement) || document.activeElement === dialog,
      ).toBe(true);
    });
  });

  it("uses danger semantics for destructive confirm (UI §14.4)", () => {
    renderWithProvider(
      <Dialog
        open
        title="删除笔记"
        confirmLabel="删除"
        cancelLabel="取消"
        destructive
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "删除" })).toHaveAttribute("data-variant", "danger");
  });

  it("uses primary semantics for a non-destructive confirm", () => {
    renderWithProvider(
      <Dialog
        open
        title="重命名"
        confirmLabel="确定"
        cancelLabel="取消"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "确定" })).toHaveAttribute("data-variant", "primary");
  });
});
