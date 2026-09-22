import type { ReactNode } from "react";
import "./ui.css";

export type BadgeTone = "accent" | "neutral" | "warning";

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /**
   * 数字/极短文本用 pill（圆点式），词组用普通内边距。
   * 数字徽标做成圆形，文字徽标做成圆角矩形 —— 两者尺寸逻辑不同。
   */
  pill?: boolean;
}

/**
 * 徽标（UI_DESIGN_SYSTEM.md §13 原语）。
 *
 * 用途是**标注状态**，不是装饰。因此：
 * - 颜色只从主题令牌取，不硬编码；
 * - 文本必须能被读出（不靠颜色单独承载信息，§39）；
 * - 不做动画，避免从编辑器抢注意力（§2.1）。
 */
export function Badge({ children, tone = "accent", pill = false }: BadgeProps) {
  return (
    <span className="ui-badge" data-tone={tone} data-pill={pill || undefined}>
      {children}
    </span>
  );
}
