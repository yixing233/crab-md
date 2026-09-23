import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor toolbar", () => {
  it("renders the formatting toolbar with the spec's actions", () => {
    render(<MarkdownEditor documentId="d1" value="" onChange={() => {}} />);
    const toolbar = screen.getByRole("toolbar", { name: /格式化/ });
    expect(toolbar).toBeInTheDocument();
    // §21.1 的全部动作都要有可访问名称（中文，见 UI §2.5）。
    for (const label of [
      "加粗",
      "斜体",
      "删除线",
      "标题",
      "无序列表",
      "有序列表",
      "引用",
      "链接",
      "图片",
      "行内代码",
      "代码块",
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
    await userEvent.click(screen.getByRole("button", { name: "加粗" }));
    expect(onChange).toHaveBeenCalledWith("****hello");
  });

  it("turns the caret line into a heading", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor documentId="d1" value="Title" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "标题" }));
    expect(onChange).toHaveBeenCalledWith("## Title");
  });

  it("inserts a link template and reports the change", async () => {
    const onChange = vi.fn();
    render(<MarkdownEditor documentId="d1" value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "链接" }));
    expect(onChange).toHaveBeenCalledWith("[text](url)");
  });

  it("keeps the editor mounted and usable after formatting", async () => {
    render(<MarkdownEditor documentId="d1" value="abc" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "斜体" }));
    expect(screen.getByTestId("markdown-editor").querySelector(".cm-editor")).toBeTruthy();
  });
});

/**
 * UI §20 / §28：语法高亮与光标上报此前完全缺失，
 * 这里把「确实装载了」这一点固定下来。
 */
describe("MarkdownEditor highlighting and cursor", () => {
  it("reports the initial cursor position on mount", () => {
    const onCursor = vi.fn();
    render(<MarkdownEditor documentId="d1" value={"a\nb"} onChange={() => {}} onCursor={onCursor} />);
    // 光标默认在文档开头 → 第 1 行第 1 列。
    expect(onCursor).toHaveBeenCalledWith(1, 1);
  });

  it("renders syntax highlight spans for markdown tokens", () => {
    render(<MarkdownEditor documentId="d1" value={"# 标题\n\n**粗体**"} onChange={() => {}} />);
    const host = screen.getByTestId("markdown-editor");
    // 有 HighlightStyle 时 CodeMirror 会给 token 打上带样式的 span；
    // 没有任何着色时这里会是 0。
    const styledSpans = host.querySelectorAll(".cm-line span[style], .cm-line span[class]");
    expect(styledSpans.length).toBeGreaterThan(0);
  });

  it("updates the cursor callback when the document changes externally", () => {
    const onCursor = vi.fn();
    const { rerender } = render(
      <MarkdownEditor documentId="d1" value={"one"} onChange={() => {}} onCursor={onCursor} />,
    );
    onCursor.mockClear();
    rerender(
      <MarkdownEditor documentId="d1" value={"one\ntwo"} onChange={() => {}} onCursor={onCursor} />,
    );
    expect(onCursor).toHaveBeenCalled();
  });

  it("mounts bracket matching without throwing", () => {
    // bracketMatching 在无配对括号时只是不渲染装饰，不该报错。
    render(<MarkdownEditor documentId="d1" value={"(unclosed"} onChange={() => {}} />);
    expect(screen.getByTestId("markdown-editor").querySelector(".cm-editor")).toBeTruthy();
  });

  it("mounts editor with scroller and content containers", () => {
    render(<MarkdownEditor documentId="d1" value={"content"} onChange={() => {}} />);
    const editor = screen.getByTestId("markdown-editor");
    expect(editor.querySelector(".cm-scroller")).toBeTruthy();
    expect(editor.querySelector(".cm-content")).toBeTruthy();
  });
});
