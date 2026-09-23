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
});

/**
 * 字体入口的核心行为。
 *
 * 这里断言**写进文档的文本**（onChange 的参数），而不是 DOM 装饰：
 * 装饰依赖视口与渲染时机，文档内容才是唯一可信的事实。
 */
describe("MarkdownEditor font entry", () => {
  it("wraps the current selection in a font span", async () => {
    // 选中全部文字后设字体 -> 应把选中的文字包进 span（而非插入空 span）。
    const onChange = vi.fn();
    const view = render(
      <MarkdownEditor
        documentId="d1"
        value="中文"
        onChange={onChange}
        onQuickFont={() => {}}
        onClearFont={() => {}}
        clearFontNonce={0}
      />,
    );

    // 用真实键盘全选，走 CodeMirror 自己的选区逻辑。
    const host = screen.getByTestId("markdown-editor");
    const content = host.querySelector(".cm-content") as HTMLElement;
    await userEvent.click(content);
    await userEvent.keyboard("{Control>}a{/Control}");

    view.rerender(
      <MarkdownEditor
        documentId="d1"
        value="中文"
        onChange={onChange}
        onQuickFont={() => {}}
        onClearFont={() => {}}
        fontSpanRequest={{ stack: "KaiTi", nonce: 1 }}
        clearFontNonce={0}
      />,
    );

    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    const text = calls[calls.length - 1][0] as string;
    // 有选区时是把选中内容裹起来，所以 span 内部就是「中文」，不是空的。
    expect(text).toContain('font-family:KaiTi');
    expect(text).toContain(">中文</span>");
  });

  it("inserts an empty span at the caret when there is no selection", async () => {
    // 用户明确要求：没有选中文字时，字体作用于**接下来输入的内容**。
    const onChange = vi.fn();
    const view = render(
      <MarkdownEditor
        documentId="d1"
        value="abc"
        onChange={onChange}
        onQuickFont={() => {}}
        onClearFont={() => {}}
        clearFontNonce={0}
      />,
    );

    view.rerender(
      <MarkdownEditor
        documentId="d1"
        value="abc"
        onChange={onChange}
        onQuickFont={() => {}}
        onClearFont={() => {}}
        fontSpanRequest={{ stack: "SimSun", nonce: 2 }}
        clearFontNonce={0}
      />,
    );

    expect(onChange).toHaveBeenCalledOnce();
    const text = onChange.mock.calls[0][0] as string;
    // 空 span 且开闭标签紧邻 —— 后续输入会落在两者之间。
    expect(text).toMatch(/<span style="font-family:SimSun"><\/span>/);
  });

  it("keeps surrounding text when setting a font with no selection", async () => {
    const onChange = vi.fn();
    const view = render(
      <MarkdownEditor
        documentId="d1"
        value="前后"
        onChange={onChange}
        onQuickFont={() => {}}
        onClearFont={() => {}}
        clearFontNonce={0}
      />,
    );
    view.rerender(
      <MarkdownEditor
        documentId="d1"
        value="前后"
        onChange={onChange}
        onQuickFont={() => {}}
        onClearFont={() => {}}
        fontSpanRequest={{ stack: "SimHei", nonce: 3 }}
        clearFontNonce={0}
      />,
    );

    const text = onChange.mock.calls[0][0] as string;
    expect(text).toContain("前后");
    expect(text).toContain('font-family:SimHei');
  });
});
