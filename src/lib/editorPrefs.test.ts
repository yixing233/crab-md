import { describe, expect, it, beforeEach } from "vitest";
import {
  applyFontFamily,
  applyFontSize,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  EDITOR_FONT_FAMILIES,
  EDITOR_FONT_SIZES,
  FONT_FAMILY_STACK,
  FONT_SIZE_PX,
  readStoredFontFamily,
  readStoredFontSize,
} from "./editorPrefs";

describe("editor font size", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--editor-font-size");
  });

  it("defaults to medium", () => {
    expect(DEFAULT_FONT_SIZE).toBe("md");
  });

  it("reads a valid stored size", () => {
    expect(readStoredFontSize("sm")).toBe("sm");
    expect(readStoredFontSize("md")).toBe("md");
    expect(readStoredFontSize("lg")).toBe("lg");
  });

  it("falls back for missing or junk values", () => {
    // 存档可能被旧版本或手工改过。
    expect(readStoredFontSize(null)).toBe(DEFAULT_FONT_SIZE);
    expect(readStoredFontSize("")).toBe(DEFAULT_FONT_SIZE);
    expect(readStoredFontSize("MD")).toBe(DEFAULT_FONT_SIZE);
    expect(readStoredFontSize("huge")).toBe(DEFAULT_FONT_SIZE);
  });

  it("defines a pixel value for every size", () => {
    // 新增档位时若忘了配像素值，这里会失败而不是渲染出 undefined。
    for (const size of EDITOR_FONT_SIZES) {
      expect(FONT_SIZE_PX[size]).toBeGreaterThan(0);
    }
  });

  it("uses larger pixels for larger sizes", () => {
    expect(FONT_SIZE_PX.sm).toBeLessThan(FONT_SIZE_PX.md);
    expect(FONT_SIZE_PX.md).toBeLessThan(FONT_SIZE_PX.lg);
  });

  it("writes the size to a CSS variable so CodeMirror updates without rebuild", () => {
    applyFontSize("lg");
    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("16px");

    applyFontSize("sm");
    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("13px");
  });

  it("falls back to the default pixels when asked for a junk size at runtime", () => {
    // 防御性：即便调用方传了非法值也不该写出 NaN。
    applyFontSize("nonsense" as never);
    const value = document.documentElement.style.getPropertyValue("--editor-font-size");
    expect(value).not.toContain("undefined");
    expect(value).not.toContain("NaN");
  });
});

describe("editor font family", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--editor-font-family");
  });

  it("defaults to sans", () => {
    expect(DEFAULT_FONT_FAMILY).toBe("sans");
  });

  it("reads a valid stored family", () => {
    expect(readStoredFontFamily("sans")).toBe("sans");
    expect(readStoredFontFamily("serif")).toBe("serif");
    expect(readStoredFontFamily("mono")).toBe("mono");
  });

  it("falls back for missing or junk values", () => {
    expect(readStoredFontFamily(null)).toBe(DEFAULT_FONT_FAMILY);
    expect(readStoredFontFamily("")).toBe(DEFAULT_FONT_FAMILY);
    expect(readStoredFontFamily("Comic Sans")).toBe(DEFAULT_FONT_FAMILY);
  });

  it("defines a font stack for every family", () => {
    for (const family of EDITOR_FONT_FAMILIES) {
      expect(FONT_FAMILY_STACK[family]?.length).toBeGreaterThan(0);
    }
  });

  it("names an explicit CJK font in every stack", () => {
    // 只写通用族（serif/sans-serif）时中文会落到系统默认字体，
    // 衬线与无衬线在中文上几乎看不出区别 —— 设置等于失效。
    for (const family of EDITOR_FONT_FAMILIES) {
      const stack = FONT_FAMILY_STACK[family];
      expect(stack).toMatch(/YaHei|PingFang|Noto|Songti|SimSun|Sarasa|Han/);
    }
  });

  it("keeps the three stacks distinct so switching actually changes rendering", () => {
    const stacks = EDITOR_FONT_FAMILIES.map((f) => FONT_FAMILY_STACK[f]);
    expect(new Set(stacks).size).toBe(EDITOR_FONT_FAMILIES.length);
  });

  it("ends each stack with a generic family as last resort", () => {
    for (const family of EDITOR_FONT_FAMILIES) {
      expect(FONT_FAMILY_STACK[family]).toMatch(/(sans-serif|serif|monospace)\s*$/);
    }
  });

  it("writes the stack to a CSS variable so the editor updates without rebuild", () => {
    applyFontFamily("serif");
    expect(document.documentElement.style.getPropertyValue("--editor-font-family")).toBe(
      FONT_FAMILY_STACK.serif,
    );

    applyFontFamily("mono");
    expect(document.documentElement.style.getPropertyValue("--editor-font-family")).toBe(
      FONT_FAMILY_STACK.mono,
    );
  });

  it("never writes an undefined stack for a junk value", () => {
    applyFontFamily("nonsense" as never);
    const value = document.documentElement.style.getPropertyValue("--editor-font-family");
    expect(value).not.toContain("undefined");
    expect(value.length).toBeGreaterThan(0);
  });
});
