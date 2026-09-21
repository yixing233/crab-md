import { PanelLeft, Plus, Search } from "lucide-react";
import { Button } from "../ui/Button";
import "./workspace.css";

export interface AppToolbarProps {
  onNewDocument: () => void;
  onToggleSidebar: () => void;
  sidebarVisible: boolean;
}

/** 顶部工具栏。视觉安静，不与编辑器争主体（UI §2.1）。 */
export function AppToolbar({ onNewDocument, onToggleSidebar, sidebarVisible }: AppToolbarProps) {
  return (
    <header className="app-toolbar" role="banner">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggleSidebar}
        aria-pressed={sidebarVisible}
        title="Toggle sidebar"
      >
        <PanelLeft size={16} />
        <span className="sr-only">Toggle sidebar</span>
      </Button>

      <span className="app-toolbar__title">crab-md</span>

      <span className="app-toolbar__spacer" />

      <Button variant="ghost" size="sm" title="Search (Ctrl+Shift+F)" disabled>
        <Search size={16} />
        <span className="sr-only">Search</span>
      </Button>

      <Button variant="primary" size="sm" onClick={onNewDocument} title="New document (Ctrl+N)">
        <Plus size={14} />
        New
      </Button>
    </header>
  );
}
