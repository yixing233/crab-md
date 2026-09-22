import { create } from "zustand";
import {
  checkForUpdate,
  downloadAndInstall,
  relaunchApp,
  type AvailableUpdate,
  type UpdaterBridge,
  type UpdateStatus,
} from "../lib/updater";
import { tauriUpdaterBridge } from "../lib/updaterBridge";

/**
 * 更新状态（应用级共享）。
 *
 * 为什么是独立 store 而不是 App 的 useState：
 * 更新状态有三个互不相邻的消费者 —— 工具栏（常驻入口）、
 * 顶部提示条（需要用户决策）、设置页（详情）。放在 App 里逐层传参会
 * 让 props 迅速膨胀；放设置页里则工具栏根本拿不到（这正是字号曾犯的错）。
 *
 * 桥接通过 `__setBridge` 注入，便于单测替换 Tauri IPC。
 */
let bridge: UpdaterBridge = tauriUpdaterBridge;

/** 仅测试用：替换更新桥接。 */
export function __setUpdateBridge(next: UpdaterBridge): void {
  bridge = next;
}

/** 仅测试用：恢复真实桥接。 */
export function __resetUpdateBridge(): void {
  bridge = tauriUpdaterBridge;
}

export interface UpdateState {
  status: UpdateStatus;
  /** 用户是否关掉了提示条（同一版本不再重复打扰）。 */
  barDismissed: boolean;
  /** 被关掉提示条的版本；出现更高版本时应重新显示。 */
  dismissedVersion: string | null;

  /** 用户主动检查：失败要出错误态。 */
  check: () => Promise<void>;
  /** 下载并安装；`beforeInstall` 用于先落盘（失败则不安装）。 */
  install: (beforeInstall?: () => Promise<boolean>) => Promise<void>;
  /** 关掉提示条（本次版本不再提示）。 */
  dismissBar: () => void;
  /** 由 App 的后台检查写入结果。 */
  setAvailable: (update: AvailableUpdate) => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: { kind: "idle" },
  barDismissed: false,
  dismissedVersion: null,

  setAvailable: (update) => {
    const { dismissedVersion } = get();
    set({
      status: {
        kind: "available",
        version: update.version,
        notes: update.notes ?? null,
      },
      // 更高版本出现时重新提示 —— 否则用户关过一次就永远收不到后续更新。
      barDismissed: dismissedVersion === update.version,
    });
  },

  check: async () => {
    set({ status: { kind: "checking" } });
    const result = await checkForUpdate(bridge);
    if ("error" in result) {
      set({ status: { kind: "error", code: "UPDATE_CHECK_FAILED" } });
      return;
    }
    if (!result.update) {
      set({ status: { kind: "up-to-date", version: "" } });
      return;
    }
    set({
      status: {
        kind: "available",
        version: result.update.version,
        notes: result.update.notes ?? null,
      },
      // 手动检查时总是显示提示条 —— 用户刚表达过兴趣。
      barDismissed: false,
    });
  },

  install: async (beforeInstall) => {
    const { status } = get();
    if (status.kind !== "available") return;

    // 顺序不可颠倒：安装会关掉应用，未落盘就等于丢数据。
    if (beforeInstall) {
      const saved = await beforeInstall();
      if (!saved) {
        set({ status: { kind: "error", code: "UPDATE_SAVE_FAILED", fatal: true } });
        return;
      }
    }

    const { getPendingUpdate } = await import("../lib/updater");
    const target = getPendingUpdate();
    if (!target) {
      set({ status: { kind: "error", code: "UPDATE_NOT_FOUND" } });
      return;
    }

    const result = await downloadAndInstall(target, (next) => set({ status: next }));
    if (!result.ok) {
      set({ status: { kind: "error", code: "UPDATE_INSTALL_FAILED", fatal: true } });
      return;
    }
    await relaunchApp(bridge);
  },

  dismissBar: () => {
    const { status } = get();
    set({
      barDismissed: true,
      dismissedVersion: status.kind === "available" ? status.version : null,
    });
  },
}));
