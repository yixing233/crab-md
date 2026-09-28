import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileIcon } from "./FileIcon";

describe("FileIcon", () => {
  it("renders txt icon with .file-icon--txt for .txt files", () => {
    const { container } = render(<FileIcon filename="readme.txt" size={16} />);
    const icon = container.querySelector(".file-icon--txt");
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass("lucide-file-text");
  });

  it("renders markdown icon with .file-icon--md for .md files", () => {
    const { container } = render(<FileIcon filename="document.md" size={16} />);
    const icon = container.querySelector(".file-icon--md");
    expect(icon).toBeInTheDocument();
    expect(icon?.tagName.toLowerCase()).toBe("svg");
  });

  it("defaults to markdown icon for files without extension", () => {
    const { container } = render(<FileIcon filename="未命名" size={14} />);
    const icon = container.querySelector(".file-icon--md");
    expect(icon).toBeInTheDocument();
  });

  it("applies custom size and className", () => {
    const { container } = render(
      <FileIcon filename="test.md" size={20} className="custom-class" />,
    );
    const icon = container.querySelector(".file-icon--md");
    expect(icon).toHaveClass("custom-class");
    expect(icon).toHaveAttribute("width", "20");
    expect(icon).toHaveAttribute("height", "20");
  });
});
