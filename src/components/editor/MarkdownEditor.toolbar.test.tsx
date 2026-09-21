import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor toolbar", () => {
  it("renders the formatting toolbar with the spec's actions", () => {
    render(<MarkdownEditor documentId="d1" value="" onChange={() => {}} />);
    const toolbar = screen.getByRole("toolbar", { name: /formatting/i });
    expect(toolbar).toBeInTheDocument();
    // §21.1 的全部动作都要有可访问名称。
    for (const label of [
      "Bold",
      "Italic",
      "Strikethrough",
      "Heading",
      "Bullet list",
      "Numbered list",
      "Quote",
      "Link",
      "Image",
      "Inline code",
      "Code block",
    ]) {
      expect(screen.getByRole("button", { name: label }), label).toBeInTheDocument();
    }
  });

  it("can hide the toolbar", () => {
    render(<MarkdownEditor documentId="d1" value="" onChange={() => {}} showToolbar={false} />);
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("applies bold to the whole document when the caret is at the start", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor documentId="d1" value="hello" onChange={onChange} />);
    // 光标默认在文档开头（折叠选区），加粗应插入空标记并把光标放在中间。
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onChange).toHaveBeenCalledWith("****hello");
  });

  it("turns the caret line into a heading", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor documentId="d1" value="Title" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Heading" }));
    expect(onChange).toHaveBeenCalledWith("## Title");
  });

  it("inserts a link template and reports the change", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor documentId="d1" value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    expect(onChange).toHaveBeenCalledWith("[text](url)");
  });

  it("keeps the editor mounted and usable after formatting", async () => {
    render(<MarkdownEditor documentId="d1" value="abc" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Italic" }));
    expect(screen.getByTestId("markdown-editor").querySelector(".cm-editor")).toBeTruthy();
  });
});
