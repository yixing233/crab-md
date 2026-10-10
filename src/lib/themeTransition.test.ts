import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRippleEnvironment,
  freshOrigin,
  prefersReducedMotion,
  rippleRadius,
  runThemeTransition,
  POINTER_ORIGIN_TTL_MS,
  type RippleEnvironment,
} from "./themeTransition";

/** 组装一个可控的转场环境；默认「支持 API 且不需要减弱动效」。 */
function env(overrides: Partial<RippleEnvironment> = {}): RippleEnvironment & {
  writeVars: ReturnType<typeof vi.fn>;
} {
  return {
    width: 1000,
    height: 800,
    reducedMotion: false,
    writeVars: vi.fn(),
    startViewTransition: vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    }),
    ...overrides,
  } as RippleEnvironment & { writeVars: ReturnType<typeof vi.fn> };
}

describe("rippleRadius", () => {
  it("measures to the farthest corner from the viewport center", () => {
    // 视口中心到四角等距：hypot(500, 400)。
    expect(rippleRadius({ x: 500, y: 400 }, 1000, 800)).toBeCloseTo(Math.hypot(500, 400), 6);
  });

  it("measures to the diagonal when the origin sits in a corner", () => {
    const diagonal = Math.hypot(1000, 800);
    expect(rippleRadius({ x: 0, y: 0 }, 1000, 800)).toBeCloseTo(diagonal, 6);
    expect(rippleRadius({ x: 1000, y: 800 }, 1000, 800)).toBeCloseTo(diagonal, 6);
  });

  it("takes the farther side on each axis independently", () => {
    // 靠近左上角时，最远角是右下角。
    expect(rippleRadius({ x: 100, y: 200 }, 1000, 800)).toBeCloseTo(Math.hypot(900, 600), 6);
    // 靠近右下角时反过来。
    expect(rippleRadius({ x: 900, y: 700 }, 1000, 800)).toBeCloseTo(Math.hypot(900, 700), 6);
  });

  it("is always large enough to cover the whole viewport", () => {
    // 圆必须覆盖视口，否则波纹扫过后会留下一圈旧配色。
    for (const origin of [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 0, y: 800 },
      { x: 1000, y: 800 },
      { x: 371, y: 42 },
    ]) {
      const radius = rippleRadius(origin, 1000, 800);
      const corners = [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 0, y: 800 },
        { x: 1000, y: 800 },
      ];
      for (const corner of corners) {
        expect(Math.hypot(corner.x - origin.x, corner.y - origin.y)).toBeLessThanOrEqual(
          radius + 1e-9,
        );
      }
    }
  });
});

describe("freshOrigin", () => {
  const origin = { x: 12, y: 34 };

  it("returns null when no pointer was recorded", () => {
    // 键盘入口（Ctrl+Shift+L）从没按过鼠标：应由调用方回退到视口中心。
    expect(freshOrigin(null, 10_000)).toBeNull();
  });

  it("keeps a recent pointer position", () => {
    expect(freshOrigin({ origin, at: 1_000 }, 1_500)).toEqual(origin);
  });

  it("drops a stale position", () => {
    // 几分钟前点过编辑器、现在按快捷键：从那儿扩散会显得莫名其妙。
    expect(freshOrigin({ origin, at: 1_000 }, 1_000 + POINTER_ORIGIN_TTL_MS + 1)).toBeNull();
  });

  it("treats the exact boundary as still fresh", () => {
    expect(freshOrigin({ origin, at: 1_000 }, 1_000 + POINTER_ORIGIN_TTL_MS)).toEqual(origin);
  });
});

describe("prefersReducedMotion", () => {
  const original = window.matchMedia;

  afterEach(() => {
    Object.defineProperty(window, "matchMedia", { writable: true, value: original });
  });

  it("reads the reduced-motion media query", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({ matches: query.includes("reduced-motion") }),
    });
    expect(prefersReducedMotion()).toBe(true);
  });

  it("returns false when the query does not match", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({ matches: false }),
    });
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("runThemeTransition", () => {
  it("applies synchronously when the API is unavailable", () => {
    // jsdom、旧 WebView 都走这条路：主题切换本身绝不能因为动画缺失而失效。
    const apply = vi.fn();
    const e = env({ startViewTransition: undefined });

    runThemeTransition(apply, { x: 1, y: 2 }, e);

    expect(apply).toHaveBeenCalledOnce();
    expect(e.writeVars).not.toHaveBeenCalled();
  });

  it("applies synchronously when the user asked for reduced motion", () => {
    const apply = vi.fn();
    const e = env({ reducedMotion: true });

    runThemeTransition(apply, { x: 1, y: 2 }, e);

    expect(apply).toHaveBeenCalledOnce();
    // 既不能动画，也不该白写一组变量。
    expect(e.writeVars).not.toHaveBeenCalled();
    expect(e.startViewTransition).not.toHaveBeenCalled();
  });

  it("writes the ripple variables before starting the transition", () => {
    const apply = vi.fn();
    const e = env();

    runThemeTransition(apply, { x: 250, y: 100 }, e);

    expect(e.writeVars).toHaveBeenCalledWith({
      x: 250,
      y: 100,
      radius: Math.hypot(750, 700),
    });
    // 顺序：变量必须在转场启动前写好，否则本次动画拿不到圆心。
    const writeOrder = (e.writeVars as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const startOrder = (e.startViewTransition as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(startOrder);
  });

  it("runs the apply callback inside the transition", () => {
    const ordered: string[] = [];
    const e = env({
      writeVars: vi.fn(() => ordered.push("vars")),
      startViewTransition: vi.fn((update: () => void) => {
        ordered.push("start");
        update();
        return { finished: Promise.resolve() };
      }),
    });

    runThemeTransition(() => ordered.push("apply"), { x: 0, y: 0 }, e);

    // apply 必须在 startViewTransition 的回调内执行 —— 转场要在这时抓快照。
    expect(ordered).toEqual(["vars", "start", "apply"]);
  });

  it("falls back to the viewport center when there is no pointer position", () => {
    const e = env();

    runThemeTransition(vi.fn(), null, e);

    expect(e.writeVars).toHaveBeenCalledWith({
      x: 500,
      y: 400,
      radius: Math.hypot(500, 400),
    });
  });

  it("swallows a rejecting finished promise", () => {
    // 连续快速切换会让转场被跳过，finished 随之 reject。不接管就是
    // 控制台里的 unhandled rejection —— 用户看着界面切好了，日志却报错。
    const catchSpy = vi.fn();
    const e = env({
      startViewTransition: vi.fn(() => ({
        finished: { catch: catchSpy } as unknown as Promise<void>,
      })),
    });

    runThemeTransition(vi.fn(), { x: 1, y: 1 }, e);

    expect(catchSpy).toHaveBeenCalledOnce();
    expect(typeof catchSpy.mock.calls[0][0]).toBe("function");
  });
});

describe("createRippleEnvironment", () => {
  const root = document.documentElement;

  afterEach(() => {
    root.style.removeProperty("--theme-ripple-x");
    root.style.removeProperty("--theme-ripple-y");
    root.style.removeProperty("--theme-ripple-radius");
  });

  it("reports the real viewport size", () => {
    const e = createRippleEnvironment();
    expect(e.width).toBe(window.innerWidth);
    expect(e.height).toBe(window.innerHeight);
  });

  it("writes the variables onto <html> as CSS lengths", () => {
    createRippleEnvironment().writeVars({ x: 10, y: 20, radius: 30 });

    expect(root.style.getPropertyValue("--theme-ripple-x")).toBe("10px");
    expect(root.style.getPropertyValue("--theme-ripple-y")).toBe("20px");
    expect(root.style.getPropertyValue("--theme-ripple-radius")).toBe("30px");
  });

  it("omits startViewTransition when the browser does not implement it", () => {
    // jsdom 30 尚未实现；此时组件必须走同步降级路径。
    expect(createRippleEnvironment().startViewTransition).toBeUndefined();
  });

  it("binds startViewTransition to the document so `this` stays valid", () => {
    const original = (document as { startViewTransition?: unknown }).startViewTransition;
    const seen: Document[] = [];
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      writable: true,
      value: function (this: Document, update: () => void) {
        seen.push(this);
        update();
        return { finished: Promise.resolve() };
      },
    });

    try {
      const e = createRippleEnvironment();
      const update = vi.fn();
      e.startViewTransition?.(update);

      expect(update).toHaveBeenCalledOnce();
      // 若把方法当裸函数传出去，这里的 this 就会丢失。
      expect(seen[0]).toBe(document);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(document, "startViewTransition");
      } else {
        Object.defineProperty(document, "startViewTransition", {
          configurable: true,
          writable: true,
          value: original,
        });
      }
    }
  });
});
