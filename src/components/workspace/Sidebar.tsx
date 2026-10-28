import { useMemo } from "react";
import { FileInput, Files, ListTree, PanelLeftClose } from "lucide-react";
import { Tabs } from "antd";
import { RecentFileList } from "./RecentFileList";
import { OutlineTree } from "../editor/OutlineTree";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import type { DocumentSummary, ExternalFileView, RecentFileView } from "../../types/document";
import { pathKey } from "../../lib/externalFiles";
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
  /** 收起侧边栏（按钮放在侧栏自己的头部，不占顶部工具栏）。 */
  onCollapse?: () => void;
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
  onCollapse,
}: SidebarProps) {
  const currentWidth = width ?? 260;

  // 将全部文件统一合并为一个扁平列表：统一磁盘历史 + 旧外部文件清单 + 工作区文档。
  //
  // 不能二选一（只取其一）：统一历史非空时，文件关联「打开方式」刚打开的
  // 文件只登记在旧外部清单里（旧版本行为），二选一会把它整个藏掉 ——
  // 用户看到标签页开了、文件树里却找不到。按路径归一键去重后三路合并。
  const displayedFiles = useMemo(() => {
    const list: RecentFileView[] = [];
    const seen = new Set<string>();

    for (const f of recentFiles ?? []) {
      list.push(f);
      seen.add(pathKey(f.path));
      seen.add(f.name.toLowerCase());
    }

    // 旧外部文件清单：统一历史里没有的条目补进来（历史版本只登记了这张表）。
    for (const f of externalFiles ?? []) {
      if (seen.has(pathKey(f.path))) continue;
      list.push({
        pathKey: pathKey(f.path),
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
      seen.add(pathKey(f.path));
      seen.add(f.name.toLowerCase());
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
        {/* 头部：收起按钮住在侧栏自己的区域里（顶部工具栏不再负责这件事）。 */}
        {onCollapse && (
          <div className="app-sidebar__header">
            <Tooltip content={zh.sidebar.collapse}>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={zh.sidebar.collapse}
                onClick={onCollapse}
              >
                <PanelLeftClose size={14} aria-hidden />
              </Button>
            </Tooltip>
          </div>
        )}
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
