import { Check } from "lucide-react";
import "./ui.css";

export interface FontPickerOption<T extends string> {
  value: T;
  /** 选项显示名（字体自己的名字，如「宋体」）。 */
  label: string;
  /** 用该字体渲染 label 的 CSS 字体栈。 */
  stack: string;
}

export interface FontPickerProps<T extends string> {
  value: T;
  options: readonly FontPickerOption<T>[];
  onChange: (value: T) => void;
  /** 单选组的可访问名。 */
  ariaLabel: string;
}

/**
 * 字体选择列表（UI_DESIGN_SYSTEM.md §34.6）。
 *
 * 为什么不用 `SegmentedControl`：
 * 字体选项有 8 个且名字长短不一（「系统默认」vs「Times New Roman」），
 * 分段控件会把它们挤成一排等宽小块，既放不下也看不出差异。
 *
 * 关键设计：**每个选项用该字体自身渲染名字**。
 * 用户在 Word 里就是靠这个挑字体的 —— 读到「宋体」两个字本身是宋体，
 * 比任何说明文字都直观。因此这里不用 `aria-label` 覆盖文本，
 * 可访问名仍是字体名本身。
 *
 * 用 `role="radiogroup"` + `role="radio"` 而不是 `<select>`：
 * 原生下拉在 WebView 里样式不可控，且无法做到「每项用自己的字体」。
 */
export function FontPicker<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: FontPickerProps<T>) {
  return (
    <div className="ui-font-picker" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className="ui-font-picker__item"
            data-active={selected || undefined}
            onClick={() => onChange(opt.value)}
          >
            {/* 名字用该字体自身渲染 —— 这是选择列表的核心价值。 */}
            <span className="ui-font-picker__name" style={{ fontFamily: opt.stack }}>
              {opt.label}
            </span>

            {/* 选中标记：不只靠颜色区分（UI §39）。 */}
            {selected && <Check size={14} aria-hidden className="ui-font-picker__check" />}
          </button>
        );
      })}
    </div>
  );
}
