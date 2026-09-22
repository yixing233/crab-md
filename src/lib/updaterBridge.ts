/**
 * 更新功能的 Tauri 桥接。
 *
 * 与 `updater.ts`（纯逻辑）分开，是因为这里依赖真实的插件与 IPC，
 * 在 jsdom 里不可用：逻辑单测注入替身，只有真机才走这里。
 */

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import type { AvailableUpdate, UpdaterBridge } from "./updater";

/** 把插件的 Update 适配成我们自己的最小接口（便于测试与解耦）。 */
function adapt(update: Update): AvailableUpdate {
  return {
    version: update.version,
    notes: update.body ?? null,
    // 插件的事件名是 PascalCase（Started / Progress / Finished），
    // 且只有 Started 带 contentLength —— 总大小来自那里，不是 Progress。
    downloadAndInstall: async (onProgress) => {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          onProgress?.(0, total);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          onProgress?.(downloaded, total);
        } else {
          onProgress?.(downloaded, total);
        }
      });
    },
  };
}

export const tauriUpdaterBridge: UpdaterBridge = {
  check: async () => {
    const update = await check();
    return update ? adapt(update) : null;
  },
  relaunch: async () => {
    await relaunch();
  },
  currentVersion: async () => invoke<string>("app_version"),
};
