import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useUpdateStore,
  __setUpdateBridge,
  __resetUpdateBridge,
} from "./useUpdateStore";
import { __setPendingUpdate, type UpdaterBridge } from "../lib/updater";

function bridge(over: Partial<UpdaterBridge> = {}): UpdaterBridge {
  return {
    check: vi.fn().mockResolvedValue(null),
    relaunch: vi.fn().mockResolvedValue(undefined),
    currentVersion: vi.fn().mockResolvedValue("0.1.0"),
    ...over,
  };
}

function update(version = "0.2.0") {
  return {
    version,
    notes: null,
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  __resetUpdateBridge();
  __setPendingUpdate(null);
  useUpdateStore.setState({
    status: { kind: "idle" },
    barDismissed: false,
    dismissedVersion: null,
  });
});

describe("useUpdateStore.check", () => {
  it("reports being up to date", async () => {
    __setUpdateBridge(bridge());
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState().status.kind).toBe("up-to-date");
  });

  it("reports an available version", async () => {
    const u = update("9.9.9");
    __setUpdateBridge(bridge({ check: vi.fn().mockResolvedValue(u) }));

    await useUpdateStore.getState().check();

    const s = useUpdateStore.getState().status;
    expect(s.kind).toBe("available");
    if (s.kind === "available") expect(s.version).toBe("9.9.9");
  });

  it("surfaces a user-initiated failure as an error state", async () => {
    __setUpdateBridge(bridge({ check: vi.fn().mockRejectedValue(new Error("offline")) }));

    await useUpdateStore.getState().check();

    // 主动检查时用户期待结果，失败必须可见（与后台静默检查不同）。
    expect(useUpdateStore.getState().status.kind).toBe("error");
  });
});

describe("useUpdateStore bar visibility", () => {
  it("shows the bar when a version becomes available", () => {
    useUpdateStore.getState().setAvailable(update("1.2.3"));
    expect(useUpdateStore.getState().barDismissed).toBe(false);
  });

  it("keeps the bar hidden after the user dismisses that version", () => {
    useUpdateStore.getState().setAvailable(update("1.2.3"));
    useUpdateStore.getState().dismissBar();
    expect(useUpdateStore.getState().barDismissed).toBe(true);

    // 同一个版本再次被发现时不应重新弹出。
    useUpdateStore.getState().setAvailable(update("1.2.3"));
    expect(useUpdateStore.getState().barDismissed).toBe(true);
  });

  it("re-shows the bar for a newer version after a dismissal", () => {
    useUpdateStore.getState().setAvailable(update("1.2.3"));
    useUpdateStore.getState().dismissBar();

    // 关掉 1.2.3 之后又出了 1.3.0：必须重新提示，
    // 否则用户关一次就永远收不到后续更新。
    useUpdateStore.getState().setAvailable(update("1.3.0"));

    expect(useUpdateStore.getState().barDismissed).toBe(false);
  });

  it("clears the dismissal when the user checks manually", async () => {
    useUpdateStore.getState().setAvailable(update("1.2.3"));
    useUpdateStore.getState().dismissBar();

    __setUpdateBridge(bridge({ check: vi.fn().mockResolvedValue(update("1.2.3")) }));
    await useUpdateStore.getState().check();

    // 用户刚点过「检查更新」，是主动表达兴趣，提示条应重新出现。
    expect(useUpdateStore.getState().barDismissed).toBe(false);
  });
});

describe("useUpdateStore.install", () => {
  it("flushes before installing, so the restart cannot lose work", async () => {
    const u = update("1.2.3");
    __setUpdateBridge(bridge({ check: vi.fn().mockResolvedValue(u) }));
    await useUpdateStore.getState().check();

    const beforeInstall = vi.fn().mockResolvedValue(true);
    await useUpdateStore.getState().install(beforeInstall);

    expect(beforeInstall).toHaveBeenCalledOnce();
    expect(u.downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("aborts installation when flushing fails", async () => {
    const u = update("1.2.3");
    __setUpdateBridge(bridge({ check: vi.fn().mockResolvedValue(u) }));
    await useUpdateStore.getState().check();

    // 落盘失败 => 不安装（安装会关应用，等于丢内容）。
    const beforeInstall = vi.fn().mockResolvedValue(false);
    await useUpdateStore.getState().install(beforeInstall);

    expect(u.downloadAndInstall).not.toHaveBeenCalled();
    const s = useUpdateStore.getState().status;
    expect(s.kind).toBe("error");
    if (s.kind === "error") expect(s.fatal).toBe(true);
  });

  it("does nothing when no update is pending", async () => {
    await useUpdateStore.getState().install();
    // 不该抛错，也不该进入奇怪状态。
    expect(useUpdateStore.getState().status.kind).toBe("idle");
  });

  it("surfaces an install failure as a fatal error", async () => {
    const u = update("1.2.3");
    u.downloadAndInstall = vi.fn().mockRejectedValue(new Error("bad signature"));
    __setUpdateBridge(bridge({ check: vi.fn().mockResolvedValue(u) }));
    await useUpdateStore.getState().check();

    await useUpdateStore.getState().install();

    const s = useUpdateStore.getState().status;
    expect(s.kind).toBe("error");
    if (s.kind === "error") expect(s.fatal).toBe(true);
  });

  it("relaunches after a successful install", async () => {
    const relaunch = vi.fn().mockResolvedValue(undefined);
    const u = update("1.2.3");
    __setUpdateBridge(bridge({ check: vi.fn().mockResolvedValue(u), relaunch }));
    await useUpdateStore.getState().check();

    await useUpdateStore.getState().install();

    expect(relaunch).toHaveBeenCalledOnce();
  });
});
