/**
 * 应用更新（检查 → 下载 → 安装）。
 *
 * 设计原则（这是「稳定」的关键，不是可选细节）：
 *
 * 1. **失败静默**：网络不可达、GitHub 被墙、代理异常都是常态。
 *    自动检查失败时只写日志，绝不弹错误、绝不影响编辑 —— 用户开应用是来写笔记的。
 *    只有用户**主动**点「检查更新」时才展示失败原因。
 *
 * 2. **不打断编辑**：下载完成后不自动重启。安装会关掉应用，
 *    必须先让用户确认，并在重启前把未保存内容落盘（否则等于丢数据）。
 *
 * 3. **签名校验由后端完成**：公钥在 tauri.conf.json，前端无法绕过。
 *    被篡改的包会在安装时被拒绝，不需要（也不能）在前端自己做校验。
 *
 * 4. **启动检查节流**：一天最多一次。频繁打扰比不更新更烦人。
 */

import { logFailure, logInfo } from "./log";

/** 自动检查的最小间隔：24 小时。 */
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 上次自动检查时间戳的存储键。 */
export const LAST_CHECK_KEY = "crab-md.update-last-check";

/** 更新生命周期状态。 */
export type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date"; version: string }
  | { kind: "available"; version: string; notes: string | null }
  | { kind: "downloading"; version: string; downloaded: number; total: number | null }
  | { kind: "ready"; version: string }
  /**
   * fatal=true 表示「安装阶段」失败（含签名校验不过、无写入权限、
   * 或未保存内容落盘失败）。这类失败必须显式告知用户；
   * 而检查失败（fatal=false，通常只是网络）可以轻描淡写。
   */
  | { kind: "error"; code: string; fatal?: boolean };

/** 检查结果里我们关心的字段（不直接暴露插件类型，便于测试替身）。 */
export interface AvailableUpdate {
  version: string;
  notes?: string | null;
  downloadAndInstall: (onProgress?: (downloaded: number, total: number | null) => void) => Promise<void>;
}

/** 插件桥接：抽象出来便于单测注入替身。 */
export interface UpdaterBridge {
  check: () => Promise<AvailableUpdate | null>;
  relaunch: () => Promise<void>;
  currentVersion: () => Promise<string>;
}

/** 已发现的更新，供「立即重启安装」使用。 */
let pending: AvailableUpdate | null = null;

export function __setPendingUpdate(update: AvailableUpdate | null): void {
  pending = update;
}

export function getPendingUpdate(): AvailableUpdate | null {
  return pending;
}

/**
 * 是否到了该自动检查的时间。
 *
 * 用 localStorage 记录时间戳：检查频率属纯客户端偏好，
 * 不值得为它引入后端配置（也不需要跨设备同步）。
 */
export function shouldAutoCheck(now: number, lastCheck: number | null): boolean {
  if (lastCheck === null || Number.isNaN(lastCheck)) return true;
  // 时钟回拨（用户改系统时间）时差值可能为负 —— 此时按"该检查"处理，
  // 否则一次误操作会把自动检查永久卡住。
  if (now < lastCheck) return true;
  return now - lastCheck >= AUTO_CHECK_INTERVAL_MS;
}

export function readLastCheck(storage: Pick<Storage, "getItem"> | null): number | null {
  if (!storage) return null;
  // getItem 本身也可能抛（隐私模式、存储被禁用）。
  // 检查节流读不到时间戳就当作"从未检查" —— 最坏是多查一次，
  // 远好于因异常中断整个更新流程。
  let raw: string | null;
  try {
    raw = storage.getItem(LAST_CHECK_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function writeLastCheck(storage: Pick<Storage, "setItem"> | null, now: number): void {
  if (!storage) return;
  try {
    storage.setItem(LAST_CHECK_KEY, String(now));
  } catch {
    // 存储不可用（隐私模式/配额）不应让更新流程失败。
  }
}

/**
 * 检查更新。
 *
 * 返回 null 表示已是最新。**不抛异常** —— 网络问题在这里被消化掉，
 * 由调用方决定是否展示（手动检查 vs 自动检查）。
 */
export async function checkForUpdate(
  bridge: UpdaterBridge,
): Promise<{ update: AvailableUpdate | null } | { error: string }> {
  try {
    const update = await bridge.check();
    if (update) {
      pending = update;
      logInfo("update.available", `version=${update.version}`);
    }
    return { update };
  } catch (raw) {
    // 网络不可达是最常见的情况，不值得当作错误上报给用户。
    const message = raw instanceof Error ? raw.message : String(raw);
    logFailure({ op: "update.check", code: "UPDATE_CHECK_FAILED" }, raw);
    return { error: message };
  }
}

/**
 * 下载并安装更新。
 *
 * 注意：`downloadAndInstall` 返回时更新**已安装**，此时必须重启才生效。
 * 调用方应当先落盘再调用（见 App 的 handleInstallUpdate）。
 */
export async function downloadAndInstall(
  update: AvailableUpdate,
  onProgress?: (status: UpdateStatus) => void,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await update.downloadAndInstall((downloaded, total) => {
      onProgress?.({ kind: "downloading", version: update.version, downloaded, total });
    });
    onProgress?.({ kind: "ready", version: update.version });
    logInfo("update.installed", `version=${update.version}`);
    return { ok: true };
  } catch (raw) {
    // 安装失败可能源于签名不匹配（包被篡改）或权限不足，必须让用户知道。
    logFailure({ op: "update.install", code: "UPDATE_INSTALL_FAILED" }, raw);
    const message = raw instanceof Error ? raw.message : String(raw);
    return { ok: false, error: message };
  }
}

/** 重启应用以应用更新。 */
export async function relaunchApp(bridge: UpdaterBridge): Promise<void> {
  await bridge.relaunch();
}
