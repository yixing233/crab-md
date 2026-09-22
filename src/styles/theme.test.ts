import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 主题色阶回归（UI_DESIGN_SYSTEM.md §2.3、§4）。
 *
 * 背景：界面曾因为 `--bg-app` 与 `--bg-surface` 只差 2% 亮度而整体「发平」——
 * 纸/壳模型存在，但差距低于肉眼可分辨阈值。这组用例把「层级必须可感知」
 * 固定下来，避免以后调色时又被改回去。
 *
 * §4 允许色值在视觉调优中演进，因此这里断言的是**关系**（差值下限），
 * 不是某个具体十六进制值。
 */

const light = readFileSync(resolve(__dirname, "theme-light.css"), "utf8");
const dark = readFileSync(resolve(__dirname, "theme-dark.css"), "utf8");

/** 从 CSS 文本里取出某个变量的十六进制值。 */
function token(css: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`token --${name} not found`);
  return m[1];
}

/** 相对亮度（0–255），用于比较两级表面的明暗差。 */
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("theme surface hierarchy", () => {
  // 2% 亮度差是肉眼几乎不可见的阈值；实测 10 步左右才清晰可辨。
  const MIN_STEP = 8;

  // 注意：这里用「绝对差」断言语义为「可分辨」的关系，方向由下方
  // 各自的显式用例负责。两类关系方向不同 ——
  // 纸↔壳在明暗主题间是**反转**的，而浮层↔壳在两种主题下都是**更亮**。

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: paper and chrome are visually distinguishable", (_name, css) => {
    const paper = luminance(token(css as string, "bg-app"));
    const chrome = luminance(token(css as string, "bg-surface"));
    expect(Math.abs(paper - chrome)).toBeGreaterThanOrEqual(MIN_STEP);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: hover and active steps are perceivable", (_name, css) => {
    const surface = luminance(token(css as string, "bg-surface"));
    const hover = luminance(token(css as string, "bg-surface-hover"));
    const active = luminance(token(css as string, "bg-surface-active"));

    // 每级都要能分辨，否则状态反馈等于没有。
    expect(Math.abs(surface - hover)).toBeGreaterThanOrEqual(MIN_STEP);
    expect(Math.abs(hover - active)).toBeGreaterThanOrEqual(MIN_STEP);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: elevated surfaces separate from chrome", (_name, css) => {
    // 浮层（对话框/菜单）必须和它底下的壳区分开，否则浮不起来。
    const chrome = luminance(token(css as string, "bg-surface"));
    const elevated = luminance(token(css as string, "bg-elevated"));
    expect(Math.abs(elevated - chrome)).toBeGreaterThanOrEqual(MIN_STEP);
  });

  it("keeps elevated surfaces lighter than chrome in both themes", () => {
    // 浮层始终朝前景方向（更亮），明暗主题一致，不反转。
    for (const css of [light, dark]) {
      expect(luminance(token(css, "bg-elevated"))).toBeGreaterThan(
        luminance(token(css, "bg-surface")),
      );
    }
  });

  it("keeps chrome darker than paper in light theme (paper floats above)", () => {
    // 浅色下「纸」比「壳」亮：编辑器看起来是浮在壳上的一张纸。
    expect(luminance(token(light, "bg-app"))).toBeGreaterThan(
      luminance(token(light, "bg-surface")),
    );
    expect(luminance(token(light, "bg-app"))).toBeGreaterThan(
      luminance(token(light, "bg-surface-active")),
    );
  });

  it("inverts the scale in dark theme (nearer layers are lighter)", () => {
    // 暗色下无法再「更亮」，改为越靠前的层越亮 —— 与浅色主题相反。
    expect(luminance(token(dark, "bg-surface"))).toBeGreaterThan(
      luminance(token(dark, "bg-app")),
    );
    expect(luminance(token(dark, "bg-surface-active"))).toBeGreaterThan(
      luminance(token(dark, "bg-surface")),
    );
  });

  it("defines elevation tokens in both themes (UI §2.3 minimal shadow)", () => {
    for (const css of [light, dark]) {
      for (const name of ["shadow-sm", "shadow-md", "shadow-lg"]) {
        expect(css).toMatch(new RegExp(`--${name}:`));
      }
    }
  });
});

/**
 * 文字对比度回归（UI_DESIGN_SYSTEM.md §4、§39）。
 *
 * 背景：暗色主题的主按钮曾用 `--accent`(#3b82f6) 作底 + `--text-inverse`
 * (#1a1a1a) 作字 —— 4.73 勉强过 AA，但那是「深字压蓝底」，视觉发闷。
 * 把 `--accent` 换成 #2563eb 后白字只有 3.68，**反而违规**。根因是一个
 * token 兼任两种角色（前景强调 vs 实心底色），两者对亮度要求相反。
 *
 * 该组用例把「实心按钮底 + 其上文字」的对比度固定下来，
 * 避免以后调色时凭感觉改回不达标的值。
 */

/** WCAG 相对亮度。 */
function relLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度（1–21）。 */
function contrast(a: string, b: string): number {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("text contrast on solid buttons", () => {
  // 正文级文字的 AA 门槛。
  const AA_NORMAL = 4.5;

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: primary button text meets AA", (_name, css) => {
    const bg = token(css as string, "accent-solid");
    const fg = token(css as string, "text-on-accent");
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: primary button hover/active still meet AA", (_name, css) => {
    const fg = token(css as string, "text-on-accent");
    for (const name of ["accent-solid-hover", "accent-solid-active"]) {
      expect(contrast(fg, token(css as string, name))).toBeGreaterThanOrEqual(AA_NORMAL);
    }
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: danger button text meets AA", (_name, css) => {
    const bg = token(css as string, "danger-solid");
    const fg = token(css as string, "text-on-danger");
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: solid buttons are visible against the app background", (_name, css) => {
    // 按钮底色与背景差得太少时，按钮边界不可辨（非文本对比需 ≥3）。
    const app = token(css as string, "bg-app");
    for (const name of ["accent-solid", "danger-solid"]) {
      expect(contrast(token(css as string, name), app)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: accent as a foreground colour stays readable on the app background", (_name, css) => {
    // `--accent` 的另一半角色：链接与选中图标，必须比背景亮/暗得足够。
    expect(contrast(token(css as string, "accent"), token(css as string, "bg-app")))
      .toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("keeps solid button colours distinct from the foreground accent in dark theme", () => {
    // 暗色下两者必须不同 —— 同值就说明又重新把两种角色合并了，
    // 而那正是白字对比度不达标的原因。
    expect(token(dark, "accent-solid")).not.toBe(token(dark, "accent"));
  });
});

/**
 * 更新提示条的可读性（UI §33 要求这类信息用持久 UI，因此它长期可见）。
 *
 * 背景：`--accent` 作前景色放在 `--accent-soft` 底上时，暗色主题实测
 * 只有 3.98，达不到 AA。提示条的内容必须一直清晰可读 ——
 * 它承载的是「要不要现在更新」这个决策。
 */
describe("update bar legibility", () => {
  const AA_NORMAL = 4.5;

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: bar text is readable on the soft accent background", (_name, css) => {
    const bg = token(css as string, "accent-soft");
    const fg = token(css as string, "text-primary");
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: the bar icon colour is readable on its background", (_name, css) => {
    // 图标改用 text-primary —— 这里断言的就是实际渲染用的那个令牌。
    const bg = token(css as string, "accent-soft");
    const fg = token(css as string, "text-primary");
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it("documents why the bar icon is not the raw accent in dark theme", () => {
    // 若有人把图标改回 `--accent`，暗色下会掉到 4.5 以下。
    // 这条用例把「不能这么做」的原因固定下来。
    const ratio = contrast(token(dark, "accent"), token(dark, "accent-soft"));
    expect(ratio).toBeLessThan(AA_NORMAL);
  });
});

/**
 * 编辑器光标可见性。
 *
 * 背景：CodeMirror 基础主题把光标写死成黑色
 * （`.cm-cursor { border-left: 1.2px solid black }`、`&light .cm-content { caretColor: black }`），
 * 它的亮色覆盖只写在 `&dark` 分支里。本应用只用了一个不含 dark 标记的
 * `EditorView.theme`，于是深色背景下光标是纯黑 —— 几乎看不见。
 *
 * 修法是给光标单列一个 `--caret` 令牌，明暗各自取值。
 */
describe("editor caret visibility", () => {
  // 光标是细线，按 UI 组件（非文本）的 3:1 门槛要求。
  const AA_NON_TEXT = 3;

  it.each([
    ["light", light],
    ["dark", dark],
  ])("%s: the caret is visible against the editor background", (_name, css) => {
    expect(contrast(token(css as string, "caret"), token(css as string, "bg-app")))
      .toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it("uses a light caret in dark theme and a dark one in light theme", () => {
    // 方向必须相反：否则等于把 CodeMirror 的写死黑光标换个名字保留下来。
    expect(luminance(token(dark, "caret"))).toBeGreaterThan(luminance(token(dark, "bg-app")));
    expect(luminance(token(light, "caret"))).toBeLessThan(luminance(token(light, "bg-app")));
  });

  it("keeps the caret distinct from the editor text colour", () => {
    // 光标与文字同色时，光标停在某个字符上就分不清位置了。
    // 但也不能差太远 —— 二者都必须在同一底上可读，故只要求值不同。
    expect(token(dark, "caret")).not.toBe(token(dark, "text-muted"));
    expect(token(light, "caret")).not.toBe(token(light, "text-muted"));
  });
});
