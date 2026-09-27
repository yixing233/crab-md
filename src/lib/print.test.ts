import { describe, expect, it, vi } from "vitest";
import { printPreview } from "./print";

describe("printPreview", () => {
  it("opens the browser print dialog", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    expect(printPreview()).toBe(true);
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });
});
