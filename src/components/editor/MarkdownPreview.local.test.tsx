import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

const readLocalAsset = vi.hoisted(() => vi.fn());
const openExternalLink = vi.hoisted(() => vi.fn());
const canOpenExternally = vi.hoisted(() => vi.fn((raw: string) => /^https?:/i.test(raw)));

vi.mock("../../lib/api", () => ({
  api: {
    readLocalAsset: (doc: string, ref: string) => readLocalAsset(doc, ref),
    readAttachment: vi.fn().mockResolvedValue(new Uint8Array()),
  },
}));
vi.mock("../../lib/openExternalLink", () => ({
  canOpenExternally: (raw: string) => canOpenExternally(raw),
  openExternalLink: (raw: string) => openExternalLink(raw),
}));

describe("MarkdownPreview local images (external files)", () => {
  const DOC = "E:\\docs\\note.md";

  beforeEach(() => {
    readLocalAsset.mockReset();
    openExternalLink.mockReset();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:mock-url"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  it("loads relative images from the document directory and injects the blob URL", async () => {
    readLocalAsset.mockResolvedValue(new Uint8Array([0x89, 0x50]));

    const { container } = render(<MarkdownPreview source={"![图](./pic.png)"} documentPath={DOC} />);

    await waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:mock-url");
    });
    expect(readLocalAsset).toHaveBeenCalledWith(DOC, "./pic.png");
  });

  it("keeps the pending placeholder when the asset cannot be read", async () => {
    readLocalAsset.mockRejectedValue(new Error("file gone"));

    const { container } = render(
      <MarkdownPreview source={"![图](./missing.png)"} documentPath={DOC} />,
    );

    await waitFor(() => expect(readLocalAsset).toHaveBeenCalled());
    // 读取失败让占位图兜底，而不是渲染破图或整页失败。
    expect(container.querySelector("img")?.getAttribute("src")).not.toBe("blob:mock-url");
  });

  it("does not rewrite image sources for workspace documents", () => {
    const { container } = render(<MarkdownPreview source={"![图](./pic.png)"} />);

    expect(container.querySelector("img")?.getAttribute("src")).toBe("./pic.png");
    expect(readLocalAsset).not.toHaveBeenCalled();
  });
});

describe("MarkdownPreview link routing", () => {
  beforeEach(() => {
    openExternalLink.mockReset();
    canOpenExternally.mockClear();
  });

  it("scrolls to the matching heading for an in-page anchor", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const { container } = render(<MarkdownPreview source={"[跳](#第二节)\n\n## 第二节"} />);

      // normalizeLink 会把中文锚点编码成 %XX，选择器按编码后的属性值找。
      const link = container.querySelector<HTMLAnchorElement>(
        `a[href="#${encodeURIComponent("第二节")}"]`,
      );
      expect(link).not.toBeNull();
      await userEvent.click(link as HTMLAnchorElement);

      expect(scrolled).toHaveLength(1);
      expect((scrolled[0] as HTMLElement).id).toBe(`h-${encodeURIComponent("第二节")}`);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("follows a footnote backlink by its literal id", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      const { container } = render(
        <MarkdownPreview source={"正文[^1]。\n\n[^1]: 脚注说明。"} />,
      );
      const ref = container.querySelector<HTMLAnchorElement>('a[href="#fn1"]');
      expect(ref).not.toBeNull();
      await userEvent.click(ref as HTMLAnchorElement);

      expect(scrolled).toHaveLength(1);
      expect((scrolled[0] as HTMLElement).id).toBe("fn1");
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("sends relative document links to onOpenLink", async () => {
    const onOpenLink = vi.fn();
    const { container } = render(
      <MarkdownPreview source={"[下一节](./next.md)"} onOpenLink={onOpenLink} />,
    );

    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    await userEvent.click(link as HTMLAnchorElement);

    expect(onOpenLink).toHaveBeenCalledWith("./next.md");
  });

  it("opens external links through the opener and never navigates the webview", () => {
    const { container } = render(<MarkdownPreview source={"[官网](https://example.com)"} />);

    const link = container.querySelector("a")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(openExternalLink).toHaveBeenCalledWith("https://example.com");
    expect(event.defaultPrevented).toBe(true);
  });
});
