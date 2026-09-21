import { useCallback, useEffect, useRef, useState } from "react";
import "./workspace.css";

export interface SplitterProps {
  /** 拖拽方向的起始宽度（px），即被调整那一侧的当前宽度。 */
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** 无障碍名称，说明这条分隔条调整的是什么。 */
  ariaLabel: string;
  /** 拖拽时手柄相对鼠标的偏移方向：侧栏在左用 "left"。 */
  side?: "left" | "right";
}

/**
 * 可拖拽分隔条（UI_DESIGN_SYSTEM.md §11「Pane resizing SHOULD be supported
 * on desktop when practical」）。
 *
 * 同时支持指针拖拽与键盘调整（方向键）—— 只用鼠标才能调整的分隔条
 * 对键盘用户等于不存在（UI §39）。
 */
export function Splitter({
  value,
  onChange,
  min = 160,
  max = 480,
  ariaLabel,
  side = "left",
}: SplitterProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startValue = useRef(value);

  const clamp = useCallback((v: number) => Math.min(max, Math.max(min, v)), [min, max]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 记录起点，拖拽过程中按位移增量计算，避免累积误差。
    // setPointerCapture 并非所有环境都提供（jsdom、部分旧 WebView）；
    // 缺少它只是拖出元素后可能丢事件，不该让按下就抛异常。
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startX.current = e.clientX;
    startValue.current = value;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const delta = e.clientX - startX.current;
    // 侧栏在左侧：向右拖变宽；在右侧：向右拖变窄。
    onChange(clamp(startValue.current + (side === "left" ? delta : -delta)));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setDragging(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onChange(clamp(value + (side === "left" ? -step : step)));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onChange(clamp(value + (side === "left" ? step : -step)));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(min);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(max);
    }
  };

  // 拖拽时给 body 加类，让全局光标保持 col-resize 且不选中文本。
  useEffect(() => {
    if (!dragging) return;
    document.body.dataset.resizing = "true";
    return () => {
      delete document.body.dataset.resizing;
    };
  }, [dragging]);

  return (
    <div
      className="splitter"
      data-dragging={dragging || undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(clamp(side === "left" ? 260 : 320))}
    />
  );
}
