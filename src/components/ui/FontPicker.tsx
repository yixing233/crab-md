import { useCallback, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "./Button";
import { ContextMenu } from "./ContextMenu";
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
 * 紧凑字体下拉选择器。菜单项仍用对应字体预览，触发按钮只显示当前选择，
 * 避免字体选项在设置页中整块平铺占用空间。
 */
export function FontPicker<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: FontPickerProps<T>) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const selected = options.find((option) => option.value === value);
  const closeMenu = useCallback(() => setOpen(false), []);

  const items = options.map((option) => ({
    id: option.value,
    label: option.label,
    fontFamily: option.stack,
    checked: option.value === value,
    onSelect: () => onChange(option.value),
  }));

  const toggleMenu = () => {
    if (open) {
      closeMenu();
      return;
    }
    const bounds = anchorRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setPosition({ x: bounds.left, y: bounds.bottom });
    setOpen(true);
  };

  return (
    <div className="ui-font-picker" ref={anchorRef}>
      <Button
        variant="secondary"
        className="ui-font-picker__trigger"
        aria-label={`${ariaLabel}：${selected?.label ?? value}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
      >
        <span
          className="ui-font-picker__name"
          style={selected ? { fontFamily: selected.stack } : undefined}
        >
          {selected?.label ?? value}
        </span>
        <ChevronDown size={14} aria-hidden />
      </Button>
      <ContextMenu
        open={open}
        x={position.x}
        y={position.y}
        items={items}
        onClose={closeMenu}
        ariaLabel={ariaLabel}
        anchorRef={anchorRef}
      />
    </div>
  );
}
