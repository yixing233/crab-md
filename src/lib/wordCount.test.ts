import { describe, expect, it } from "vitest";
import { countText } from "./wordCount";

describe("wordCount", () => {
  it("handles empty or whitespace strings", () => {
    expect(countText("")).toEqual({ characters: 0, words: 0, readingTimeMin: 0 });
    expect(countText("   \n\t  ")).toEqual({ characters: 0, words: 0, readingTimeMin: 0 });
  });

  it("counts Chinese characters accurately", () => {
    const stats = countText("这是一篇测试文章");
    expect(stats.characters).toBe(8);
    expect(stats.words).toBe(8);
    expect(stats.readingTimeMin).toBe(1);
  });

  it("counts English words accurately", () => {
    const stats = countText("Hello world from Crab-MD");
    // "Hello", "world", "from", "Crab", "MD" -> 5 words
    expect(stats.words).toBe(5);
    expect(stats.characters).toBe(21);
  });

  it("counts mixed Chinese and English text", () => {
    const stats = countText("在 React 19 中使用 Markdown 编辑器");
    expect(stats.words).toBe(10);
    expect(stats.characters).toBe(22);
  });

  it("estimates reading time based on length", () => {
    const longText = "测试".repeat(350); // 700 chars
    const stats = countText(longText);
    expect(stats.words).toBe(700);
    expect(stats.readingTimeMin).toBe(3); // ceil(700 / 300) = 3
  });
});
