import { describe, expect, it } from "vitest";
import {
  getRenderToggles,
  parseRenderToggles,
  setRenderToggles,
} from "./renderToggles";

describe("render toggles", () => {
  describe("parseRenderToggles", () => {
    it("defaults to both on", () => {
      expect(parseRenderToggles(null)).toEqual({ mermaid: true, math: true });
    });

    it("parses valid stored JSON", () => {
      expect(parseRenderToggles('{"mermaid":false,"math":false}')).toEqual({
        mermaid: false,
        math: false,
      });
      expect(parseRenderToggles('{"mermaid":true,"math":false}')).toEqual({
        mermaid: true,
        math: false,
      });
    });

    it("fills missing fields with defaults instead of undefined", () => {
      expect(parseRenderToggles('{"mermaid":false}')).toEqual({ mermaid: false, math: true });
      expect(parseRenderToggles("{}")).toEqual({ mermaid: true, math: true });
    });

    it("falls back on malformed JSON and wrong types", () => {
      expect(parseRenderToggles("not json")).toEqual({ mermaid: true, math: true });
      expect(parseRenderToggles('{"mermaid":"no","math":1}')).toEqual({
        mermaid: true,
        math: true,
      });
    });
  });

  describe("get/set", () => {
    it("updates partial state and returns a snapshot", () => {
      setRenderToggles({ mermaid: false, math: false });
      expect(getRenderToggles()).toEqual({ mermaid: false, math: false });

      setRenderToggles({ mermaid: true });
      expect(getRenderToggles()).toEqual({ mermaid: true, math: false });

      // 快照：改返回值不得影响内部状态。
      const snapshot = getRenderToggles() as { mermaid: boolean };
      snapshot.mermaid = false;
      expect(getRenderToggles().mermaid).toBe(true);

      // 还原，避免污染其他测试文件共享的模块状态。
      setRenderToggles({ mermaid: true, math: true });
    });
  });
});
