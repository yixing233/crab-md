import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EditorFontBar } from "./EditorFontBar";

/** 收集 onPick 收到的字体栈。 */
let picked: string[] = [];
let cleared = 0;

function renderEntry(over: Partial<Parameters<typeof EditorFontBar>[0]> = {}) {
  picked = [];
  cleared = 0;
  const props = {
    onPick: (stack: string) => picked.push(stack),
    onClear: () => {
      cleared += 1;
    },
    hasFont: false,
    hasSelection: true,
    defaultLatin: "system" as const,
    defaultCjk: "system" as const,
    ...over,
  };
  render(<EditorFontBar {...props} />);
}

/** 打开下拉。 */
async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "字体" }));
}

describe("EditorFontBar (icon button + dropdown)", () => {
  it("renders a single icon button, not a row of font buttons", () => {
    renderEntry();
    // 形态要求：一个入口按钮；字体选项在点击之前不出现在页面上。
    expect(screen.getByRole("button", { name: "字体" })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "宋体" })).not.toBeInTheDocument();
  });

  it("opens a dropdown on click, listing the font choices", async () => {
    renderEntry();
    await openMenu();

    const menu = screen.getByRole("menu", { name: "字体" });
    for (const name of ["默认", "雅黑", "黑体", "宋体", "楷体", "仿宋", "Times", "等宽"]) {
      expect(within(menu).getByRole("menuitem", { name })).toBeInTheDocument();
    }
  });

  it("marks itself expanded while open", async () => {
    renderEntry();
    expect(screen.getByRole("button", { name: "字体" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await openMenu();
    expect(screen.getByRole("button", { name: "字体" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("closes when the same button is clicked again", async () => {
    renderEntry();
    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "字体" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("applies the chosen font and closes", async () => {
    renderEntry();
    await openMenu();

    await userEvent.click(screen.getByRole("menuitem", { name: "宋体" }));

    expect(picked).toHaveLength(1);
    expect(picked[0]).toContain("SimSun");
    // 选完即关，不需要再点一次。
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("composes the default option from the user's current settings", async () => {
    renderEntry({ defaultLatin: "times", defaultCjk: "kaiti" });
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "默认" }));

    expect(picked[0]).toContain("Times New Roman");
    expect(picked[0]).toContain("KaiTi");
  });

  it("keeps the other direction when a CJK font is picked", async () => {
    // 局部改中文字体不应把用户设置的西文字体也换掉。
    renderEntry({ defaultLatin: "georgia", defaultCjk: "system" });
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "宋体" }));

    expect(picked[0]).toContain("Georgia");
    expect(picked[0]).toContain("SimSun");
  });

  it("keeps the CJK font when a Latin font is picked", async () => {
    renderEntry({ defaultLatin: "system", defaultCjk: "simhei" });
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Times" }));

    expect(picked[0]).toContain("Times New Roman");
    expect(picked[0]).toContain("SimHei");
  });

  it("renders each option in its own font", async () => {
    renderEntry();
    await openMenu();

    const item = screen.getByRole("menuitem", { name: "宋体" });
    const labelEl = item.querySelector(".ui-menu__label") as HTMLElement;
    expect(labelEl.style.fontFamily).toContain("SimSun");
  });

  it("renders Latin options in their own font, not the current default", async () => {
    // 关键回归：早先西文项一律用 defaultLatin 渲染，于是 Times 与等宽
    // 都显示成同一个字体，用户看不出这两项是什么（实测缺陷）。
    renderEntry({ defaultLatin: "system", defaultCjk: "system" });
    await openMenu();

    const times = screen.getByRole("menuitem", { name: "Times" }).querySelector(
      ".ui-menu__label",
    ) as HTMLElement;
    const mono = screen.getByRole("menuitem", { name: "等宽" }).querySelector(
      ".ui-menu__label",
    ) as HTMLElement;

    expect(times.style.fontFamily).toContain("Times New Roman");
    expect(mono.style.fontFamily).toContain("Cascadia Mono");
  });

  it("keeps every option visually distinct", async () => {
    renderEntry({ defaultLatin: "system", defaultCjk: "system" });
    await openMenu();

    const stacks = screen
      .getAllByRole("menuitem")
      .map((i) => (i.querySelector(".ui-menu__label") as HTMLElement).style.fontFamily);
    // 每一项都得能看出差别，否则这个选择列表没有意义。
    expect(new Set(stacks).size).toBe(stacks.length);
  });

  it("stays enabled with no selection, because it sets the font for what you type next", async () => {
    // 行为要求：没有选中文字时也要能改字体 —— 作用于后续输入。
    // 因此按钮**不能**禁用（早先版本禁用是错的）。
    renderEntry();
    const btn = screen.getByRole("button", { name: "字体" });
    expect(btn).toBeEnabled();

    await userEvent.click(btn);
    expect(screen.getByRole("menu", { name: "字体" })).toBeInTheDocument();
  });

  it("explains what setting a font without a selection does", async () => {
    renderEntry();
    await userEvent.hover(screen.getByRole("button", { name: "字体" }));
    expect(await screen.findByText(/接下来输入/)).toBeInTheDocument();
  });

  it("offers no clear item when the selection has no font", async () => {
    renderEntry({ hasFont: false });
    await openMenu();
    expect(screen.queryByRole("menuitem", { name: "清除字体" })).not.toBeInTheDocument();
  });

  it("offers a clear item when the selection already has a font", async () => {
    renderEntry({ hasFont: true });
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "清除字体" })).toBeInTheDocument();
  });

  it("reports clear through the dropdown", async () => {
    renderEntry({ hasFont: true });
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "清除字体" }));
    expect(cleared).toBe(1);
  });

  it("closes on Escape", async () => {
    renderEntry();
    await openMenu();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes when clicking outside", async () => {
    renderEntry();
    await openMenu();
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
