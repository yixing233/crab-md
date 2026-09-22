import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditorFontBar } from "./EditorFontBar";

/** 收集 onPick 收到的字体栈。 */
let picked: string[] = [];

function renderBar(over: Partial<Parameters<typeof EditorFontBar>[0]> = {}) {
  picked = [];
  const props = {
    onPick: (stack: string) => picked.push(stack),
    onClear: vi.fn(),
    hasFont: false,
    hasSelection: true,
    defaultLatin: "system" as const,
    defaultCjk: "system" as const,
    ...over,
  };
  render(<EditorFontBar {...props} />);
  return props;
}

describe("EditorFontBar", () => {
  it("offers the quick font choices", () => {
    renderBar();
    const bar = screen.getByRole("toolbar", { name: "字体" });
    for (const name of ["默认", "雅黑", "黑体", "宋体", "楷体", "仿宋", "Times", "等宽"]) {
      expect(within(bar).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("reports the font stack when a choice is clicked", async () => {
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: "宋体" }));

    expect(picked).toHaveLength(1);
    // 传出去的是完整 CSS 栈，不是短名 —— 调用方不需要再查表。
    expect(picked[0]).toContain("SimSun");
  });

  it("composes the default option from the user's current settings", async () => {
    renderBar({ defaultLatin: "times", defaultCjk: "kaiti" });
    await userEvent.click(screen.getByRole("button", { name: "默认" }));

    expect(picked[0]).toContain("Times New Roman");
    expect(picked[0]).toContain("KaiTi");
  });

  it("keeps the other direction when a CJK font is picked", async () => {
    // 局部改中文字体不应把用户设置的西文字体也换掉。
    renderBar({ defaultLatin: "georgia", defaultCjk: "system" });
    await userEvent.click(screen.getByRole("button", { name: "宋体" }));

    expect(picked[0]).toContain("Georgia");
    expect(picked[0]).toContain("SimSun");
  });

  it("keeps the CJK font when a Latin font is picked", async () => {
    renderBar({ defaultLatin: "system", defaultCjk: "simhei" });
    await userEvent.click(screen.getByRole("button", { name: "Times" }));

    expect(picked[0]).toContain("Times New Roman");
    expect(picked[0]).toContain("SimHei");
  });

  it("disables every font button when nothing is selected", async () => {
    // 没有选中文字时设字体没有意义，按钮应禁用而不是静默无效。
    renderBar({ hasSelection: false });

    for (const name of ["默认", "宋体", "Times"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }

    await userEvent.click(screen.getByRole("button", { name: "宋体" }));
    expect(picked).toHaveLength(0);
  });

  it("explains why the buttons are disabled", async () => {
    renderBar({ hasSelection: false });
    // 悬停提示里说明需要先选中文字，而不是让用户猜。
    await userEvent.hover(screen.getByRole("button", { name: "宋体" }));
    expect(await screen.findByText(/请先选中文字/)).toBeInTheDocument();
  });

  it("renders each choice in its own font", () => {
    renderBar();
    const btn = screen.getByRole("button", { name: "宋体" });
    // Button 会把 children 包进 .ui-button__label，故要往里找带 style 的 span。
    const span = btn.querySelector("span[style]") as HTMLElement;
    expect(span).not.toBeNull();
    expect(span.style.fontFamily).toContain("SimSun");
  });

  it("hides the clear button when the selection has no font", () => {
    renderBar({ hasFont: false });
    expect(screen.queryByRole("button", { name: "清除字体" })).not.toBeInTheDocument();
  });

  it("shows the clear button when the selection already has a font", () => {
    renderBar({ hasFont: true });
    expect(screen.getByRole("button", { name: "清除字体" })).toBeInTheDocument();
  });

  it("reports clear when the clear button is clicked", async () => {
    const props = renderBar({ hasFont: true });
    await userEvent.click(screen.getByRole("button", { name: "清除字体" }));
    expect(props.onClear).toHaveBeenCalledOnce();
  });
});
