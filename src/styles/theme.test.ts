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
