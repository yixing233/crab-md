import { render, screen, waitFor } from "@testing-library/react";
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

const defaultWorkspaceRoot = vi.fn();
vi.mock("../../lib/api", () => ({
  api: {
    defaultWorkspaceRoot: () => defaultWorkspaceRoot(),
  },
  toAppError: (raw: unknown) =>
    raw && typeof raw === "object" && "code" in raw
      ? raw
      : { code: "UNKNOWN", message: String(raw) },
}));

function setSettings(over: Partial<Record<string, unknown>> = {}) {
  useWorkspaceStore.setState({
    settings: {
      workspaceRoot: null,
      effectiveWorkspaceRoot: "E:/default/workspace",
      workspaceRootIsFromEnv: false,
      configPath: "E:/config/settings.json",
      version: 1,
      ...over,
    } as never,
  });
}

function renderPage(over: Partial<Parameters<typeof SettingsPage>[0]> = {}) {
  const props = { open: true, onClose: vi.fn(), onChanged: vi.fn(), ...over };
  render(<SettingsPage {...props} />);
  return props;
}

describe("SettingsPage (UI §34)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultWorkspaceRoot.mockResolvedValue("E:/default/workspace");
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

  it("shows the effective data directory, not just the configured one", async () => {
    setSettings({ effectiveWorkspaceRoot: "E:/actual/place" });
    renderPage();
    // 用户要看的是"实际在用哪个目录"，而不是"设置里写了什么"。
    expect(screen.getByTestId("effective-workspace-root")).toHaveTextContent("E:/actual/place");
  });

  it("shows the settings file location so it can be backed up", async () => {
    setSettings({ configPath: "E:/config/settings.json" });
    renderPage();
    expect(await screen.findByText(/E:\/config\/settings\.json/)).toBeInTheDocument();
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
    await userEvent.click(screen.getByText("数据目录"));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("asks for confirmation before switching directories", async () => {
    setSettings();
    openDialog.mockResolvedValue("E:/other/place");
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /浏览/ }));

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

    await userEvent.click(screen.getByRole("button", { name: /浏览/ }));
    await userEvent.click(await screen.findByRole("button", { name: "取消" }));

    expect(switchSpy).not.toHaveBeenCalled();
  });

  it("switches and reports success once confirmed", async () => {
    setSettings();
    openDialog.mockResolvedValue("E:/other/place");
    const switchSpy = vi.fn().mockResolvedValue(true);
    useWorkspaceStore.setState({ setWorkspaceRoot: switchSpy } as never);
    const props = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /浏览/ }));
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

    await userEvent.click(screen.getByRole("button", { name: /浏览/ }));

    // 选同一个目录是无操作，不该弹确认框打扰用户。
    expect(screen.queryByText(/原目录里的内容不会被删除/)).not.toBeInTheDocument();
    expect(switchSpy).not.toHaveBeenCalled();
  });

  it("explains when an environment variable overrides the setting", async () => {
    setSettings({ workspaceRootIsFromEnv: true });
    renderPage();

    // 这种情况下改设置不会生效，必须说清楚，而不是让用户白点。
    expect(await screen.findByText(/CRAB_MD_WORKSPACE/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /浏览/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /恢复默认/ })).toBeDisabled();
  });

  it("enables reset only when a custom path is set", async () => {
    setSettings({ workspaceRoot: null });
    const { unmount } = render(<SettingsPage open onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByRole("button", { name: /恢复默认/ })).toBeDisabled();
    unmount();

    setSettings({ workspaceRoot: "E:/custom" });
    render(<SettingsPage open onClose={() => {}} onChanged={() => {}} />);
    expect(screen.getByRole("button", { name: /恢复默认/ })).toBeEnabled();
  });

  it("shows the platform default location as a hint", async () => {
    setSettings();
    renderPage();
    expect(await screen.findByText(/E:\/default\/workspace/)).toBeInTheDocument();
  });

  it("groups by user mental model, not implementation module (UI §34)", () => {
    setSettings();
    renderPage();
    // 分组名是「文件与数据」，而不是「数据库 / 路径配置」。
    expect(screen.getByRole("heading", { name: "文件与数据" })).toBeInTheDocument();
  });
});
