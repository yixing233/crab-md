import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Breadcrumb } from "./Breadcrumb";

describe("Breadcrumb", () => {
  it("shows the current title", () => {
    render(<Breadcrumb virtualPath="/" title="我的笔记" />);
    expect(screen.getByText("我的笔记")).toBeInTheDocument();
  });

  it("marks the current item with aria-current, not just colour (UI §39)", () => {
    render(<Breadcrumb virtualPath="/" title="我的笔记" />);
    expect(screen.getByText("我的笔记")).toHaveAttribute("aria-current", "page");
  });

  it("renders nothing extra for the root path", () => {
    // 根目录不该出现「/ / 文档名」这种冗余段。
    render(<Breadcrumb virtualPath="/" title="甲" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("splits a nested path into segments", () => {
    render(<Breadcrumb virtualPath="/笔记/Go/" title="并发" />);
    expect(screen.getByText("笔记")).toBeInTheDocument();
    expect(screen.getByText("Go")).toBeInTheDocument();
    expect(screen.getByText("并发")).toBeInTheDocument();
  });

  it("reports the cumulative path when a segment is clicked", async () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb virtualPath="/笔记/Go/" title="并发" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    // 累积路径，供调用方定位到该层。
    expect(onNavigate).toHaveBeenCalledWith("/笔记/Go/");
  });

  it("reports the first-level path for the first segment", async () => {
    const onNavigate = vi.fn();
    render(<Breadcrumb virtualPath="/笔记/Go/" title="并发" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole("button", { name: "笔记" }));
    expect(onNavigate).toHaveBeenCalledWith("/笔记/");
  });

  it("renders plain text (no buttons) when navigation is not wired", () => {
    render(<Breadcrumb virtualPath="/笔记/" title="并发" />);
    expect(screen.getByText("笔记")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses an accessible landmark name", () => {
    render(<Breadcrumb virtualPath="/" title="甲" />);
    expect(screen.getByRole("navigation", { name: "文档位置" })).toBeInTheDocument();
  });
});
