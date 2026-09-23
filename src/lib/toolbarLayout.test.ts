import { describe, expect, it } from "vitest";
import {
  buildSlots,
  computeToolbarLayout,
  slotsWidth,
  TOOLBAR_ITEM_GAP,
  TOOLBAR_ITEM_WIDTH,
  TOOLBAR_SEPARATOR_WIDTH,
  type ToolbarSlot,
} from "./toolbarLayout";

/** 与真实工具栏同构的分组，用于验证真实布局行为。 */
const GROUPS: readonly (readonly string[])[] = [
  ["bold", "italic", "strikethrough", "inlineCode"],
  ["heading", "bulletList", "orderedList", "quote"],
  ["link", "image", "codeBlock"],
  ["table", "math", "mathBlock"],
];

const ALL = GROUPS.flat();

describe("buildSlots", () => {
  it("puts one separator between groups, not before the first", () => {
    const slots = buildSlots([["a", "b"], ["c"]]);
    expect(slots).toEqual([
      { kind: "action", id: "a" },
      { kind: "action", id: "b" },
      { kind: "separator" },
      { kind: "action", id: "c" },
    ]);
  });

  it("never emits two separators in a row", () => {
    // 空组若照旧插竖线，就会出现相连的两条 —— 明显的排版瑕疵。
    const slots = buildSlots([["a"], [], ["b"]]);
    const kinds = slots.map((s) => s.kind);
    expect(kinds).toEqual(["action", "separator", "action"]);
  });

  it("does not start with a separator", () => {
    const slots = buildSlots([[], ["a"]]);
    expect(slots[0]).toEqual({ kind: "action", id: "a" });
  });

  it("returns nothing for all-empty groups", () => {
    expect(buildSlots([[], []])).toEqual([]);
  });
});

describe("slotsWidth", () => {
  it("accounts for gaps between items", () => {
    const slots: ToolbarSlot<string>[] = [
      { kind: "action", id: "a" },
      { kind: "action", id: "b" },
    ];
    // 两个按钮 + 一个 gap。
    expect(slotsWidth(slots)).toBe(TOOLBAR_ITEM_WIDTH * 2 + TOOLBAR_ITEM_GAP);
  });

  it("counts a separator narrower than an action", () => {
    const slots: ToolbarSlot<string>[] = [
      { kind: "action", id: "a" },
      { kind: "separator" },
    ];
    expect(slotsWidth(slots)).toBe(TOOLBAR_ITEM_WIDTH + TOOLBAR_ITEM_GAP + TOOLBAR_SEPARATOR_WIDTH);
    expect(TOOLBAR_SEPARATOR_WIDTH).toBeLessThan(TOOLBAR_ITEM_WIDTH);
  });

  it("is zero for no slots", () => {
    expect(slotsWidth([])).toBe(0);
  });
});

describe("computeToolbarLayout", () => {
  it("shows everything when the width is unknown", () => {
    // jsdom 与首帧量不到宽度：宁可多显示，也不能凭 0 误收起。
    for (const w of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = computeToolbarLayout(GROUPS, w);
      expect(out.overflow, `width=${w}`).toEqual([]);
      expect(out.visible.filter((s) => s.kind === "action")).toHaveLength(ALL.length);
    }
  });

  it("shows everything when it fits exactly", () => {
    const exact = slotsWidth(buildSlots(GROUPS));
    const out = computeToolbarLayout(GROUPS, exact);
    expect(out.overflow).toEqual([]);
    expect(out.visible).toEqual(buildSlots(GROUPS));
  });

  it("moves the tail into the more menu when it does not fit", () => {
    // 留出大约「12 个按钮」的宽度 —— 末尾几个应被收起。
    const out = computeToolbarLayout(GROUPS, TOOLBAR_ITEM_WIDTH * 12);
    expect(out.overflow.length).toBeGreaterThan(0);
    // 被收起的一定是排在后面的动作，而不是中间挖空。
    const visibleIds = out.visible
      .filter((s): s is { kind: "action"; id: string } => s.kind === "action")
      .map((s) => s.id);
    expect(visibleIds).toEqual(ALL.slice(0, visibleIds.length));
  });

  it("never loses an action: visible + overflow is exactly the input set", () => {
    // 这是本功能最重要的性质 —— 折叠不能把某个动作弄丢。
    for (const width of [TOOLBAR_ITEM_WIDTH * 3, 200, 300, 400, 460, 600]) {
      const out = computeToolbarLayout(GROUPS, width);
      const visibleIds = out.visible
        .filter((s): s is { kind: "action"; id: string } => s.kind === "action")
        .map((s) => s.id);
      const combined = [...visibleIds, ...out.overflow].sort();
      expect(combined, `width=${width}`).toEqual([...ALL].sort());
    }
  });

  it("does not duplicate an action across visible and overflow", () => {
    for (const width of [120, 200, 300, 420]) {
      const out = computeToolbarLayout(GROUPS, width);
      const visibleIds = out.visible
        .filter((s): s is { kind: "action"; id: string } => s.kind === "action")
        .map((s) => s.id);
      const overlap = visibleIds.filter((id) => out.overflow.includes(id));
      expect(overlap, `width=${width}`).toEqual([]);
    }
  });

  it("keeps the visible row within the available width, including the more button", () => {
    // 折叠后若仍然放不下，就等于换行了 —— 那正是要避免的。
    for (const width of [150, 200, 260, 320, 400]) {
      const out = computeToolbarLayout(GROUPS, width);
      if (out.overflow.length === 0) continue;
      const used = slotsWidth(out.visible) + TOOLBAR_ITEM_WIDTH + TOOLBAR_ITEM_GAP;
      expect(used, `width=${width}`).toBeLessThanOrEqual(width);
    }
  });

  it("collapses progressively as the width shrinks", () => {
    // 宽度越小，收起得越多（单调性）。
    const widths = [600, 500, 400, 300, 220, 160];
    const counts = widths.map((w) => computeToolbarLayout(GROUPS, w).overflow.length);
    for (let i = 1; i < counts.length; i += 1) {
      expect(counts[i], `${widths[i]} vs ${widths[i - 1]}`).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });

  it("collapses everything but still offers them in the menu when very narrow", () => {
    // 极窄时行内一个都放不下，但动作必须仍可从菜单取用。
    const out = computeToolbarLayout(GROUPS, 30);
    expect(out.overflow).toEqual(ALL);
    const visibleIds = out.visible.filter((s) => s.kind === "action");
    expect(visibleIds).toEqual([]);
  });

  it("drops separators that lose their group when collapsing", () => {
    // 70px：放得下一个动作 + 「更多」（28 + 32 = 60），放不下两个（92）。
    // 此时只剩第一个动作，前面不该留一条孤零零的竖线。
    const out = computeToolbarLayout(GROUPS, 70);
    expect(out.overflow.length).toBeGreaterThan(0);
    expect(out.visible[0]?.kind).toBe("action");
    expect(out.visible[out.visible.length - 1]?.kind).not.toBe("separator");
    // 该序列里根本不该有任何竖线 —— 只有一个分组存活。
    expect(out.visible.some((s) => s.kind === "separator")).toBe(false);
  });

  it("handles a single group without needing separators", () => {
    const out = computeToolbarLayout([["bold", "italic"]], slotsWidth(buildSlots([["bold", "italic"]])));
    expect(out.overflow).toEqual([]);
    expect(out.visible.every((s) => s.kind === "action")).toBe(true);
  });

  it("handles empty groups", () => {
    const out = computeToolbarLayout([], 200);
    expect(out).toEqual({ visible: [], overflow: [] });
  });

  it("reserves room for the more button when the last item would not fit", () => {
    // 差一点点就放得下时，仍应收起 —— 否则「更多」按钮自己会把行撑出去。
    const withoutMore = slotsWidth(buildSlots(GROUPS));
    const out = computeToolbarLayout(GROUPS, withoutMore - 1);
    expect(out.overflow.length).toBeGreaterThan(0);
  });
});
