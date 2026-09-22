import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW_MODE,
  nextViewMode,
  readStoredViewMode,
  showsEditor,
  showsPreview,
  VIEW_MODES,
} from "./viewMode";

describe("view mode", () => {
  it("defaults to split, matching the §11 baseline", () => {
    expect(DEFAULT_VIEW_MODE).toBe("split");
  });

  it("reads a valid stored mode", () => {
    expect(readStoredViewMode("edit")).toBe("edit");
    expect(readStoredViewMode("split")).toBe("split");
    expect(readStoredViewMode("preview")).toBe("preview");
  });

  it("falls back to the default for missing or junk values", () => {
    // 存档可能是旧版本写的、被手工改过、或是 null。
    expect(readStoredViewMode(null)).toBe(DEFAULT_VIEW_MODE);
    expect(readStoredViewMode("")).toBe(DEFAULT_VIEW_MODE);
    expect(readStoredViewMode("EDIT")).toBe(DEFAULT_VIEW_MODE);
    expect(readStoredViewMode("nonsense")).toBe(DEFAULT_VIEW_MODE);
  });

  it("cycles edit -> split -> preview -> edit", () => {
    expect(nextViewMode("edit")).toBe("split");
    expect(nextViewMode("split")).toBe("preview");
    // 回到起点，保证循环可无限按下去。
    expect(nextViewMode("preview")).toBe("edit");
  });

  it("visits every mode exactly once per full cycle", () => {
    const seen: string[] = [];
    let mode = DEFAULT_VIEW_MODE;
    for (let i = 0; i < VIEW_MODES.length; i++) {
      seen.push(mode);
      mode = nextViewMode(mode);
    }
    expect(new Set(seen).size).toBe(VIEW_MODES.length);
    // 走满一圈应回到起点。
    expect(mode).toBe(DEFAULT_VIEW_MODE);
  });

  it("hides the editor only in preview mode", () => {
    expect(showsEditor("edit")).toBe(true);
    expect(showsEditor("split")).toBe(true);
    expect(showsEditor("preview")).toBe(false);
  });

  it("hides the preview only in edit mode", () => {
    expect(showsPreview("edit")).toBe(false);
    expect(showsPreview("split")).toBe(true);
    expect(showsPreview("preview")).toBe(true);
  });

  it("never hides both panes at once", () => {
    // 三档都必须至少显示一栏，否则用户会看到空白界面。
    for (const mode of VIEW_MODES) {
      expect(showsEditor(mode) || showsPreview(mode)).toBe(true);
    }
  });
});
