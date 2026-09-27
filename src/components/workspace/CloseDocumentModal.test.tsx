import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  CloseDocumentModal,
  type CloseDocumentModalProps,
} from "./CloseDocumentModal";

function renderModal(over: Partial<CloseDocumentModalProps> = {}) {
  const props: CloseDocumentModalProps = {
    prompt: null,
    onSave: vi.fn().mockResolvedValue(undefined),
    onDiscard: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    ...over,
  };
  render(<CloseDocumentModal {...props} />);
  return props;
}

describe("CloseDocumentModal", () => {
  it("renders nothing when prompt is null", () => {
    const { container } = render(<CloseDocumentModal prompt={null} onSave={vi.fn()} onDiscard={vi.fn()} onCancel={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("handles save-changes confirmation", async () => {
    const props = renderModal({
      prompt: { kind: "save-changes", id: "1", title: "测试文档.md" },
    });

    expect(screen.getByText("是否保存对 “测试文档.md” 的更改？")).toBeInTheDocument();

    const saveBtn = screen.getByRole("button", { name: "保存" });
    await userEvent.click(saveBtn);
    expect(props.onSave).toHaveBeenCalledOnce();
  });

  it("handles save-changes discard", async () => {
    const props = renderModal({
      prompt: { kind: "save-changes", id: "1", title: "测试文档.md" },
    });

    const discardBtn = screen.getByRole("button", { name: "不保存" });
    await userEvent.click(discardBtn);
    expect(props.onDiscard).toHaveBeenCalledOnce();
  });

  it("handles save-and-name with custom title", async () => {
    const props = renderModal({
      prompt: { kind: "save-and-name", id: "new1", suggestedName: "建议名称" },
    });

    expect(screen.getByText("保存新笔记")).toBeInTheDocument();
    const input = screen.getByPlaceholderText("输入笔记名称") as HTMLInputElement;
    expect(input.value).toBe("建议名称");

    await userEvent.clear(input);
    await userEvent.type(input, "我的第一篇笔记");

    const saveBtn = screen.getByRole("button", { name: "保存" });
    await userEvent.click(saveBtn);
    expect(props.onSave).toHaveBeenCalledWith("我的第一篇笔记");
  });

  it("handles save-and-name discard", async () => {
    const props = renderModal({
      prompt: { kind: "save-and-name", id: "new1", suggestedName: "草稿" },
    });

    const discardBtn = screen.getByRole("button", { name: "不保存" });
    await userEvent.click(discardBtn);
    expect(props.onDiscard).toHaveBeenCalledOnce();
  });

  it("handles cancel", async () => {
    const props = renderModal({
      prompt: { kind: "save-changes", id: "1", title: "文档" },
    });

    const cancelBtn = screen.getByRole("button", { name: "取消" });
    await userEvent.click(cancelBtn);
    expect(props.onCancel).toHaveBeenCalledOnce();
  });
});
