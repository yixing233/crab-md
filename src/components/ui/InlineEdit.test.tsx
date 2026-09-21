import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InlineEdit } from "./InlineEdit";

describe("InlineEdit (UI §18.2)", () => {
  it("focuses and selects the initial value on mount", async () => {
    render(
      <InlineEdit initialValue="旧名" ariaLabel="名称" onCommit={() => {}} onCancel={() => {}} />,
    );
    const input = screen.getByRole("textbox", { name: "名称" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("旧名");
  });

  it("commits the trimmed value on Enter", async () => {
    const onCommit = vi.fn();
    render(
      <InlineEdit initialValue="旧名" ariaLabel="名称" onCommit={onCommit} onCancel={() => {}} />,
    );
    const input = screen.getByRole("textbox", { name: "名称" });
    await userEvent.clear(input);
    await userEvent.type(input, "  新名  {Enter}");
    expect(onCommit).toHaveBeenCalledWith("新名");
  });

  it("cancels on Escape without committing", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <InlineEdit initialValue="旧名" ariaLabel="名称" onCommit={onCommit} onCancel={onCancel} />,
    );
    const input = screen.getByRole("textbox", { name: "名称" });
    await userEvent.clear(input);
    await userEvent.type(input, "改动{Escape}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels rather than commits when the value is unchanged", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <InlineEdit initialValue="原名" ariaLabel="名称" onCommit={onCommit} onCancel={onCancel} />,
    );
    await userEvent.type(screen.getByRole("textbox", { name: "名称" }), "{Enter}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("rejects a blank value instead of sending it upstream", async () => {
    const onCommit = vi.fn();
    render(
      <InlineEdit initialValue="原名" ariaLabel="名称" onCommit={onCommit} onCancel={() => {}} />,
    );
    const input = screen.getByRole("textbox", { name: "名称" });
    await userEvent.clear(input);
    await userEvent.type(input, "   {Enter}");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits on blur", async () => {
    const onCommit = vi.fn();
    render(
      <div>
        <InlineEdit initialValue="旧名" ariaLabel="名称" onCommit={onCommit} onCancel={() => {}} />
        <button>别处</button>
      </div>,
    );
    const input = screen.getByRole("textbox", { name: "名称" });
    await userEvent.clear(input);
    await userEvent.type(input, "新名");
    await userEvent.click(screen.getByRole("button", { name: "别处" }));
    expect(onCommit).toHaveBeenCalledWith("新名");
  });

  it("does not double-commit after Escape followed by blur", async () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    render(
      <div>
        <InlineEdit initialValue="旧名" ariaLabel="名称" onCommit={onCommit} onCancel={onCancel} />
        <button>别处</button>
      </div>,
    );
    const input = screen.getByRole("textbox", { name: "名称" });
    await userEvent.clear(input);
    await userEvent.type(input, "新名{Escape}");
    // Escape 之后失焦不应再提交一次。
    await userEvent.click(screen.getByRole("button", { name: "别处" }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
