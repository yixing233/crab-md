import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PreviewTypeRow } from "./PreviewTypeRow";
import {
  PREVIEW_DEFAULT_TYPOGRAPHY,
  PREVIEW_SIZE_RANGE,
  stepSizeDown,
  stepSizeUp,
  type ElementTypography,
} from "../../lib/previewTypography";

function renderRow(over: Partial<Parameters<typeof PreviewTypeRow>[0]> = {}) {
  const props: Parameters<typeof PreviewTypeRow>[0] = {
    element: "body",
    value: { ...PREVIEW_DEFAULT_TYPOGRAPHY.body },
    latinFont: "system",
    onChange: vi.fn(),
    ...over,
  };
  render(<PreviewTypeRow {...props} />);
  return props;
}

describe("PreviewTypeRow", () => {
  it("shows the element name in the interface language", () => {
    renderRow({ element: "h3" });
    // 用户看到的是「三级标题」，不是 HTML 标签名 h3。
    expect(screen.getByText("三级标题")).toBeInTheDocument();
  });

  it("shows the current size so the setting is verifiable at a glance", () => {
    renderRow({ value: { cjkFont: "system", sizePx: 18 } });
    expect(screen.getByTestId("preview-size-body")).toHaveTextContent("18");
  });

  it("renders the current font name with that font's own glyphs", () => {
    // 选择列表的核心价值：读到「宋体」两个字本身就是宋体。
    renderRow({ value: { cjkFont: "simsun", sizePx: 16 } });
    const button = screen.getByRole("button", { name: /正文字体|正文.*字体/ });
    const label = within(button).getByText("宋体");
    expect(label).toBeInTheDocument();
    expect(label.style.fontFamily).toContain("SimSun");
  });

  it("raises the size by exactly one step", async () => {
    const props = renderRow({ value: { cjkFont: "system", sizePx: 16 } });
    await userEvent.click(screen.getByRole("button", { name: /正文.*放大/ }));

    expect(props.onChange).toHaveBeenCalledWith({
      cjkFont: "system",
      sizePx: stepSizeUp("body", 16),
    });
  });

  it("lowers the size by exactly one step", async () => {
    const props = renderRow({ value: { cjkFont: "system", sizePx: 16 } });
    await userEvent.click(screen.getByRole("button", { name: /正文.*缩小/ }));

    expect(props.onChange).toHaveBeenCalledWith({
      cjkFont: "system",
      sizePx: stepSizeDown("body", 16),
    });
  });

  it("disables the grow control at the element's maximum", () => {
    // 到端点时按钮应禁用，而不是点了没反应。
    renderRow({ value: { cjkFont: "system", sizePx: PREVIEW_SIZE_RANGE.body.max } });
    expect(screen.getByRole("button", { name: /正文.*放大/ })).toBeDisabled();
  });

  it("disables the shrink control at the element's minimum", () => {
    renderRow({ value: { cjkFont: "system", sizePx: PREVIEW_SIZE_RANGE.body.min } });
    expect(screen.getByRole("button", { name: /正文.*缩小/ })).toBeDisabled();
  });

  it("keeps the font unchanged when only the size is adjusted", async () => {
    // 两个设置互相独立，调字号不该顺手把字体重置。
    const props = renderRow({ value: { cjkFont: "kaiti", sizePx: 16 } });
    await userEvent.click(screen.getByRole("button", { name: /正文.*放大/ }));

    const sent = (props.onChange as ReturnType<typeof vi.fn>).mock.calls[0][0] as ElementTypography;
    expect(sent.cjkFont).toBe("kaiti");
  });

  it("opens a menu offering every CJK font", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: /正文.*字体/ }));

    for (const name of ["默认", "微软雅黑", "黑体", "宋体", "楷体", "仿宋"]) {
      expect(screen.getByRole("menuitem", { name }), name).toBeInTheDocument();
    }
  });

  it("reports the chosen font while preserving the size", async () => {
    const props = renderRow({ value: { cjkFont: "system", sizePx: 22 } });
    await userEvent.click(screen.getByRole("button", { name: /正文.*字体/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "黑体" }));

    expect(props.onChange).toHaveBeenCalledWith({ cjkFont: "simhei", sizePx: 22 });
  });

  it("gives the font control an accessible name naming its element", () => {
    // 11 行长得一样，可访问名必须能区分是哪一行 —— 否则读屏用户无法操作。
    renderRow({ element: "quote" });
    expect(screen.getByRole("button", { name: /引用.*字体/ })).toBeInTheDocument();
  });

  it("does not mutate the incoming value object", async () => {
    const value = { cjkFont: "system" as const, sizePx: 16 };
    renderRow({ value });
    await userEvent.click(screen.getByRole("button", { name: /正文.*放大/ }));
    expect(value.sizePx).toBe(16);
  });
});
