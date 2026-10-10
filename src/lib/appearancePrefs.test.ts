import { beforeEach, describe, expect, it } from "vitest";
import {
  applyAccentColor,
  applyDarkStyle,
  applyUiDensity,
  applyUiZoom,
  readStoredAccentColor,
  readStoredDarkStyle,
  readStoredUiDensity,
  readStoredUiZoom,
} from "./appearancePrefs";

describe("appearancePrefs", () => {
  beforeEach(() => {
    document.documentElement.style.zoom = "";
    document.documentElement.removeAttribute("data-density");
    document.documentElement.removeAttribute("data-dark-style");
  });

  describe("UI Zoom", () => {
    it("reads valid zoom and falls back to 100", () => {
      expect(readStoredUiZoom("110")).toBe("110");
      expect(readStoredUiZoom("invalid")).toBe("100");
      expect(readStoredUiZoom(null)).toBe("100");
    });

    it("applies zoom ratio to html element", () => {
      applyUiZoom("125");
      expect(document.documentElement.style.zoom).toBe("1.25");
      applyUiZoom("100");
      expect(document.documentElement.style.zoom).toBe("1");
    });
  });

  describe("Accent Color", () => {
    it("reads valid color and falls back to blue", () => {
      expect(readStoredAccentColor("purple")).toBe("purple");
      expect(readStoredAccentColor("unknown")).toBe("blue");
      expect(readStoredAccentColor(null)).toBe("blue");
    });

    it("applies palette CSS variables to root", () => {
      applyAccentColor("purple", "light");
      expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#7c3aed");
      expect(document.documentElement.style.getPropertyValue("--accent-solid")).toBe("#7c3aed");

      applyAccentColor("purple", "dark");
      expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#a78bfa");
    });
  });

  describe("UI Density", () => {
    it("reads valid density and falls back to standard", () => {
      expect(readStoredUiDensity("compact")).toBe("compact");
      expect(readStoredUiDensity("invalid")).toBe("standard");
      expect(readStoredUiDensity(null)).toBe("standard");
    });

    it("sets data-density attribute", () => {
      applyUiDensity("compact");
      expect(document.documentElement).toHaveAttribute("data-density", "compact");
      applyUiDensity("comfortable");
      expect(document.documentElement).toHaveAttribute("data-density", "comfortable");
    });
  });

  describe("Dark Style", () => {
    it("reads valid dark style and falls back to default", () => {
      expect(readStoredDarkStyle("oled")).toBe("oled");
      expect(readStoredDarkStyle("invalid")).toBe("default");
      expect(readStoredDarkStyle(null)).toBe("default");
    });

    it("sets data-dark-style attribute", () => {
      applyDarkStyle("oled");
      expect(document.documentElement).toHaveAttribute("data-dark-style", "oled");
    });
  });
});
