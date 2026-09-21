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
  /** 纯图标按钮：去掉横向内边距并保持正方形（UI §14.4 要求有可访问名称）。 */
  iconOnly?: boolean;
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
  iconOnly = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  // className 必须合并而非让调用方覆盖：调用方传入的类（如
  // editor-toolbar__button）只做微调，ui-button 的基础布局
  // （inline-flex / align-items / gap）不能被顶掉，否则图标与文字会错位。
  const classes = className ? `ui-button ${className}` : "ui-button";

  return (
    <button
      type="button"
      className={classes}
      data-variant={variant}
      data-size={size}
      data-icon-only={iconOnly || undefined}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner size={14} />}
      <span className="ui-button__label">{children}</span>
    </button>
  );
}
