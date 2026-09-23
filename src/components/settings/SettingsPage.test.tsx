import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { defaultPreviewTypography } from "../../lib/previewTypography";
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
const appVersion = vi.fn();
// getSettings 的返回值由 setSettings() 同步设置，避免挂载后的 loadSettings
// 用一份"默认值"覆盖掉各个用例自己的 fixture。
const getSettingsApi = vi.fn();
// 工厂是**整体替换**模块：真实 useWorkspaceStore / SettingsPage 会调用
// api 上多个方法，漏掉哪个就会在运行时 undefined 并被 catch 静默吞掉
//（测试仍绿，但该路径其实没被验证）。
vi.mock("../../lib/api", () => ({
  api: {
    getSettings: () => getSettingsApi(),
    setWorkspaceRoot: vi.fn(),
    resetWorkspaceRoot: vi.fn(),
    defaultWorkspaceRoot: () => defaultWorkspaceRoot(),
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
    syncScroll: true,
    onChangeSyncScroll: vi.fn(),
    fontSize: "md",
    onChangeFontSize: vi.fn(),
    latinFont: "system",
    onChangeLatinFont: vi.fn(),
    cjkFont: "system",
    onChangeCjkFont: vi.fn(),
    previewTypography: defaultPreviewTypography(),
    onChangePreviewElement: vi.fn(),
    onResetPreviewTypography: vi.fn(),
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
  syncScroll: true,
  onChangeSyncScroll: () => {},
  fontSize: "md",
  onChangeFontSize: () => {},
  latinFont: "system",
  onChangeLatinFont: () => {},
  cjkFont: "system",
  onChangeCjkFont: () => {},
  previewTypography: defaultPreviewTypography(),
  onChangePreviewElement: () => {},
  onResetPreviewTypography: () => {},
};

/** 切到某个分组（设置页是左侧导航 + 右侧内容）。 */
async function goTo(label: string) {
  await userEvent.click(screen.getByRole("button", { name: label }));
}

describe("SettingsPage (UI §34)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultWorkspaceRoot.mockResolvedValue("E:/default/workspace");
    // 默认「版本取不到」-> 组件回退到构建期常量；需要断言的用例自行覆盖。
    appVersion.mockRejectedValue(new Error("no ipc"));
    updaterCheck.mockResolvedValue(null);
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
    // §34：分组按用户心智模型 —— 外观/编辑器/预览排版/文件与数据/关于，
    // 而不是「数据库 / 路径 / 缓存」。
    const nav = screen.getByRole("navigation", { name: "设置分组" });
    for (const label of ["外观", "编辑器", "预览排版", "文件与数据", "关于"]) {
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

  describe("preview typography group", () => {
    it("lists every element category the user asked for", async () => {
      setSettings();
      renderPage();
      await goTo("预览排版");

      // 正文 + 六个标题层级 + 代码 + 引用 + 表格 + 公式。
      for (const name of [
        "正文",
        "一级标题",
        "二级标题",
        "三级标题",
        "四级标题",
        "五级标题",
        "六级标题",
        "代码",
        "引用",
        "表格",
        "公式",
      ]) {
        expect(screen.getByText(name), name).toBeInTheDocument();
      }
    });

    it("keeps the six heading levels separate rather than merging them", async () => {
      // 用户明确要求标题逐级独立：大标题与六级标题要能设成不同字体。
      setSettings();
      renderPage();
      await goTo("预览排版");

      const numerals = ["一", "二", "三", "四", "五", "六"];
      for (const n of numerals) {
        expect(
          screen.getByRole("button", { name: new RegExp(`${n}级标题.*字体`) }),
          `${n}级标题`,
        ).toBeInTheDocument();
      }
    });

    it("offers the Latin face once, globally, not per element", async () => {
      // 拉丁是全局一项：逐元素重复设置同一件事没有意义。
      setSettings();
      renderPage();
      await goTo("预览排版");
      expect(screen.getByText("西文字体")).toBeInTheDocument();

      // 11 行元素 + 1 个全局西文选择器，字体按钮不该出现 12 个独立分组。
      const latinPickers = screen.getAllByRole("radiogroup", { name: "西文字体" });
      expect(latinPickers).toHaveLength(1);
    });

    it("reports a per-element change with that element's id", async () => {
      setSettings();
      const props = renderPage();
      await goTo("预览排版");

      await userEvent.click(screen.getByRole("button", { name: /一级标题.*放大/ }));

      expect(props.onChangePreviewElement).toHaveBeenCalledWith(
        "h1",
        expect.objectContaining({ sizePx: expect.any(Number) }),
      );
    });

    it("does not report changes for other elements when one is adjusted", async () => {
      // 分元素设置若会互相影响，这个功能就没有意义了。
      setSettings();
      const props = renderPage();
      await goTo("预览排版");

      await userEvent.click(screen.getByRole("button", { name: /代码.*放大/ }));

      const calls = (props.onChangePreviewElement as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe("code");
    });

    it("offers a reset so a ruined setting is recoverable", async () => {
      setSettings();
      const props = renderPage();
      await goTo("预览排版");

      await userEvent.click(screen.getByRole("button", { name: "恢复默认排版" }));
      expect(props.onResetPreviewTypography).toHaveBeenCalledOnce();
    });
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

    // 精确匹配：/大/ 会同时命中「大 16」与「特大 18」（子串匹配）。
    await userEvent.click(screen.getByRole("radio", { name: "大 16" }));

    // 设置页是受控组件：它只上报选择，**应用与持久化由 App 负责**。
    // （字号在这里自己 setState + 应用的话，就只有打开过设置页才生效，
    //  重启即回默认 —— 那条链路由 App.test.tsx 覆盖。）
    expect(props.onChangeFontSize).toHaveBeenCalledWith("lg");
  });

  it("reports the chosen Chinese font to its owner", async () => {
    setSettings();
    const props = renderPage();
    await goTo("编辑器");

    await userEvent.click(screen.getByRole("radio", { name: "宋体" }));

    expect(props.onChangeCjkFont).toHaveBeenCalledWith("simsun");
  });

  it("reports the chosen Latin font to its owner, separately from Chinese", async () => {
    setSettings();
    const props = renderPage();
    await goTo("编辑器");

    await userEvent.click(screen.getByRole("radio", { name: "Times New Roman" }));

    expect(props.onChangeLatinFont).toHaveBeenCalledWith("times");
    // 关键：改西文**不应**动到中文。
    expect(props.onChangeCjkFont).not.toHaveBeenCalled();
  });

  it("offers Chinese and Latin fonts as two separate groups", async () => {
    setSettings();
    renderPage();
    await goTo("编辑器");

    // 两组各有自己的可访问名，用户能分辨在改哪一侧。
    expect(screen.getByRole("radiogroup", { name: "中文字体" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "西文字体" })).toBeInTheDocument();

    // 中文字体在中文组里。
    const cjkGroup = screen.getByRole("radiogroup", { name: "中文字体" });
    for (const name of ["微软雅黑", "黑体", "宋体", "楷体", "仿宋"]) {
      expect(within(cjkGroup).getByRole("radio", { name })).toBeInTheDocument();
    }
    // 西文字体在西文组里。
    const latinGroup = screen.getByRole("radiogroup", { name: "西文字体" });
    for (const name of ["Times New Roman", "Georgia", "Arial", "Calibri"]) {
      expect(within(latinGroup).getByRole("radio", { name })).toBeInTheDocument();
    }
  });

  it("renders each option's name in its own font so the choice is visible", async () => {
    setSettings();
    renderPage();
    await goTo("编辑器");

    // 这是选择列表的核心价值：读到「宋体」两个字本身就是宋体。
    const option = screen.getByRole("radio", { name: "宋体" });
    const nameEl = option.querySelector(".ui-font-picker__name") as HTMLElement;
    expect(nameEl.style.fontFamily).toContain("SimSun");
  });

  it("renders Latin options in their own font too", async () => {
    setSettings();
    renderPage();
    await goTo("编辑器");

    const option = screen.getByRole("radio", { name: "Georgia" });
    const nameEl = option.querySelector(".ui-font-picker__name") as HTMLElement;
    expect(nameEl.style.fontFamily).toContain("Georgia");
  });

  it("marks the active fonts as checked, independently per group", async () => {
    setSettings();
    renderPage({ cjkFont: "kaiti", latinFont: "georgia" });
    await goTo("编辑器");

    expect(screen.getByRole("radio", { name: "楷体" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "宋体" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("radio", { name: "Georgia" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Arial" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("renders the sample with the current size and both fonts", async () => {
    setSettings();
    renderPage({ fontSize: "lg", latinFont: "times", cjkFont: "simsun" });
    await goTo("编辑器");

    // 三项互相影响，用真实值渲染示例才看得出合起来的效果。
    const sample = screen.getByTestId("font-sample");
    expect(sample).toHaveStyle({ fontSize: "16px" });
    // 西文在前、中文在后 —— 顺序决定了汉字是否真的走中文字体。
    const stack = sample.style.fontFamily;
    expect(stack).toContain("Times New Roman");
    expect(stack).toContain("SimSun");
    expect(stack.indexOf("Times New Roman")).toBeLessThan(stack.indexOf("SimSun"));
  });

  it("offers the three view modes and reports the choice", async () => {
    setSettings();
    const props = renderPage();
    await goTo("编辑器");

    await userEvent.click(screen.getByRole("radio", { name: "仅阅读" }));
    expect(props.onChangeViewMode).toHaveBeenCalledWith("preview");
  });

  it("offers the sync scroll switch and reports user toggle", async () => {
    setSettings();
    const props = renderPage({ syncScroll: true });
    await goTo("编辑器");

    expect(screen.getByText("同步滚动")).toBeInTheDocument();
    const disabledOption = screen.getByRole("radio", { name: "关闭" });
    expect(disabledOption).toBeInTheDocument();

    await userEvent.click(disabledOption);
    expect(props.onChangeSyncScroll).toHaveBeenCalledWith(false);
  });

  it("reflects disabled sync scroll state and allows turning on", async () => {
    setSettings();
    const props = renderPage({ syncScroll: false });
    await goTo("编辑器");

    const enabledOption = screen.getByRole("radio", { name: "开启" });
    expect(enabledOption).toBeInTheDocument();

    await userEvent.click(enabledOption);
    expect(props.onChangeSyncScroll).toHaveBeenCalledWith(true);
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
    expect(screen.getByTestId("app-version")).toBeInTheDocument();
  });

  it("shows the running version reported by the backend, not a build-time constant", async () => {
    setSettings();
    // 后端是版本的权威来源（与更新检查同源），前端常量可能漂移。
    appVersion.mockResolvedValue("1.2.3");
    renderPage();
    await goTo("关于");

    await waitFor(() =>
      expect(screen.getByTestId("app-version")).toHaveTextContent("1.2.3"),
    );
  });

  it("falls back to the build-time version when the backend is unreachable", async () => {
    setSettings();
    appVersion.mockRejectedValue(new Error("no ipc"));
    renderPage();
    await goTo("关于");

    // 取不到也不该显示空白或报错。
    expect(screen.getByTestId("app-version")).not.toHaveTextContent("");
  });

  it("describes itself as local-first rather than advertising", async () => {
    setSettings();
    renderPage();
    await goTo("关于");
    expect(screen.getByText(/本地优先/)).toBeInTheDocument();
  });

  // ---- 软件更新 ----

  it("reports when the app is up to date", async () => {
    setSettings();
    updaterCheck.mockResolvedValue(null);
    renderPage();
    await goTo("关于");

    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));

    expect(await screen.findByText("已是最新版本")).toBeInTheDocument();
  });

  it("offers to install when a new version exists", async () => {
    setSettings();
    updaterCheck.mockResolvedValue({ version: "9.9.9", notes: null, downloadAndInstall: vi.fn() });
    renderPage();
    await goTo("关于");

    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));

    expect(await screen.findByText(/9\.9\.9/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下载并安装/ })).toBeInTheDocument();
  });

  it("explains a check failure and suggests what to do", async () => {
    setSettings();
    updaterCheck.mockRejectedValue(new Error("network down"));
    renderPage();
    await goTo("关于");

    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));

    // 主动检查要给出可操作的原因（代理/GitHub 不可达），而不是空手而归。
    expect(await screen.findByText("检查更新失败")).toBeInTheDocument();
    expect(screen.getByText(/代理/)).toBeInTheDocument();
  });

  it("asks for confirmation before installing, since it restarts the app", async () => {
    setSettings();
    const update = { version: "9.9.9", notes: null, downloadAndInstall: vi.fn() };
    updaterCheck.mockResolvedValue(update);
    renderPage();
    await goTo("关于");

    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    await userEvent.click(await screen.findByRole("button", { name: /下载并安装/ }));

    // 安装会关闭应用 —— 必须确认，且说清会重启。
    expect(await screen.findByText(/安装完成后应用会自动重启/)).toBeInTheDocument();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("does not install when the confirmation is cancelled", async () => {
    setSettings();
    const update = { version: "9.9.9", notes: null, downloadAndInstall: vi.fn() };
    updaterCheck.mockResolvedValue(update);
    renderPage();
    await goTo("关于");

    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    await userEvent.click(await screen.findByRole("button", { name: /下载并安装/ }));
    await userEvent.click(await screen.findByRole("button", { name: "取消" }));

    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });

  it("saves unsaved work before installing, so the restart cannot lose it", async () => {
    setSettings();
    const update = { version: "9.9.9", notes: null, downloadAndInstall: vi.fn() };
    updaterCheck.mockResolvedValue(update);

    const flushActive = vi.fn().mockResolvedValue(true);
    useWorkspaceStore.setState({ flushActive } as never);

    renderPage();
    await goTo("关于");
    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    await userEvent.click(await screen.findByRole("button", { name: /下载并安装/ }));
    await userEvent.click(await screen.findByRole("button", { name: /安装并重启/ }));

    // 顺序很关键：先落盘，再安装。
    await waitFor(() => expect(flushActive).toHaveBeenCalled());
    await waitFor(() => expect(update.downloadAndInstall).toHaveBeenCalled());
  });

  it("aborts installation when saving fails, rather than losing the user's work", async () => {
    setSettings();
    const update = { version: "9.9.9", notes: null, downloadAndInstall: vi.fn() };
    updaterCheck.mockResolvedValue(update);

    // 落盘失败 => 绝不安装（安装会关应用，等于丢内容）。
    const flushActive = vi.fn().mockResolvedValue(false);
    useWorkspaceStore.setState({ flushActive } as never);

    renderPage();
    await goTo("关于");
    await userEvent.click(screen.getByRole("button", { name: /检查更新/ }));
    await userEvent.click(await screen.findByRole("button", { name: /下载并安装/ }));
    await userEvent.click(await screen.findByRole("button", { name: /安装并重启/ }));

    await waitFor(() => expect(flushActive).toHaveBeenCalled());
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
  });
});
