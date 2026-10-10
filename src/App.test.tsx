import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listDocuments = vi.fn();
const listExternalFiles = vi.fn();
const readExternalFile = vi.fn();
const saveExternalFile = vi.fn();
const forgetExternalFile = vi.fn();
vi.mock("./lib/api", () => ({
  api: {
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    createDocument: vi.fn(),
    readDocument: vi.fn(),
    saveDocument: vi.fn(),
    renameDocument: vi.fn(),
    deleteDocument: vi.fn(),
    duplicateDocument: vi.fn(),
    // 外部文件：打开时读盘、保存时写回、列表来自数据库。
    readExternalFile: (...a: unknown[]) => readExternalFile(...a),
    saveExternalFile: (...a: unknown[]) => saveExternalFile(...a),
    listExternalFiles: (...a: unknown[]) => listExternalFiles(...a),
    forgetExternalFile: (...a: unknown[]) => forgetExternalFile(...a),
    // 统一磁盘文件 API
    listRecentFiles: vi.fn().mockResolvedValue([]),
    openFile: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    removeFromHistory: vi.fn(),
    deleteFileOnDisk: vi.fn(),
    searchFiles: vi.fn().mockResolvedValue([]),
    updateFileSession: vi.fn(),
    setFilePinned: vi.fn(),
    revealFile: vi.fn(),
    // 右键「打开文件所在位置」：整体替换模块，漏了会抛
    // "api.revealDocument is not a function"。
    revealDocument: vi.fn(),
    revealExternalFile: vi.fn(),
    saveAttachment: vi.fn(),
    readAttachment: vi.fn(),
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
    // SettingsPage 挂载即拉版本；工厂是整体替换，漏了会抛
    // "api.appVersion is not a function"。
    appVersion: vi.fn().mockResolvedValue("0.1.0"),
  },
  toAppError: (raw: unknown) =>
    raw && typeof raw === "object" && "code" in raw
      ? raw
      : { code: "UNKNOWN", message: String(raw) },
}));

import App from "./App";
import { THEME_STORAGE_KEY } from "./lib/theme";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";

// 更新检查会走 Tauri IPC，jsdom 里没有桥。替身让它可断言，
// 也避免每次挂载都在控制台刷 "UPDATE_CHECK_FAILED"。
const updaterCheck = vi.fn();
vi.mock("./lib/updaterBridge", () => ({
  tauriUpdaterBridge: {
    check: () => updaterCheck(),
    relaunch: vi.fn().mockResolvedValue(undefined),
    currentVersion: vi.fn().mockResolvedValue("0.1.0"),
  },
}));

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
    recoveryCandidate: null,
    externalFiles: [],
    externalFilesLoaded: false,
    externalBaseline: null,
  });
}

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    listDocuments.mockResolvedValue([]);
    // 默认「没有打开过外部文件」：大多数用例不关心这条路径。
    listExternalFiles.mockResolvedValue([]);
    // 默认「已是最新」：大多数用例不关心更新，别让它们被更新提示干扰。
    updaterCheck.mockResolvedValue(null);
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("--editor-font-size");
    document.documentElement.style.removeProperty("--editor-font-family");
  });

  describe("update check on startup", () => {
    it("checks for updates once on mount", async () => {
      render(<App />);
      await screen.findByRole("banner");

      await waitFor(() => expect(updaterCheck).toHaveBeenCalledOnce());
    });

    it("does not check again within the throttle window", async () => {
      // 记下「刚刚检查过」，再挂载一次：应当被节流挡住，不再请求。
      localStorage.setItem("crab-md.update-last-check", String(Date.now()));
      render(<App />);
      await screen.findByRole("banner");

      expect(updaterCheck).not.toHaveBeenCalled();
    });

    it("checks again after the throttle window has passed", async () => {
      localStorage.setItem(
        "crab-md.update-last-check",
        String(Date.now() - 25 * 60 * 60 * 1000),
      );
      render(<App />);
      await screen.findByRole("banner");

      await waitFor(() => expect(updaterCheck).toHaveBeenCalledOnce());
    });

    it("makes a new version visible in both the toolbar and a persistent bar", async () => {
      updaterCheck.mockResolvedValue({
        version: "9.9.9",
        notes: null,
        downloadAndInstall: vi.fn(),
      });
      render(<App />);
      await screen.findByRole("banner");

      // 提示条：常驻（UI §33 要求「需要用户选择」用持久 UI，不能用会消失的 toast）。
      const bar = await screen.findByTestId("update-bar");
      expect(bar).toHaveTextContent("9.9.9");

      // 工具栏徽标：即使提示条被关掉，入口仍然可达。
      expect(
        screen.getByRole("button", { name: /有新版本 9\.9\.9/ }),
      ).toBeInTheDocument();
    });

    it("keeps the toolbar entry after the bar is dismissed", async () => {
      updaterCheck.mockResolvedValue({
        version: "9.9.9",
        notes: null,
        downloadAndInstall: vi.fn(),
      });
      render(<App />);
      await screen.findByRole("banner");
      await screen.findByTestId("update-bar");

      // 关掉提示条后仍能从工具栏进入 —— 否则用户关一次就再也找不到更新。
      await userEvent.click(screen.getByRole("button", { name: "暂不更新" }));

      expect(screen.queryByTestId("update-bar")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /有新版本 9\.9\.9/ }),
      ).toBeInTheDocument();
    });

    it("stays silent when the check fails (offline is normal)", async () => {
      // 网络不通不能变成错误提示 —— 用户开应用是来写笔记的。
      updaterCheck.mockRejectedValue(new Error("offline"));
      render(<App />);
      await screen.findByRole("banner");

      await waitFor(() => expect(updaterCheck).toHaveBeenCalled());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("records the check time even when it fails, so it does not retry every launch", async () => {
      updaterCheck.mockRejectedValue(new Error("offline"));
      render(<App />);
      await screen.findByRole("banner");

      await waitFor(() =>
        expect(localStorage.getItem("crab-md.update-last-check")).not.toBeNull(),
      );
    });
  });

  // 编辑器偏好必须在**挂载时**就生效。曾经它只由设置页持有，
  // 于是必须先打开过设置页才应用，重启应用即回到默认值 —— 用户会认为
  // 「字号设置没保存」。
  it("applies the stored editor font size on mount, without opening settings", async () => {
    localStorage.setItem("crab-md.editor-font-size", "lg");
    render(<App />);
    await screen.findByRole("banner");

    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("16px");
  });

  it("applies the stored editor font family on mount", async () => {
    localStorage.setItem("crab-md.editor-font-family", "simsun");
    render(<App />);
    await screen.findByRole("banner");

    expect(document.documentElement.style.getPropertyValue("--editor-font-family")).toContain(
      "SimSun",
    );
  });

  it("applies a font family stored by an older version, instead of resetting it", async () => {
    // 旧版本存的是抽象类别。若不做迁移，老用户升级后会看到字体被重置，
    // 体感就是「我的设置丢了」。
    localStorage.setItem("crab-md.editor-font-family", "serif");
    render(<App />);
    await screen.findByRole("banner");

    expect(document.documentElement.style.getPropertyValue("--editor-font-family")).toContain(
      "SimSun",
    );
  });

  it("falls back to the default font size when nothing is stored", async () => {
    render(<App />);
    await screen.findByRole("banner");

    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("14px");
  });

  it("persists a font size chosen in settings and survives a remount", async () => {
    const { unmount } = render(<App />);
    await screen.findByRole("banner");
    await userEvent.click(screen.getByRole("button", { name: "设置" }));
    await userEvent.click(screen.getByRole("button", { name: "编辑器" }));
    // 精确匹配：/大/ 会同时命中「大 16」与「特大 18」（子串匹配）。
    await userEvent.click(screen.getByRole("radio", { name: "大 16" }));

    await waitFor(() =>
      expect(localStorage.getItem("crab-md.editor-font-size")).toBe("lg"),
    );
    unmount();

    // 重启后仍是「大」—— 这正是之前缺的那一环。
    document.documentElement.style.removeProperty("--editor-font-size");
    render(<App />);
    await screen.findByRole("banner");
    expect(document.documentElement.style.getPropertyValue("--editor-font-size")).toBe("16px");
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

  it("reveals a workspace document in the file manager without a toast", async () => {
    await openOneDocument();
    const { api } = await import("./lib/api");
    (api.revealDocument as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开文件所在位置" }));

    // 路径由 Rust 解析，前端只递 id —— §7.1 要求前端不掌握磁盘布局。
    await waitFor(() => expect(api.revealDocument).toHaveBeenCalledWith("d1"));
    // 文件管理器窗口本身就是反馈，成功再弹 toast 只会碍事。
    expect(document.querySelector(".ui-toast")).toBeNull();
  });

  it("says so when the file to reveal is gone", async () => {
    await openOneDocument();
    const { api } = await import("./lib/api");
    (api.revealDocument as ReturnType<typeof vi.fn>).mockRejectedValue({
      code: "NOT_FOUND",
      message: "document not found: d1",
    });

    await userEvent.click(screen.getByRole("button", { name: /更多操作/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "打开文件所在位置" }));

    // 静默失败与坏掉的菜单项无法区分，故失败必须说出来。
    const toast = await waitFor(() => {
      const el = document.querySelector(".ui-toast[data-tone='error']");
      if (!el) throw new Error("error toast not rendered");
      return el;
    });
    expect(toast).toHaveTextContent("无法定位「甲」");
  });

  it("toggles synchronized scrolling in split view and persists the preference", async () => {
    localStorage.clear();
    await openOneDocument();

    // 默认开启同步滚动
    const toggle = screen.getByRole("button", { name: "同步滚动" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    // 点击关闭同步滚动
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(localStorage.getItem("crab-md.sync-scroll")).toBe("false");

    // 再次点击开启同步滚动
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("crab-md.sync-scroll")).toBe("true");
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

    // 默认打开「外观」分组；用面板的分组导航确认打开了。
    expect(await screen.findByRole("navigation", { name: "设置分组" })).toBeInTheDocument();
  });

  it("opens settings with Ctrl+comma (UI §29)", async () => {
    render(<App />);
    await screen.findByRole("banner");

    await userEvent.keyboard("{Control>},{/Control}");

    expect(await screen.findByRole("navigation", { name: "设置分组" })).toBeInTheDocument();
  });

  it("closes settings again", async () => {
    render(<App />);
    await screen.findByRole("banner");
    await userEvent.click(screen.getByRole("button", { name: "设置" }));
    await screen.findByRole("navigation", { name: "设置分组" });

    await userEvent.click(screen.getByRole("button", { name: "关闭" }));

    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: "设置分组" })).not.toBeInTheDocument(),
    );
  });

  it("toggles the outline sidebar with the toggle button", async () => {
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

    const toggle = await screen.findByRole("button", { name: "切换侧边栏" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("toggles the outline with Ctrl+Shift+O", async () => {
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
    const toggle = await screen.findByRole("button", { name: "切换侧边栏" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await userEvent.keyboard("{Control>}{Shift>}o{/Shift}{/Control}");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("switches the sidebar between the files and outline panels", async () => {
    await openOneDocument();

    // 默认停在「文件」：新工作区里大纲是空的，先给可执行的入口。
    expect(screen.getByRole("tab", { name: "文件" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tree", { name: "笔记列表" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "大纲" }));

    expect(screen.getByRole("tab", { name: "大纲" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("navigation", { name: "文档大纲" })).toBeInTheDocument();
    // 面板互斥：切走后文件树不再渲染。
    expect(screen.queryByRole("tree", { name: "笔记列表" })).not.toBeInTheDocument();
  });

  it("remembers the chosen sidebar panel across a remount", async () => {
    const doc = {
      id: "d1", title: "甲", virtualPath: "/", revision: 1,
      contentHash: "sha256:x", createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z", size: 0,
    };
    const { api } = await import("./lib/api");
    listDocuments.mockResolvedValue([doc]);
    (api.readDocument as ReturnType<typeof vi.fn>).mockResolvedValue({ ...doc, content: "# 标题" });

    const first = render(<App />);
    await userEvent.click(await screen.findByText("甲"));
    await userEvent.click(screen.getByRole("tab", { name: "大纲" }));
    expect(localStorage.getItem("crab-md.sidebar-tab")).toBe("outline");
    first.unmount();

    // 重新挂载后仍停在大纲，而不是回到默认面板。
    resetStore();
    render(<App />);
    await screen.findByRole("banner");
    expect(await screen.findByRole("tab", { name: "大纲" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("brings the outline panel back from the view menu", async () => {
    await openOneDocument();
    // 先切回文件面板，让大纲处于「未显示」。
    await userEvent.click(screen.getByRole("tab", { name: "文件" }));
    expect(screen.queryByRole("navigation", { name: "文档大纲" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "视图" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "大纲" }));

    // 菜单里的「大纲」不再是独立开关，而是把侧栏切到对应面板。
    expect(screen.getByRole("tab", { name: "大纲" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("navigation", { name: "文档大纲" })).toBeInTheDocument();
  });

  it("switches the view mode from the menu bar", async () => {
    await openOneDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "视图" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "仅阅读" }));

    expect(document.querySelector(".app-panes")).toHaveAttribute("data-view", "preview");  });

  it("runs the same 新建 command from the 文件 menu as from the toolbar", async () => {
    const { api } = await import("./lib/api");
    render(<App />);
    await screen.findByRole("menubar", { name: "主菜单" });

    await userEvent.click(screen.getByRole("menuitem", { name: "文件" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "新建" }));

    // 菜单项只是转发到 handleNewDocument，没有另写一条路径。
    expect(api.createDocument).toHaveBeenCalled();
  });

  it("greys out document commands in the 文件 menu when nothing is open", async () => {
    render(<App />);
    await screen.findByRole("menubar", { name: "主菜单" });

    await userEvent.click(screen.getByRole("menuitem", { name: "文件" }));

    // 明示不可用，比「点了没反应」更好判断。
    expect(await screen.findByRole("menuitem", { name: "保存" })).toBeDisabled();
  });

  it("opens the command palette from the 编辑 menu", async () => {
    render(<App />);
    await screen.findByRole("menubar", { name: "主菜单" });

    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "命令面板" }));

    expect(await screen.findByRole("dialog", { name: "命令面板" })).toBeInTheDocument();
  });

  it("opens the about dialog from the 帮助 menu, without the settings page", async () => {
    render(<App />);
    await screen.findByRole("menubar", { name: "主菜单" });

    await userEvent.click(screen.getByRole("menuitem", { name: "帮助" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "关于 crab-md" }));

    // 「关于」是独立对话框，不再把用户丢进设置页。
    expect(await screen.findByRole("dialog", { name: "关于 crab-md" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "设置分组" })).not.toBeInTheDocument();
  });

  it("opens the about dialog from the toolbar update entry, so the badge leads to the install", async () => {
    updaterCheck.mockResolvedValue({
      version: "9.9.9",
      notes: null,
      downloadAndInstall: vi.fn(),
    });
    render(<App />);
    await screen.findByRole("banner");

    await userEvent.click(await screen.findByRole("button", { name: /有新版本 9\.9\.9/ }));

    expect(await screen.findByRole("dialog", { name: "关于 crab-md" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "设置分组" })).not.toBeInTheDocument();
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

/**
 * 主题切换的波纹扩散（View Transitions API）。
 *
 * jsdom 没有实现 `startViewTransition`，所以这里自己桩一个。也正因为 jsdom
 * 没有，上面那些主题用例仍在持续验证「不支持时同步降级」这条真实路径。
 */
describe("theme ripple transition", () => {
  const originalMatchMedia = window.matchMedia;
  const originalStartViewTransition = (document as { startViewTransition?: unknown })
    .startViewTransition;

  /** 桩：同步执行回调，并记录回调执行时 `data-theme` 是什么。 */
  function stubViewTransition() {
    const themesDuringCallback: (string | null)[] = [];
    const start = vi.fn((update: () => void) => {
      update();
      themesDuringCallback.push(document.documentElement.getAttribute("data-theme"));
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      writable: true,
      value: start,
    });
    return { start, themesDuringCallback };
  }

  /** 桩 matchMedia：只让「减弱动效」查询命中，其余（如深浅色）一律不命中。 */
  function stubReducedMotion(reduced: boolean) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({ matches: reduced && query.includes("reduced-motion") }),
    });
  }

  /** 点一下主题按钮，并把指针坐标一并给出（波纹圆心取自它）。 */
  async function clickThemeButtonAt(x: number, y: number) {
    await userEvent.pointer({
      target: screen.getByLabelText(/主题/),
      coords: { x, y },
      keys: "[MouseLeft]",
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    listDocuments.mockResolvedValue([]);
    updaterCheck.mockResolvedValue(null);
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    for (const name of ["--theme-ripple-x", "--theme-ripple-y", "--theme-ripple-radius"]) {
      document.documentElement.style.removeProperty(name);
    }
  });

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", { writable: true, value: originalMatchMedia });
    if (originalStartViewTransition === undefined) {
      Reflect.deleteProperty(document, "startViewTransition");
    } else {
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        writable: true,
        value: originalStartViewTransition,
      });
    }
  });

  it("grows the ripple from the pointer position and switches theme inside the transition", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { start, themesDuringCallback } = stubViewTransition();
    render(<App />);
    await screen.findByRole("banner");

    await clickThemeButtonAt(120, 40);

    expect(start).toHaveBeenCalledOnce();
    // 圆心就是指针按下的位置，半径覆盖到视口最远角。
    expect(document.documentElement.style.getPropertyValue("--theme-ripple-x")).toBe("120px");
    expect(document.documentElement.style.getPropertyValue("--theme-ripple-y")).toBe("40px");
    const radius = Math.hypot(
      Math.max(120, window.innerWidth - 120),
      Math.max(40, window.innerHeight - 40),
    );
    expect(document.documentElement.style.getPropertyValue("--theme-ripple-radius")).toBe(
      `${radius}px`,
    );
    // 主题必须在快照抓取时已经改好，否则波纹扫过的是同一套配色。
    expect(themesDuringCallback).toEqual(["dark"]);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("starts from the viewport center for the keyboard shortcut", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { start } = stubViewTransition();
    render(<App />);
    await screen.findByRole("banner");

    // Ctrl+Shift+L 没有指针位置：从视口中心扩散最自然，而不是从左上角。
    await userEvent.keyboard("{Control>}{Shift>}l{/Shift}{/Control}");

    expect(start).toHaveBeenCalledOnce();
    expect(document.documentElement.style.getPropertyValue("--theme-ripple-x")).toBe(
      `${window.innerWidth / 2}px`,
    );
    expect(document.documentElement.style.getPropertyValue("--theme-ripple-y")).toBe(
      `${window.innerHeight / 2}px`,
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("animates menu-driven switches too, where the callback carries no event", async () => {
    // 菜单项是 `onSelect: () => void`，拿不到点击坐标 —— 这条用例固定的正是
    // 「在 window 上集中记录指针位置」这个设计所换取的能力。
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { start } = stubViewTransition();
    render(<App />);
    await screen.findByRole("menubar", { name: "主菜单" });

    await userEvent.click(screen.getByRole("menuitem", { name: "视图" }));
    // 「主题」是子菜单，靠悬停展开（`onPointerEnter`）。
    await userEvent.hover(await screen.findByRole("menuitem", { name: "主题" }));
    // 带勾选态的菜单项是 menuitemradio，不是 menuitem。
    const darkItem = await screen.findByRole("menuitemradio", { name: "深色主题" });
    await userEvent.pointer({
      target: darkItem,
      coords: { x: 300, y: 25 },
      keys: "[MouseLeft]",
    });

    expect(start).toHaveBeenCalledOnce();
    expect(document.documentElement.style.getPropertyValue("--theme-ripple-x")).toBe("300px");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("switches synchronously with no ripple when reduced motion is requested", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { start } = stubViewTransition();
    stubReducedMotion(true);
    render(<App />);
    await screen.findByRole("banner");

    await userEvent.click(screen.getByLabelText(/主题/));

    // 动画被跳过，但主题切换本身绝不能因此失效（UI §9）。
    expect(start).not.toHaveBeenCalled();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--theme-ripple-x")).toBe("");
  });

  it("does not play the ripple when the preference changes but the resolved theme does not", async () => {
    // 「跟随系统」（系统为亮）→「浅色」：偏好值变了，画面一个像素都不变。
    // 播一次 280ms 全屏波纹只会让人觉得卡了一下。
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    const { start } = stubViewTransition();
    render(<App />);
    await screen.findByRole("banner");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    await userEvent.pointer({
      // 偏好为 system 时按钮的 aria-label 是「跟随系统」，不是「*主题」。
      target: screen.getByRole("button", { name: "跟随系统" }),
      coords: { x: 120, y: 40 },
      keys: "[MouseLeft]",
    });

    expect(start).not.toHaveBeenCalled();
    // 动画省掉了，但偏好必须真的落到「浅色」并持久化。
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("does not replay the ripple when the active theme is re-selected", async () => {
    // 菜单里点已经勾选的那一行：主题没变，再来一次全屏波纹只是噪音。
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { start } = stubViewTransition();
    render(<App />);
    await screen.findByRole("menubar", { name: "主菜单" });

    await userEvent.click(screen.getByRole("menuitem", { name: "视图" }));
    await userEvent.hover(await screen.findByRole("menuitem", { name: "主题" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "浅色主题" }));

    expect(start).not.toHaveBeenCalled();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

/**
 * 外部文件：从磁盘原位打开的文件必须在重启后仍然可见、可打开。
 *
 * 这是用户报告的核心问题 —— 之前这类文件只存在于内存里，
 * 重启后标签还在但内容没了，只能重新走一遍文件选择器。
 * 现在记录保存在工作区数据库（只有路径/名称等元信息，没有正文）。
 */
describe("external files survive a restart", () => {
  const EXTERNAL_PATH = "E:\\notes\\外部.md";
  const EXTERNAL_TAB = `ext:${EXTERNAL_PATH}`;

  function record(over: Partial<Record<string, unknown>> = {}) {
    return {
      path: EXTERNAL_PATH,
      name: "外部.md",
      size: 5,
      modifiedAt: "2026-01-01T00:00:00Z",
      openedAt: "2026-01-02T00:00:00Z",
      missing: false,
      ...over,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    listDocuments.mockResolvedValue([]);
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("restores a remembered external file after a restart, without the picker", async () => {
    // 重启后的状态：文档列表为空，但数据库里还记着上次打开过的外部文件。
    listExternalFiles.mockResolvedValue([record()]);
    readExternalFile.mockResolvedValue({
      path: EXTERNAL_PATH,
      name: "外部.md",
      content: "# 重启后仍在",
      size: 6,
      modifiedAt: "2026-01-03T00:00:00Z",
    });

    render(<App />);
    await screen.findByRole("banner");

    // 统一文件列表里能直接看到它 —— 不必再走文件选择器。
    const item = await screen.findByRole("button", { name: "外部.md" });

    await userEvent.click(item);

    // 点开后重新从磁盘读正文，并切换到该标签页。
    await waitFor(() => expect(readExternalFile).toHaveBeenCalledWith(EXTERNAL_PATH));
    expect(useWorkspaceStore.getState().activeContent).toBe("# 重启后仍在");
    expect(useWorkspaceStore.getState().activeId).toBe(EXTERNAL_TAB);
    // 打开一次就刷新一次清单（库里的大小/时间戳可能变了）。
    expect(listExternalFiles.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps a remembered tab id from localStorage alive until the catalog loads", async () => {
    // 冷启动第一帧：标签 id 已从 localStorage 恢复，但清单还没读回来。
    // 此时若按「记录不存在」清理，用户的标签会被全部误删。
    localStorage.setItem("crab-md.open-tabs", JSON.stringify([EXTERNAL_TAB]));
    let resolveCatalog: (v: unknown[]) => void = () => {};
    listExternalFiles.mockImplementation(
      () => new Promise((resolve) => { resolveCatalog = resolve; }),
    );

    render(<App />);
    await screen.findByRole("banner");

    // 清单尚未返回：标签必须还在。
    expect(await screen.findByRole("tab", { name: "外部.md" })).toBeInTheDocument();

    resolveCatalog([record()]);
    await waitFor(() => expect(listExternalFiles).toHaveBeenCalled());
    expect(screen.getByRole("tab", { name: "外部.md" })).toBeInTheDocument();
  });

  it("drops a remembered tab once the catalog proves the record is gone", async () => {
    localStorage.setItem("crab-md.open-tabs", JSON.stringify([EXTERNAL_TAB]));
    listExternalFiles.mockResolvedValue([]);

    render(<App />);
    await screen.findByRole("banner");

    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("crab-md.open-tabs") ?? "[]"),
      ).not.toContain(EXTERNAL_TAB),
    );
  });

  it("saves edits back to the original file, never into the workspace", async () => {
    localStorage.setItem("crab-md.open-tabs", JSON.stringify([EXTERNAL_TAB]));
    listExternalFiles.mockResolvedValue([record()]);
    readExternalFile.mockResolvedValue({
      path: EXTERNAL_PATH,
      name: "外部.md",
      content: "旧内容",
      size: 3,
      modifiedAt: "2026-01-01T00:00:00Z",
    });
    saveExternalFile.mockResolvedValue({
      path: EXTERNAL_PATH,
      name: "外部.md",
      content: "旧内容",
      size: 3,
      modifiedAt: "2026-01-02T00:00:00Z",
    });

    render(<App />);
    await screen.findByRole("banner");

    // 打开外部标签，然后模拟一次显式保存。
    await userEvent.click(await screen.findByRole("tab", { name: "外部.md" }));
    await waitFor(() => expect(readExternalFile).toHaveBeenCalled());

    const { api } = await import("./lib/api");
    await useWorkspaceStore.getState().saveActive();

    expect(saveExternalFile).toHaveBeenCalledWith(EXTERNAL_PATH, "旧内容");
    // 原位保存：绝不创建/修改工作区文档。
    expect(api.saveDocument).not.toHaveBeenCalled();
  });

  it("does not reload from disk when the active external tab is re-clicked", async () => {
    // 重新读盘会把编辑区的未保存内容换成磁盘上的旧版本 —— 点自己当前那条
    // 标签必须是空操作（点击标签栏、点击侧栏列表两条路都要挡）。
    localStorage.setItem("crab-md.open-tabs", JSON.stringify([EXTERNAL_TAB]));
    listExternalFiles.mockResolvedValue([record()]);
    readExternalFile.mockResolvedValue({
      path: EXTERNAL_PATH,
      name: "外部.md",
      content: "磁盘上的旧内容",
      size: 7,
      modifiedAt: "2026-01-01T00:00:00Z",
    });

    render(<App />);
    await screen.findByRole("banner");
    await waitFor(() => expect(useWorkspaceStore.getState().externalFilesLoaded).toBe(true));
    await userEvent.click(await screen.findByRole("tab", { name: /外部\.md/ }));
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe(EXTERNAL_TAB));
    expect(readExternalFile).toHaveBeenCalledTimes(1);

    // 编辑内容，然后再次点击同一条标签。
    useWorkspaceStore.getState().setContent("还没保存的编辑");
    await userEvent.click(screen.getByRole("tab", { name: /外部\.md/ }));

    // 不再读盘，编辑内容原样保留。
    expect(readExternalFile).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().activeContent).toBe("还没保存的编辑");
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it("marks a vanished file as missing in the list instead of hiding it", async () => {
    listExternalFiles.mockResolvedValue([record({ missing: true })]);

    render(<App />);
    await screen.findByRole("banner");

    expect(await screen.findByText("外部.md")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "外部.md，文件不存在" }),
    ).toBeInTheDocument();
  });

  it("keeps the current file open when switching would fail to save", async () => {
    // 数据安全回归（ARCHITECTURE.md §18.1）：切换标签前必须落盘，
    // 落盘失败就不能切 —— 否则 setState 会把未保存的编辑直接覆盖掉。
    const doc = {
      id: "d1", title: "甲", virtualPath: "/", revision: 1,
      contentHash: "sha256:x", createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z", size: 0,
    };
    const { api } = await import("./lib/api");
    listDocuments.mockResolvedValue([doc]);
    (api.readDocument as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...doc,
      content: "原内容",
    });
    (api.saveDocument as ReturnType<typeof vi.fn>).mockRejectedValue({
      code: "IO_ERROR",
      message: "disk full",
    });
    listExternalFiles.mockResolvedValue([record()]);

    render(<App />);
    await screen.findByRole("banner");
    await userEvent.click(await screen.findByText("甲"));
    await waitFor(() => expect(useWorkspaceStore.getState().activeId).toBe("d1"));

    // 制造未保存编辑，然后从侧栏列表尝试切到外部文件。
    useWorkspaceStore.getState().setContent("改了但写不进去的内容");
    await userEvent.click(await screen.findByRole("button", { name: "外部.md" }));

    // 写入失败 -> 停留在原文档，内容没丢。
    await waitFor(() => expect(api.saveDocument).toHaveBeenCalled());
    expect(useWorkspaceStore.getState().activeId).toBe("d1");
    expect(useWorkspaceStore.getState().activeContent).toBe("改了但写不进去的内容");
  });

  it("does not close a tab when the final save fails", async () => {
    localStorage.setItem("crab-md.open-tabs", JSON.stringify([EXTERNAL_TAB]));
    listExternalFiles.mockResolvedValue([record()]);
    readExternalFile.mockResolvedValue({
      path: EXTERNAL_PATH,
      name: "外部.md",
      content: "原文",
      size: 2,
      modifiedAt: "2026-01-01T00:00:00Z",
    });
    saveExternalFile.mockRejectedValue({ code: "IO_ERROR", message: "read-only" });

    render(<App />);
    await screen.findByRole("banner");
    await waitFor(() => expect(useWorkspaceStore.getState().externalFilesLoaded).toBe(true));
    await userEvent.click(await screen.findByRole("tab", { name: /外部\.md/ }));
    await waitFor(() => expect(readExternalFile).toHaveBeenCalled());

    // 改动后关闭 -> 弹保存确认 -> 保存失败时标签必须留着。
    useWorkspaceStore.getState().setContent("写不进去的改动");
    await userEvent.click(screen.getByRole("button", { name: "关闭 外部.md" }));

    const confirm = await screen.findByRole("dialog");
    expect(confirm).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(saveExternalFile).toHaveBeenCalled());
    // 标签仍在，编辑内容仍在（脏标记让标签名带上「未保存」）。
    expect(screen.getByRole("tab", { name: /外部\.md/ })).toBeInTheDocument();
    expect(useWorkspaceStore.getState().activeContent).toBe("写不进去的改动");
  });
});
