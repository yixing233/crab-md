import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, AlertTriangle, X } from "lucide-react";
import "./ui.css";

export type ToastTone = "success" | "error";

export interface ToastProps {
  /** 非空即显示。 */
  message: string | null;
  tone?: ToastTone;
  onDismiss: () => void;
  /** 自动消失时长；0 表示不自动消失（错误建议保留到用户处理）。 */
  duration?: number;
}

/**
 * 轻提示（UI_DESIGN_SYSTEM.md §13 必备组件、§33 规则）。
 *
 * §33 要点：不打断操作、可读、有明确的生命周期、不用来承载关键决策。
 * 因此这里是屏幕角落的浮层，而不是模态框。
 */
export function Toast({ message, tone = "success", onDismiss, duration }: ToastProps) {
  // 成功提示短暂停留后自动消失；错误默认保留（duration=0）。
  const auto = duration ?? (tone === "success" ? 2200 : 0);

  useEffect(() => {
    if (!message || auto <= 0) return;
    const t = setTimeout(onDismiss, auto);
    return () => clearTimeout(t);
    // message 变化时重新计时（连续保存会刷新而不是叠加）。
  }, [message, auto, onDismiss]);

  if (!message) return null;

  const Icon = tone === "success" ? Check : AlertTriangle;

  return createPortal(
    <div className="ui-toast" data-tone={tone} role="status" aria-live="polite">
      <Icon size={15} aria-hidden className="ui-toast__icon" />
      <span className="ui-toast__text">{message}</span>
      <button
        type="button"
        className="ui-toast__close"
        aria-label="关闭提示"
        onClick={onDismiss}
      >
        <X size={13} aria-hidden />
      </button>
    </div>,
    document.body,
  );
}
