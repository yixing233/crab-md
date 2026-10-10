import { useId, useLayoutEffect, useMemo, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Segmented } from "antd";
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
 * 分段控件 —— 内部基于 Ant Design Segmented 的适配层（UI_DESIGN_SYSTEM.md §13 原语）。
 *
 * 用于**互斥的少量选项**（2–4 个）。相比手写 radio 组，antd Segmented 自带
 * 物理平滑滑块位移动画（thumb glide）、完善的键盘循环导航和响应式尺寸。
 *
 * 外观由设计令牌（ui.css / antdTheme.ts）统一定义，适配应用明暗主题。
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  showLabels = false,
}: SegmentedControlProps<T>) {
  const generatedName = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const antdOptions = useMemo(() => {
    return options.map((option) => {
      const Icon = option.icon;
      const content = (
        <span className="ui-segmented__content" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {Icon && <Icon size={15} aria-hidden />}
          {showLabels ? (
            <span className="ui-segmented__label">{option.label}</span>
          ) : (
            <span className="sr-only">{option.label}</span>
          )}
        </span>
      );

      return {
        value: option.value,
        label: showLabels ? (
          content
        ) : (
          <Tooltip content={option.label}>
            {content}
          </Tooltip>
        ),
      };
    });
  }, [options, showLabels]);

  // 同步 aria-checked 与放行 pointer-events：
  // 1. antd 内部使用原生 <input type="radio">，辅助技术与现有断言期待 aria-checked 属性对齐；
  // 2. antd 对 radio 施加 pointer-events:none，内联赋予 auto 保证无障碍点击与测试环境行为一致。
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const radios = containerRef.current.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    radios.forEach((radio) => {
      radio.style.pointerEvents = "auto";
      radio.setAttribute("aria-checked", radio.checked ? "true" : "false");
    });
  }, [value, options]);

  return (
    <div ref={containerRef} style={{ display: "inline-flex" }}>
      <Segmented
        className="ui-segmented"
        name={generatedName}
        aria-label={ariaLabel}
        data-labeled={showLabels || undefined}
        value={value}
        options={antdOptions}
        onChange={(v) => onChange(v as T)}
      />
    </div>
  );
}
