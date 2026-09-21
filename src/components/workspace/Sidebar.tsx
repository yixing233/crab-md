import { FileTree } from "./FileTree";
import type { DocumentSummary } from "../../types/document";
import "./workspace.css";

export interface SidebarProps {
  documents: DocumentSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function Sidebar({ documents, activeId, onSelect, onCreate }: SidebarProps) {
  return (
    <aside className="app-sidebar" role="complementary" aria-label="Workspace">
      <div className="app-sidebar__header">Notes</div>
      <FileTree documents={documents} activeId={activeId} onSelect={onSelect} onCreate={onCreate} />
    </aside>
  );
}
