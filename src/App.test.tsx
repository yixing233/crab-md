import { render, screen, waitFor } from "@testing-library/react";
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
    duplicateDocument: vi.fn(),
    // 设置相关：SettingsPage 会用到，工厂必须一并提供（整体替换模块）。
    getSettings: vi.fn().mockResolvedValue({
      workspaceRoot: null,
      effectiveWorkspaceRoot: "E:/default/workspace",
      workspaceRootIsFromEnv: false,
      configPath: "E:/config/settings.json",
      version: 1,
    }),
    setWorkspaceRoot: vi.fn(),
    resetWorkspaceRoot: vi.fn(),
    defaultWorkspaceRoot: vi.fn().mockResolvedValue("E:/default/workspace"),
  },
  toAppError: (raw: unknown) =>
    raw && typeof raw === "object" && "code" in raw
      ? raw
      : { code: "UNKNOWN", message: String(raw) },
}));

import App from "./App";
import { THEME_STORAGE_KEY } from "./lib/theme";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";

/**
 * store 是模块级单例，状态会跨用例泄漏（例如上一个用例留下的 activeId
 * 会让状态栏显示「已保存」，与本用例的 toast 文案撞车）。
 * 每个用例前显式重置，保证互相独立。
 */
function resetStore() {
  useWorkspaceStore.setState({
    documents: [],
    activeId: null,
    activeContent: "",
    dirty: false,
    loading: false,
    error: null,
  });
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
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
    expect(await screen.findByText("还没有笔记")).toBeInTheDocument();
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

    await userEvent.click(screen.getByLabelText(/主题/));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("cycles dark -> system -> light -> dark", async () => {
    // 起始值显式播种，避免依赖"空存储解析成 system"这一隐式前提。
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<App />);
    await screen.findByRole("banner");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    const btn = screen.getByLabelText(/主题/);

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

/**
 * 批次 C 补齐的能力：大纲、面包屑、快捷键、轻提示。
 * 这些是「规范要求但此前完全不存在」的部分，用测试固定住。
 */
describe("App panes and shortcuts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    listDocuments.mockResolvedValue([]);
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  /** 打开一篇文档，让三栏有内容可渲染。 */
  async function openOneDocument() {
    const doc = {
      id: "d1", title: "甲", virtualPath: "/", revision: 1,
      contentHash: "sha256:x", createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z", size: 0,
    };
    const { api } = await import("./lib/api");
    listDocuments.mockResolvedValue([doc]);
    (api.readDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ ...doc, content: "# 标题" });
    render(<App />);
    await userEvent.click(await screen.findByText("甲"));
  }

  it("duplicates a document from the sidebar menu and confirms with a toast", async () => {
    await openOneDocument();
    const { api } = await import("./lib/api");
    (api.duplicateDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "d2", title: "甲 副本", virtualPath: "/", revision: 1,
      contentHash: "sha256:x", createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z", size: 0,
    });

    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "另存为副本" }));

    // 默认标题由 i18n 生成（「<原标题> 副本」），不是硬编码在组件里。
    expect(api.duplicateDocument).toHaveBeenCalledWith("d1", "甲 副本");
    const toast = await waitFor(() => {
      const el = document.querySelector(".ui-toast");
      if (!el) throw new Error("toast not rendered");
      return el;
    });
    expect(toast).toHaveTextContent("已另存为副本");
  });

  it("reports a failed duplicate without claiming success", async () => {
    await openOneDocument();
    const { api } = await import("./lib/api");
    (api.duplicateDocument as ReturnType<typeof vi.fn>).mockRejectedValue({
      code: "IO_ERROR",
      message: "disk full",
    });

    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "另存为副本" }));

    const toast = await waitFor(() => {
      const el = document.querySelector(".ui-toast[data-tone='error']");
      if (!el) throw new Error("error toast not rendered");
      return el;
    });
    // 文案要说明原文未受影响，否则用户会以为原稿也出问题了。
    expect(toast).toHaveTextContent("另存失败，原文未受影响");
  });

  it("hides the preview in edit-only mode (收起预览栏)", async () => {
    await openOneDocument();
    // 分栏时两者都在。
    expect(screen.getByTestId("markdown-editor")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "文档位置" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "仅编辑" }));

    // 编辑器保留，预览（阅读面）消失。
    expect(screen.getByTestId("markdown-editor")).toBeInTheDocument();
    expect(document.querySelector(".app-pane--preview")).toBeNull();
  });

  it("hides the source editor in preview-only mode (收起源码栏)", async () => {
    await openOneDocument();

    await userEvent.click(screen.getByRole("radio", { name: "仅阅读" }));

    // 源码编辑器消失，阅读面保留。
    expect(screen.queryByTestId("markdown-editor")).toBeNull();
    expect(document.querySelector(".app-pane--preview")).not.toBeNull();
  });

  it("shows both panes in split mode", async () => {
    await openOneDocument();
    await userEvent.click(screen.getByRole("radio", { name: "仅编辑" }));
    await userEvent.click(screen.getByRole("radio", { name: "分栏" }));

    expect(screen.getByTestId("markdown-editor")).toBeInTheDocument();
    expect(document.querySelector(".app-pane--preview")).not.toBeNull();
  });

  it("records the chosen mode on the panes container", async () => {
    await openOneDocument();
    await userEvent.click(screen.getByRole("radio", { name: "仅阅读" }));
    // CSS 依赖该属性决定单栏铺满（见 App.css）。
    expect(document.querySelector(".app-panes")).toHaveAttribute("data-view", "preview");
  });

  it("persists the view mode so it survives a restart", async () => {
    await openOneDocument();
    await userEvent.click(screen.getByRole("radio", { name: "仅阅读" }));
    expect(localStorage.getItem("crab-md.view-mode")).toBe("preview");
  });

  it("cycles the view mode with Ctrl+backslash", async () => {
    await openOneDocument();
    const panes = () => document.querySelector(".app-panes");

    // 默认分栏 -> 仅阅读
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(panes()).toHaveAttribute("data-view", "preview");

    // 仅阅读 -> 仅编辑
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(panes()).toHaveAttribute("data-view", "edit");

    // 仅编辑 -> 分栏（回到起点）
    await userEvent.keyboard("{Control>}\\{/Control}");
    expect(panes()).toHaveAttribute("data-view", "split");
  });

  it("opens settings from the toolbar button", async () => {
    render(<App />);
    await screen.findByRole("banner");

    await userEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(await screen.findByTestId("effective-workspace-root")).toBeInTheDocument();
  });

  it("opens settings with Ctrl+comma (UI §29)", async () => {
    render(<App />);
    await screen.findByRole("banner");

    await userEvent.keyboard("{Control>},{/Control}");

    expect(await screen.findByTestId("effective-workspace-root")).toBeInTheDocument();
  });

  it("closes settings again", async () => {
    render(<App />);
    await screen.findByRole("banner");
    await userEvent.click(screen.getByRole("button", { name: "设置" }));
    await screen.findByTestId("effective-workspace-root");

    await userEvent.click(screen.getByRole("button", { name: "关闭" }));

    await waitFor(() =>
      expect(screen.queryByTestId("effective-workspace-root")).not.toBeInTheDocument(),
    );
  });

  it("toggles the outline pane from the toolbar", async () => {
    render(<App />);
    await screen.findByRole("banner");

    const toggle = screen.getByRole("button", { name: "大纲" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles the outline with Ctrl+Shift+O", async () => {
    render(<App />);
    await screen.findByRole("banner");
    const toggle = screen.getByRole("button", { name: "大纲" });

    await userEvent.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("creates a document with Ctrl+N", async () => {
    const { api } = await import("./lib/api");
    render(<App />);
    await screen.findByRole("banner");

    await userEvent.keyboard("{Control>}n{/Control}");
    expect(api.createDocument).toHaveBeenCalled();
  });

  it("shows a toast after Ctrl+S", async () => {
    const doc = {
      id: "d1", title: "甲", virtualPath: "/", revision: 1,
      contentHash: "sha256:x", createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z", size: 0,
    };
    const { api } = await import("./lib/api");
    listDocuments.mockResolvedValue([doc]);
    (api.readDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ ...doc, content: "hi" });
    (api.saveDocument as ReturnType<typeof vi.fn>).mockResolvedValue(doc);

    render(<App />);
    await userEvent.click(await screen.findByText("甲"));

    await userEvent.keyboard("{Control>}s{/Control}");

    // 「已保存」在状态栏也会出现（文档干净时），所以断言必须限定在提示元素上。
    const toast = await waitFor(() => {
      const el = document.querySelector(".ui-toast");
      if (!el) throw new Error("toast not rendered");
      return el;
    });
    expect(toast).toHaveTextContent("已保存");
    expect(toast).toHaveAttribute("data-tone", "success");
  });

  it("shows a hint instead of a blank pane while the workspace loads", async () => {
    // 让列表请求悬停不决，观察加载态。
    listDocuments.mockImplementation(() => new Promise(() => {}));
    render(<App />);
    // 文案同时出现在 spinner 的 aria-label 与说明段落里，故用 getAllByText。
    expect((await screen.findAllByText("正在载入工作区…")).length).toBeGreaterThan(0);
    // 且确实渲染在 main 里，而不是某个被隐藏的区域。
    expect(screen.getByRole("main").querySelector(".app-loading")).toBeTruthy();
  });
});
