import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { Modal } from "antd";
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
 * 模态对话框 —— 内部为 antd Modal 的适配层（UI_DESIGN_SYSTEM.md §13、§16）。
 *
 * §16 要求由 antd Modal 承担：标题、关闭行为、Escape、焦点陷阱、明确主操作。
 * 外观（overlay/panel）仍走 `.ui-dialog*` 令牌样式，保证明暗主题一致。
 * 测试与调用方依赖的结构契约：
 * - open 时渲染 role="dialog"（Modal 内置）；
 * - 点击遮罩 = onCancel；
 * - 取消/确认按钮的名称来自 cancelLabel/confirmLabel，
 *   且 confirm 按钮带 data-variant（danger/primary）语义。
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
  // antd Modal 默认挂 body（portal），这里不需要自己管理焦点陷阱；
  // Escape 与遮罩点击都是 Modal 内置行为，映射到 onCancel。
  // 但「打开时把焦点移入对话框」在 jsdom / 禁动画场景下 Modal 不保证，
  // 保留原实现的焦点迁移：聚焦第一个动作按钮（取消）。
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const firstActionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      // 等 Modal 完成挂载再聚焦；直接同步调用时面板尚未插入 DOM。
      const raf = requestAnimationFrame(() => firstActionRef.current?.focus());
      return () => {
        cancelAnimationFrame(raf);
        previouslyFocused.current?.focus?.();
      };
    }
  }, [open]);

  return (
    <Modal
      open={open}
      title={<h2 className="ui-dialog__title">{title}</h2>}
      onCancel={onCancel}
      // footer 自定义为「语义化按钮对」，而不是 antd 默认的 确定/取消。
      footer={[
        <Button key="cancel" ref={firstActionRef} variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>,
        <Button
          key="confirm"
          variant={destructive ? "danger" : "primary"}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>,
      ]}
      // 遮罩点击关闭 = 原对话框行为（测试 §overlay click）。
      mask={{ closable: true }}
      // 关闭即卸载（原实现 !open 时返回 null，无退场动画）。
      destroyOnHidden
      // antd Modal 默认 zIndex=1000 且是内联样式，CSS 压不过；而设置面板
      // （1050）与「关于」对话框（1060）都在它之上 —— 从这些面板里弹出的
      // 确认框（如更新安装确认）会被整个压在面板后面且点不到。
      // 1100 是既定层级：面板之上、菜单（1200）/toast（1300）之下。
      zIndex={1100}
      width={400}
      centered
      // Escape 由 Modal 内置处理（keyboard 默认 true）。
      className="ui-dialog-modal"
      styles={{
        container: { padding: 0, background: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" },
        header: { padding: "var(--space-5) var(--space-5) 0", background: "transparent", marginBottom: 0 },
        body: { padding: "var(--space-2) var(--space-5) 0" },
        footer: { padding: "0 var(--space-5) var(--space-5)" },
        mask: { background: "rgb(0 0 0 / 0.28)" },
      }}
    >
      {children ? <div className="ui-dialog__body">{children}</div> : null}
    </Modal>
  );
}
