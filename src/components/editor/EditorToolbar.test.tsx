import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorToolbar } from "./EditorToolbar";

let toolbarWidth = 200;

beforeEach(() => {
  toolbarWidth = 200;
  vi.stubGlobal("ResizeObserver", undefined);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("editor-toolbar") ? toolbarWidth : 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("EditorToolbar responsive overflow", () => {
  it("keeps all actions inline when they fit", () => {
    toolbarWidth = 1000;
    render(<EditorToolbar onAction={() => {}} />);

    expect(screen.queryByRole("button", { name: "更多格式" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加粗" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "块级公式" })).toBeInTheDocument();
  });

  it("moves trailing actions into the More menu and invokes the chosen action", async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<EditorToolbar onAction={onAction} />);

    const moreButton = screen.getByRole("button", { name: "更多格式" });
    expect(moreButton).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.queryByRole("button", { name: "标题" })).not.toBeInTheDocument();

    await user.click(moreButton);
    const headingItem = await screen.findByRole("menuitem", { name: "标题" });
    await user.click(headingItem);

    expect(onAction).toHaveBeenCalledWith("heading");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("recalculates visible actions when the available width changes", async () => {
    render(<EditorToolbar onAction={() => {}} />);
    expect(screen.getByRole("button", { name: "更多格式" })).toBeInTheDocument();

    toolbarWidth = 1000;
    fireEvent(window, new Event("resize"));

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "更多格式" })).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "标题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "块级公式" })).toBeInTheDocument();
  });

  it("opens heading levels dropdown (H1 ~ H6) and invokes chosen heading level", async () => {
    toolbarWidth = 1000;
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<EditorToolbar onAction={onAction} />);

    const arrowBtn = screen.getByRole("button", { name: "选择标题级别" });
    await user.click(arrowBtn);

    const h3Item = await screen.findByRole("menuitem", { name: "H3" });
    await user.click(h3Item);

    expect(onAction).toHaveBeenCalledWith("h3");
  });

  it("renders onPrint button when provided and triggers on click", async () => {
    toolbarWidth = 1000;
    const onPrint = vi.fn();
    const user = userEvent.setup();
    render(<EditorToolbar onAction={() => {}} onPrint={onPrint} />);

    const printBtn = screen.getByRole("button", { name: "导出 PDF" });
    expect(printBtn).toBeInTheDocument();
    await user.click(printBtn);
    expect(onPrint).toHaveBeenCalledOnce();
  });
});
