import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

const { readAttachment, createObjectURL, revokeObjectURL } = vi.hoisted(() => ({
  readAttachment: vi.fn(),
  createObjectURL: vi.fn(() => "blob:attachment-preview"),
  revokeObjectURL: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  api: { readAttachment },
}));

describe("MarkdownPreview attachments", () => {
  it("loads a UUID attachment and renders it through an ObjectURL", async () => {
    const id = "01993ab2-0000-7000-8000-000000000000";
    readAttachment.mockResolvedValue(new Uint8Array([1, 2, 3]));
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const { container } = render(
      <MarkdownPreview source={`![pasted image](attachment://${id})`} />,
    );

    await waitFor(() => expect(readAttachment).toHaveBeenCalledWith(id));
    await waitFor(() =>
      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        "blob:attachment-preview",
      ),
    );
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("does not ask the attachment API for an invalid attachment URI", () => {
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const { container } = render(
      <MarkdownPreview source="![not an attachment](attachment://not-a-uuid)" />,
    );

    expect(readAttachment).not.toHaveBeenCalled();
    expect(container.querySelector("img")?.getAttribute("src")).not.toBe(
      "attachment://not-a-uuid",
    );
  });
});
