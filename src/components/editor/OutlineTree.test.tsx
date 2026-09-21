import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OutlineTree } from "./OutlineTree";

describe("OutlineTree", () => {
  it("shows an empty state when the document has no headings", () => {
    render(<OutlineTree source="just text" onJump={() => {}} />);
    expect(screen.getByText("这篇文档还没有标题。")).toBeInTheDocument();
  });

  it("lists the headings", () => {
    render(<OutlineTree source={"# 一\n## 二\n### 三"} onJump={() => {}} />);
    expect(screen.getByRole("button", { name: "一" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "二" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "三" })).toBeInTheDocument();
  });

  it("reports the 0-based line when a heading is clicked", async () => {
    const onJump = vi.fn();
    render(<OutlineTree source={"# 一\n\ntext\n\n## 二"} onJump={onJump} />);
    await userEvent.click(screen.getByRole("button", { name: "二" }));
    // 与 lib/outline.ts 的行号约定一致，可直接用于编辑器跳转。
    expect(onJump).toHaveBeenCalledWith(4);
  });

  it("indents deeper headings so the hierarchy is visible", () => {
    render(<OutlineTree source={"# 一\n### 三"} onJump={() => {}} />);
    const h1 = screen.getByRole("button", { name: "一" });
    const h3 = screen.getByRole("button", { name: "三" });
    // 一级 10px，三级 34px —— 层级不只靠字号区分（UI §39）。
    expect(h1).toHaveStyle({ paddingLeft: "10px" });
    expect(h3).toHaveStyle({ paddingLeft: "34px" });
  });

  it("uses an accessible navigation landmark", () => {
    render(<OutlineTree source="# 一" onJump={() => {}} />);
    expect(screen.getByRole("navigation", { name: "文档大纲" })).toBeInTheDocument();
  });

  it("ignores headings inside fenced code blocks", () => {
    render(<OutlineTree source={"```\n# 不是标题\n```"} onJump={() => {}} />);
    expect(screen.getByText("这篇文档还没有标题。")).toBeInTheDocument();
  });

  it("labels an empty heading rather than rendering a blank row", () => {
    render(<OutlineTree source="#" onJump={() => {}} />);
    expect(screen.getByRole("button", { name: "（无标题）" })).toBeInTheDocument();
  });
});
