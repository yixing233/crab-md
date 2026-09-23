import { FileInput } from "lucide-react";
import { FileTree } from "./FileTree";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import type { DocumentSummary } from "../../types/document";
import { zh } from "../../lib/i18n";
import "./workspace.css";

export interface SidebarProps {
  documents: DocumentSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  /** 另存为副本（新身份、独立文件）。 */
  onDuplicate: (id: string, title: string) => void;
  /** 导出为 .md 文件（路径由系统对话框选定）。 */
  onExport: (id: string, title: string) => void;
  /** 从磁盘导入 .md 为新笔记（不针对某一篇，故放在标题栏）。 */
  onImport: () => void;
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
  onDuplicate,
  onExport,
  onImport,
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
      <div className="app-sidebar__header">
        <span>{zh.sidebar.title}</span>
        {/* 「导入」属于整个列表而不是某一篇，故放在列表标题旁，
            而不是塞进每篇笔记的右键菜单（那样会误导成"导入到这一篇"）。 */}
        <Tooltip content={zh.fileTree.importDoc}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={zh.fileTree.importDoc}
            onClick={onImport}
          >
            <FileInput size={14} strokeWidth={2} aria-hidden />
          </Button>
        </Tooltip>
      </div>
      <FileTree
        documents={documents}
        activeId={activeId}
        onSelect={onSelect}
        onCreate={onCreate}
        onRename={onRename}
        onDuplicate={onDuplicate}
        onExport={onExport}
        onRequestDelete={onRequestDelete}
      />
    </aside>
  );
}
