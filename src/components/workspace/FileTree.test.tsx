import { render, screen } from "@testing-library/react";
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

describe("FileTree", () => {
  it("shows an empty state with a create action when there are no notes", () => {
    render(<FileTree documents={[]} activeId={null} onSelect={() => {}} onCreate={() => {}} />);
    expect(screen.getByText("No notes yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new note/i })).toBeInTheDocument();
  });

  it("renders documents as tree items", () => {
    render(
      <FileTree documents={[doc("1", "Go Basics")]} activeId={null} onSelect={() => {}} onCreate={() => {}} />,
    );
    expect(screen.getByText("Go Basics")).toBeInTheDocument();
  });

  it("calls onSelect with the document id", async () => {
    const onSelect = vi.fn();
    render(
      <FileTree documents={[doc("42", "Notes")]} activeId={null} onSelect={onSelect} onCreate={() => {}} />,
    );
    await userEvent.click(screen.getByText("Notes"));
    expect(onSelect).toHaveBeenCalledWith("42");
  });

  it("marks the active document as selected", () => {
    render(
      <FileTree documents={[doc("1", "Active")]} activeId="1" onSelect={() => {}} onCreate={() => {}} />,
    );
    expect(screen.getByRole("treeitem", { name: /Active/ })).toHaveAttribute("aria-selected", "true");
  });

  it("creates a document from the empty state button", async () => {
    const onCreate = vi.fn();
    render(<FileTree documents={[]} activeId={null} onSelect={() => {}} onCreate={onCreate} />);
    await userEvent.click(screen.getByRole("button", { name: /new note/i }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("nests documents under their folder", () => {
    render(
      <FileTree
        documents={[doc("1", "Deep", "/Folder/")]}
        activeId={null}
        onSelect={() => {}}
        onCreate={() => {}}
      />,
    );
    expect(screen.getByText("Folder")).toBeInTheDocument();
    expect(screen.getByText("Deep")).toBeInTheDocument();
  });
});
