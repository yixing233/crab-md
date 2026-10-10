import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AboutDialog } from "./AboutDialog";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useUpdateStore } from "../../stores/useUpdateStore";

// 版本由后端给出（与更新器比较的版本同源）。
const appVersion = vi.fn();
vi.mock("../../lib/api", () => ({
  api: {
    appVersion: () => appVersion(),
  },
  toAppError: (raw: unknown) =>
    raw && typeof raw === "object" && "code" in raw
      ? raw
      : { code: "UNKNOWN", message: String(raw) },
}));

// 更新检查走 Tauri IPC；替身让它可控，也避免控制台刷错误日志。
const updaterCheck = vi.fn();
vi.mock("../../lib/updaterBridge", () => ({
  tauriUpdaterBridge: {
    check: () => updaterCheck(),
    relaunch: vi.fn().mockResolvedValue(undefined),
    currentVersion: vi.fn().mockResolvedValue("0.1.0"),
  },
}));

function renderAbout(over: Partial<Parameters<typeof AboutDialog>[0]> = {}) {
  const props: Parameters<typeof AboutDialog>[0] = {
    open: true,
    onClose: vi.fn(),
    ...over,
  };
  render(<AboutDialog {...props} />);
  return props;
}

describe("AboutDialog (UI §16、§34)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认「版本取不到」-> 组件回退到构建期常量；需要断言的用例自行覆盖。
    appVersion.mockRejectedValue(new Error("no ipc"));
    updaterCheck.mockResolvedValue(null);
    useUpdateStore.setState({ status: { kind: "idle" }, barDismissed: false });
    useWorkspaceStore.setState({ flushActive: vi.fn().mockResolvedValue(true) } as never);
  });

  it("renders nothing when closed", () => {
    renderAbout({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is a titled modal dialog, so it is findable without the settings page (UI §16)", () => {
    renderAbout();
    const dialog = screen.getByRole("dialog", { name: "关于 crab-md" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("shows the app version", () => {
    renderAbout();
    expect(screen.getByTestId("app-version")).toBeInTheDocument();
  });

  it("shows the running version reported by the backend, not a build-time constant", async () => {
    // 后端是版本的权威来源（与更新检查同源），前端常量可能漂移。
    appVersion.mockResolvedValue("1.2.3");
    renderAbout();

    await waitFor(() =>
      expect(screen.getByTestId("app-version")).toHaveTextContent("1.2.3"),
    );
  });

  it("falls back to the build-time version when the backend is unreachable", () => {
    appVersion.mockRejectedValue(new Error("no ipc"));
    renderAbout();

    // 取不到也不该显示空白或报错。
    expect(screen.getByTestId("app-version")).not.toHaveTextContent("");
  });

  it("describes itself as local-first rather than advertising", () => {
    renderAbout();
    expect(screen.getByText(/本地优先/)).toBeInTheDocument();
  });

  it("closes from the close button", async () => {
    const props = renderAbout();
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape (UI §16 requires desktop escape handling)", async () => {
    const props = renderAbout();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("closes when the overlay is clicked", async () => {
    const props = renderAbout();
    const overlay = screen.getByRole("dialog").parentElement!;
    await userEvent.click(overlay);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  // ---- 版面（§34.0 三带结构） ----

  it("does not repeat the app name below its own title (UI §34.0)", () => {
    renderAbout();

    // 标题已经写着「关于 crab-md」，正文再放一遍就是重复标题。
    expect(screen.queryByText("crab-md")).not.toBeInTheDocument();
  });

  it("pins the update entry in a footer band with its action, not adrift in the body", () => {
    renderAbout();

    // 动作要和它所属的区块同处一个贴底容器，否则会浮在剩余空白里。
    const check = screen.getByRole("button", { name: /检查更新/ });
    expect(check.closest("footer")).not.toBeNull();
    expect(screen.getByTestId("update-status").closest("footer")).toBe(check.closest("footer"));
  });

  it("keeps fact values out of the single-line truncating settings list", () => {
    renderAbout();

    // `.settings-meta dd` 会 ellipsis 截断；数据格式是一句话，截断等于藏信息。
    expect(screen.getByTestId("app-version").closest(".settings-meta")).toBeNull();
    expect(screen.getByText("标准 Markdown + 本地 SQLite 索引")).toBeInTheDocument();
  });

  // ---- 软件更新 ----

  it("reports when the app is up to date", async () => {
    updaterCheck.mockResolvedValue(null);
    renderAbout();

    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));

    expect(await screen.findByText("已是最新版本")).toBeInTheDocument();
  });

  it("offers to install when a new version exists", async () => {
    updaterCheck.mockResolvedValue({ version: "9.9.9", notes: null, downloadAndInstall: vi.fn() });
    renderAbout();

    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));

    expect(await screen.findByText(/9\.9\.9/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下载并安装/ })).toBeInTheDocument();
  });

  it("explains a check failure and suggests what to do", async () => {
    updaterCheck.mockRejectedValue(new Error("network down"));
    renderAbout();

    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));

    // 主动检查要给出可操作的原因（代理/GitHub 不可达），而不是空手而归。
    expect(await screen.findByText("检查更新失败")).toBeInTheDocument();
    expect(screen.getByText(/代理/)).toBeInTheDocument();
  });

  it("asks for confirmation before installing, since it restarts the app", async () => {
    const update = { version: "9.9.9", notes: null, downloadAndInstall: vi.fn() };
    updaterCheck.mockResolvedValue(update);
    renderAbout();

    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    await userEvent.click(await screen.findByRole("button", { name: /下载并安装/ }));

    // 安装会关闭应用 —— 必须确认，且说清会重启。
    expect(await screen.findByText(/安装完成后应用会自动重启/)).toBeInTheDocument();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("does not install when the confirmation is cancelled", async () => {
    const update = { version: "9.9.9", notes: null, downloadAndInstall: vi.fn() };
    updaterCheck.mockResolvedValue(update);
    renderAbout();

    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    await userEvent.click(await screen.findByRole("button", { name: /下载并安装/ }));
    await userEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("saves unsaved work before installing, so the restart cannot lose it", async () => {
    const update = { version: "9.9.9", notes: null, downloadAndInstall: vi.fn() };
    updaterCheck.mockResolvedValue(update);

    const flushActive = vi.fn().mockResolvedValue(true);
    useWorkspaceStore.setState({ flushActive } as never);

    renderAbout();
    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    await userEvent.click(await screen.findByRole("button", { name: /下载并安装/ }));
    await userEvent.click(await screen.findByRole("button", { name: /安装并重启/ }));

    // 顺序很关键：先落盘，再安装。
    await waitFor(() => expect(flushActive).toHaveBeenCalled());
    await waitFor(() => expect(update.downloadAndInstall).toHaveBeenCalled());
  });

  it("aborts installation when saving fails, rather than losing the user's work", async () => {
    const update = { version: "9.9.9", notes: null, downloadAndInstall: vi.fn() };
    updaterCheck.mockResolvedValue(update);

    // 落盘失败 => 绝不安装（安装会关应用，等于丢内容）。
    const flushActive = vi.fn().mockResolvedValue(false);
    useWorkspaceStore.setState({ flushActive } as never);

    renderAbout();
    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    await userEvent.click(await screen.findByRole("button", { name: /下载并安装/ }));
    await userEvent.click(await screen.findByRole("button", { name: /安装并重启/ }));

    await waitFor(() => expect(flushActive).toHaveBeenCalled());
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("notifies the host when saving fails, so the user is told why nothing happened", async () => {
    const update = { version: "9.9.9", notes: null, downloadAndInstall: vi.fn() };
    updaterCheck.mockResolvedValue(update);
    const onSaveFailed = vi.fn();
    useWorkspaceStore.setState({ flushActive: vi.fn().mockResolvedValue(false) } as never);

    renderAbout({ onSaveFailed });
    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    await userEvent.click(await screen.findByRole("button", { name: /下载并安装/ }));
    await userEvent.click(await screen.findByRole("button", { name: /安装并重启/ }));

    await waitFor(() => expect(onSaveFailed).toHaveBeenCalledWith(expect.stringContaining("保存失败")));
  });
});
