import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PrintExportModal } from "./PrintExportModal";
import * as printLib from "../../lib/print";

describe("PrintExportModal", () => {
  it("renders when open and displays title and content", () => {
    render(
      <PrintExportModal
        open={true}
        documentTitle="测试文档.md"
        content="# 一级标题\n\n这是一段测试内容"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("导出 PDF 与排版打印")).toBeInTheDocument();
    expect(screen.getByText("测试文档")).toBeInTheDocument();
    expect(screen.getByText("纸张规格")).toBeInTheDocument();
    expect(screen.getByText("页边距")).toBeInTheDocument();
  });

  it("calls printPreview and onClose on clicking confirm button", async () => {
    const printSpy = vi.spyOn(printLib, "printPreview").mockReturnValue(true);
    const onClose = vi.fn();

    render(
      <PrintExportModal
        open={true}
        documentTitle="测试文档.md"
        content="内容"
        onClose={onClose}
      />,
    );

    const exportBtn = screen.getByRole("button", { name: /导出 PDF \/ 打印/ });
    await userEvent.click(exportBtn);

    expect(printSpy).toHaveBeenCalledWith("测试文档.md");
    expect(onClose).toHaveBeenCalledOnce();
    printSpy.mockRestore();
  });

  it("closes on Escape key", async () => {
    const onClose = vi.fn();
    render(
      <PrintExportModal
        open={true}
        documentTitle="测试文档.md"
        content="内容"
        onClose={onClose}
      />,
    );

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
