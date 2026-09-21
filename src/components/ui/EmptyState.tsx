import type { ReactNode } from "react";
import "./ui.css";

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** 建议的主操作，例如「新建笔记」。 */
  action?: ReactNode;
}

/** 空态（UI_DESIGN_SYSTEM.md §32）。 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      <p className="ui-empty__title">{title}</p>
      {description && <p className="ui-empty__description">{description}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
