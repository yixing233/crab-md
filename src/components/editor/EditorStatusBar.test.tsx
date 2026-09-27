import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditorStatusBar } from "./EditorStatusBar";

describe("EditorStatusBar", () => {
  it("renders basic line, column, and document title", () => {
    render(
      <EditorStatusBar
        dirty={false}
        line={5}
        column={12}
        path="测试文档.md"
        content="一段测试正文"
      />,
    );

    expect(screen.getByText("测试文档.md")).toBeInTheDocument();
    expect(screen.getByText("第 5 行，第 12 列")).toBeInTheDocument();
    expect(screen.getByText("已保存")).toBeInTheDocument();
    expect(screen.getByText(/6 词/)).toBeInTheDocument();
  });

  it("displays selection stats when text is selected", () => {
    render(
      <EditorStatusBar
        dirty={true}
        line={1}
        column={1}
        path="文档.md"
        content="一段很长很长的正文内容，这里有好多字"
        selectedText="选中文本"
      />,
    );

    expect(screen.getByText("未保存")).toBeInTheDocument();
    expect(screen.getByText("已选 4 词（4 字符）")).toBeInTheDocument();
  });
});
