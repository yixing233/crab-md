import { useMemo } from "react";
import { FileInput, Files, ListTree } from "lucide-react";
import { Tabs } from "antd";
import { RecentFileList } from "./RecentFileList";
import { OutlineTree } from "../editor/OutlineTree";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import type { DocumentSummary, ExternalFileView, RecentFileView } from "../../types/document";
import { zh } from "../../lib/i18n";
import "./workspace.css";

export type SidebarTab = "outline" | "notes" | "external";

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
  /** 在系统文件管理器里定位该笔记的磁盘文件。 */
  onReveal: (id: string, title: string) => void;
  /** 从磁盘打开文本或 Markdown。 */
  onOpenFile: () => void;
  onRequestDelete: (id: string, title: string) => void;
  /** 打开过的历史文件（来自数据库；没有正文）。 */
  externalFiles?: ExternalFileView[];
  recentFiles?: RecentFileView[];
  /** 打开某个外部文件（重新从磁盘读取）。 */
  onOpenExternal?: (path: string) => void;
  /** 在系统文件管理器里定位外部文件。 */
  onRevealExternal?: (path: string) => void;
  /** 从历史文件列表移除记录（不删除磁盘文件）。 */
  onForgetExternal?: (path: string) => void;
  onRemoveRecentFile?: (path: string) => void;
  onDeleteDiskFile?: (path: string) => void;
  onTogglePin?: (path: string, pinned: boolean) => void;
  /** 当前激活的面板。 */
  tab: SidebarTab;
  /** 切换面板。 */
  onChangeTab: (tab: SidebarTab) => void;
  /** 大纲标题跳转回调。 */
  onJump?: (line: number) => void;
  /** 面板宽度（px），由外层分隔条调整（UI §11）。 */
  width?: number;
  /** 是否折叠（用于平滑展开/收起过渡动画）。 */
  collapsed?: boolean;
}

/**
 * 左侧栏：大纲与文件面板（使用 Ant Design Tabs 实现平滑滑块与标准无障碍）。
 */
export function Sidebar({
  documents,
  activeId,
  activeContent = "",
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onExport: _onExport,
  onReveal,
  onOpenFile,
  onRequestDelete,
  externalFiles = [],
  recentFiles,
  onOpenExternal,
  onRevealExternal,
  onForgetExternal,
  onRemoveRecentFile,
  onDeleteDiskFile,
  onTogglePin,
  tab,
  onChangeTab,
  onJump = () => {},
  width,
  collapsed = false,
}: SidebarProps) {
  const currentWidth = width ?? 260;

  // 将全部文件统一合并为一个扁平列表：优先真实磁盘历史，合并旧工作区文档，彻底消除“内部文档 vs 外部文件”的割裂
  const displayedFiles = useMemo(() => {
    const list: RecentFileView[] = [];
    const seen = new Set<string>();

    if (recentFiles && recentFiles.length > 0) {
      for (const f of recentFiles) {
        list.push(f);
        seen.add(f.path.toLowerCase());
        seen.add(f.name.toLowerCase());
      }
    } else if (externalFiles && externalFiles.length > 0) {
      for (const f of externalFiles) {
        list.push({
          pathKey: f.path.toLowerCase(),
          path: f.path,
          name: f.name,
          size: f.size,
          modifiedAt: f.modifiedAt,
          openedAt: f.openedAt,
          pinned: false,
          cursorLine: 1,
          cursorCol: 1,
          scrollRatio: 0,
          exists: !f.missing,
        });
        seen.add(f.path.toLowerCase());
        seen.add(f.name.toLowerCase());
      }
    }

    // 补充工作区中的文档（如旧笔记或测试数据），确保统一在一个列表展示
    for (const d of documents) {
      const key = d.id.toLowerCase();
      const nameKey = d.title.toLowerCase();
      if (!seen.has(key) && !seen.has(nameKey) && !seen.has(`${nameKey}.md`)) {
        list.push({
          pathKey: d.id,
          path: d.id,
          name: d.title,
          size: d.size,
          modifiedAt: d.updatedAt,
          openedAt: d.updatedAt,
          pinned: false,
          cursorLine: 1,
          cursorCol: 1,
          scrollRatio: 0,
          exists: true,
        });
        seen.add(key);
      }
    }

    return list;
  }, [recentFiles, externalFiles, documents]);

  const activePath = activeId?.startsWith("ext:") ? activeId.slice(4) : activeId;
  const currentKey = tab === "outline" ? "outline" : "notes";

  const tabItems = [
    {
      key: "outline",
      label: (
        <span className="app-sidebar__tab-title">
          <ListTree size={14} aria-hidden />
          <span>{zh.outline.title}</span>
        </span>
      ),
      children: (
        <div className="app-sidebar__panel" id="sidebar-panel-outline">
          {activeId && activeContent.trim().length > 0 ? (
            <OutlineTree source={activeContent} onJump={onJump} showHeader={false} />
          ) : (
            <div className="app-sidebar__empty-outline">
              <ListTree size={20} strokeWidth={1.5} className="app-sidebar__empty-icon" aria-hidden />
              <span className="app-sidebar__empty-title">{zh.sidebar.emptyOutlineTitle}</span>
              <p className="app-sidebar__empty-desc">{zh.sidebar.emptyOutlineDesc}</p>
            </div>
          )}
        </div>
      ),
    },
    {
      key: "notes",
      label: (
        <span className="app-sidebar__tab-title">
          <Files size={14} aria-hidden />
          <span>{zh.sidebar.filesTab}</span>
        </span>
      ),
      children: (
        <div className="app-sidebar__panel" id="sidebar-panel-notes">
          <RecentFileList
            files={displayedFiles}
            activePath={activePath}
            onOpen={(path) => {
              if (onOpenExternal && (path.includes("/") || path.includes("\\") || path.startsWith("ext:"))) {
                onOpenExternal(path);
              } else {
                onSelect(path);
              }
            }}
            onNew={onCreate}
            onOpenFilePicker={onOpenFile}
            onDuplicate={onDuplicate}
            onRename={onRename}
            onReveal={(path, name) => {
              if (onRevealExternal && (path.includes("/") || path.includes("\\") || path.startsWith("ext:"))) {
                onRevealExternal(path);
              } else {
                onReveal(path, name);
              }
            }}
            onRemoveFromHistory={(path) => {
              if (onRemoveRecentFile) onRemoveRecentFile(path);
              else if (onForgetExternal) onForgetExternal(path);
            }}
            onDeleteFromDisk={(path) => {
              if (onDeleteDiskFile && (path.includes("/") || path.includes("\\") || path.startsWith("ext:"))) {
                onDeleteDiskFile(path);
              } else {
                onRequestDelete(path, "");
              }
            }}
            onTogglePin={(path, pinned) => {
              if (onTogglePin) onTogglePin(path, pinned);
            }}
          />
        </div>
      ),
    },
  ];

  return (
    <aside
      className="app-sidebar"
      role="complementary"
      aria-label="侧边栏"
      data-collapsed={collapsed || undefined}
      style={{ flexBasis: collapsed ? 0 : currentWidth }}
    >
      <div className="app-sidebar__inner" style={{ width: currentWidth }}>
        <Tabs
          className="app-sidebar__antd-tabs"
          activeKey={currentKey}
          onChange={(k) => onChangeTab(k as SidebarTab)}
          size="small"
          destroyOnHidden
          tabBarExtraContent={
            <Tooltip content={zh.fileTree.openFile}>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={zh.fileTree.openFile}
                onClick={onOpenFile}
              >
                <FileInput size={14} strokeWidth={2} aria-hidden />
              </Button>
            </Tooltip>
          }
          items={tabItems}
        />
      </div>
    </aside>
  );
}
