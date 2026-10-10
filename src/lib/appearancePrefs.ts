import type { ResolvedTheme } from "./theme";

// ---------------------------------------------------------------------------
// 1. 界面缩放 (UI Zoom)
// ---------------------------------------------------------------------------

export type UiZoom = "90" | "100" | "110" | "125" | "150";

export const UI_ZOOMS: readonly UiZoom[] = ["90", "100", "110", "125", "150"] as const;

export const DEFAULT_UI_ZOOM: UiZoom = "100";

export const UI_ZOOM_KEY = "crab-md:ui-zoom";

export function readStoredUiZoom(raw: string | null): UiZoom {
  return raw && (UI_ZOOMS as readonly string[]).includes(raw) ? (raw as UiZoom) : DEFAULT_UI_ZOOM;
}

export function applyUiZoom(zoom: UiZoom): void {
  if (typeof document === "undefined") return;
  const ratio = Number(zoom) / 100;
  // CSS zoom 在 Chromium / WebView2 中原生支持，等比放大整个 DOM 树与外壳字号
  document.documentElement.style.zoom = String(ratio);
}

// ---------------------------------------------------------------------------
// 2. 主题强调色 (Accent Color)
// ---------------------------------------------------------------------------

export type AccentColor = "blue" | "green" | "purple" | "orange" | "rose";

export const ACCENT_COLORS: readonly AccentColor[] = ["blue", "green", "purple", "orange", "rose"] as const;

export const DEFAULT_ACCENT_COLOR: AccentColor = "blue";

export const ACCENT_COLOR_KEY = "crab-md:accent-color";

export interface AccentColorPalette {
  previewHex: string;
  light: {
    accent: string;
    accentSoft: string;
    accentSolid: string;
    accentSolidHover: string;
    accentSolidActive: string;
    borderFocus: string;
    selectionBg: string;
    antdPrimary: string;
  };
  dark: {
    accent: string;
    accentSoft: string;
    accentSolid: string;
    accentSolidHover: string;
    accentSolidActive: string;
    borderFocus: string;
    selectionBg: string;
    antdPrimary: string;
  };
}

export const ACCENT_PALETTES: Record<AccentColor, AccentColorPalette> = {
  blue: {
    previewHex: "#2563eb",
    light: {
      accent: "#2563eb",
      accentSoft: "#eff6ff",
      accentSolid: "#2563eb",
      accentSolidHover: "#1d4ed8",
      accentSolidActive: "#1e40af",
      borderFocus: "#3b82f6",
      selectionBg: "#bfdbfe",
      antdPrimary: "#2563eb",
    },
    dark: {
      accent: "#3b82f6",
      accentSoft: "#1e293b",
      accentSolid: "#2563eb",
      accentSolidHover: "#1d4ed8",
      accentSolidActive: "#1e40af",
      borderFocus: "#60a5fa",
      selectionBg: "#1e40af",
      antdPrimary: "#3b82f6",
    },
  },
  green: {
    previewHex: "#16a34a",
    light: {
      accent: "#16a34a",
      accentSoft: "#f0fdf4",
      accentSolid: "#16a34a",
      accentSolidHover: "#15803d",
      accentSolidActive: "#166534",
      borderFocus: "#22c55e",
      selectionBg: "#bbf7d0",
      antdPrimary: "#16a34a",
    },
    dark: {
      accent: "#22c55e",
      accentSoft: "#14291a",
      accentSolid: "#16a34a",
      accentSolidHover: "#15803d",
      accentSolidActive: "#166534",
      borderFocus: "#4ade80",
      selectionBg: "#166534",
      antdPrimary: "#22c55e",
    },
  },
  purple: {
    previewHex: "#7c3aed",
    light: {
      accent: "#7c3aed",
      accentSoft: "#f5f3ff",
      accentSolid: "#7c3aed",
      accentSolidHover: "#6d28d9",
      accentSolidActive: "#5b21b6",
      borderFocus: "#8b5cf6",
      selectionBg: "#ddd6fe",
      antdPrimary: "#7c3aed",
    },
    dark: {
      accent: "#a78bfa",
      accentSoft: "#2a1845",
      accentSolid: "#7c3aed",
      accentSolidHover: "#6d28d9",
      accentSolidActive: "#5b21b6",
      borderFocus: "#c4b5fd",
      selectionBg: "#5b21b6",
      antdPrimary: "#a78bfa",
    },
  },
  orange: {
    previewHex: "#ea580c",
    light: {
      accent: "#ea580c",
      accentSoft: "#fff7ed",
      accentSolid: "#ea580c",
      accentSolidHover: "#c2410c",
      accentSolidActive: "#9a3412",
      borderFocus: "#f97316",
      selectionBg: "#fed7aa",
      antdPrimary: "#ea580c",
    },
    dark: {
      accent: "#fb923c",
      accentSoft: "#361b0e",
      accentSolid: "#ea580c",
      accentSolidHover: "#c2410c",
      accentSolidActive: "#9a3412",
      borderFocus: "#fdba74",
      selectionBg: "#9a3412",
      antdPrimary: "#fb923c",
    },
  },
  rose: {
    previewHex: "#e11d48",
    light: {
      accent: "#e11d48",
      accentSoft: "#fff1f2",
      accentSolid: "#e11d48",
      accentSolidHover: "#be123c",
      accentSolidActive: "#9f1239",
      borderFocus: "#f43f5e",
      selectionBg: "#fecdd3",
      antdPrimary: "#e11d48",
    },
    dark: {
      accent: "#fb7185",
      accentSoft: "#35121b",
      accentSolid: "#e11d48",
      accentSolidHover: "#be123c",
      accentSolidActive: "#9f1239",
      borderFocus: "#fda4af",
      selectionBg: "#9f1239",
      antdPrimary: "#fb7185",
    },
  },
};

export function readStoredAccentColor(raw: string | null): AccentColor {
  return raw && (ACCENT_COLORS as readonly string[]).includes(raw)
    ? (raw as AccentColor)
    : DEFAULT_ACCENT_COLOR;
}

export function applyAccentColor(accent: AccentColor, resolvedTheme: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const palette = ACCENT_PALETTES[accent][resolvedTheme];
  const root = document.documentElement;

  root.style.setProperty("--accent", palette.accent);
  root.style.setProperty("--accent-soft", palette.accentSoft);
  root.style.setProperty("--accent-solid", palette.accentSolid);
  root.style.setProperty("--accent-solid-hover", palette.accentSolidHover);
  root.style.setProperty("--accent-solid-active", palette.accentSolidActive);
  root.style.setProperty("--border-focus", palette.borderFocus);
  root.style.setProperty("--selection-bg", palette.selectionBg);
}

// ---------------------------------------------------------------------------
// 3. 布局密度 (UI Density)
// ---------------------------------------------------------------------------

export type UiDensity = "compact" | "standard" | "comfortable";

export const UI_DENSITIES: readonly UiDensity[] = ["compact", "standard", "comfortable"] as const;

export const DEFAULT_UI_DENSITY: UiDensity = "standard";

export const UI_DENSITY_KEY = "crab-md:ui-density";

export function readStoredUiDensity(raw: string | null): UiDensity {
  return raw && (UI_DENSITIES as readonly string[]).includes(raw)
    ? (raw as UiDensity)
    : DEFAULT_UI_DENSITY;
}

export function applyUiDensity(density: UiDensity): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-density", density);
}

// ---------------------------------------------------------------------------
// 4. 深色背景风格 (Dark Style: OLED 纯黑 vs 默认深灰)
// ---------------------------------------------------------------------------

export type DarkStyle = "default" | "oled";

export const DARK_STYLES: readonly DarkStyle[] = ["default", "oled"] as const;

export const DEFAULT_DARK_STYLE: DarkStyle = "default";

export const DARK_STYLE_KEY = "crab-md:dark-style";

export function readStoredDarkStyle(raw: string | null): DarkStyle {
  return raw && (DARK_STYLES as readonly string[]).includes(raw)
    ? (raw as DarkStyle)
    : DEFAULT_DARK_STYLE;
}

export function applyDarkStyle(style: DarkStyle): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-dark-style", style);
}
