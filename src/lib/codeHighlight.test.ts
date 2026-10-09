import { describe, expect, it, vi } from "vitest";
import hljs from "highlight.js/lib/common";
import { highlightCode } from "./codeHighlight";

describe("highlightCode", () => {
  it("highlights a registered language into hljs token markup", () => {
    const html = highlightCode("const x = 1;", "js");

    expect(html).not.toBeNull();
    expect(html).toContain('class="hljs-keyword"');
    expect(html).toContain("const");
    expect(html).toContain('class="hljs-number"');
  });

  it("highlights cpp with the token classes the stylesheet maps", () => {
    // cpp 语法里 `const` / `char` 是 hljs-type 而非 hljs-keyword
    // （已用 node + highlight.js 实测确认），样式表按 type 映射即可。
    const html = highlightCode("const char* filepath; // 注释", "cpp");

    expect(html).not.toBeNull();
    expect(html).toContain('class="hljs-type"');
    expect(html).toContain('class="hljs-comment"');
  });

  it("returns null for an unregistered language so callers can fall back", () => {
    expect(highlightCode("A-->B", "mermaidish")).toBeNull();
  });

  it("returns null for an empty or whitespace language", () => {
    expect(highlightCode("plain", "")).toBeNull();
    expect(highlightCode("plain", "   ")).toBeNull();
  });

  it("is case-insensitive and trims the language name", () => {
    expect(highlightCode("const x = 1;", "  JavaScript  ")).not.toBeNull();
  });

  it("escapes HTML rather than emitting raw markup", () => {
    const html = highlightCode('const s = "<img src=x onerror=alert(1)>";', "js");

    expect(html).not.toBeNull();
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("returns null instead of throwing when highlighting fails", () => {
    const spy = vi.spyOn(hljs, "highlight").mockImplementation(() => {
      throw new Error("boom");
    });

    expect(highlightCode("const x = 1;", "js")).toBeNull();
    spy.mockRestore();
  });
});
