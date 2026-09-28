import { fireEvent, render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./MarkdownEditor";

describe("MarkdownEditor image paste", () => {
  it("intercepts a supported clipboard image and inserts its attachment reference", async () => {
    const onChange = vi.fn();
    const onPasteImage = vi.fn().mockResolvedValue("01993ab2-0000-7000-8000-000000000000");
    const { getByTestId } = render(
      <MarkdownEditor
        documentId="d1"
        value="before"
        onChange={onChange}
        onPasteImage={onPasteImage}
      />,
    );
    const content = getByTestId("markdown-editor").querySelector(".cm-content") as HTMLElement;
    const view = EditorView.findFromDOM(content);
    view!.dispatch({ selection: { anchor: 6 } });

    const file = new File([new Uint8Array([1, 2, 3])], "pasted.png", { type: "image/png" });
    fireEvent.paste(content, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
        files: [file],
      },
    });

    await waitFor(() => expect(onPasteImage).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        "before![图片](attachment://01993ab2-0000-7000-8000-000000000000)",
      ),
    );
  });

  it("leaves ordinary text paste to CodeMirror and does not call the image handler", async () => {
    const onChange = vi.fn();
    const onPasteImage = vi.fn();
    const { getByTestId } = render(
      <MarkdownEditor
        documentId="d1"
        value=""
        onChange={onChange}
        onPasteImage={onPasteImage}
      />,
    );
    const content = getByTestId("markdown-editor").querySelector(".cm-content") as HTMLElement;

    fireEvent.paste(content, {
      clipboardData: {
        items: [{ kind: "string", type: "text/plain" }],
        files: [],
        getData: () => "plain text",
      },
    });

    expect(onPasteImage).not.toHaveBeenCalled();
  });

  it("intercepts dropped image and inserts its attachment reference", async () => {
    const onChange = vi.fn();
    const onPasteImage = vi.fn().mockResolvedValue("01993ab2-0000-7000-8000-000000000001");
    const { getByTestId } = render(
      <MarkdownEditor
        documentId="d1"
        value="drop-before "
        onChange={onChange}
        onPasteImage={onPasteImage}
      />,
    );
    const content = getByTestId("markdown-editor").querySelector(".cm-content") as HTMLElement;
    const view = EditorView.findFromDOM(content);
    view!.dispatch({ selection: { anchor: 12 } });

    const file = new File([new Uint8Array([4, 5, 6])], "dropped.jpg", { type: "image/jpeg" });
    fireEvent.drop(content, {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    });

    await waitFor(() => expect(onPasteImage).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        "drop-before ![图片](attachment://01993ab2-0000-7000-8000-000000000001)",
      ),
    );
  });
});
