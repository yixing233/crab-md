import { describe, expect, it } from "vitest";
import { focusedParagraphRange, typewriterScrollDelta } from "./writingMode";

describe("typewriterScrollDelta", () => {
  const scrollerTop = 100;
  const viewportHeight = 500;

  it("scrolls the caret line up to the anchor fraction of the viewport", () => {
    // 光标在 460px（视口底部）；锚点 38% → 目标 100 + 190 = 290。
    expect(typewriterScrollDelta(460, scrollerTop, viewportHeight)).toBe(170);
  });

  it("scrolls back down when the caret climbs above the anchor", () => {
    // 光标在 160px（锚点之上）→ 负增量，视口下移。
    expect(typewriterScrollDelta(160, scrollerTop, viewportHeight)).toBe(-130);
  });

  it("returns 0 within the 2px tolerance", () => {
    expect(typewriterScrollDelta(290.5, scrollerTop, viewportHeight)).toBe(0);
    expect(typewriterScrollDelta(291.5, scrollerTop, viewportHeight)).toBe(0);
    expect(typewriterScrollDelta(292.5, scrollerTop, viewportHeight)).not.toBe(0);
  });
});

describe("focusedParagraphRange", () => {
  it("expands to the blank-line-delimited block around the caret", () => {
    const lines = ["第一段 a", "第一段 b", "", "第二段 a", "第二段 b", "第二段 c", "", "尾部"];
    expect(focusedParagraphRange(lines, 4)).toEqual([3, 5]);
    expect(focusedParagraphRange(lines, 0)).toEqual([0, 1]);
    expect(focusedParagraphRange(lines, 7)).toEqual([7, 7]);
  });

  it("treats whitespace-only lines as block boundaries", () => {
    const lines = ["a", "   ", "b"];
    expect(focusedParagraphRange(lines, 2)).toEqual([2, 2]);
  });

  it("returns null for empty documents and out-of-range carets", () => {
    expect(focusedParagraphRange([], 0)).toBeNull();
    expect(focusedParagraphRange(["a"], -1)).toBeNull();
    expect(focusedParagraphRange(["a"], 1)).toBeNull();
  });
});
