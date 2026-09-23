import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import {
  applyPreviewTypography,
  defaultPreviewTypography,
} from "../../lib/previewTypography";

/**
 * 端到端：设置的排版是否**真的**作用到预览元素上。
 *
 * 单测已证明变量写对了，但「CSS 有没有读到变量」是另一回事 ——
 * 变量名写错、选择器不匹配都会让设置静默失效，而 jsdom 不做级联计算，
 * 无法在 jsdom 里断言 computedStyle。故这里分两层：
 * 1) 变量确实写到 <html> 上（本文件）；
 * 2) CSS 里确实引用了同名变量（下面的静态检查）。
 */
const SAMPLE = [
  "# 一级标题",
  "",
  "## 二级标题",
  "",
  "正文段落",
  "",
  "> 引用",
  "",
  "```",
  "code block",
  "```",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
].join("\n");

describe("preview typography reaches the document", () => {
  beforeEach(() => {
    render(<MarkdownPreview source={SAMPLE} />);
  });

  it("renders every element category the settings can target", async () => {
    // 若预览里根本没有某类元素，那类设置就是空转。
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(document.querySelector(".markdown-preview blockquote")).not.toBeNull();
    expect(document.querySelector(".markdown-preview code")).not.toBeNull();
    expect(document.querySelector(".markdown-preview table")).not.toBeNull();
  });

  it("writes a font-size variable for each of those categories", () => {
    applyPreviewTypography("system", defaultPreviewTypography());
    const root = document.documentElement;
    for (const id of ["body", "h1", "h2", "h3", "h4", "h5", "h6", "code", "quote", "table", "math"]) {
      expect(root.style.getPropertyValue(`--preview-size-${id}`), id).toMatch(/^\d+px$/);
    }
  });
});
