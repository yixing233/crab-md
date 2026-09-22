import { Columns2, SquarePen, TabletSmartphone, type LucideIcon } from "lucide-react";
import { zh } from "../../lib/i18n";
import { VIEW_MODES, type ViewMode } from "../../lib/viewMode";
import { Tooltip } from "./Tooltip";
import "./ui.css";

export interface ViewModeSwitchProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const ICONS: Record<ViewMode, LucideIcon> = {
  edit: SquarePen,
  split: Columns2,
  preview: TabletSmartphone,
};

/**
 * 视图模式分段控件（UI_DESIGN_SYSTEM.md §11）。
 *
 * 用分段控件而不是「一个循环按钮」：三档是**互斥的可见状态**，
 * 分段控件让「当前在哪一档」一目了然，循环按钮却要按下才知道。
 *
 * 语义上用 radio 组而非一排普通按钮 —— 屏幕阅读器会正确播报
 * 「3 选 1」而不是「3 个独立开关」。
 */
export function ViewModeSwitch({ value, onChange }: ViewModeSwitchProps) {
  return (
    <div
      className="ui-segmented"
      role="radiogroup"
      aria-label={zh.toolbar.view.label}
    >
      {VIEW_MODES.map((mode) => {
        const Icon = ICONS[mode];
        const label = zh.toolbar.view[mode];
        const active = mode === value;
        return (
          <Tooltip key={mode} content={label}>
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              className="ui-segmented__item"
              data-active={active || undefined}
              onClick={() => onChange(mode)}
            >
              <Icon size={15} aria-hidden />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
