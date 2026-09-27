import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

const mermaidApi = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaidApi }));

describe("MarkdownPreview Mermaid diagrams", () => {
  beforeEach(() => {
    mermaidApi.initialize.mockReset();
    mermaidApi.render.mockReset();
  });

  it("renders Mermaid with strict mode and sanitizes the returned SVG", async () => {
    mermaidApi.render.mockResolvedValue({
      svg:
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>' +
        '<path d="M0 0" onclick="alert(1)" /></svg>',
    });

    const { container } = render(
      <MarkdownPreview
        source={["```mermaid", "flowchart TD", "  A --> B", "```"].join("\n")}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".mermaid-diagram svg")).not.toBeNull();
    });

    expect(mermaidApi.initialize).toHaveBeenCalledWith({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
    });
    expect(container.querySelector(".mermaid-diagram code")).toBeNull();
    expect(container.querySelector(".mermaid-diagram script")).toBeNull();
    expect(container.querySelector(".mermaid-diagram [onclick]")).toBeNull();
    expect(container.querySelector(".mermaid-diagram"))
      ?.toHaveAttribute("data-mermaid-state", "rendered");
  });

  it("keeps the escaped source when Mermaid rejects a diagram", async () => {
    mermaidApi.render.mockRejectedValue(new Error("invalid diagram"));

    const { container } = render(
      <MarkdownPreview
        source={["```mermaid", "not valid Mermaid", "```"].join("\n")}
      />,
    );

    await waitFor(() => {
      expect(mermaidApi.render).toHaveBeenCalled();
    });

    const diagram = container.querySelector(".mermaid-diagram");
    expect(diagram).not.toBeNull();
    expect(diagram?.querySelector("pre.mermaid-source code")).not.toBeNull();
    expect(diagram?.textContent).toContain("not valid Mermaid");
    expect(diagram).toHaveAttribute("data-mermaid-state", "error");
  });

  it("renders enhanced code blocks with copy button and handles copying", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const { container } = render(
      <MarkdownPreview source={"```ts\nconst greeting = 'hello';\n```"} />,
    );

    const copyBtn = container.querySelector(".code-block__copy") as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();
    expect(container.querySelector(".code-block__lang")?.textContent).toBe("ts");

    copyBtn.click();
    expect(writeText).toHaveBeenCalledWith("const greeting = 'hello';\n");

    vi.unstubAllGlobals();
  });
});
