import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { THEME_STORAGE_KEY } from "./lib/theme";

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDocuments.mockResolvedValue([]);
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
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

  it("applies a resolved theme to <html> on mount", async () => {
    render(<App />);
    const theme = await screen.findByRole("banner").then(
      () => document.documentElement.getAttribute("data-theme"),
    );
    // 空存储回退为 system；jsdom 不报告 prefers-color-scheme: dark，故解析为 light。
    expect(theme).toBe("light");
  });

  it("routes the theme button light -> dark and persists it", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<App />);
    await screen.findByRole("banner");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    await userEvent.click(screen.getByTitle(/theme/i));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("cycles dark -> system -> light -> dark", async () => {
    // 起始值显式播种，避免依赖"空存储解析成 system"这一隐式前提。
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<App />);
    await screen.findByRole("banner");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    const btn = screen.getByTitle(/theme/i);

    await userEvent.click(btn); // dark -> system
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    // jsdom 不报告 prefers-color-scheme: dark，故 system 生效为 light。
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    await userEvent.click(btn); // system -> light
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await userEvent.click(btn); // light -> dark（回到起点）
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("restores a stored dark preference on mount", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<App />);
    await screen.findByRole("banner");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
