import { useMemo } from "react";
import { ListTree } from "lucide-react";
import { extractOutline } from "../../lib/outline";
import { zh } from "../../lib/i18n";
import "./editor.css";

export interface OutlineTreeProps {
  /** 当前文档内容；从中抽取标题。 */
  source: string;
  /** 点击某个标题时跳转到它的行（0 基）。 */
  onJump: (line: number) => void;
}

/**
 * 文档大纲（UI_DESIGN_SYSTEM.md §19 / §23）。
 *
 * 纯展示组件：标题抽取逻辑在 `lib/outline.ts`，跳转行为由父组件决定。
 */
export function OutlineTree({ source, onJump }: OutlineTreeProps) {
  const items = useMemo(() => extractOutline(source), [source]);

  if (items.length === 0) {
    return <p className="outline__empty">{zh.outline.empty}</p>;
  }

  return (
    <nav className="outline" aria-label={zh.outline.ariaLabel}>
      <div className="outline__header">
        <ListTree size={14} aria-hidden />
        <span>{zh.outline.title}</span>
      </div>
      <ul className="outline__list">
        {items.map((item, i) => (
          <li key={`${item.line}-${i}`}>
            <button
              type="button"
              className="outline__item"
              // 层级缩进直接映射到 padding，层级关系一眼可见。
              style={{ paddingLeft: (item.level - 1) * 12 + 10 }}
              data-level={item.level}
              onClick={() => onJump(item.line)}
              title={item.text || zh.outline.untitled}
            >
              {item.text || zh.outline.untitled}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
