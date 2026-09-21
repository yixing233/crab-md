import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listDocuments = vi.fn();
vi.mock("./lib/api", () => ({
  api: {
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    createDocument: vi.fn(),
    readDocument: vi.fn(),
    saveDocument: vi.fn(),
    renameDocument: vi.fn(),
    deleteDocument: vi.fn(),
  },
  toAppError: (raw: unknown) =>
    raw && typeof raw === "object" && "code" in raw
      ? raw
      : { code: "UNKNOWN", message: String(raw) },
}));

import App from "./App";

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDocuments.mockResolvedValue([]);
  });

  it("renders the toolbar, sidebar and editor regions", async () => {
    render(<App />);
    expect(await screen.findByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("loads documents on mount", async () => {
    render(<App />);
    await screen.findByRole("tree", { name: /notes/i }).catch(() => null);
    expect(listDocuments).toHaveBeenCalled();
  });

  it("shows the empty state when there are no notes", async () => {
    render(<App />);
    expect(await screen.findByText("No notes yet")).toBeInTheDocument();
  });
});
