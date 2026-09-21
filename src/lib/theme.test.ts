import { describe, expect, it } from "vitest";
import { applyTheme, readStoredPreference, resolveTheme, systemPrefersDark } from "./theme";

describe("resolveTheme", () => {
  it("returns the explicit preference as-is", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the system when preference is 'system'", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("explicit preference wins over the system", () => {
    // 用户明确选了浅色时，系统是深色也不应改回来。
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("readStoredPreference", () => {
  it("accepts the three valid values", () => {
    expect(readStoredPreference("light")).toBe("light");
    expect(readStoredPreference("dark")).toBe("dark");
    expect(readStoredPreference("system")).toBe("system");
  });

  it("falls back to system for anything else", () => {
    for (const bad of [null, "", "DARK", "solarized", "{}", "  dark"]) {
      expect(readStoredPreference(bad)).toBe("system");
    }
  });
});

describe("applyTheme", () => {
  it("writes data-theme onto the given root", () => {
    const root = document.createElement("div");
    applyTheme("dark", root);
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyTheme("light", root);
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("defaults to the document element and is readable by CSS", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("systemPrefersDark", () => {
  it("returns a boolean without throwing in jsdom", () => {
    expect(typeof systemPrefersDark()).toBe("boolean");
  });
});
