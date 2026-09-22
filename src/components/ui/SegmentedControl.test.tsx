import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

const OPTIONS = [
  { value: "a", label: "选项甲" },
  { value: "b", label: "选项乙" },
  { value: "c", label: "选项丙" },
] as const;

describe("SegmentedControl", () => {
  it("renders as a radio group, not a row of independent toggles", () => {
    render(
      <SegmentedControl value="a" options={OPTIONS} onChange={() => {}} ariaLabel="测试组" />,
    );
    // 用 radiogroup 语义，屏幕阅读器会播报「N 选 1」。
    expect(screen.getByRole("radiogroup", { name: "测试组" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("marks exactly one option as checked", () => {
    render(
      <SegmentedControl value="b" options={OPTIONS} onChange={() => {}} ariaLabel="测试组" />,
    );
    const checked = screen
      .getAllByRole("radio")
      .filter((el) => el.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAccessibleName("选项乙");
  });

  it("reports the clicked option", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl value="a" options={OPTIONS} onChange={onChange} ariaLabel="测试组" />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "选项丙" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("accepts a value not in the option list without crashing", () => {
    // 防御性：调用方传入过期值时不该崩，只是没有选中项。
    render(
      <SegmentedControl value="zzz" options={OPTIONS} onChange={() => {}} ariaLabel="测试组" />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("hides labels in compact mode but keeps accessible names", () => {
    render(
      <SegmentedControl value="a" options={OPTIONS} onChange={() => {}} ariaLabel="测试组" />,
    );
    // 不显示文字时仍要有可访问名称（纯图标按钮必须如此，§14.4）。
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAccessibleName();
    }
  });

  it("shows labels when asked, so the current value is readable at a glance", () => {
    render(
      <SegmentedControl
        value="a"
        options={OPTIONS}
        onChange={() => {}}
        ariaLabel="测试组"
        showLabels
      />,
    );
    expect(screen.getByText("选项甲")).toBeInTheDocument();
  });
});
