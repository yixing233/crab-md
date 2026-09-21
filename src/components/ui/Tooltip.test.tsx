import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Tooltip, __resetTooltipGroupState } from "./Tooltip";

/**
 * 用真实计时器 + 短延迟，不用 vi.useFakeTimers。
 *
 * 原因：userEvent 的内部实现依赖计时器，与假计时器同用会互相卡住
 * （要么 hover 永不返回而超时，要么自动推进导致延迟断言失效）。
 * 这里延迟都取 20–40ms，既真实又足够快。
 */
describe("Tooltip", () => {
  beforeEach(() => {
    __resetTooltipGroupState();
  });

  it("does not render the bubble before hover", () => {
    render(
      <Tooltip content="加粗" delay={30}>
        <button>B</button>
      </Tooltip>,
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("waits for the delay before showing", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="加粗" delay={200}>
        <button>B</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button"));
    // 延迟未到就不该出现 —— 这正是原生 title 不可控、而我们要自己实现的原因。
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("加粗"));
  });

  it("hides the bubble on mouse leave", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="斜体" delay={20}>
        <button>I</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument());

    await user.unhover(screen.getByRole("button"));
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("shows on keyboard focus, so it is reachable without a mouse", async () => {
    render(
      <Tooltip content="标题" delay={10}>
        <button>H</button>
      </Tooltip>,
    );
    screen.getByRole("button").focus();
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("标题"));
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="链接" delay={10}>
        <button>L</button>
      </Tooltip>,
    );
    screen.getByRole("button").focus();
    await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("stays hidden when disabled", async () => {
    render(
      <Tooltip content="隐藏" delay={10} disabled>
        <button>X</button>
      </Tooltip>,
    );
    screen.getByRole("button").focus();
    // 给足时间仍不应出现。
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("renders via a portal on document.body, outside the parent stacking context", async () => {
    render(
      <div style={{ overflow: "hidden" }}>
        <Tooltip content="新建" delay={10}>
          <button>N</button>
        </Tooltip>
      </div>,
    );
    screen.getByRole("button").focus();
    await waitFor(() => expect(screen.getByRole("tooltip")).toBeInTheDocument());
    // 父级 overflow:hidden 不该把提示裁掉。
    expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
  });

  it("cancels a pending show when the pointer leaves before the delay elapses", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="删除线" delay={200}>
        <button>S</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button"));
    await user.unhover(screen.getByRole("button"));
    await new Promise((r) => setTimeout(r, 260));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows immediately for a sibling right after the previous one hid", async () => {
    // 工具栏里从左划过一排按钮时，第二个起不应再各等一次完整延迟。
    const user = userEvent.setup();
    render(
      <div>
        <Tooltip content="一" delay={300}>
          <button>One</button>
        </Tooltip>
        <Tooltip content="二" delay={300}>
          <button>Two</button>
        </Tooltip>
      </div>,
    );

    await user.hover(screen.getByRole("button", { name: "One" }));
    // 首次悬停必须等满延迟（组内状态已被重置）。
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("一"));

    await user.unhover(screen.getByRole("button", { name: "One" }));
    await user.hover(screen.getByRole("button", { name: "Two" }));

    // 组内快速切换：几乎立即出现，而不是再等 300ms。
    await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("二"), {
      timeout: 150,
    });
  });
});
