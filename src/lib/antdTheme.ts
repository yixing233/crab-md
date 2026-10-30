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
    components: {
      /**
       * Table 的配色对齐应用自己的设计令牌。
       *
       * antd 默认表格是纯白容器 + 白表头，与主页的灰底（`--bg-app`）并排时
       * 明显是两块不同材质。这里把容器设为透明（露出页面底色）、表头压深一档，
       * 表头文字用次级灰 —— 与手写列表时期的观感一致。
       *
       * 取值用 CSS 变量而不是硬编码色值：明暗主题与强调色切换由变量驱动，
       * 这里跟着走就行，不必维护第二份配色表。
       */
      Table: {
        // 这里必须用**具体色值**：antd 会对这些颜色做运算（派生 hover、
        // 分隔线等），`var(--x)` 参与不了计算，会被静默丢掉并回退默认白底。
        // 明暗两套在下面的分支里各配一次，与 theme-light/dark.css 同源。
        headerBg: isDark ? "#1c1c1f" : "#f5f5f6",
        headerColor: isDark ? "#8a8a8a" : "#6b6b6b",
        headerSplitColor: "transparent",
        colorBgContainer: "transparent",
        rowHoverBg: isDark ? "#2c2c30" : "#ececee",
        borderColor: isDark ? "#303034" : "#e8e8ea",
        headerBorderRadius: 0,
      },
    },
  };
}

/** 浅色主题的默认 antd 配置。 */
export const antdLightTheme: ThemeConfig = getAntdTheme("light", "blue");

/** 深色主题的默认 antd 配置。 */
export const antdDarkTheme: ThemeConfig = getAntdTheme("dark", "blue");
