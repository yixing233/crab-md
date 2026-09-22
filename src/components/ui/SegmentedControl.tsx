import type { LucideIcon } from "lucide-react";
import { Tooltip } from "./Tooltip";
import "./ui.css";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** 无障碍名称，说明这组选项在选什么。 */
  ariaLabel: string;
  /**
   * 是否显示文字标签。
   * 工具栏里空间紧张用纯图标（配合 Tooltip）；设置页里显示文字，
   * 因为「当前选的是哪个」比「省空间」更重要。
   */
  showLabels?: boolean;
}

/**
 * 分段控件（UI_DESIGN_SYSTEM.md §13 原语）。
 *
 * 用于**互斥的少量选项**（2–4 个）。相比下拉框，分段控件把可选项全部
 * 摊开，一眼可见当前值，点一次即切换 —— 设置页的主题/视图/字号都用它，
 * 避免每处各写一份单选逻辑（§2.4 组件纪律）。
 *
 * 语义用 radiogroup 而非一排普通按钮：屏幕阅读器会正确播报
 * 「N 选 1」，而不是「N 个独立开关」。
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  showLabels = false,
}: SegmentedControlProps<T>) {
  return (
    <div
      className="ui-segmented"
      role="radiogroup"
      aria-label={ariaLabel}
      data-labeled={showLabels || undefined}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        const button = (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            className="ui-segmented__item"
            data-active={active || undefined}
            onClick={() => onChange(option.value)}
          >
            {Icon && <Icon size={15} aria-hidden />}
            {showLabels && <span className="ui-segmented__label">{option.label}</span>}
          </button>
        );

        // 纯图标时用 Tooltip 补全名称；有文字标签时不必再悬浮提示。
        return showLabels ? (
          button
        ) : (
          <Tooltip key={option.value} content={option.label}>
            {button}
          </Tooltip>
        );
      })}
    </div>
  );
}
