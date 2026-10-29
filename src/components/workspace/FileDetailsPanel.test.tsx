import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { FileDetailsPanel } from "./FileDetailsPanel";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import type { FileDetails } from "../../types/document";

function details(over: Partial<FileDetails> = {}): FileDetails {
  return {
    path: "E:\\notes\\a.md",
    name: "a.md",
    documentId: null,
    size: 2048,
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-02T00:00:00Z",
    openedAt: "2026-01-03T00:00:00Z",
    pinned: false,
    exists: true,
    text: "# 标题\n\n正文内容",
    ...over,
  };
}

function mockLoad(result: FileDetails | null) {
  const spy = vi.fn().mockResolvedValue(result);
  useWorkspaceStore.setState({ loadFileDetails: spy } as never);
  return spy;
}

describe("FileDetailsPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the full path, size and timestamps", async () => {
    mockLoad(details());
    render(<FileDetailsPanel path="E:\\notes\\a.md" onClose={() => {}} />);

    expect(await screen.findByText("E:\\notes\\a.md")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.getByText("a.md")).toBeInTheDocument();
  });

  it("counts words from the text", async () => {
    // 详情里的字数来自后端给的正文；只读文件头是数不出来的。
    mockLoad(details({ text: "中文四个字 and two words" }));
    render(<FileDetailsPanel path="E:\\notes\\a.md" onClose={() => {}} />);

    // 中文 5 字 + 英文 3 词（and / two / words）
    expect(await screen.findByText("8")).toBeInTheDocument();
  });

  it("omits word counts when the body could not be read", async () => {
    mockLoad(details({ text: null }));
    render(<FileDetailsPanel path="E:\\notes\\a.md" onClose={() => {}} />);

    await screen.findByText("E:\\notes\\a.md");
    expect(screen.queryByText("字数")).not.toBeInTheDocument();
  });

  it("flags a file that is no longer on disk", async () => {
    mockLoad(details({ exists: false }));
    render(<FileDetailsPanel path="E:\\notes\\a.md" onClose={() => {}} />);

    expect(await screen.findByText("文件已不在磁盘上")).toBeInTheDocument();
  });

  it("shows a failure state instead of fake data", async () => {
    mockLoad(null);
    render(<FileDetailsPanel path="E:\\notes\\a.md" onClose={() => {}} />);

    expect(
      await screen.findByText(/无法读取这个文件的详情/),
    ).toBeInTheDocument();
  });

  it("closes via the drawer close button", async () => {
    mockLoad(details());
    const onClose = vi.fn();
    render(<FileDetailsPanel path="E:\\notes\\a.md" onClose={onClose} />);

    await screen.findByText("E:\\notes\\a.md");
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
