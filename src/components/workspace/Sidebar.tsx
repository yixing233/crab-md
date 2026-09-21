import { FileTree } from "./FileTree";
import type { DocumentSummary } from "../../types/document";
import { zh } from "../../lib/i18n";
import "./workspace.css";

export interface SidebarProps {
  documents: DocumentSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onRequestDelete: (id: string, title: string) => void;
  /** 面板宽度（px），由外层分隔条调整（UI §11）。 */
  width?: number;
}

export function Sidebar({
  documents,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onRequestDelete,
  width,
}: SidebarProps) {
  return (
    <aside
      className="app-sidebar"
      role="complementary"
      aria-label={zh.sidebar.title}
      style={width ? { flexBasis: width } : undefined}
    >
      <div className="app-sidebar__header">{zh.sidebar.title}</div>
      <FileTree
        documents={documents}
        activeId={activeId}
        onSelect={onSelect}
        onCreate={onCreate}
        onRename={onRename}
        onRequestDelete={onRequestDelete}
      />
    </aside>
  );
}
