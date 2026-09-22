import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_CHECK_INTERVAL_MS,
  checkForUpdate,
  downloadAndInstall,
  readLastCheck,
  shouldAutoCheck,
  writeLastCheck,
  __setPendingUpdate,
  getPendingUpdate,
  type UpdaterBridge,
} from "./updater";

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
    notes: "修了些东西",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  __setPendingUpdate(null);
});

describe("update check throttling", () => {
  it("checks when never checked before", () => {
    expect(shouldAutoCheck(1000, null)).toBe(true);
  });

  it("does not check again within the interval", () => {
    const now = 10_000_000;
    expect(shouldAutoCheck(now, now - 1000)).toBe(false);
    expect(shouldAutoCheck(now, now - AUTO_CHECK_INTERVAL_MS + 1)).toBe(false);
  });

  it("checks again once the interval has elapsed", () => {
    const now = 10_000_000;
    expect(shouldAutoCheck(now, now - AUTO_CHECK_INTERVAL_MS)).toBe(true);
    expect(shouldAutoCheck(now, now - AUTO_CHECK_INTERVAL_MS - 1)).toBe(true);
  });

  it("treats a clock rollback as due, so it cannot wedge forever", () => {
    // 用户把系统时间调早：lastCheck 会比 now 还大。
    // 若按差值判断就会永远为负、再也不检查 —— 这里必须放行。
    expect(shouldAutoCheck(1_000, 2_000_000)).toBe(true);
  });

  it("reads and writes the timestamp", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(readLastCheck(storage)).toBeNull();

    writeLastCheck(storage, 12345);
    expect(readLastCheck(storage)).toBe(12345);
  });

  it("ignores junk in storage instead of failing", () => {
    const storage = { getItem: () => "not-a-number", setItem: () => {} };
    expect(readLastCheck(storage)).toBeNull();
  });

  it("survives storage being unavailable", () => {
    const storage = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readLastCheck(storage)).toBeNull();
    // 写入失败不应抛出 —— 更新流程不该因为存不了时间戳而中断。
    expect(() => writeLastCheck(storage, 1)).not.toThrow();
  });
});

describe("checkForUpdate", () => {
  it("returns the update and remembers it", async () => {
    const u = update();
    const b = bridge({ check: vi.fn().mockResolvedValue(u) });

    const result = await checkForUpdate(b);

    expect(result).toEqual({ update: u });
    expect(getPendingUpdate()).toBe(u);
  });

  it("returns null when already up to date", async () => {
    const result = await checkForUpdate(bridge());
    expect(result).toEqual({ update: null });
  });

  it("absorbs network failures instead of throwing", async () => {
    // 网络不可达是常态：自动检查必须能安静地失败，不能影响应用使用。
    const b = bridge({ check: vi.fn().mockRejectedValue(new Error("network down")) });

    const result = await checkForUpdate(b);

    expect(result).toEqual({ error: "network down" });
  });

  it("handles a non-Error rejection", async () => {
    const b = bridge({ check: vi.fn().mockRejectedValue("boom") });
    expect(await checkForUpdate(b)).toEqual({ error: "boom" });
  });
});

describe("downloadAndInstall", () => {
  it("reports progress and success", async () => {
    const u = update();
    const seen: string[] = [];

    const result = await downloadAndInstall(u, (s) => seen.push(s.kind));

    expect(result).toEqual({ ok: true });
    expect(u.downloadAndInstall).toHaveBeenCalledOnce();
    expect(seen).toContain("ready");
  });

  it("forwards byte progress so the user sees movement", async () => {
    const u = update();
    u.downloadAndInstall = vi.fn().mockImplementation(async (onProgress) => {
      onProgress?.(512, 1024);
    });
    const progress: Array<[number, number | null]> = [];

    await downloadAndInstall(u, (s) => {
      if (s.kind === "downloading") progress.push([s.downloaded, s.total]);
    });

    expect(progress).toEqual([[512, 1024]]);
  });

  it("surfaces install failures, since they may mean a bad signature", async () => {
    const u = update();
    u.downloadAndInstall = vi.fn().mockRejectedValue(new Error("signature mismatch"));

    const result = await downloadAndInstall(u);

    expect(result).toEqual({ ok: false, error: "signature mismatch" });
  });
});
