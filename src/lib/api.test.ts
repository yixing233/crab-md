import { describe, expect, it } from "vitest";
import { toAppError } from "./api";

describe("toAppError", () => {
  it("recognises the machine-readable envelope", () => {
    const e = toAppError({ code: "NOT_FOUND", message: "document not found: x" });
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toContain("document not found");
  });

  it("falls back to a generic error for unknown shapes", () => {
    const e = toAppError("boom");
    expect(e.code).toBe("UNKNOWN");
    expect(e.message).toContain("boom");
  });

  it("handles null and undefined without throwing", () => {
    expect(toAppError(null).code).toBe("UNKNOWN");
    expect(toAppError(undefined).code).toBe("UNKNOWN");
  });

  it("surfaces Error instances", () => {
    expect(toAppError(new Error("nope")).message).toContain("nope");
  });
});
