/**
 * 主题切换的波纹扩散动画（View Transitions API）。
 *
 * 为什么单独成模块：
 * - 半径数学与「什么时候不该做动画」都是纯逻辑，必须能脱离浏览器测试；
 * - App.tsx 已经很长，把转场细节塞进去只会更难读。
 *
 * 降级策略：不支持 `document.startViewTransition`（jsdom、旧 WebView）或用户
 * 要求减弱动效时，直接同步应用主题 —— 主题切换本身绝不能因为动画不可用而失效。
 */

/** 波纹圆心（视口坐标，CSS 像素）。 */
export interface RippleOrigin {
  x: number;
  y: number;
}

/** 一次转场要写进 CSS 的三个变量。 */
export interface RippleVars {
  x: number;
  y: number;
  radius: number;
}

/**
 * 运行一次转场所需的环境。
 *
 * 抽成接口是为了单测能传假对象：jsdom 里既没有布局也没有 View Transitions，
 * 只能靠替身验证「写了什么变量、按什么顺序调用」。
 */
export interface RippleEnvironment {
  width: number;
  height: number;
  /** 用户是否要求减弱动效（`prefers-reduced-motion: reduce`）。 */
  reducedMotion: boolean;
  /** 写入圆心与半径。 */
  writeVars: (vars: RippleVars) => void;
  /** View Transitions 入口；`undefined` 表示浏览器不支持。 */
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
}

/**
 * 覆盖整个视口所需的半径：圆心到最远角的距离。
 *
 * 只取「更远的那一侧」而不逐个算四个角 —— 到四角的距离里，最远的那个角
 * 必然同时由最远的 x 与最远的 y 组成，故两者一取即可。
 */
export function rippleRadius(origin: RippleOrigin, width: number, height: number): number {
  const dx = Math.max(origin.x, width - origin.x);
  const dy = Math.max(origin.y, height - origin.y);
  return Math.hypot(dx, dy);
}

/** 是否要求减弱动效。无 matchMedia（老浏览器 / SSR）时按不减弱处理。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 指针位置的有效期（毫秒）。
 *
 * 鼠标点击时 `pointerdown` 与 `click` 相隔不到一帧，必定命中；
 * 而「几分钟前点过编辑器、现在按 Ctrl+Shift+L」就不该从那个旧位置扩散 ——
 * 那种情况视为没有指针信息，回到视口中心。
 */
export const POINTER_ORIGIN_TTL_MS = 1000;

/** 记下指针位置的时刻。 */
export interface StampedOrigin {
  origin: RippleOrigin;
  at: number;
}

/** 取出仍然「新鲜」的指针位置；过期或从未记录过都返回 null。 */
export function freshOrigin(stamped: StampedOrigin | null, now: number): RippleOrigin | null {
  if (!stamped) return null;
  return now - stamped.at <= POINTER_ORIGIN_TTL_MS ? stamped.origin : null;
}

/**
 * 应用主题：能动画就动画，不能就同步应用。
 *
 * 顺序很重要 —— 先把圆心与半径写进 CSS 变量，再启动转场。转场一旦开始
 * 立刻抓取新旧快照，晚写的变量不会参与本次动画。
 */
export function runThemeTransition(
  apply: () => void,
  origin: RippleOrigin | null,
  env: RippleEnvironment,
): void {
  if (!env.startViewTransition || env.reducedMotion) {
    apply();
    return;
  }

  // 键盘入口（Ctrl+Shift+L）没有指针位置，从视口中心扩散最自然。
  const from = origin ?? { x: env.width / 2, y: env.height / 2 };
  env.writeVars({ x: from.x, y: from.y, radius: rippleRadius(from, env.width, env.height) });

  const transition = env.startViewTransition(() => {
    apply();
  });

  // 转场可能被跳过或打断（例如连续快速切换），此时 finished 会 reject。
  // 必须在此接管：未处理的拒绝会变成控制台里的 unhandled rejection。
  transition.finished.catch(() => {});
}

/**
 * 用当前浏览器环境组装运行参数。
 *
 * `document`/`window` 都在**调用时**读取，模块加载期不碰 DOM。
 */
export function createRippleEnvironment(): RippleEnvironment {
  const doc = typeof document === "undefined" ? null : document;

  return {
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
    reducedMotion: prefersReducedMotion(),
    writeVars: ({ x, y, radius }) => {
      if (!doc) return;
      const style = doc.documentElement.style;
      style.setProperty("--theme-ripple-x", `${x}px`);
      style.setProperty("--theme-ripple-y", `${y}px`);
      style.setProperty("--theme-ripple-radius", `${radius}px`);
    },
    // 包一层再调用：`startViewTransition` 需要正确的 this，直接把它当裸函数
    // 传出去在某些环境会抛 "Illegal invocation"。
    startViewTransition:
      doc && typeof doc.startViewTransition === "function"
        ? (update) => doc.startViewTransition(update)
        : undefined,
  };
}
