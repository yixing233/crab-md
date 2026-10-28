import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./editor.css";

export interface LightboxProps {
  /** 图片地址（blob URL / data URL / 远程地址均可）。 */
  src: string;
  /** 图片说明文字（取 alt），显示在底部。 */
  alt?: string;
  onClose: () => void;
}

/** 滚轮缩放的范围与步长。 */
const MIN_SCALE = 1;
const MAX_SCALE = 8;
const WHEEL_STEP = 1.15;

/**
 * 图片灯箱：点击预览里的图片打开，全屏查看。
 *
 * - 滚轮缩放（放大后可拖拽平移）、双击在 1x / 2.5x 间切换；
 * - Esc 或点击遮罩关闭；
 * - 经 portal 挂到 document.body，避免被预览区的 overflow 裁剪。
 */
export function Lightbox({ src, alt, onClose }: LightboxProps) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Esc 关闭。挂在 document 上：焦点可能在按钮或图片上。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 滚轮缩放必须是非 passive 监听才能 preventDefault（阻止页面滚动）。
  // React 的 onWheel 是 passive 的，所以用 ref 手动挂。
  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => {
        const next = e.deltaY < 0 ? s * WHEEL_STEP : s / WHEEL_STEP;
        return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // 双击在「原始大小」与「2.5x 放大」间切换。
  const toggleZoom = useCallback(() => {
    setScale((s) => (s > 1.01 ? 1 : 2.5));
    setOffset({ x: 0, y: 0 });
  }, []);

  // 拖拽平移（仅放大后有意义，但任何时候都允许，行为可预期）。
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    setOffset({ x: drag.baseX + e.clientX - drag.startX, y: drag.baseY + e.clientY - drag.startY });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragStateRef.current?.pointerId === e.pointerId) dragStateRef.current = null;
  };

  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt ? `查看图片：${alt}` : "查看图片"}
      onClick={onClose}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt ?? ""}
        className="lightbox__image"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={toggleZoom}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      {alt && <p className="lightbox__caption">{alt}</p>}
      <button
        type="button"
        className="lightbox__close"
        aria-label="关闭图片查看"
        onClick={onClose}
      >
        <X size={18} aria-hidden />
      </button>
      <span className="lightbox__zoom">{Math.round(scale * 100)}%</span>
    </div>,
    document.body,
  );
}
