/** 用户的主题偏好；`system` 表示跟随系统（UI_DESIGN_SYSTEM.md §4.1）。 */
export type ThemePreference = "light" | "dark" | "system";

/** 实际生效的主题 —— 只有这两种，`system` 会被解析掉。 */
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "crab-md:theme";

/**
 * 把偏好解析为实际主题。
 *
 * 单独抽成纯函数是为了能脱离 DOM 测试 —— `prefers-color-scheme` 在 jsdom
 * 里不会真实变化，若把判断写在 effect 里就只能靠手工验证。
 */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return preference;
}

/**
 * 读取已保存的偏好。任何无法识别的值（旧版本、手工改坏、被清空）
 * 一律回退到 `system`，而不是抛错 —— 主题损坏不应让应用起不来。
 */
export function readStoredPreference(raw: string | null): ThemePreference {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

/** 把主题写到 `<html data-theme>`，CSS 变量随之切换（见 styles/theme-*.css）。 */
export function applyTheme(theme: ResolvedTheme, root: HTMLElement = document.documentElement): void {
  root.setAttribute("data-theme", theme);
}

/**
 * 把主题同步到**原生窗口**，让标题栏也跟随明暗。
 *
 * 为什么需要单独做这件事：
 * `applyTheme` 只改 WebView 内部的 CSS，原生标题栏由操作系统绘制，
 * 不受 `data-theme` 影响。结果是深色模式下标题栏仍是刺眼的白色。
 *
 * 平台能力（已核实）：Tauri 的 `setTheme` 转调 tao，tao 在 Windows 上用
 * `DwmSetWindowAttribute(DWMWA_USE_IMMERSIVE_DARK_MODE)` 设置深色标题栏，
 * 需要 Windows 10 build 18985+；更早的系统上调用是无害的 no-op。
 *
 * 失败一律静默：拿不到窗口（单测 / 浏览器预览）或权限缺失时，
 * 界面本身仍然正确，不该因为标题栏而让应用报错。
 */
export async function applyWindowTheme(theme: ResolvedTheme): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(theme);
  } catch {
    // 无 Tauri IPC（单测、harness、浏览器）时静默跳过。
  }
}

/** 查询当前系统是否偏好深色。老浏览器无 matchMedia 时按浅色处理。 */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
