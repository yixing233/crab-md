import { useState, type MouseEvent } from "react";
import { FileText, Home, Plus, X } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { ContextMenu, type ContextMenuEntry } from "../ui/ContextMenu";
import { InlineEdit } from "../ui/InlineEdit";
import { zh } from "../../lib/i18n";
import "./tabBar.css";

export interface TabItem {
  id: string;
  title: string;
  dirty?: boolean;
}

export interface TabBarProps {
  /** 当前打开的标签页列表。 */
  tabs: TabItem[];
  /** 当前激活的标签页 ID；为 null 表示当前处于「主页」。 */
  activeId: string | null;
  /** 点击选择某个标签页；id 为 null 时表示切换至「主页」。 */
  onSelectTab: (id: string | null) => void;
  /** 关闭某个标签页。 */
  onCloseTab: (id: string) => void;
  /** 新建标签页 / 新建笔记。 */
  onNewTab: () => void;
  /** 关闭其他标签页。 */
  onCloseOtherTabs?: (id: string) => void;
  /** 关闭右侧标签页。 */
  onCloseRightTabs?: (id: string) => void;
  /** 全部关闭并回到主页。 */
  onCloseAllTabs?: () => void;
  /** 重命名标签页对应的文档。 */
  onRenameTab?: (id: string, newTitle: string) => void;
  /** 另存为副本。 */
  onDuplicateTab?: (id: string, title: string) => void;
  /** 导出文档。 */
  onExportTab?: (id: string, title: string) => void;
}

interface TabContextMenuState {
  x: number;
  y: number;
  tabId: string;
}

export function TabBar({
  tabs,
  activeId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onCloseOtherTabs,
  onCloseRightTabs,
  onCloseAllTabs,
  onRenameTab,
  onDuplicateTab,
  onExportTab,
}: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const handleContextMenu = (e: MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  };

  const targetTab = contextMenu ? tabs.find((t) => t.id === contextMenu.tabId) : null;

  // 右键菜单：包含重命名、副本、导出，并将多样的关闭选项收纳至“关闭标签页”二级子菜单
  const contextMenuItems: ContextMenuEntry[] =
    contextMenu && targetTab
      ? [
          {
            id: "rename",
            label: zh.fileTree.rename,
            shortcut: "F2",
            onSelect: () => {
              setRenamingId(targetTab.id);
            },
          },
          {
            id: "duplicate",
            label: zh.fileTree.duplicate,
            onSelect: () => onDuplicateTab?.(targetTab.id, targetTab.title),
          },
          {
            id: "export",
            label: zh.fileTree.exportDoc,
            onSelect: () => onExportTab?.(targetTab.id, targetTab.title),
          },
          { id: "action-sep", separator: true },
          {
            id: "close-submenu",
            label: "关闭标签页",
            shortcut: "Ctrl+W",
            onSelect: () => onCloseTab(targetTab.id),
            submenu: [
              {
                id: "close-current",
                label: "关闭当前标签页",
                shortcut: "Ctrl+W",
                onSelect: () => onCloseTab(targetTab.id),
              },
              {
                id: "close-others",
                label: "关闭其他标签页",
                disabled: tabs.length <= 1,
                onSelect: () => onCloseOtherTabs?.(targetTab.id),
              },
              {
                id: "close-right",
                label: "关闭右侧标签页",
                disabled: tabs.findIndex((t) => t.id === targetTab.id) >= tabs.length - 1,
                onSelect: () => onCloseRightTabs?.(targetTab.id),
              },
              { id: "close-all-sep", separator: true },
              {
                id: "close-all",
                label: "关闭所有标签页",
                onSelect: () => onCloseAllTabs?.(),
              },
            ],
          },
        ]
      : [];

  return (
    <nav className="app-tab-bar" aria-label="标签栏">
      <div className="app-tab-bar__scroll" role="tablist">
        {/* 固定主页标签 */}
        <button
          type="button"
          role="tab"
          className="app-tab app-tab--home"
          aria-selected={activeId === null}
          data-active={activeId === null || undefined}
          onClick={() => onSelectTab(null)}
          title="工作区主页"
        >
          <Home size={14} className="app-tab__icon" aria-hidden />
          <span className="app-tab__title">主页</span>
        </button>

        {/* 动态文档标签列表 */}
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const isRenaming = tab.id === renamingId;
          return (
            <div
              key={tab.id}
              role="tab"
              className="app-tab"
              aria-selected={isActive}
              data-active={isActive || undefined}
              data-dirty={tab.dirty || undefined}
              onClick={() => {
                if (!isRenaming) onSelectTab(tab.id);
              }}
              onDoubleClick={() => setRenamingId(tab.id)}
              onAuxClick={(e) => {
                // 中键点击快速关闭
                if (e.button === 1) {
                  e.preventDefault();
                  onCloseTab(tab.id);
                }
              }}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              title={tab.title}
            >
              <FileText size={13} className="app-tab__icon" aria-hidden />

              {isRenaming ? (
                <InlineEdit
                  initialValue={tab.title}
                  ariaLabel={zh.fileTree.renameLabel}
                  onCommit={(next) => {
                    setRenamingId(null);
                    onRenameTab?.(tab.id, next);
                  }}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <span className="app-tab__title">{tab.title || "无标题"}</span>
              )}

              {/* 未保存修改圆点 */}
              {tab.dirty && !isRenaming && (
                <span className="app-tab__dirty" title="有未保存修改" aria-label="未保存" />
              )}

              {/* 关闭按钮 */}
              {!isRenaming && (
                <button
                  type="button"
                  className="app-tab__close"
                  aria-label={`关闭 ${tab.title}`}
                  title="关闭 (Ctrl+W)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <X size={12} aria-hidden />
                </button>
              )}
            </div>
          );
        })}

        {/* 新建标签按钮 */}
        <Tooltip content={zh.toolbar.newDocument}>
          <button
            type="button"
            className="app-tab-bar__new"
            aria-label={zh.toolbar.newDocument}
            onClick={onNewTab}
          >
            <Plus size={14} aria-hidden />
          </button>
        </Tooltip>
      </div>

      <ContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextMenuItems}
        ariaLabel="标签页操作"
        onClose={() => setContextMenu(null)}
      />
    </nav>
  );
}
