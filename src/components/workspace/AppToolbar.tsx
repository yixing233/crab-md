import { Moon, PanelLeft, Plus, Search, Sun, SunMoon } from "lucide-react";
import { Button } from "../ui/Button";
import "./workspace.css";

export interface AppToolbarProps {
  onNewDocument: () => void;
  onToggleSidebar: () => void;
  sidebarVisible: boolean;
  /** 当前主题偏好（UI_DESIGN_SYSTEM.md §4.1 要求 Light/Dark/Follow system）。 */
  themePreference: "light" | "dark" | "system";
  onCycleTheme: () => void;
}

const THEME_LABEL: Record<AppToolbarProps["themePreference"], string> = {
  light: "Light theme",
  dark: "Dark theme",
  system: "System theme",
};

/** 顶部工具栏。视觉安静，不与编辑器争主体（UI §2.1）。 */
export function AppToolbar({
  onNewDocument,
  onToggleSidebar,
  sidebarVisible,
  themePreference,
  onCycleTheme,
}: AppToolbarProps) {
  const ThemeIcon =
    themePreference === "light" ? Sun : themePreference === "dark" ? Moon : SunMoon;
  const themeLabel = THEME_LABEL[themePreference];

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

      <Button
        variant="ghost"
        size="sm"
        onClick={onCycleTheme}
        title={`${themeLabel} (Ctrl+Shift+L)`}
      >
        <ThemeIcon size={16} />
        <span className="sr-only">{themeLabel}</span>
      </Button>

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
