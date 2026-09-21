import { Moon, PanelLeft, Plus, Search, Sun, SunMoon } from "lucide-react";
import { Button } from "../ui/Button";
import { zh } from "../../lib/i18n";
import "./workspace.css";

export interface AppToolbarProps {
  onNewDocument: () => void;
  onToggleSidebar: () => void;
  sidebarVisible: boolean;
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
  themePreference,
  onCycleTheme,
}: AppToolbarProps) {
  const ThemeIcon = THEME_ICON[themePreference];
  const themeLabel = zh.toolbar.theme[themePreference];

  return (
    <header className="app-toolbar" role="banner">
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        onClick={onToggleSidebar}
        aria-pressed={sidebarVisible}
        title={zh.toolbar.toggleSidebar}
        aria-label={zh.toolbar.toggleSidebar}
      >
        <PanelLeft size={16} aria-hidden />
      </Button>

      <span className="app-toolbar__title">{zh.app.name}</span>

      <span className="app-toolbar__spacer" />

      <Button
        variant="ghost"
        size="sm"
        iconOnly
        onClick={onCycleTheme}
        title={`${themeLabel}（Ctrl+Shift+L）`}
        aria-label={themeLabel}
      >
        <ThemeIcon size={16} aria-hidden />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        iconOnly
        title={zh.toolbar.search}
        aria-label={zh.toolbar.search}
        disabled
      >
        <Search size={16} aria-hidden />
      </Button>

      <Button
        variant="primary"
        size="sm"
        onClick={onNewDocument}
        title={`${zh.toolbar.newDocument}（Ctrl+N）`}
      >
        <Plus size={14} aria-hidden />
        <span>{zh.toolbar.newDocument}</span>
      </Button>
    </header>
  );
}
