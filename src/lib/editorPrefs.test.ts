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

  it("defaults to the system font", () => {
    expect(DEFAULT_FONT_FAMILY).toBe("system");
  });

  it("reads a valid stored family", () => {
    expect(readStoredFontFamily("system")).toBe("system");
    expect(readStoredFontFamily("simsun")).toBe("simsun");
    expect(readStoredFontFamily("mono")).toBe("mono");
  });

  it("accepts every family it advertises", () => {
    // 选项列表与校验逻辑必须一致：漏一个会导致选中后立刻被重置。
    for (const family of EDITOR_FONT_FAMILIES) {
      expect(readStoredFontFamily(family)).toBe(family);
    }
  });

  it("falls back for missing or junk values", () => {
    expect(readStoredFontFamily(null)).toBe(DEFAULT_FONT_FAMILY);
    expect(readStoredFontFamily("")).toBe(DEFAULT_FONT_FAMILY);
    expect(readStoredFontFamily("Comic Sans")).toBe(DEFAULT_FONT_FAMILY);
  });

  it("migrates the old abstract categories instead of resetting them", () => {
    // 旧版本存的是 sans/serif/mono。不做迁移的话老用户重启后
    // 会发现字体被重置 —— 体感就是「我的设置丢了」。
    expect(readStoredFontFamily("serif")).toBe("simsun");
    expect(readStoredFontFamily("sans")).toBe("system");
    // mono 在新旧模型里同名，保持原值。
    expect(readStoredFontFamily("mono")).toBe("mono");
  });

  it("defines a font stack for every family", () => {
    for (const family of EDITOR_FONT_FAMILIES) {
      expect(FONT_FAMILY_STACK[family]?.length).toBeGreaterThan(0);
    }
  });

  it("names an explicit CJK font in every stack", () => {
    // §34.6：只写通用族（serif/sans-serif）时中文会落到系统默认字体，
    // 中文的衬线差别也不像西文那样直观 —— 设置等于失效。
    for (const family of EDITOR_FONT_FAMILIES) {
      const stack = FONT_FAMILY_STACK[family];
      expect(stack).toMatch(/YaHei|PingFang|Noto|Songti|SimSun|SimHei|KaiTi|FangSong|Han|Heiti/);
    }
  });

  it("keeps every stack distinct so switching actually changes rendering", () => {
    const stacks = EDITOR_FONT_FAMILIES.map((f) => FONT_FAMILY_STACK[f]);
    expect(new Set(stacks).size).toBe(EDITOR_FONT_FAMILIES.length);
  });

  it("ends each stack with a generic family as last resort", () => {
    // 字体缺失时由 CSS 沿栈继续回退，这是浏览器原生行为，
    // 比自己探测字体可用性可靠（实测 System.Drawing 会漏报 SimSun/SimHei）。
    for (const family of EDITOR_FONT_FAMILIES) {
      expect(FONT_FAMILY_STACK[family]).toMatch(/(sans-serif|serif|monospace)\s*$/);
    }
  });

  it("puts the named CJK face first in the CJK-specific stacks", () => {
    // 「宋体」这一项首先得真的是宋体，否则用户选了却看不出变化。
    expect(FONT_FAMILY_STACK.simsun.startsWith("SimSun")).toBe(true);
    expect(FONT_FAMILY_STACK.simhei.startsWith("SimHei")).toBe(true);
    expect(FONT_FAMILY_STACK.kaiti.startsWith("KaiTi")).toBe(true);
    expect(FONT_FAMILY_STACK.fangsong.startsWith("FangSong")).toBe(true);
    // 微软雅黑的正式名是 "Microsoft YaHei UI"（Windows 上优先它）。
    expect(FONT_FAMILY_STACK.yahei).toContain("Microsoft YaHei");
  });

  it("leads the Times New Roman stack with Times New Roman", () => {
    expect(FONT_FAMILY_STACK.times.startsWith('"Times New Roman"')).toBe(true);
  });

  it("writes the stack to a CSS variable so the editor updates without rebuild", () => {
    applyFontFamily("simsun");
    expect(document.documentElement.style.getPropertyValue("--editor-font-family")).toBe(
      FONT_FAMILY_STACK.simsun,
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

describe("editor font size", () => {
  it("accepts every size it advertises", () => {
    for (const size of EDITOR_FONT_SIZES) {
      expect(readStoredFontSize(size)).toBe(size);
    }
  });

  it("has an increasing pixel value per step", () => {
    // 档位必须单调递增，否则「特大」比「大」还小。
    const px = EDITOR_FONT_SIZES.map((s) => FONT_SIZE_PX[s]);
    for (let i = 1; i < px.length; i += 1) {
      expect(px[i]).toBeGreaterThan(px[i - 1]);
    }
  });
});
