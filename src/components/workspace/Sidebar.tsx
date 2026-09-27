import { Folder, FolderOpen, ListTree } from "lucide-react";
import { FileTree } from "./FileTree";
import { OutlineTree } from "../editor/OutlineTree";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import type { DocumentSummary } from "../../types/document";
import { zh } from "../../lib/i18n";
import "./workspace.css";

export interface SidebarProps {
  documents: DocumentSummary[];
  activeId: string | null;
  activeContent?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  /** 另存为副本（新身份、独立文件）。 */
  onDuplicate: (id: string, title: string) => void;
  /** 导出为 .md 文件（路径由系统对话框选定）。 */
  onExport: (id: string, title: string) => void;
  /** 从磁盘打开文本或 Markdown 为新笔记（不针对某一篇，故放在标题栏）。 */
  onOpenFile: () => void;
  onRequestDelete: (id: string, title: string) => void;
  /** 大纲标题跳转回调。 */
  onJump?: (line: number) => void;
  /** 面板宽度（px），由外层分隔条调整（UI §11）。 */
  width?: number;
  /** 是否折叠（用于平滑展开/收起过渡动画）。 */
  collapsed?: boolean;
}

export function Sidebar({
  documents,
  activeId,
  activeContent = "",
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onExport,
  onOpenFile,
  onRequestDelete,
  onJump = () => {},
  width,
  collapsed = false,
}: SidebarProps) {
  const currentWidth = width ?? 260;

  return (
    <aside
      className="app-sidebar"
      role="complementary"
      aria-label="侧边栏"
      data-collapsed={collapsed || undefined}
      style={{ flexBasis: collapsed ? 0 : currentWidth }}
    >
      <div className="app-sidebar__inner" style={{ width: currentWidth }}>
        {/* 大纲区域：主视区，显示当前文档的大纲结构与快速跳转 */}
        <div className="app-sidebar__section app-sidebar__section--outline">
          <div className="app-sidebar__section-header">
            <div className="app-sidebar__section-title">
              <ListTree size={14} className="app-sidebar__icon" aria-hidden />
              <span>大纲</span>
            </div>
          </div>
          <div className="app-sidebar__outline-container">
            {activeId && activeContent.trim().length > 0 ? (
              <OutlineTree source={activeContent} onJump={onJump} showHeader={false} />
            ) : (
              <div className="app-sidebar__empty-outline">
                <ListTree size={20} strokeWidth={1.5} className="app-sidebar__empty-icon" />
                <span className="app-sidebar__empty-title">暂无文档大纲</span>
                <p className="app-sidebar__empty-desc">打开或编辑带标题的笔记时在此生成目录结构</p>
              </div>
            )}
          </div>
        </div>

        {/* 笔记文件树区域 */}
        <div className="app-sidebar__section app-sidebar__section--files">
          <div className="app-sidebar__section-header">
            <div className="app-sidebar__section-title">
              <Folder size={14} className="app-sidebar__icon" aria-hidden />
              <span>{zh.sidebar.title}</span>
            </div>
            <Tooltip content={zh.fileTree.openFile}>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={zh.fileTree.openFile}
                onClick={onOpenFile}
              >
                <FolderOpen size={14} strokeWidth={2} aria-hidden />
              </Button>
            </Tooltip>
          </div>
          <div className="app-sidebar__files-container">
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
          </div>
        </div>
      </div>
    </aside>
  );
}
