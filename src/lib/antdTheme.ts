import { theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";
import { ACCENT_PALETTES, type AccentColor } from "./appearancePrefs";
import type { ResolvedTheme } from "./theme";

/**
 * antd 组件的主题令牌映射。
 *
 * 应用自己的明暗主题由 `<html data-theme>` 上的 CSS 变量驱动
 * （theme-light.css / theme-dark.css），antd 组件不吃 CSS 变量，
 * 需要 ConfigProvider 的 ThemeConfig。这里把两边对齐：
 * antd 的取值**读自同一套设计值**，明暗两份各配一次，
 * 并支持动态响应用户偏好的强调色（Accent Color）。
 */
const sharedTokens = {
  fontFamily: "var(--font-ui)",
  borderRadius: 6,
  controlHeight: 30,
  fontSize: 13,
};

/**
 * 根据实际生效的明暗与强调色，生成 antd ConfigProvider 的主题配置。
 */
export function getAntdTheme(resolvedTheme: ResolvedTheme, accent: AccentColor = "blue"): ThemeConfig {
  const palette = ACCENT_PALETTES[accent]?.[resolvedTheme] ?? ACCENT_PALETTES.blue[resolvedTheme];
  const isDark = resolvedTheme === "dark";

  const baseTokens = isDark
    ? {
        ...sharedTokens,
        colorPrimary: palette.antdPrimary,
        colorSuccess: "#22c55e",
        colorWarning: "#f59e0b",
        colorError: "#ef4444",
        colorInfo: "#38bdf8",
        colorBgContainer: "#232326",
        colorBgElevated: "#2c2c30",
        colorBorder: "#3d3d42",
        colorBorderSecondary: "#303034",
        colorText: "#e8e8e8",
        colorTextSecondary: "#b4b4b4",
        colorTextTertiary: "#8a8a8a",
        colorLink: palette.accent,
      }
    : {
        ...sharedTokens,
        colorPrimary: palette.antdPrimary,
        colorSuccess: "#16a34a",
        colorWarning: "#d97706",
        colorError: "#dc2626",
        colorInfo: "#0284c7",
        colorBgContainer: "#ffffff",
        colorBgElevated: "#ffffff",
        colorBorder: "#d8d8dc",
        colorBorderSecondary: "#e8e8ea",
        colorText: "#1a1a1a",
        colorTextSecondary: "#555555",
        colorTextTertiary: "#6b6b6b",
        colorLink: palette.accent,
      };

  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: baseTokens,
  };
}

/** 浅色主题的默认 antd 配置。 */
export const antdLightTheme: ThemeConfig = getAntdTheme("light", "blue");

/** 深色主题的默认 antd 配置。 */
export const antdDarkTheme: ThemeConfig = getAntdTheme("dark", "blue");
