import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Splitter } from "./Splitter";

function renderSplitter(over: Partial<Parameters<typeof Splitter>[0]> = {}) {
  const props = {
    value: 260,
    onChange: vi.fn(),
    ariaLabel: "调整侧边栏宽度",
    ...over,
  };
  render(<Splitter {...props} />);
  return props;
}

describe("Splitter (UI §11)", () => {
  it("exposes itself as a vertical separator with value bounds", () => {
    renderSplitter({ min: 180, max: 480 });
    const sep = screen.getByRole("separator");
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
    expect(sep).toHaveAttribute("aria-valuenow", "260");
    expect(sep).toHaveAttribute("aria-valuemin", "180");
    expect(sep).toHaveAttribute("aria-valuemax", "480");
    expect(sep).toHaveAccessibleName("调整侧边栏宽度");
  });

  it("is keyboard focusable, so it is not mouse-only (UI §39)", () => {
    renderSplitter();
    expect(screen.getByRole("separator")).toHaveAttribute("tabindex", "0");
  });

  it("widens a left-side pane with ArrowRight", async () => {
    const props = renderSplitter({ side: "left" });
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(props.onChange).toHaveBeenCalledWith(270);
  });

  it("narrows a left-side pane with ArrowLeft", async () => {
    const props = renderSplitter({ side: "left" });
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(props.onChange).toHaveBeenCalledWith(250);
  });

  it("inverts the arrow direction for a right-side pane", async () => {
    // 预览在右侧：按左键应当是变宽。
    const props = renderSplitter({ side: "right", value: 420 });
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(props.onChange).toHaveBeenCalledWith(430);
  });

  it("uses a larger step with Shift held", async () => {
    const props = renderSplitter({ side: "left" });
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(props.onChange).toHaveBeenCalledWith(300);
  });

  it("clamps to the minimum instead of going smaller", async () => {
    const props = renderSplitter({ value: 185, min: 180, max: 480 });
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{ArrowLeft}");
    // 185 - 10 = 175 会被夹到 180。
    expect(props.onChange).toHaveBeenCalledWith(180);
  });

  it("clamps to the maximum instead of going larger", async () => {
    const props = renderSplitter({ value: 475, min: 180, max: 480 });
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(props.onChange).toHaveBeenCalledWith(480);
  });

  it("jumps to the bounds with Home and End", async () => {
    const props = renderSplitter({ min: 180, max: 480 });
    screen.getByRole("separator").focus();
    await userEvent.keyboard("{Home}");
    expect(props.onChange).toHaveBeenLastCalledWith(180);
    await userEvent.keyboard("{End}");
    expect(props.onChange).toHaveBeenLastCalledWith(480);
  });

  it("resets to a sensible width on double click", async () => {
    const props = renderSplitter({ side: "left" });
    await userEvent.dblClick(screen.getByRole("separator"));
    expect(props.onChange).toHaveBeenCalledWith(260);
  });
});
