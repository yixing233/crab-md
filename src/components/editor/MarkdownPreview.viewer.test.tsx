import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

const readAttachment = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api", () => ({
  api: {
    readAttachment: (...a: unknown[]) => readAttachment(...a),
    readLocalAsset: vi.fn().mockRejectedValue(new Error("not available")),
  },
}));
vi.mock("../../lib/openExternalLink", () => ({
  canOpenExternally: (raw: string) => /^https?:/i.test(raw),
  openExternalLink: vi.fn(),
}));

describe("MarkdownPreview image lightbox", () => {
  beforeEach(() => {
    readAttachment.mockReset().mockResolvedValue(new Uint8Array());
  });

  it("opens the lightbox on image click and closes on Escape", async () => {
    render(<MarkdownPreview source={"![截图](https://example.com/shot.png)"} />);

    await userEvent.click(screen.getByRole("img", { name: "截图" }));

    const dialog = await screen.findByRole("dialog", { name: "查看图片：截图" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/shot.png",
    );

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("closes on backdrop click but not on image click", async () => {
    render(<MarkdownPreview source={"![截图](https://example.com/shot.png)"} />);
    await userEvent.click(screen.getByRole("img", { name: "截图" }));

    const dialog = screen.getByRole("dialog");
    // 点图片本体：不关闭（那是拖拽/缩放的把手）
    fireEvent.click(dialog.querySelector("img")!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // 点遮罩：关闭
    fireEvent.click(dialog);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("does not open the lightbox for images wrapped in a link", async () => {
    // 链接优先：包在链接里的图片点击应走链接分流，不进灯箱。
    const onOpenLink = vi.fn();
    render(
      <MarkdownPreview
        source={"[![封面](https://example.com/cover.png)](./detail.md)"}
        onOpenLink={onOpenLink}
      />,
    );

    await userEvent.click(screen.getByRole("img", { name: "封面" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onOpenLink).toHaveBeenCalledWith("./detail.md");
  });
});

describe("MarkdownPreview long code block collapsing", () => {
  const longBody = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
  const source = "```js\n" + longBody + "\n```";

  it("renders long blocks collapsed and expands on button click", async () => {
    const { container } = render(<MarkdownPreview source={source} />);

    const block = container.querySelector<HTMLElement>(".code-block")!;
    expect(block.dataset.collapsed).toBe("true");

    await userEvent.click(screen.getByRole("button", { name: "展开全部 30 行" }));

    expect(block.dataset.collapsed).toBe("false");
    expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "收起" }));
    expect(block.dataset.collapsed).toBe("true");
  });

  it("keeps the copy button working next to the expand button", async () => {
    render(<MarkdownPreview source={source} />);
    expect(screen.getByRole("button", { name: "复制代码" })).toBeInTheDocument();
  });
});
