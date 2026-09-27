import { useState, type MouseEvent } from "react";
import { FileText, Home, Plus, X } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
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
}: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);

  const handleContextMenu = (e: MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      tabId,
    });
  };

  const contextMenuItems: ContextMenuItem[] = contextMenu
    ? [
        {
          id: "close",
          label: "关闭标签页",
          shortcut: "Ctrl+W",
          onSelect: () => onCloseTab(contextMenu.tabId),
        },
        {
          id: "close-others",
          label: "关闭其他标签页",
          disabled: tabs.length <= 1,
          onSelect: () => onCloseOtherTabs?.(contextMenu.tabId),
        },
        {
          id: "close-right",
          label: "关闭右侧标签页",
          disabled: tabs.findIndex((t) => t.id === contextMenu.tabId) >= tabs.length - 1,
          onSelect: () => onCloseRightTabs?.(contextMenu.tabId),
        },
        {
          id: "close-all",
          label: "关闭所有标签页",
          onSelect: () => onCloseAllTabs?.(),
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
          return (
            <div
              key={tab.id}
              role="tab"
              className="app-tab"
              aria-selected={isActive}
              data-active={isActive || undefined}
              data-dirty={tab.dirty || undefined}
              onClick={() => onSelectTab(tab.id)}
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
              <span className="app-tab__title">{tab.title || "无标题"}</span>

              {/* 未保存修改圆点 */}
              {tab.dirty && <span className="app-tab__dirty" title="有未保存修改" aria-label="未保存" />}

              {/* 关闭按钮 */}
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
