import { useEffect, useRef, useState } from "react";
import "./ui.css";

export interface InlineEditProps {
  /** 初始值；组件挂载时自动聚焦并全选。 */
  initialValue: string;
  /** 无障碍名称（UI §15 要求可访问名称，此处不显示可见标签）。 */
  ariaLabel: string;
  /** Enter 或失焦时提交；空白值不会提交。 */
  onCommit: (next: string) => void;
  /** Escape 取消（桌面端，UI §18.2）。 */
  onCancel: () => void;
}

/**
 * 行内编辑输入（UI_DESIGN_SYSTEM.md §13 原语、§18.2 重命名规则）。
 *
 * 复用 `.ui-input` 的样式，而不是让各页面自造输入框样式（§2.4）。
 * 行为：自动聚焦并全选、Enter 提交、Escape 取消、失焦提交。
 */
export function InlineEdit({ initialValue, ariaLabel, onCommit, onCancel }: InlineEditProps) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialValue);
  // 记住是否已结束，避免 Escape 之后 onBlur 又提交一次。
  const settled = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    const trimmed = value.trim();
    // 空名或未改动就不提交，避免无意义的后端写入。
    if (!trimmed || trimmed === initialValue) {
      onCancel();
      return;
    }
    onCommit(trimmed);
  };

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  return (
    <input
      ref={ref}
      className="ui-input ui-input--inline"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
    />
  );
}
