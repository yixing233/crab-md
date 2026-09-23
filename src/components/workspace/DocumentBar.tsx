import { ArrowUpDown, ListTree } from "lucide-react";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { ViewModeSwitch } from "../ui/ViewModeSwitch";
import { zh } from "../../lib/i18n";
import type { ViewMode } from "../../lib/viewMode";
import type { ReactNode } from "react";
import "./workspace.css";

export interface DocumentBarProps {
  /** 左侧内容：面包屑（文件名/路径）。 */
  children: ReactNode;
  /** 视图模式：仅编辑 / 分栏 / 仅阅读（UI §11）。 */
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  /** 是否显示文档大纲（UI §23）。 */
  outlineVisible: boolean;
  onToggleOutline: () => void;
  /** 是否开启编辑/预览同步滚动。 */
  syncScroll?: boolean;
  onToggleSyncScroll?: () => void;
}

/**
 * 文档栏：位于编辑区顶部、显示当前文件名的那一行。
 *
 * 左侧是面包屑（我在哪），右侧是「这篇文档怎么看」——视图模式与大纲开关。
 * 分栏模式下提供同步滚动快速切换入口。
 *
 * 为什么视图切换在这里而不是顶部工具栏：
 * 它是**当前文档的视图属性**，不是全局工具。放在文件名旁边，
 * 语义上归属明确，也让工具栏只留下真正全局的动作（§2.1 层次更清晰）。
 */
export function DocumentBar({
  children,
  viewMode,
  onChangeViewMode,
  outlineVisible,
  onToggleOutline,
  syncScroll = true,
  onToggleSyncScroll,
}: DocumentBarProps) {
  return (
    <div className="document-bar">
      {children}

      <span className="document-bar__spacer" />

      <ViewModeSwitch value={viewMode} onChange={onChangeViewMode} />

      {/* 同步滚动开关只在分栏（双栏并存）模式下显示 */}
      {viewMode === "split" && onToggleSyncScroll && (
        <Tooltip
          content={
            syncScroll
              ? `${zh.toolbar.syncScroll}（${zh.toolbar.syncScrollOn}）`
              : `${zh.toolbar.syncScroll}（${zh.toolbar.syncScrollOff}）`
          }
        >
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onToggleSyncScroll}
            aria-pressed={syncScroll}
            aria-label={zh.toolbar.syncScroll}
            data-active={syncScroll || undefined}
          >
            <ArrowUpDown size={16} aria-hidden />
          </Button>
        </Tooltip>
      )}

      <Tooltip content={`${zh.toolbar.toggleOutline}　Ctrl+Shift+O`}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={onToggleOutline}
          aria-pressed={outlineVisible}
          aria-label={zh.toolbar.toggleOutline}
        >
          <ListTree size={16} aria-hidden />
        </Button>
      </Tooltip>
    </div>
  );
}
