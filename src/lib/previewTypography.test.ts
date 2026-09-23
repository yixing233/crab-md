import { beforeEach, describe, expect, it } from "vitest";
import {
  applyPreviewTypography,
  clampSize,
  composePreviewFontStack,
  defaultPreviewTypography,
  isPreviewElement,
  normalizeTypography,
  parseStoredTypography,
  PREVIEW_DEFAULT_TYPOGRAPHY,
  PREVIEW_ELEMENTS,
  PREVIEW_LATIN_STACK,
  PREVIEW_SIZE_RANGE,
  PREVIEW_SIZE_STEPS,
  stepSizeDown,
  stepSizeUp,
} from "./previewTypography";
import { EDITOR_LATIN_FONTS } from "./editorPrefs";

describe("preview elements", () => {
  it("covers the element categories the user asked for", () => {
    // 正文 + 六个标题层级 + 代码 + 引用 + 表格 + 公式。
    for (const id of ["body", "h1", "h2", "h3", "h4", "h5", "h6", "code", "quote", "table", "math"] as const) {
      expect(PREVIEW_ELEMENTS).toContain(id);
    }
    expect(PREVIEW_ELEMENTS).toHaveLength(11);
  });

  it("gives every element its own default typography", () => {
    for (const id of PREVIEW_ELEMENTS) {
      expect(PREVIEW_DEFAULT_TYPOGRAPHY[id]).toBeDefined();
      expect(PREVIEW_DEFAULT_TYPOGRAPHY[id].sizePx).toBeGreaterThan(0);
    }
  });

  it("makes headings strictly smaller as the level deepens", () => {
    // 层级差是标题可读性的核心；一旦某级比上一级大，视觉层级就乱了。
    const sizes = (["h1", "h2", "h3", "h4", "h5", "h6"] as const).map(
      (id) => PREVIEW_DEFAULT_TYPOGRAPHY[id].sizePx,
    );
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i], `h${i + 1} must be smaller than h${i}`).toBeLessThan(sizes[i - 1]);
    }
  });

  it("keeps h1 above body so the title stands out", () => {
    expect(PREVIEW_DEFAULT_TYPOGRAPHY.h1.sizePx).toBeGreaterThan(
      PREVIEW_DEFAULT_TYPOGRAPHY.body.sizePx,
    );
  });

  it("identifies known element ids only", () => {
    expect(isPreviewElement("body")).toBe(true);
    expect(isPreviewElement("math")).toBe(true);
    expect(isPreviewElement("h7")).toBe(false);
    expect(isPreviewElement("")).toBe(false);
  });
});

describe("preview Latin stack", () => {
  it("never contains system-ui for any choice", () => {
    // 关键回归：system-ui 在 Windows 上即微软雅黑，自带拉丁与汉字两套字形，
    // 排栈首会把两个方向一起吃掉（实测：选了字体却毫无变化）。
    for (const latin of EDITOR_LATIN_FONTS) {
      expect(PREVIEW_LATIN_STACK[latin], latin).not.toContain("system-ui");
    }
  });

  it("never contains system-ui in the composed stack either", () => {
    for (const latin of EDITOR_LATIN_FONTS) {
      for (const cjk of ["system", "yahei", "simsun", "kaiti"] as const) {
        expect(composePreviewFontStack(latin, cjk)).not.toContain("system-ui");
      }
    }
  });

  it("puts the Latin face before the CJK face", () => {
    // 实测：拉丁在前时拉丁走拉丁字体、汉字穿透到中文字体，两边都生效。
    const stack = composePreviewFontStack("times", "simsun");
    expect(stack.indexOf("Times New Roman")).toBeLessThan(stack.indexOf("SimSun"));
  });

  it("names a concrete CJK face so Chinese does not fall back to system default", () => {
    for (const cjk of ["yahei", "simhei", "simsun", "kaiti", "fangsong"] as const) {
      expect(composePreviewFontStack("system", cjk)).toMatch(
        /YaHei|SimHei|SimSun|KaiTi|FangSong/,
      );
    }
  });

  it("ends with a generic family matching the CJK choice", () => {
    expect(composePreviewFontStack("system", "simsun")).toMatch(/serif$/);
    expect(composePreviewFontStack("system", "kaiti")).toMatch(/serif$/);
    expect(composePreviewFontStack("system", "yahei")).toMatch(/sans-serif$/);
  });
});

describe("clampSize", () => {
  it("snaps to a value on the step ladder", () => {
    const v = clampSize("body", 15.4);
    expect(PREVIEW_SIZE_STEPS).toContain(v);
  });

  it("respects the per-element range", () => {
    // 正文不该被压到 4px，标题也不该被放到 900px。
    expect(clampSize("body", 4)).toBeGreaterThanOrEqual(PREVIEW_SIZE_RANGE.body.min);
    expect(clampSize("h1", 900)).toBeLessThanOrEqual(PREVIEW_SIZE_RANGE.h1.max);
  });

  it("falls back to the default for junk", () => {
    expect(clampSize("body", Number.NaN)).toBe(PREVIEW_DEFAULT_TYPOGRAPHY.body.sizePx);
    expect(clampSize("body", "16" as never)).toBe(PREVIEW_DEFAULT_TYPOGRAPHY.body.sizePx);
    expect(clampSize("body", null)).toBe(PREVIEW_DEFAULT_TYPOGRAPHY.body.sizePx);
  });

  it("never returns a value outside the element range", () => {
    // 先夹后对齐：否则对齐可能把值送回区间外。
    for (const id of PREVIEW_ELEMENTS) {
      const { min, max } = PREVIEW_SIZE_RANGE[id];
      for (const raw of [-100, 0, 5, 50, 500, 1e9]) {
        const v = clampSize(id, raw);
        expect(v, `${id} <- ${raw}`).toBeGreaterThanOrEqual(min);
        expect(v, `${id} <- ${raw}`).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe("stepSizeUp / stepSizeDown", () => {
  it("moves exactly one step at a time", () => {
    const start = clampSize("body", 16);
    const up = stepSizeUp("body", start);
    expect(up).toBeGreaterThan(start);
    expect(PREVIEW_SIZE_STEPS.indexOf(up)).toBe(PREVIEW_SIZE_STEPS.indexOf(start) + 1);
  });

  it("is reversible", () => {
    const start = clampSize("body", 16);
    expect(stepSizeDown("body", stepSizeUp("body", start))).toBe(start);
  });

  it("stops at the element's maximum instead of running past it", () => {
    const max = PREVIEW_SIZE_RANGE.body.max;
    const atMax = clampSize("body", max);
    expect(stepSizeUp("body", atMax)).toBe(atMax);
  });

  it("stops at the element's minimum", () => {
    const min = PREVIEW_SIZE_RANGE.body.min;
    const atMin = clampSize("body", min);
    expect(stepSizeDown("body", atMin)).toBe(atMin);
  });

  it("keeps stepping monotonic across the whole range", () => {
    let v = PREVIEW_SIZE_RANGE.h1.min;
    const seen = [v];
    for (let i = 0; i < 30; i += 1) {
      const next = stepSizeUp("h1", v);
      if (next === v) break;
      expect(next).toBeGreaterThan(v);
      v = next;
      seen.push(v);
    }
    expect(v).toBeLessThanOrEqual(PREVIEW_SIZE_RANGE.h1.max);
    expect(seen.length).toBeGreaterThan(1);
  });
});

describe("normalizeTypography", () => {
  it("returns defaults for null", () => {
    expect(normalizeTypography("body", null)).toEqual(PREVIEW_DEFAULT_TYPOGRAPHY.body);
  });

  it("keeps a valid CJK font", () => {
    const t = normalizeTypography("body", { cjkFont: "kaiti", sizePx: 18 });
    expect(t.cjkFont).toBe("kaiti");
    expect(t.sizePx).toBe(18);
  });

  it("rejects an unknown CJK font instead of writing it to CSS", () => {
    // 手改 localStorage 或旧版本遗留都可能带来非法值。
    const t = normalizeTypography("body", { cjkFont: "Comic Sans" as never, sizePx: 16 });
    expect(t.cjkFont).toBe(PREVIEW_DEFAULT_TYPOGRAPHY.body.cjkFont);
  });

  it("clamps an out-of-range size", () => {
    expect(normalizeTypography("body", { sizePx: 999 }).sizePx).toBeLessThanOrEqual(
      PREVIEW_SIZE_RANGE.body.max,
    );
  });
});

describe("parseStoredTypography", () => {
  it("returns defaults for null or junk", () => {
    expect(parseStoredTypography(null)).toEqual(defaultPreviewTypography());
    expect(parseStoredTypography("not json")).toEqual(defaultPreviewTypography());
    expect(parseStoredTypography("[1,2,3]")).toEqual(defaultPreviewTypography());
  });

  it("round-trips a stored value", () => {
    const t = defaultPreviewTypography();
    t.h1 = { cjkFont: "simhei", sizePx: 34 };
    t.code = { cjkFont: "mono" as never, sizePx: 13 };
    const back = parseStoredTypography(JSON.stringify(t));
    expect(back.h1).toEqual({ cjkFont: "simhei", sizePx: 34 });
    // code 的 cjkFont 非法 -> 只该项回退，其余保留。
    expect(back.code.sizePx).toBe(13);
  });

  it("keeps the good entries when one entry is broken", () => {
    // 整份丢弃会让用户所有设置一起回到默认，代价太大。
    const raw = JSON.stringify({ body: { cjkFont: "kaiti", sizePx: 17 }, h1: "garbage" });
    const back = parseStoredTypography(raw);
    expect(back.body).toEqual({ cjkFont: "kaiti", sizePx: 17 });
    expect(back.h1).toEqual(PREVIEW_DEFAULT_TYPOGRAPHY.h1);
  });

  it("fills in elements missing from the stored value", () => {
    const back = parseStoredTypography(JSON.stringify({ body: { sizePx: 18 } }));
    for (const id of PREVIEW_ELEMENTS) {
      expect(back[id], id).toBeDefined();
    }
    expect(back.body.sizePx).toBe(18);
  });
});

describe("applyPreviewTypography", () => {
  beforeEach(() => {
    const root = document.documentElement;
    for (const id of PREVIEW_ELEMENTS) {
      root.style.removeProperty(`--preview-font-${id}`);
      root.style.removeProperty(`--preview-size-${id}`);
    }
  });

  it("writes a font and a size variable for every element", () => {
    applyPreviewTypography("times", defaultPreviewTypography());
    const root = document.documentElement;
    for (const id of PREVIEW_ELEMENTS) {
      expect(root.style.getPropertyValue(`--preview-font-${id}`), id).not.toBe("");
      expect(root.style.getPropertyValue(`--preview-size-${id}`), id).toMatch(/^\d+px$/);
    }
  });

  it("reflects the per-element CJK choice in that element's variable", () => {
    const t = defaultPreviewTypography();
    t.h1 = { cjkFont: "simhei", sizePx: 30 };
    t.body = { cjkFont: "kaiti", sizePx: 16 };
    applyPreviewTypography("system", t);

    const root = document.documentElement;
    expect(root.style.getPropertyValue("--preview-font-h1")).toContain("SimHei");
    expect(root.style.getPropertyValue("--preview-font-body")).toContain("KaiTi");
    // 两类元素互不影响，这正是「分元素设置」的意义。
    expect(root.style.getPropertyValue("--preview-font-h1")).not.toContain("KaiTi");
  });

  it("applies the single Latin choice to every element", () => {
    applyPreviewTypography("times", defaultPreviewTypography());
    const root = document.documentElement;
    for (const id of PREVIEW_ELEMENTS) {
      expect(root.style.getPropertyValue(`--preview-font-${id}`), id).toContain(
        "Times New Roman",
      );
    }
  });

  it("writes the size with px units so CSS cannot misinterpret it", () => {
    const t = defaultPreviewTypography();
    t.math = { cjkFont: "system", sizePx: 22 };
    applyPreviewTypography("system", t);
    expect(document.documentElement.style.getPropertyValue("--preview-size-math")).toBe("22px");
  });

  it("falls back to defaults for a missing element instead of writing nothing", () => {
    const partial = { body: { cjkFont: "kaiti", sizePx: 18 } } as never;
    applyPreviewTypography("system", partial);
    expect(document.documentElement.style.getPropertyValue("--preview-size-h1")).toBe(
      `${PREVIEW_DEFAULT_TYPOGRAPHY.h1.sizePx}px`,
    );
  });
});

describe("size steps", () => {
  it("is sorted ascending so stepping has a well-defined direction", () => {
    for (let i = 1; i < PREVIEW_SIZE_STEPS.length; i += 1) {
      expect(PREVIEW_SIZE_STEPS[i]).toBeGreaterThan(PREVIEW_SIZE_STEPS[i - 1]);
    }
  });

  it("offers at least one step inside every element's range", () => {
    for (const id of PREVIEW_ELEMENTS) {
      const { min, max } = PREVIEW_SIZE_RANGE[id];
      const inside = PREVIEW_SIZE_STEPS.filter((s) => s >= min && s <= max);
      expect(inside.length, id).toBeGreaterThan(0);
      // 默认值本身也必须在区间内，否则一打开设置页就是越界状态。
      expect(PREVIEW_DEFAULT_TYPOGRAPHY[id].sizePx).toBeGreaterThanOrEqual(min);
      expect(PREVIEW_DEFAULT_TYPOGRAPHY[id].sizePx).toBeLessThanOrEqual(max);
    }
  });
});

/**
 * 变量名拼写检查。
 *
 * 这是本功能最容易静默失效的地方：`applyPreviewTypography` 写的是
 * `--preview-size-math`，CSS 里若写成 `--preview-font-maths`，
 * 编译、类型检查、单测全都照过，而设置就是没效果 —— 用户只会觉得
 * 「这个开关是坏的」。故直接在源码层面对齐两边的名字。
 *
 * （实测抓到过：`--preview-font-math` 曾只在写入侧存在。）
 */
describe("CSS variables are wired end to end", () => {
  const IDS = PREVIEW_ELEMENTS;

  it("references every font and size variable in the preview stylesheet", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cssPath = path.resolve(__dirname, "../components/editor/editor.css");
    const css = fs.readFileSync(cssPath, "utf8");

    const missing: string[] = [];
    for (const id of IDS) {
      for (const kind of ["font", "size"]) {
        const name = `--preview-${kind}-${id}`;
        if (!css.includes(name)) missing.push(name);
      }
    }
    expect(missing, `these variables are written but never used: ${missing.join(", ")}`).toEqual(
      [],
    );
  });

  it("does not reference variables that nothing writes", async () => {
    // 反向检查：CSS 引用了不存在的变量时，会落到兜底值，设置同样静默失效。
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cssPath = path.resolve(__dirname, "../components/editor/editor.css");
    const css = fs.readFileSync(cssPath, "utf8");

    const used = [...css.matchAll(/--preview-(font|size)-([a-z0-9]+)/g)].map((m) => m[0]);
    const expected = new Set(
      IDS.flatMap((id) => [`--preview-font-${id}`, `--preview-size-${id}`]),
    );
    for (const name of new Set(used)) {
      expect(expected.has(name), `CSS uses ${name}, which nothing writes`).toBe(true);
    }
  });

  it("uses the same number in the CSS fallback as the default size", async () => {
    // 变量由 JS 在挂载时写入，但样式表里的兜底值先于它生效。
    // 两边不一致时首帧会跳到另一个字号（可见的闪动），
    // 而且测试环境（不执行 apply）会一直用兜底值，掩盖真实默认。
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cssPath = path.resolve(__dirname, "../components/editor/editor.css");
    const css = fs.readFileSync(cssPath, "utf8");

    for (const id of IDS) {
      const m = css.match(new RegExp(`--preview-size-${id},\\s*(\\d+)px`));
      expect(m, `${id} has no numeric fallback in CSS`).not.toBeNull();
      expect(Number(m![1]), `${id} fallback must equal its default`).toBe(
        PREVIEW_DEFAULT_TYPOGRAPHY[id].sizePx,
      );
    }
  });
});
