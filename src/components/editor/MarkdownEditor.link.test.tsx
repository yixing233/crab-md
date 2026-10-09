import { render, screen } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

const openUrl = vi.fn((_url: string) => Promise.resolve());
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrl(url),
}));

function setup(value: string) {
  render(<MarkdownEditor documentId="d1" value={value} onChange={() => {}} />);
  const content = screen.getByTestId("markdown-editor").querySelector(".cm-content") as HTMLElement;
  const view = EditorView.findFromDOM(content);
  if (!view) throw new Error("editor view not found");
  // 光标移到文档末尾，让第 1 行的链接离开活跃行 → 触发即时渲染
  view.dispatch({ selection: { anchor: view.state.doc.length } });
  return { content, view };
}

describe("MarkdownEditor inline link", () => {
  beforeEach(() => {
    openUrl.mockClear();
  });

  it("renders [文字](url) as a .cm-live-link span carrying data-href", () => {
    const url = "https://kitty.fo/register?invite=2P6SVT55";
    const { content } = setup(`- [机场购买](${url})\n\n末尾`);

    const link = content.querySelector(".cm-live-link");
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent("机场购买");
    expect(link).toHaveAttribute("data-href", url);
    // `[` 与 `](url)` 必须已经折叠：源码标记不该再出现在可见文本里
    expect(content.textContent).not.toContain("](https://kitty.fo");
  });

  it("opens the link on Ctrl+click and prevents the built-in selection", async () => {
    const url = "https://wzyp.cn/item/as6ldw";
    const { content, view } = setup(`- [ChatGPT Plus代充](${url})\n\n末尾`);
    const link = content.querySelector(".cm-live-link") as HTMLElement;

    const before = view.state.selection.main.head;
    // ctrlKey 让处理器返回 true → preventDefault + 跳过内置鼠标选择
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    // openExternalLink 内部是动态 import，打开动作落在微任务里。
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledWith(url));
    // 内置的 mousedown 处理器被跳过，光标没有被搬到链接里
    expect(view.state.selection.main.head).toBe(before);
  });

  it("does not open on a plain click, and leaves the click to the editor", () => {
    const url = "https://chatgpt.com";
    const { content } = setup(`- 使用qq，Google邮箱注册[ChatGPT](${url})\n\n末尾`);
    const link = content.querySelector(".cm-live-link") as HTMLElement;

    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      // 没有修饰键
    });
    link.dispatchEvent(event);

    // 我们的处理器在修饰键检查处就返回 false，没有拦下这次事件；
    // 事件最终仍被 `preventDefault`，说明它落到了 CodeMirror 内置的
    // 鼠标选择处理器（也就是正常的光标落点路径）。
    expect(openUrl).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not intercept Ctrl+click when the target is not openable", () => {
    const { content } = setup(`- [本地文档](./note.md)\n\n末尾`);
    const link = content.querySelector(".cm-live-link") as HTMLElement;

    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    link.dispatchEvent(event);

    // 相对路径交给编辑器自己处理（普通光标操作），不唤起系统浏览器。
    // 我们没拦 → 事件继续走到内置处理器并被它 preventDefault。
    expect(openUrl).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });
});
