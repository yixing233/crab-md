import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewModeSwitch } from "./ViewModeSwitch";

describe("ViewModeSwitch (UI §11)", () => {
  it("renders the three modes as a radio group", () => {
    render(<ViewModeSwitch value="split" onChange={() => {}} />);
    // 语义上用 radiogroup，屏幕阅读器会播报「3 选 1」。
    expect(screen.getByRole("radiogroup", { name: "视图" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("marks exactly one mode as checked", () => {
    render(<ViewModeSwitch value="split" onChange={() => {}} />);
    const checked = screen.getAllByRole("radio").filter(
      (el) => el.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAccessibleName("分栏");
  });

  it("reports the clicked mode", async () => {
    const onChange = vi.fn();
    render(<ViewModeSwitch value="split" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "仅阅读" }));
    expect(onChange).toHaveBeenCalledWith("preview");
  });

  it("offers edit-only and preview-only modes", () => {
    // 这两档就是用户要的「收起预览栏」与「收起源码栏」。
    render(<ViewModeSwitch value="split" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "仅编辑" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "仅阅读" })).toBeInTheDocument();
  });

  it("reflects the checked state from props", () => {
    const { rerender } = render(<ViewModeSwitch value="edit" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "仅编辑" })).toHaveAttribute("aria-checked", "true");
    rerender(<ViewModeSwitch value="preview" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "仅阅读" })).toHaveAttribute("aria-checked", "true");
  });

  it("gives every icon-only control an accessible name (UI §14.4)", () => {
    render(<ViewModeSwitch value="split" onChange={() => {}} />);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAccessibleName();
    }
  });
});
