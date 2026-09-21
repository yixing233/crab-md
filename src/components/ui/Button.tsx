import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";
import "./ui.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 进行中：显示 spinner、禁用点击，避免重复提交（UI §14.4）。 */
  loading?: boolean;
  children: ReactNode;
}

/**
 * 语义化按钮。样式全部由 data-variant / data-size 经 CSS 令牌控制，
 * 调用方不传颜色/尺寸数值（UI_DESIGN_SYSTEM.md §37）。
 */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className="ui-button"
      data-variant={variant}
      data-size={size}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner size={14} />}
      <span>{children}</span>
    </button>
  );
}
