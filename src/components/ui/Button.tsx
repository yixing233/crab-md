import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button as AntButton } from "antd";
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

/** 应用语义到 antd 语义的映射。 */
const VARIANT_TYPE = {
  primary: "primary",
  secondary: "default",
  ghost: "text",
  danger: "primary",
} as const;

const SIZE_HEIGHT = { sm: 28, md: 32, lg: 40 } as const;

/**
 * 语义化按钮 —— 内部为 antd Button 的适配层（UI_DESIGN_SYSTEM.md §37）。
 *
 * 调用方只传语义（variant/size/iconOnly），不传颜色/尺寸数值；
 * antd 的视觉由全局 ConfigProvider（antdTheme.ts）与本文件的
 * `.ui-button[data-variant]` 覆盖样式共同收敛到设计令牌上。
 * data-variant / data-size 保留：特性 CSS（如 workspace.css 的菜单触发器）
 * 与测试依赖它们。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    iconOnly = false,
    disabled,
    className,
    style,
    // 原生 type（submit/reset）与 antd 的 type（视觉语义）撞名：
    // 适配层把 type 收编为 antd 语义，调用方传的原生意图转成 htmlType。
    type,
    children,
    ...rest
  },
  ref,
) {
  // className 必须合并而非让调用方覆盖：调用方传入的类（如
  // editor-toolbar__button）只做微调，ui-button 的基础布局
  // （inline-flex / align-items / gap）不能被顶掉，否则图标与文字会错位。
  const classes = className ? `ui-button ${className}` : "ui-button";

  return (
    <AntButton
      ref={ref}
      className={classes}
      data-variant={variant}
      data-size={size}
      data-icon-only={iconOnly || undefined}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      // 两个汉字的中文文案会被 antd 自动插空格（「保 存」），破坏可访问
      // 名称与紧凑排版；在组件级关掉（ConfigProvider 的全局配置只在
      // App 树内生效，Toast/CloseDocumentModal 等 portal 场景会绕过它）。
      autoInsertSpace={false}
      // antd 的 danger 是独立属性而非 type；primary+danger 即实心危险按钮。
      danger={variant === "danger"}
      type={VARIANT_TYPE[variant]}
      // 调用方传 type="submit"（如 CloseDocumentModal 的保存按钮）时
      // 映射为 antd 的 htmlType，保住原生表单提交语义。
      htmlType={type === "submit" ? "submit" : type === "reset" ? "reset" : "button"}
      loading={loading}
      disabled={disabled || loading}
      style={{
        height: SIZE_HEIGHT[size],
        paddingInline: iconOnly ? 0 : undefined,
        width: iconOnly ? SIZE_HEIGHT[size] : undefined,
        ...style,
      }}
      {...(rest as Record<string, unknown>)}
    >
      {iconOnly ? children : <span className="ui-button__label">{children}</span>}
    </AntButton>
  );
});
