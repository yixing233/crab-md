import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";

// 原生目录选择器在 jsdom 里不可用；这里替代成可控 stub，
// 以便验证「选了目录 -> 弹确认 -> 切换」的完整链路。
const openDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...a: unknown[]) => openDialog(...a),
}));

// 在文件管理器中打开：jsdom 里没有原生能力，stub 掉以便断言被调用。
const revealItemInDir = vi.fn();
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: (...a: unknown[]) => revealItemInDir(...a),
}));

const defaultWorkspaceRoot = vi.fn();
// getSettings 的返回值由 setSettings() 同步设置，避免挂载后的 loadSettings
// 用一份"默认值"覆盖掉各个用例自己的 fixture。
const getSettingsApi = vi.fn();
// 工厂是**整体替换**模块：真实 useWorkspaceStore 会调用 api.getSettings /
// setWorkspaceRoot / resetWorkspaceRoot，漏掉哪个就会在运行时 undefined 并
// 被 store 的 catch 静默吞掉（测试仍绿，但该路径其实没被验证）。
vi.mock("../../lib/api", () => ({
  api: {
    getSettings: () => getSettingsApi(),
    setWorkspaceRoot: vi.fn(),
    resetWorkspaceRoot: vi.fn(),
    defaultWorkspaceRoot: () => defaultWorkspaceRoot(),
  },
  toAppError: (raw: unknown) =>
    raw && typeof raw === "object" && "code" in raw
      ? raw
      : { code: "UNKNOWN", message: String(raw) },
}));

function setSettings(over: Partial<Record<string, unknown>> = {}) {
  const view = {
    workspaceRoot: null,
    effectiveWorkspaceRoot: "E:/default/workspace",
    workspaceRootIsFromEnv: false,
    configPath: "E:/config/settings.json",
    version: 1,
    ...over,
  };
  useWorkspaceStore.setState({ settings: view } as never);
  // 挂载时 loadSettings 会重新拉一次；让它返回同一份，避免覆盖用例 fixture。
  getSettingsApi.mockResolvedValue(view);
}

function renderPage(over: Partial<Parameters<typeof SettingsPage>[0]> = {}) {
  const props: Parameters<typeof SettingsPage>[0] = {
    open: true,
    onClose: vi.fn(),
    onChanged: vi.fn(),
    themePreference: "system",
    onChangeTheme: vi.fn(),
    viewMode: "split",
    onChangeViewMode: vi.fn(),
    fontSize: "md",
    onChangeFontSize: vi.fn(),
    fontFamily: "sans",
    onChangeFontFamily: vi.fn(),
    ...over,
  };
  render(<SettingsPage {...props} />);
  return props;
}

/** 直接渲染（不走 helper）时用的完整默认 props，避免每处重复。 */
const BASE_PROPS: Parameters<typeof SettingsPage>[0] = {
  open: true,
  onClose: () => {},
  onChanged: () => {},
  themePreference: "system",
  onChangeTheme: () => {},
  viewMode: "split",
  onChangeViewMode: () => {},
  fontSize: "md",
  onChangeFontSize: () => {},
  fontFamily: "sans",
  onChangeFontFamily: () => {},
};

/** 切到某个分组（设置页是左侧导航 + 右侧内容）。 */
async function goTo(label: string) {
  await userEvent.click(screen.getByRole("button", { name: label }));
}

describe("SettingsPage (UI §34)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultWorkspaceRoot.mockResolvedValue("E:/default/workspace");
    localStorage.clear();
    useWorkspaceStore.setState({
      settings: null,
      documents: [], activeId: null, activeContent: "",
      loading: false, error: null, dirty: false,
    });
  });

  it("renders nothing when closed", () => {
    renderPage({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the four groups by user mental model, not implementation module", () => {
    setSettings();
    renderPage();
    // §34：分组按用户心智模型 —— 外观/编辑器/文件与数据/关于，
    // 而不是「数据库 / 路径 / 缓存」。
    const nav = screen.getByRole("navigation", { name: "设置分组" });
    for (const label of ["外观", "编辑器", "文件与数据", "关于"]) {
      expect(within(nav).getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("opens on the appearance group", () => {
    setSettings();
    renderPage();
    expect(screen.getByRole("heading", { name: "外观" })).toBeInTheDocument();
  });

  it("switches groups from the left nav", async () => {
    setSettings();
    renderPage();
    await goTo("关于");
    expect(screen.getByTestId("app-version")).toBeInTheDocument();
  });

  it("closes with the close button", async () => {
    setSettings();
    const props = renderPage();
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", async () => {
    setSettings();
    const props = renderPage();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("does not close when clicking inside the panel", async () => {
    setSettings();
    const props = renderPage();
    await userEvent.click(screen.getByRole("heading", { name: "外观" }));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  // ---- 外观 ----

  it("offers light / dark / follow-system and reports the choice", async () => {
    setSettings();
    const props = renderPage();
    // §4.1 要求三档，缺一不可。
    await userEvent.click(screen.getByRole("radio", { name: "深色" }));
    expect(props.onChangeTheme).toHaveBeenCalledWith("dark");
  });

  it("marks the current theme as checked", () => {
    setSettings();
    renderPage({ themePreference: "dark" });
    expect(screen.getByRole("radio", { name: "深色" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "浅色" })).toHaveAttribute("aria-checked", "false");
  });

  // ---- 编辑器 ----

  it("reports the chosen font size to its owner", async () => {
    setSettings();
    const props = renderPage();
    await goTo("编辑器");

    await userEvent.click(screen.getByRole("radio", { name: /大/ }));

    // 设置页是受控组件：它只上报选择，**应用与持久化由 App 负责**。
    // （字号在这里自己 setState + 应用的话，就只有打开过设置页才生效，
    //  重启即回默认 —— 那条链路由 App.test.tsx 覆盖。）
    expect(props.onChangeFontSize).toHaveBeenCalledWith("lg");
  });

  it("reports the chosen font family to its owner", async () => {
    setSettings();
    const props = renderPage();
    await goTo("编辑器");

    await userEvent.click(screen.getByRole("radio", { name: "衬线" }));

    expect(props.onChangeFontFamily).toHaveBeenCalledWith("serif");
  });

  it("renders the sample with the current size and family", async () => {
    setSettings();
    renderPage({ fontSize: "lg", fontFamily: "serif" });
    await goTo("编辑器");

    // 两项目前互相影响，用真实值渲染示例才看得出合起来的效果。
    const sample = screen.getByTestId("font-sample");
    expect(sample).toHaveStyle({ fontSize: "16px" });
    expect(sample.style.fontFamily).toContain("Georgia");
  });

  it("offers the three view modes and reports the choice", async () => {
    setSettings();
    const props = renderPage();
    await goTo("编辑器");

    await userEvent.click(screen.getByRole("radio", { name: "仅阅读" }));
    expect(props.onChangeViewMode).toHaveBeenCalledWith("preview");
  });

  // ---- 文件与数据 ----

  it("shows the effective data directory, not just the configured one", async () => {
    setSettings({ effectiveWorkspaceRoot: "E:/actual/place" });
    renderPage();
    await goTo("文件与数据");
    // 用户要看的是"实际在用哪个目录"，而不是"设置里写了什么"。
    expect(screen.getByTestId("effective-workspace-root")).toHaveTextContent("E:/actual/place");
  });

  it("shows the full path as a tooltip so a long path stays readable", async () => {
    const long = "E:/a/very/long/path/that/would/otherwise/be/truncated/workspace";
    setSettings({ effectiveWorkspaceRoot: long });
    renderPage();
    await goTo("文件与数据");
    // 单行末尾省略，完整路径放 title —— 不再逐字符折断。
    expect(screen.getByTestId("effective-workspace-root")).toHaveAttribute("title", long);
  });

  it("shows the settings file location so it can be backed up", async () => {
    setSettings({ configPath: "E:/config/settings.json" });
    renderPage();
    await goTo("文件与数据");
    expect(await screen.findByText(/E:\/config\/settings\.json/)).toBeInTheDocument();
  });

  it("asks for confirmation before switching directories", async () => {
    setSettings();
    openDialog.mockResolvedValue("E:/other/place");
    renderPage();
    await goTo("文件与数据");

    await userEvent.click(screen.getByRole("button", { name: /更换/ }));

    // 必须确认：用户要知道换目录不等于删除旧笔记。
    expect(await screen.findByText(/切换数据目录/)).toBeInTheDocument();
    expect(screen.getByText(/原目录里的内容不会被删除/)).toBeInTheDocument();
  });

  it("does not switch when the confirmation is cancelled", async () => {
    setSettings();
    openDialog.mockResolvedValue("E:/other/place");
    const switchSpy = vi.fn();
    useWorkspaceStore.setState({ setWorkspaceRoot: switchSpy } as never);
    renderPage();
    await goTo("文件与数据");

    await userEvent.click(screen.getByRole("button", { name: /更换/ }));
    await userEvent.click(await screen.findByRole("button", { name: "取消" }));

    expect(switchSpy).not.toHaveBeenCalled();
  });

  it("switches and reports success once confirmed", async () => {
    setSettings();
    openDialog.mockResolvedValue("E:/other/place");
    const switchSpy = vi.fn().mockResolvedValue(true);
    useWorkspaceStore.setState({ setWorkspaceRoot: switchSpy } as never);
    const props = renderPage();
    await goTo("文件与数据");

    await userEvent.click(screen.getByRole("button", { name: /更换/ }));
    await userEvent.click(await screen.findByRole("button", { name: "切换" }));

    expect(switchSpy).toHaveBeenCalledWith("E:/other/place");
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  it("does not confirm when the picked folder is the current one", async () => {
    setSettings({ effectiveWorkspaceRoot: "E:/same/place" });
    openDialog.mockResolvedValue("E:/same/place");
    const switchSpy = vi.fn();
    useWorkspaceStore.setState({ setWorkspaceRoot: switchSpy } as never);
    renderPage();
    await goTo("文件与数据");

    await userEvent.click(screen.getByRole("button", { name: /更换/ }));

    // 选同一个目录是无操作，不该弹确认框打扰用户。
    expect(screen.queryByText(/原目录里的内容不会被删除/)).not.toBeInTheDocument();
    expect(switchSpy).not.toHaveBeenCalled();
  });

  it("opens the data directory in the system file manager", async () => {
    setSettings({ effectiveWorkspaceRoot: "E:/notes" });
    renderPage();
    await goTo("文件与数据");

    await userEvent.click(screen.getByRole("button", { name: /打开/ }));

    expect(revealItemInDir).toHaveBeenCalledWith("E:/notes");
  });

  it("explains when an environment variable overrides the setting", async () => {
    setSettings({ workspaceRootIsFromEnv: true });
    renderPage();
    await goTo("文件与数据");

    // 这种情况下改设置不会生效，必须说清楚，而不是让用户白点。
    expect(await screen.findByText(/CRAB_MD_WORKSPACE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /更换/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /恢复默认/ })).toBeDisabled();
  });

  it("enables reset only when a custom path is set", async () => {
    setSettings({ workspaceRoot: null });
    const { unmount } = render(<SettingsPage {...BASE_PROPS} />);
    await goTo("文件与数据");
    expect(screen.getByRole("button", { name: /恢复默认/ })).toBeDisabled();
    unmount();

    setSettings({ workspaceRoot: "E:/custom" });
    render(<SettingsPage {...BASE_PROPS} />);
    await goTo("文件与数据");
    expect(screen.getByRole("button", { name: /恢复默认/ })).toBeEnabled();
  });

  it("shows the platform default location as a hint", async () => {
    // 当前用的是自定义目录，默认位置作为"恢复默认会去哪"的提示单独显示。
    setSettings({ workspaceRoot: "E:/custom", effectiveWorkspaceRoot: "E:/custom" });
    defaultWorkspaceRoot.mockResolvedValue("E:/platform/default");
    renderPage();
    await goTo("文件与数据");
    expect(await screen.findByText("E:/platform/default")).toBeInTheDocument();
  });

  // ---- 关于 ----

  it("shows the app version in the about group", async () => {
    setSettings();
    renderPage();
    await goTo("关于");
    // 版本由 Vite 构建期注入。
    expect(screen.getByTestId("app-version")).toBeInTheDocument();
  });

  it("describes itself as local-first rather than advertising", async () => {
    setSettings();
    renderPage();
    await goTo("关于");
    expect(screen.getByText(/本地优先/)).toBeInTheDocument();
  });
});
