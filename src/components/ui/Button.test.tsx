import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its label and is clickable", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies the requested variant and size as data attributes", () => {
    render(<Button variant="danger" size="lg">Delete</Button>);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn).toHaveAttribute("data-variant", "danger");
    expect(btn).toHaveAttribute("data-size", "lg");
  });

  it("blocks clicks while loading", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("marks itself busy for assistive tech while loading", () => {
    render(<Button loading>Saving</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });

  it("does not fire clicks when disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>No</Button>);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to secondary/md", () => {
    render(<Button>Plain</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("data-variant", "secondary");
    expect(btn).toHaveAttribute("data-size", "md");
  });

  // 回归：调用方传入 className 时曾整体覆盖 ui-button，导致基础布局
  // （inline-flex / align-items / gap）丢失，图标与文字错位。
  it("merges a caller className instead of replacing ui-button", () => {
    render(<Button className="custom-x">Label</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("ui-button");
    expect(btn).toHaveClass("custom-x");
  });

  it("works without a caller className", () => {
    render(<Button>Label</Button>);
    expect(screen.getByRole("button").className).toBe("ui-button");
  });

  it("marks icon-only buttons for square sizing", () => {
    render(
      <Button iconOnly aria-label="加粗">
        <svg aria-hidden />
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "加粗" });
    expect(btn).toHaveAttribute("data-icon-only");
  });

  it("does not mark normal buttons as icon-only", () => {
    render(<Button>文字</Button>);
    expect(screen.getByRole("button")).not.toHaveAttribute("data-icon-only");
  });
});
