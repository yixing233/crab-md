export interface TextStats {
  /** 字符数（不含连续空白与换行）。 */
  characters: number;
  /** 词数（中文每个汉字计 1 词，英文连续单词计 1 词）。 */
  words: number;
  /** 预计阅读时长（按每分钟 300 词/字估算，单位分钟）。 */
  readingTimeMin: number;
}

/**
 * 统计正文的中英文字数、字符数与预估阅读时间。
 */
export function countText(text: string): TextStats {
  if (!text || text.trim().length === 0) {
    return { characters: 0, words: 0, readingTimeMin: 0 };
  }

  // 1. 中文/日文/韩文字符计数（每个字符算 1 个字/词）
  const cjkMatches = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf\uf900-\ufaff]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;

  // 2. 西文单词计数（剔除 CJK 后的连续字母数字词）
  const nonCjk = text.replace(/[\u4e00-\u9fa5\u3040-\u30ff\u3400-\u4dbf\uf900-\ufaff]/g, " ");
  const wordMatches = nonCjk.match(/[a-zA-Z0-9_\u00C0-\u024F]+/g);
  const wordCount = wordMatches ? wordMatches.length : 0;

  const totalWords = cjkCount + wordCount;
  // 字符数（排除换行与空格）
  const characters = text.replace(/\s+/g, "").length;
  // 阅读时长（中文约 300~350字/分，最少为 1 分钟）
  const readingTimeMin = totalWords > 0 ? Math.max(1, Math.ceil(totalWords / 300)) : 0;

  return {
    characters,
    words: totalWords,
    readingTimeMin,
  };
}
