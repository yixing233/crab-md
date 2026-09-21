import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import "./ui.css";

export interface DialogProps {
  open: boolean;
  /** 标题。必填 —— 对话框必须让用户知道自己在确认什么（UI §16）。 */
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** 危险操作（如删除）用 danger 语义（UI §14.4）。 */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 模态对话框（UI_DESIGN_SYSTEM.md §13 必备组件、§16 规则）。
 *
 * §16 要求：
 * - 明确的标题
 * - 关闭行为
 * - 桌面端 Escape 处理
 * - 焦点陷阱
 * - 动作必需时给出明确的主操作
 */
export function Dialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // 打开时记住原焦点，关闭后归还 —— 否则键盘用户会丢失位置。
  // 同时把焦点移进对话框，满足 §16 的焦点管理要求。
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const first = panelRef.current?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    first?.focus();

    return () => previouslyFocused.current?.focus?.();
  }, [open]);

  // Escape 取消（§16 要求桌面端有 Escape 处理）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      // 焦点陷阱：Tab 在对话框内循环，不跑到背后的页面上。
      if (e.key !== "Tab") return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      if (!focusables || focusables.length === 0) return;
      const list = Array.from(focusables);
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open) return null;

  return createPortal(
    <div className="ui-dialog-overlay" onMouseDown={onCancel}>
      <div
        ref={panelRef}
        className="ui-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // 阻止冒泡：点击面板内部不应关闭对话框。
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="ui-dialog__title">{title}</h2>
        {children && <div className="ui-dialog__body">{children}</div>}
        <div className="ui-dialog__actions">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
