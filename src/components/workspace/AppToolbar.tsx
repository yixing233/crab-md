import { Download, Moon, PanelLeft, Plus, Printer, Search, Settings, Sun, SunMoon } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Tooltip } from "../ui/Tooltip";
import { zh } from "../../lib/i18n";
import "./workspace.css";

export interface AppToolbarProps {
  onNewDocument: () => void;
  onToggleSidebar: () => void;
  sidebarVisible: boolean;
  /** 打开设置页（UI §34，快捷键 Ctrl+,）。 */
  onOpenSettings: () => void;
  /** 可选：打开编辑器查找面板（若全局工具栏不需要则不传）。 */
  onSearch?: () => void;
  /** 打开系统打印对话框，用户可选择另存为 PDF。 */
  onPrint: () => void;
  /**
   * 有新版本时显示常驻入口（含徽标）。
   * 传 null 表示无更新 —— 工具栏保持安静（§2.1）。
   */
  pendingVersion: string | null;
  /** 点更新入口：打开设置页的「关于」分组。 */
  onOpenUpdate: () => void;
  /** 当前主题偏好（UI_DESIGN_SYSTEM.md §4.1 要求 Light/Dark/Follow system）。 */
  themePreference: "light" | "dark" | "system";
  onCycleTheme: () => void;
}

const THEME_ICON = { light: Sun, dark: Moon, system: SunMoon } as const;

/**
 * 顶部工具栏。视觉安静，不与编辑器争主体（UI §2.1）。
 *
 * 视图模式与大纲切换**不在这里** —— 它们属于「当前这篇文档怎么看」，
 * 已移到文档栏（文件名右侧）。工具栏只保留全局工具。
 */
export function AppToolbar({
  onNewDocument,
  onToggleSidebar,
  sidebarVisible,
  onOpenSettings,
  onSearch,
  onPrint,
  pendingVersion,
  onOpenUpdate,
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

      {onSearch && (
        <Tooltip content={`${zh.toolbar.search}　Ctrl+F`}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={zh.toolbar.search}
            onClick={onSearch}
          >
            <Search size={16} aria-hidden />
          </Button>
        </Tooltip>
      )}

      <Tooltip content={zh.toolbar.printPdf}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={zh.toolbar.printPdf}
          onClick={onPrint}
        >
          <Printer size={16} aria-hidden />
        </Button>
      </Tooltip>

      {/* 有更新时才出现的常驻入口：带徽标，一眼可见。
          没有更新时整块不渲染 —— 工具栏平时保持安静（§2.1）。 */}
      {pendingVersion !== null && (
        <Tooltip content={zh.settings.update.toolbarLabel(pendingVersion)}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenUpdate}
            aria-label={zh.settings.update.toolbarLabel(pendingVersion)}
          >
            <Download size={16} aria-hidden />
            <Badge pill>{pendingVersion}</Badge>
          </Button>
        </Tooltip>
      )}

      <Tooltip content={`${zh.toolbar.settings}　Ctrl+,`}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={onOpenSettings}
          aria-label={zh.toolbar.settings}
        >
          <Settings size={16} aria-hidden />
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
