import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import "./ui.css";

export type TooltipSide = "top" | "bottom";

/** 组内快速切换的判定窗口（毫秒）。 */
const GROUP_WINDOW = 400;

/** 最近一次提示隐藏的时间戳；用于同组控件间快速切换时立即显示。 */
let lastHiddenAt = 0;

export interface TooltipProps {
  /** 提示内容。通常是一行短文本。 */
  content: string;
  /** 被包裹的元素；提示会锚定在它上方。 */
  children: ReactElement;
  side?: TooltipSide;
  /** 首次显示延迟（毫秒）。同组内连续移动时不再等待。 */
  delay?: number;
  /** 为真时不显示提示（例如控件被禁用且提示无意义时）。 */
  disabled?: boolean;
}

/**
 * 悬停/聚焦提示（UI_DESIGN_SYSTEM.md §13 必备组件）。
 *
 * 为什么不用原生 `title`：
 * - 延迟由浏览器决定（约 1–2 秒），无法调整；
 * - 外观是系统样式，不跟随应用主题，暗色下尤其突兀。
 *
 * 因此自绘：延迟可控、配色走主题令牌、位置自动收进视口。
 */
export function Tooltip({
  content,
  children,
  side = "top",
  delay = 300,
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const id = useId();

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const show = useCallback(() => {
    if (disabled) return;
    clearTimer();
    // 在工具栏等成组控件上连续移动时，第二个及之后的提示立即出现 ——
    // 这与桌面系统的提示行为一致，反复等待只会显得迟钝。
    const wait = performance.now() - lastHiddenAt < GROUP_WINDOW ? 0 : delay;
    timerRef.current = window.setTimeout(() => setOpen(true), wait);
  }, [clearTimer, delay, disabled]);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  // 卸载时清掉待触发的定时器，避免在已卸载组件上 setState。
  useEffect(() => clearTimer, [clearTimer]);

  // 记录「显示过之后隐藏」的时刻，供组内快速切换使用。
  // 注意必须判断前一个状态：挂载时 open 就是 false，若在此处无条件赋值，
  // 会把 lastHiddenAt 设成当前时间，导致本组件首次悬停被误判为组内切换、
  // 延迟直接失效。
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      lastHiddenAt = performance.now();
    }
    wasOpenRef.current = open;
  }, [open]);

  // 定位：先渲染再量尺寸，然后收进视口（避免贴边被裁）。
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;

    const measure = () => {
      const a = anchor.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      const gap = 6;
      const margin = 6;

      let top = side === "top" ? a.top - t.height - gap : a.bottom + gap;
      let left = a.left + a.width / 2 - t.width / 2;

      // 水平收边；垂直方向若越界则翻到另一侧。
      left = Math.min(Math.max(margin, left), window.innerWidth - t.width - margin);
      if (top < margin) top = a.bottom + gap;
      if (top + t.height > window.innerHeight - margin) top = a.top - t.height - gap;

      setPos({ top, left });
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // content 变化会改变提示尺寸，故一并作为依赖。
  }, [open, side, content]);

  // Escape 关闭：提示不应拦住用户的退出操作。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  return (
    <>
      <span
        ref={anchorRef}
        className="ui-tooltip-anchor"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="ui-tooltip"
            data-side={side}
            style={
              pos
                ? { top: pos.top, left: pos.left }
                : // 首次测量前先藏起来，避免在左上角闪一下。
                  { top: 0, left: 0, visibility: "hidden" }
            }
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

/** 仅测试用：重置组内延迟状态，避免用例间互相影响。 */
export function __resetTooltipGroupState(): void {
  lastHiddenAt = 0;
}
