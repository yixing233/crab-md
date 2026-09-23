import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";
import type { DocumentSummary } from "../../types/document";

function doc(id: string, title: string, virtualPath = "/"): DocumentSummary {
  return {
    id, title, virtualPath, revision: 1,
    contentHash: "sha256:x",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    size: 0,
  };
}

/** 默认 props：只关心被测行为，其余用空实现。 */
function renderTree(over: Partial<Parameters<typeof FileTree>[0]> = {}) {
  const props: Parameters<typeof FileTree>[0] = {
    documents: [] as DocumentSummary[],
    activeId: null,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onExport: vi.fn(),
    onRequestDelete: vi.fn(),
    ...over,
  };
  render(<FileTree {...props} />);
  return props;
}

describe("FileTree", () => {
  it("shows an empty state with a create action when there are no notes", () => {
    renderTree();
    expect(screen.getByText("还没有笔记")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新建笔记/ })).toBeInTheDocument();
  });

  it("renders documents as tree items", () => {
    renderTree({ documents: [doc("1", "Go Basics")] });
    expect(screen.getByText("Go Basics")).toBeInTheDocument();
  });

  it("calls onSelect with the document id", async () => {
    const props = renderTree({ documents: [doc("42", "Notes")] });
    await userEvent.click(screen.getByText("Notes"));
    expect(props.onSelect).toHaveBeenCalledWith("42");
  });

  it("marks the active document as selected", () => {
    renderTree({ documents: [doc("1", "Active")], activeId: "1" });
    expect(screen.getByRole("treeitem", { name: /Active/ })).toHaveAttribute("aria-selected", "true");
  });

  it("creates a document from the empty state button", async () => {
    const props = renderTree();
    await userEvent.click(screen.getByRole("button", { name: /新建笔记/ }));
    expect(props.onCreate).toHaveBeenCalledOnce();
  });

  it("nests documents under their folder", () => {
    renderTree({ documents: [doc("1", "Deep", "/Folder/")] });
    expect(screen.getByText("Folder")).toBeInTheDocument();
    expect(screen.getByText("Deep")).toBeInTheDocument();
  });
});

describe("FileTree inline rename (UI §18.2)", () => {
  it("opens an input on the more-menu rename action, pre-filled and focused", async () => {
    renderTree({ documents: [doc("1", "旧标题")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));

    const input = screen.getByRole("textbox", { name: "笔记名称" });
    expect(input).toHaveValue("旧标题");
    // §18.2 要求自动聚焦。
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("commits on Enter with the new title", async () => {
    const props = renderTree({ documents: [doc("7", "旧标题")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));

    const input = screen.getByRole("textbox", { name: "笔记名称" });
    await userEvent.clear(input);
    await userEvent.type(input, "新标题{Enter}");

    expect(props.onRename).toHaveBeenCalledWith("7", "新标题");
    expect(screen.queryByRole("textbox", { name: "笔记名称" })).not.toBeInTheDocument();
  });

  it("cancels on Escape without renaming", async () => {
    const props = renderTree({ documents: [doc("7", "旧标题")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));

    const input = screen.getByRole("textbox", { name: "笔记名称" });
    await userEvent.clear(input);
    await userEvent.type(input, "不该保存{Escape}");

    expect(props.onRename).not.toHaveBeenCalled();
    expect(screen.getByText("旧标题")).toBeInTheDocument();
  });

  it("does not call rename when the title is unchanged", async () => {
    const props = renderTree({ documents: [doc("1", "原名")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    await userEvent.type(screen.getByRole("textbox", { name: "笔记名称" }), "{Enter}");
    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("rejects a blank title instead of sending it to the backend", async () => {
    const props = renderTree({ documents: [doc("1", "原名")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));

    const input = screen.getByRole("textbox", { name: "笔记名称" });
    await userEvent.clear(input);
    await userEvent.type(input, "   {Enter}");

    expect(props.onRename).not.toHaveBeenCalled();
  });

  it("trims whitespace around the new title", async () => {
    const props = renderTree({ documents: [doc("1", "原名")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));

    const input = screen.getByRole("textbox", { name: "笔记名称" });
    await userEvent.clear(input);
    await userEvent.type(input, "  新名  {Enter}");

    expect(props.onRename).toHaveBeenCalledWith("1", "新名");
  });

  it("starts rename with the F2 key on desktop", async () => {
    renderTree({ documents: [doc("1", "键盘重命名")] });
    const item = screen.getByRole("treeitem", { name: /键盘重命名/ });
    item.focus();
    await userEvent.keyboard("{F2}");
    expect(screen.getByRole("textbox", { name: "笔记名称" })).toBeInTheDocument();
  });
});

describe("FileTree delete entry", () => {
  it("asks the parent to delete via the more menu", async () => {
    const props = renderTree({ documents: [doc("9", "要删的")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "删除" }));

    // 组件只上报请求，确认对话框由上层负责（破坏性操作必须先确认）。
    expect(props.onRequestDelete).toHaveBeenCalledWith("9", "要删的");
  });

  it("marks delete as the dangerous item (UI §14.4)", async () => {
    renderTree({ documents: [doc("1", "甲")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    // 删除是本菜单里唯一的破坏性操作，必须带 danger 语义。
    expect(screen.getByRole("menuitem", { name: "删除" })).toHaveAttribute("data-danger");
    expect(screen.getByRole("menuitem", { name: "另存为副本" })).not.toHaveAttribute("data-danger");
  });
});

describe("FileTree duplicate entry (另存为)", () => {
  it("offers 另存为副本 in the more menu", async () => {
    renderTree({ documents: [doc("1", "甲")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    expect(screen.getByRole("menuitem", { name: "另存为副本" })).toBeInTheDocument();
  });

  it("reports the id and current title to the parent", async () => {
    const props = renderTree({ documents: [doc("5", "原始标题")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "另存为副本" }));

    // 组件不自己拼标题 —— 文案属 i18n，由上层决定（UI §2.5）。
    expect(props.onDuplicate).toHaveBeenCalledWith("5", "原始标题");
  });

  it("closes the menu after duplicating", async () => {
    renderTree({ documents: [doc("1", "甲")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "另存为副本" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("reaches duplicate from right-click too, not just the more button", async () => {
    const props = renderTree({ documents: [doc("7", "右键的")] });
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /右键的/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "另存为副本" }));
    expect(props.onDuplicate).toHaveBeenCalledWith("7", "右键的");
  });

  it("keeps duplicate above delete so a destructive action is never first", async () => {
    renderTree({ documents: [doc("1", "甲")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(labels.indexOf("另存为副本")).toBeLessThan(labels.indexOf("删除"));
  });
});

describe("FileTree export entry (导出)", () => {
  it("offers 导出为 Markdown in the menu", async () => {
    renderTree({ documents: [doc("1", "甲")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    expect(screen.getByRole("menuitem", { name: /导出为 Markdown/ })).toBeInTheDocument();
  });

  it("reports the id and title so the dialog can suggest a filename", async () => {
    const props = renderTree({ documents: [doc("9", "要导出的")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /导出为 Markdown/ }));

    expect(props.onExport).toHaveBeenCalledWith("9", "要导出的");
  });

  it("reaches export from right-click too", async () => {
    const props = renderTree({ documents: [doc("3", "右键导出")] });
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /右键导出/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /导出为 Markdown/ }));
    expect(props.onExport).toHaveBeenCalledWith("3", "右键导出");
  });

  it("closes the menu after choosing export", async () => {
    renderTree({ documents: [doc("1", "甲")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /导出为 Markdown/ }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is not a destructive action", async () => {
    // 导出只读，绝不该带 danger 语义。
    renderTree({ documents: [doc("1", "甲")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    expect(screen.getByRole("menuitem", { name: /导出为 Markdown/ })).not.toHaveAttribute(
      "data-danger",
    );
  });

  it("keeps export above delete", async () => {
    renderTree({ documents: [doc("1", "甲")] });
    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    const labels = screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
    const exportAt = labels.findIndex((l) => l.includes("导出"));
    const deleteAt = labels.findIndex((l) => l.includes("删除"));
    expect(exportAt).toBeGreaterThanOrEqual(0);
    expect(exportAt).toBeLessThan(deleteAt);
  });
});
