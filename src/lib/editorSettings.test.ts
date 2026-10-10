import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_DELAY_MS,
  DEFAULT_AUTOSAVE_MODE,
  DEFAULT_LINE_NUMBERS,
  DEFAULT_LINE_WRAP,
  readStoredAutosaveMode,
  readStoredLineNumbers,
  readStoredLineWrap,
} from "./editorSettings";

describe("editor behavior prefs", () => {
  describe("line numbers", () => {
    it("defaults to off", () => {
      expect(DEFAULT_LINE_NUMBERS).toBe(false);
      expect(readStoredLineNumbers(null)).toBe(false);
    });

    it("parses stored booleans", () => {
      expect(readStoredLineNumbers("true")).toBe(true);
      expect(readStoredLineNumbers("false")).toBe(false);
    });

    it("falls back on garbage instead of trusting it", () => {
      expect(readStoredLineNumbers("yes")).toBe(false);
      expect(readStoredLineNumbers("1")).toBe(false);
      expect(readStoredLineNumbers("")).toBe(false);
    });
  });

  describe("line wrap", () => {
    it("defaults to on", () => {
      expect(DEFAULT_LINE_WRAP).toBe(true);
      expect(readStoredLineWrap(null)).toBe(true);
    });

    it("parses stored booleans and falls back on garbage", () => {
      expect(readStoredLineWrap("true")).toBe(true);
      expect(readStoredLineWrap("false")).toBe(false);
      expect(readStoredLineWrap("off")).toBe(true);
    });
  });

  describe("autosave mode", () => {
    it("defaults to 1s (current behavior)", () => {
      expect(DEFAULT_AUTOSAVE_MODE).toBe("1s");
      expect(readStoredAutosaveMode(null)).toBe("1s");
    });

    it("accepts every documented mode", () => {
      expect(readStoredAutosaveMode("off")).toBe("off");
      expect(readStoredAutosaveMode("1s")).toBe("1s");
      expect(readStoredAutosaveMode("3s")).toBe("3s");
      expect(readStoredAutosaveMode("5s")).toBe("5s");
    });

    it("falls back on unknown values", () => {
      expect(readStoredAutosaveMode("10s")).toBe("1s");
      expect(readStoredAutosaveMode("")).toBe("1s");
    });

    it("maps non-off modes to milliseconds", () => {
      expect(AUTOSAVE_DELAY_MS["1s"]).toBe(1000);
      expect(AUTOSAVE_DELAY_MS["3s"]).toBe(3000);
      expect(AUTOSAVE_DELAY_MS["5s"]).toBe(5000);
    });
  });
});
