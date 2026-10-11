import { Download, Moon, PanelLeft, Plus, Printer, Search, Settings, Sun, SunMoon } from "lucide-react";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Tooltip } from "../ui/Tooltip";
import { MenuBar, type MenuBarMenu } from "./MenuBar";
import { zh } from "../../lib/i18n";
import "./workspace.css";

export interface AppToolbarProps {
  onNewDocument: () => void;
  onToggleSidebar: () => void;
  sidebarVisible: boolean;
  /**
   * 顶部菜单栏（文件 / 编辑 / 视图 / 帮助）。
   *
   * 可选：`devHarness` 这类只关心单个控件的宿主可以不传，工具栏退化成
   * 原来那排图标。菜单项由 App.tsx 组装 —— 只有它知道哪些命令当前可用。
   */
  menus?: MenuBarMenu[];
  /** 打开设置页（UI §34，快捷键 Ctrl+,）。 */
  onOpenSettings: () => void;
  /** 可选：打开编辑器查找面板（若全局工具栏不需要则不传）。 */
  onSearch?: () => void;
  /** 可选：打开打印对话框（文档级操作优先放在 EditorToolbar）。 */
  onPrint?: () => void;
  /**
   * 有新版本时显示常驻入口（含徽标）。
   * 传 null 表示无更新 —— 工具栏保持安静（§2.1）。
   */
  pendingVersion: string | null;
  /** 点更新入口：打开「关于」对话框（更新详情就在里面）。 */
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
  menus,
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

      {menus && menus.length > 0 && <MenuBar menus={menus} />}

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

      {onPrint && (
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
      )}

      {/* 有更新时才出现的常驻入口：带徽标，一眼可见。
          没有更新时整块不渲染 —— 工具栏平时保持安静（§2.1）。 */}
      {pendingVersion !== null && (
        <Tooltip content={zh.update.toolbarLabel(pendingVersion)}>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenUpdate}
            aria-label={zh.update.toolbarLabel(pendingVersion)}
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

      {/* 按钮上文字本身可见，Tooltip 不再带快捷键 —— 快捷键归属
          命令面板与菜单（那里有统一的 shortcut 列），工具栏保持安静。 */}
      <Tooltip content={zh.toolbar.newDocument}>
        <Button variant="primary" size="sm" onClick={onNewDocument}>
          <Plus size={14} aria-hidden />
          <span>{zh.toolbar.newDocument}</span>
        </Button>
      </Tooltip>
    </header>
  );
}
