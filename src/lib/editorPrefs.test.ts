import { describe, expect, it, beforeEach } from "vitest";
import {
  applyFontStack,
  applyFontSize,
  CJK_FACES,
  composeFontStack,
  DEFAULT_CJK_FONT,
  DEFAULT_FONT_SIZE,
  DEFAULT_LATIN_FONT,
  EDITOR_CJK_FONTS,
  EDITOR_FONT_FAMILY_IDS,
  EDITOR_FONT_SIZES,
  EDITOR_LATIN_FONTS,
  FONT_SIZE_PX,
  isCjkFontId,
  isLatinFontId,
  LATIN_FACES,
  migrateLegacyFontPreset,
  previewStack,
  readStoredCjkFont,
  readStoredFontSize,
  readStoredLatinFont,
} from "./editorPrefs";

describe("editor font size", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--editor-font-size");
  });

  it("defaults to md", () => {
    expect(DEFAULT_FONT_SIZE).toBe("md");
  });

  it("reads valid sizes and rejects junk", () => {
    for (const size of EDITOR_FONT_SIZES) {
      expect(readStoredFontSize(size)).toBe(size);
    }
    expect(readStoredFontSize(null)).toBe(DEFAULT_FONT_SIZE);
    expect(readStoredFontSize("huge")).toBe(DEFAULT_FONT_SIZE);
  });

  it("writes px to the CSS variable so the editor needs no rebuild", () => {
    applyFontSize("xl");
    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe(
      `${FONT_SIZE_PX.xl}px`,
    );
  });

  it("has an increasing pixel value per step", () => {
    const px = EDITOR_FONT_SIZES.map((s) => FONT_SIZE_PX[s]);
    for (let i = 1; i < px.length; i += 1) {
      expect(px[i]).toBeGreaterThan(px[i - 1]);
    }
  });

  it("never writes undefined for a junk value", () => {
    applyFontSize("nonsense" as never);
    const v = document.documentElement.style.getPropertyValue("--editor-font-size");
    expect(v).not.toContain("undefined");
    expect(v.length).toBeGreaterThan(0);
  });
});

describe("composeFontStack (Chinese and Latin set separately)", () => {
  it("puts a explicitly chosen Latin face before the CJK face", () => {
    // 用户显式选过西文字体时，西文排前 —— 中文字形仍会沿栈回退。
    const stack = composeFontStack("times", "simsun");
    expect(stack.indexOf("Times New Roman")).toBeLessThan(stack.indexOf("SimSun"));
  });

  it("puts the CJK face first when the Latin choice is still the default", () => {
    // 关键回归（实测缺陷）：西文为「系统默认」时栈首是 system-ui，
    // 它在 Windows 上是微软雅黑，**自带完整拉丁字形**，会把整个栈吃掉 ——
    // 像素比对证实选「楷体」后中文/数字/混排三种内容渲染结果与 system-ui
    // 完全一致，用户选的字体一个字符都没生效。故此时必须让中文排前。
    const stack = composeFontStack("system", "kaiti");
    expect(stack.indexOf("KaiTi")).toBeLessThan(stack.indexOf("system-ui"));
  });

  it("makes the chosen CJK font actually win when Latin is default", () => {
    // 上面那条的实质要求：中文字形必须在任何西文/系统字形之前，
    // 否则「选了却没变化」。这里断言所有中文字体都满足。
    for (const cjk of EDITOR_CJK_FONTS) {
      const stack = composeFontStack("system", cjk);
      const generic = /, (sans-serif|serif|monospace)$/.exec(stack);
      const body = generic ? stack.slice(0, generic.index) : stack;
      // 第一个出现的具名字形必须来自 CJK 表。
      const firstCjkAt = body.indexOf(CJK_FACES[cjk].split(",")[0].trim());
      const firstLatinAt = body.indexOf(LATIN_FACES.system.split(",")[0].trim());
      expect(firstCjkAt, `CJK face not leading for ${cjk}`).toBe(0);
      expect(firstLatinAt).toBeGreaterThan(0);
    }
  });

  it("includes both chosen faces", () => {
    const stack = composeFontStack("georgia", "kaiti");
    expect(stack).toContain("Georgia");
    expect(stack).toContain("KaiTi");
  });

  it("ends with a generic family as last resort", () => {
    for (const latin of EDITOR_LATIN_FONTS) {
      for (const cjk of EDITOR_CJK_FONTS) {
        expect(composeFontStack(latin, cjk)).toMatch(/(sans-serif|serif|monospace)\s*$/);
      }
    }
  });

  it("names an explicit CJK face in every combination (UI §34.6)", () => {
    // 只写通用族时中文会落到系统默认字体，设置等于失效。
    for (const latin of EDITOR_LATIN_FONTS) {
      for (const cjk of EDITOR_CJK_FONTS) {
        expect(composeFontStack(latin, cjk)).toMatch(
          /YaHei|PingFang|Noto|Songti|SimSun|SimHei|KaiTi|FangSong|Han|Heiti/,
        );
      }
    }
  });

  it("uses a serif generic when the CJK choice is a serif face", () => {
    // 通用族跟着中文字体走，否则兜底时字形会突然从衬线跳到无衬线。
    expect(composeFontStack("system", "simsun")).toMatch(/serif$/);
    expect(composeFontStack("system", "kaiti")).toMatch(/serif$/);
    expect(composeFontStack("system", "yahei")).toMatch(/sans-serif$/);
  });

  it("falls back to defaults for junk ids", () => {
    const stack = composeFontStack("nope" as never, "nope" as never);
    expect(stack).toBe(composeFontStack(DEFAULT_LATIN_FONT, DEFAULT_CJK_FONT));
  });
});

describe("previewStack (font picker labels)", () => {
  it("puts the CJK face first when previewing a CJK option", () => {
    // 关键回归：标签文字是中文（「宋体」），若合成栈里西文排前面，
    // 「系统默认」的 system-ui 自带汉字字形，会把六个中文选项全渲染成
    // 同一种字体 —— 选择列表看起来毫无区别（实测缺陷）。
    const stack = previewStack("system", "simsun", "cjk");
    expect(stack.startsWith("SimSun")).toBe(true);
  });

  it("does not include the Latin face at all when previewing a CJK option", () => {
    // CJK 预览刻意**不含**西文字形：标签是中文，混入西文只会干扰判断。
    const stack = previewStack("times", "kaiti", "cjk");
    expect(stack).not.toContain("Times New Roman");
    expect(stack.startsWith("KaiTi")).toBe(true);
  });

  it("keeps the Latin face first when previewing a Latin option", () => {
    const stack = previewStack("georgia", "simsun", "latin");
    expect(stack.startsWith("Georgia")).toBe(true);
  });

  it("names an explicit CJK face in both modes", () => {
    for (const cjk of EDITOR_CJK_FONTS) {
      expect(previewStack("system", cjk, "cjk")).toMatch(
        /YaHei|PingFang|Noto|Songti|SimSun|SimHei|KaiTi|FangSong|Heiti/,
      );
      expect(previewStack("system", cjk, "latin")).toMatch(
        /YaHei|PingFang|Noto|Songti|SimSun|SimHei|KaiTi|FangSong|Heiti/,
      );
    }
  });

  it("keeps every CJK preview distinct", () => {
    // 六个选项必须两两不同，否则列表无法区分。
    const stacks = EDITOR_CJK_FONTS.map((c) => previewStack("system", c, "cjk"));
    expect(new Set(stacks).size).toBe(EDITOR_CJK_FONTS.length);
  });

  it("ends with a generic family", () => {
    expect(previewStack("system", "simsun", "cjk")).toMatch(/serif$/);
    expect(previewStack("georgia", "simsun", "latin")).toMatch(/serif$/);
  });
});

describe("font preferences", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--editor-font-family");
  });

  it("defaults both directions to system", () => {
    expect(DEFAULT_LATIN_FONT).toBe("system");
    expect(DEFAULT_CJK_FONT).toBe("system");
  });

  it("accepts every font it advertises, per direction", () => {
    for (const f of EDITOR_LATIN_FONTS) expect(readStoredLatinFont(f)).toBe(f);
    for (const f of EDITOR_CJK_FONTS) expect(readStoredCjkFont(f)).toBe(f);
  });

  it("does not let one direction read the other's value", () => {
    // 「宋体」不是西文项，读西文时必须回退 —— 否则两处会串。
    expect(readStoredLatinFont("simsun")).toBe(DEFAULT_LATIN_FONT);
    // 「Georgia」不是中文项。
    expect(readStoredCjkFont("georgia")).toBe(DEFAULT_CJK_FONT);
  });

  it("falls back for null and junk", () => {
    expect(readStoredLatinFont(null)).toBe(DEFAULT_LATIN_FONT);
    expect(readStoredCjkFont(null)).toBe(DEFAULT_CJK_FONT);
    expect(readStoredLatinFont("Comic Sans")).toBe(DEFAULT_LATIN_FONT);
    expect(readStoredCjkFont("Comic Sans")).toBe(DEFAULT_CJK_FONT);
  });

  it("writes the composed stack to one CSS variable", () => {
    applyFontStack("times", "simsun");
    expect(document.documentElement.style.getPropertyValue("--editor-font-family")).toBe(
      composeFontStack("times", "simsun"),
    );
  });

  it("never writes undefined for junk", () => {
    applyFontStack("nope" as never, "nope" as never);
    const v = document.documentElement.style.getPropertyValue("--editor-font-family");
    expect(v).not.toContain("undefined");
    expect(v.length).toBeGreaterThan(0);
  });
});

describe("legacy preset migration", () => {
  it("splits the old single preset into (Latin, CJK)", () => {
    // 老用户只存过一个值。不迁移的话升级后字体看起来被重置了。
    expect(migrateLegacyFontPreset("serif")).toEqual(["times", "simsun"]);
    expect(migrateLegacyFontPreset("sans")).toEqual(["system", "system"]);
    expect(migrateLegacyFontPreset("mono")).toEqual(["mono", "system"]);
  });

  it("migrates the concrete presets from the previous round too", () => {
    expect(migrateLegacyFontPreset("kaiti")).toEqual(["system", "kaiti"]);
    expect(migrateLegacyFontPreset("yahei")).toEqual(["system", "yahei"]);
    expect(migrateLegacyFontPreset("times")).toEqual(["times", "simsun"]);
  });

  it("produces values that the readers accept", () => {
    // 迁移结果必须能通过校验，否则会被当成非法值再回退一次。
    for (const preset of ["sans", "serif", "mono", "kaiti", "yahei", "simhei", "fangsong", "times", "system"]) {
      const m = migrateLegacyFontPreset(preset);
      expect(m).not.toBeNull();
      expect(readStoredLatinFont(m![0])).toBe(m![0]);
      expect(readStoredCjkFont(m![1])).toBe(m![1]);
    }
  });

  it("returns null for null or unknown values", () => {
    expect(migrateLegacyFontPreset(null)).toBeNull();
    expect(migrateLegacyFontPreset("Comic Sans")).toBeNull();
  });
});

describe("font id classification", () => {
  it("classifies Latin and CJK ids correctly", () => {
    expect(isLatinFontId("times")).toBe(true);
    expect(isLatinFontId("mono")).toBe(true);
    expect(isLatinFontId("simsun")).toBe(false);

    expect(isCjkFontId("simsun")).toBe(true);
    expect(isCjkFontId("kaiti")).toBe(true);
    expect(isCjkFontId("georgia")).toBe(false);
  });

  it("treats 'system' as belonging to both directions", () => {
    // 「系统默认」在两个方向上都合法，故两个判定都应为真；
    // 派生类只需保证它总能被解析出栈即可。
    expect(isLatinFontId("system")).toBe(true);
    expect(isCjkFontId("system")).toBe(true);
  });

  it("covers every quick-bar id with a face definition", () => {
    // 快速条用一维 id 列表；每个 id 必须能解析成某个具名字形，
    // 否则点下去会得到空栈。
    for (const id of EDITOR_FONT_FAMILY_IDS) {
      const faces: string = isLatinFontId(id)
        ? LATIN_FACES[id as keyof typeof LATIN_FACES]
        : CJK_FACES[id as keyof typeof CJK_FACES];
      expect(faces, `no face for id ${id}`).toBeTruthy();
      expect(String(faces).length).toBeGreaterThan(0);
    }
  });
});
