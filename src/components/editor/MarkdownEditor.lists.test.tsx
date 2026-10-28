import { render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

function setup(value: string, anchor?: number) {
  render(<MarkdownEditor documentId="d1" value={value} onChange={() => {}} />);
  const content = screen.getByTestId("markdown-editor").querySelector(".cm-content") as HTMLElement;
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error("editor view not found");
  view.dispatch({ selection: { anchor: anchor ?? value.length } });
  return { content, view };
}

function pressKey(content: HTMLElement, init: KeyboardEventInit): void {
  content.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
}

describe("MarkdownEditor list continuation (markdownKeymap)", () => {
  it("continues a bullet list on Enter", () => {
    const { content, view } = setup("- 项目一\n末尾", "- 项目一".length);

    pressKey(content, { key: "Enter" });

    // 新列表项为空，原本的下一行（末尾）不被并进列表项。
    expect(view.state.doc.toString()).toBe("- 项目一\n- \n末尾");
  });

  it("continues a task list with a fresh checkbox", () => {
    const { content, view } = setup("- [ ] 待办\n末尾", "- [ ] 待办".length);

    pressKey(content, { key: "Enter" });

    expect(view.state.doc.toString()).toBe("- [ ] 待办\n- [ ] \n末尾");
  });

  it("continues a block quote on Enter", () => {
    const { content, view } = setup("> 引用\n末尾", "> 引用".length);

    pressKey(content, { key: "Enter" });

    expect(view.state.doc.toString()).toBe("> 引用\n> \n末尾");
  });

  it("deletes the list marker on Backspace right after it", () => {
    const { content, view } = setup("- 项目", "- ".length);

    pressKey(content, { key: "Backspace" });

    expect(view.state.doc.toString()).toBe("项目");
  });
});

describe("MarkdownEditor list indent (Tab / Mod+])", () => {
  it("indents a list item with Tab and outdents with Shift+Tab", () => {
    const { content, view } = setup("- a");

    pressKey(content, { key: "Tab" });
    expect(view.state.doc.toString()).toBe("  - a");

    pressKey(content, { key: "Tab", shiftKey: true });
    expect(view.state.doc.toString()).toBe("- a");
  });

  it("indents with Mod+] and outdents with Mod+[", () => {
    const { content, view } = setup("- a");

    pressKey(content, { key: "]", ctrlKey: true });
    expect(view.state.doc.toString()).toBe("  - a");

    pressKey(content, { key: "[", ctrlKey: true });
    expect(view.state.doc.toString()).toBe("- a");
  });
});
