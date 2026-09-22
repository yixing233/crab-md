import { ListTree, Moon, PanelLeft, Plus, Search, Sun, SunMoon } from "lucide-react";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { ViewModeSwitch } from "../ui/ViewModeSwitch";
import { zh } from "../../lib/i18n";
import type { ViewMode } from "../../lib/viewMode";
import "./workspace.css";

export interface AppToolbarProps {
  onNewDocument: () => void;
  onToggleSidebar: () => void;
  sidebarVisible: boolean;
  /** 是否显示文档大纲（UI §23）。 */
  outlineVisible: boolean;
  onToggleOutline: () => void;
  /** 视图模式：仅编辑 / 分栏 / 仅阅读（UI §11）。 */
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  /** 当前主题偏好（UI_DESIGN_SYSTEM.md §4.1 要求 Light/Dark/Follow system）。 */
  themePreference: "light" | "dark" | "system";
  onCycleTheme: () => void;
}

const THEME_ICON = { light: Sun, dark: Moon, system: SunMoon } as const;

/** 顶部工具栏。视觉安静，不与编辑器争主体（UI §2.1）。 */
export function AppToolbar({
  onNewDocument,
  onToggleSidebar,
  sidebarVisible,
  outlineVisible,
  onToggleOutline,
  viewMode,
  onChangeViewMode,
  themePreference,
  onCycleTheme,
}: AppToolbarProps) {
  const ThemeIcon = THEME_ICON[themePreference];
  const themeLabel = zh.toolbar.theme[themePreference];

  return (
    <header className="app-toolbar" role="banner">
      <Tooltip content={zh.toolbar.toggleSidebar}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={onToggleSidebar}
          aria-pressed={sidebarVisible}
          aria-label={zh.toolbar.toggleSidebar}
        >
          <PanelLeft size={16} aria-hidden />
        </Button>
      </Tooltip>

      <span className="app-toolbar__title">{zh.app.name}</span>

      <span className="app-toolbar__spacer" />

      {/* 视图模式：仅编辑 / 分栏 / 仅阅读。放最右侧常用区之前。 */}
      <ViewModeSwitch value={viewMode} onChange={onChangeViewMode} />

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

      <Tooltip content={`${themeLabel}　Ctrl+Shift+L`}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={onCycleTheme}
          aria-label={themeLabel}
        >
          <ThemeIcon size={16} aria-hidden />
        </Button>
      </Tooltip>

      <Tooltip content={zh.toolbar.search}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={zh.toolbar.search}
          disabled
        >
          <Search size={16} aria-hidden />
        </Button>
      </Tooltip>

      <Tooltip content={`${zh.toolbar.newDocument}　Ctrl+N`}>
        <Button variant="primary" size="sm" onClick={onNewDocument}>
          <Plus size={14} aria-hidden />
          <span>{zh.toolbar.newDocument}</span>
        </Button>
      </Tooltip>
    </header>
  );
}
