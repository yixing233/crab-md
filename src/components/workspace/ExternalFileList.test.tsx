import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExternalFileList } from "./ExternalFileList";
import { externalTabId } from "../../lib/externalFiles";
import type { ExternalFileView } from "../../types/document";

function file(path: string, name: string, missing = false): ExternalFileView {
  return {
    path,
    name,
    size: 4,
    modifiedAt: "2026-01-01T00:00:00Z",
    openedAt: "2026-01-02T00:00:00Z",
    missing,
  };
}

/** 默认 props：只关心被测行为，其余用空实现。 */
function renderList(over: Partial<Parameters<typeof ExternalFileList>[0]> = {}) {
  const props: Parameters<typeof ExternalFileList>[0] = {
    files: [],
    activeId: null,
    onOpen: vi.fn(),
    onReveal: vi.fn(),
    onForget: vi.fn(),
    onOpenFilePicker: vi.fn(),
    ...over,
  };
  render(<ExternalFileList {...props} />);
  return props;
}

describe("ExternalFileList", () => {
  it("shows an empty state with an open-file action when nothing was opened yet", async () => {
    const props = renderList();

    expect(screen.getByText("还没有打开过外部文件")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "打开文件…" }));
    expect(props.onOpenFilePicker).toHaveBeenCalledOnce();
  });

  it("renders remembered files and opens one by path", async () => {
    const props = renderList({ files: [file("E:\\notes\\a.md", "a.md")] });

    await userEvent.click(screen.getByRole("button", { name: "a.md" }));

    expect(props.onOpen).toHaveBeenCalledWith("E:\\notes\\a.md");
  });

  it("highlights the file that is currently open", () => {
    // 标签页 id 与列表条目必须能用同一个函数对上，否则高亮会永远失效。
    const path = "E:\\notes\\a.md";
    renderList({ files: [file(path, "a.md")], activeId: externalTabId(path) });

    expect(screen.getByRole("button", { name: "a.md" })).toHaveAttribute(
      "data-selected",
    );
  });

  it("does not highlight a file that is not the active one", () => {
    renderList({
      files: [file("E:\\notes\\a.md", "a.md")],
      activeId: externalTabId("E:\\notes\\other.md"),
    });

    expect(screen.getByRole("button", { name: "a.md" })).not.toHaveAttribute(
      "data-selected",
    );
  });

  it("announces a file that vanished from disk", () => {
    renderList({ files: [file("E:\\notes\\gone.md", "gone.md", true)] });

    // 记录仍在列表里，但读屏用户从条目名就能听出它已经不可用。
    expect(screen.getByRole("button", { name: "gone.md，文件不存在" })).toHaveAttribute(
      "data-missing",
    );
  });

  it("offers reveal for a file that is still on disk", async () => {
    const props = renderList({ files: [file("E:\\notes\\a.md", "a.md")] });

    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开文件所在位置" }));

    expect(props.onReveal).toHaveBeenCalledWith("E:\\notes\\a.md");
  });

  it("disables reveal for a file that is gone", async () => {
    renderList({ files: [file("E:\\notes\\gone.md", "gone.md", true)] });

    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));

    expect(screen.getByRole("menuitem", { name: "打开文件所在位置" })).toBeDisabled();
  });

  it("asks for confirmation before removing a record", async () => {
    const props = renderList({ files: [file("E:\\notes\\a.md", "a.md")] });

    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "从列表移除" }));

    // 先确认，且确认文案必须说清「不删磁盘文件」，否则用户不敢点。
    expect(props.onForget).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "从列表移除" })).toBeInTheDocument();
    expect(screen.getByText(/磁盘上的文件不会被删除/)).toBeInTheDocument();
  });

  it("removes the record only after the user confirms", async () => {
    const props = renderList({ files: [file("E:\\notes\\a.md", "a.md")] });

    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "从列表移除" }));
    await userEvent.click(screen.getByRole("button", { name: "移除" }));

    expect(props.onForget).toHaveBeenCalledWith("E:\\notes\\a.md");
  });

  it("cancelling the confirmation removes nothing", async () => {
    const props = renderList({ files: [file("E:\\notes\\a.md", "a.md")] });

    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "从列表移除" }));
    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(props.onForget).not.toHaveBeenCalled();
  });

  it("treats removal as destructive", async () => {
    // 移除会丢掉一条记录（用户需要重新打开才能找回），必须走 danger 语义。
    renderList({ files: [file("E:\\notes\\a.md", "a.md")] });

    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    expect(screen.getByRole("menuitem", { name: "从列表移除" })).toHaveAttribute(
      "data-danger",
    );
  });

  it("reaches the menu by right-click too", async () => {
    const props = renderList({ files: [file("E:\\notes\\a.md", "a.md")] });

    const { fireEvent } = await import("@testing-library/react");
    fireEvent.contextMenu(screen.getByRole("button", { name: "a.md" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "从列表移除" }));
    await userEvent.click(screen.getByRole("button", { name: "移除" }));

    expect(props.onForget).toHaveBeenCalledWith("E:\\notes\\a.md");
  });
});
