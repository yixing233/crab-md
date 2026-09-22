import { Columns2, SquarePen, TabletSmartphone } from "lucide-react";
import { zh } from "../../lib/i18n";
import { VIEW_MODES, type ViewMode } from "../../lib/viewMode";
import { SegmentedControl, type SegmentedOption } from "./SegmentedControl";
import "./ui.css";

export interface ViewModeSwitchProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

const OPTIONS: readonly SegmentedOption<ViewMode>[] = [
  { value: "edit", label: zh.toolbar.view.edit, icon: SquarePen },
  { value: "split", label: zh.toolbar.view.split, icon: Columns2 },
  { value: "preview", label: zh.toolbar.view.preview, icon: TabletSmartphone },
];

/**
 * 视图模式分段控件（UI_DESIGN_SYSTEM.md §11）。
 *
 * 工具栏里空间紧张，故用纯图标 + Tooltip；设置页里则用带文字的
 * `SegmentedControl`（那里「当前选的是哪个」比省空间更重要）。
 *
 * 判据：`VIEW_MODES` 是唯一顺序来源，这里只做图标与文案映射，
 * 循环切换（Ctrl+\）与分段控件不会各自维护一份顺序。
 */
export function ViewModeSwitch({ value, onChange }: ViewModeSwitchProps) {
  // 断言所有模式都有对应选项，避免新增模式时这里静默漏掉。
  const options = VIEW_MODES.map((mode) => {
    const found = OPTIONS.find((o) => o.value === mode);
    if (!found) throw new Error(`ViewModeSwitch: missing option for mode "${mode}"`);
    return found;
  });

  return (
    <SegmentedControl
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={zh.toolbar.view.label}
    />
  );
}
