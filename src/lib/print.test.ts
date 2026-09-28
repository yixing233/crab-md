import { describe, expect, it, vi } from "vitest";
import { printPreview } from "./print";

describe("printPreview", () => {
  it("opens the browser print dialog", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    expect(printPreview()).toBe(true);
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });

  it("temporarily sets document title for PDF filename suggestion", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      expect(document.title).toBe("项目计划");
    });
    document.title = "Crab-MD";

    expect(printPreview("项目计划.md")).toBe(true);
    expect(print).toHaveBeenCalledOnce();
    expect(document.title).toBe("Crab-MD");

    print.mockRestore();
  });
});
