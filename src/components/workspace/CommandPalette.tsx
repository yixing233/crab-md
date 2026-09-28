import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  Columns2,
  FileEdit,
  FilePlus,
  FileText,
  FolderOpen,
  PanelLeft,
  Printer,
  Save,
  Search,
  Settings,
  SunMoon,
} from "lucide-react";
import type { DocumentSummary } from "../../types/document";
import type { ViewMode } from "../../lib/viewMode";
import type { SettingsSection } from "../settings/SettingsPage";
import { zh } from "../../lib/i18n";
import "./palette.css";

export interface PaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  category: "文档" | "命令";
  icon: ReactNode;
  shortcut?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  documents: DocumentSummary[];
  onOpenDocument: (id: string) => void;
  onNewDocument: () => void;
  onOpenFile: () => void;
  onSaveActive?: () => void;
  onToggleSidebar: () => void;
  onCycleTheme: () => void;
  onChangeViewMode: (mode: ViewMode) => void;
  onOpenSettings: (section?: SettingsSection) => void;
  onPrint: () => void;
}

export function CommandPalette({
  open,
  onClose,
  documents,
  onOpenDocument,
  onNewDocument,
  onOpenFile,
  onSaveActive,
  onToggleSidebar,
  onCycleTheme,
  onChangeViewMode,
  onOpenSettings,
  onPrint,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 打开时重置输入与选中项，并聚焦输入框
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 30);
    }
  }, [open]);

  // 全局 Escape 关闭监听
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 构建全部可用命令
  const commands: PaletteItem[] = useMemo(() => {
    return [
      {
        id: "cmd-new-doc",
        title: "新建笔记",
        category: "命令",
        shortcut: "Ctrl+N",
        icon: <FilePlus size={16} />,
        onSelect: () => {
          onClose();
          onNewDocument();
        },
      },
      {
        id: "cmd-open-file",
        title: "打开本地文件",
        category: "命令",
        shortcut: "Ctrl+O",
        icon: <FolderOpen size={16} />,
        onSelect: () => {
          onClose();
          onOpenFile();
        },
      },
      ...(onSaveActive
        ? [
            {
              id: "cmd-save-doc",
              title: "保存当前文档",
              category: "命令" as const,
              shortcut: "Ctrl+S",
              icon: <Save size={16} />,
              onSelect: () => {
                onClose();
                onSaveActive();
              },
            },
          ]
        : []),
      {
        id: "cmd-toggle-sidebar",
        title: "切换侧边栏 / 大纲",
        category: "命令",
        shortcut: "Ctrl+Shift+O",
        icon: <PanelLeft size={16} />,
        onSelect: () => {
          onClose();
          onToggleSidebar();
        },
      },
      {
        id: "cmd-cycle-theme",
        title: "切换明暗主题",
        category: "命令",
        shortcut: "Ctrl+Shift+L",
        icon: <SunMoon size={16} />,
        onSelect: () => {
          onClose();
          onCycleTheme();
        },
      },
      {
        id: "cmd-view-split",
        title: "切换为分栏编辑预览视图",
        category: "命令",
        shortcut: "Ctrl+\\",
        icon: <Columns2 size={16} />,
        onSelect: () => {
          onClose();
          onChangeViewMode("split");
        },
      },
      {
        id: "cmd-view-edit",
        title: "切换为仅源码编辑视图",
        category: "命令",
        icon: <FileEdit size={16} />,
        onSelect: () => {
          onClose();
          onChangeViewMode("edit");
        },
      },
      {
        id: "cmd-view-preview",
        title: "切换为纯阅读预览视图",
        category: "命令",
        icon: <BookOpen size={16} />,
        onSelect: () => {
          onClose();
          onChangeViewMode("preview");
        },
      },
      {
        id: "cmd-print",
        title: "导出为 PDF / 打印",
        category: "命令",
        shortcut: "Ctrl+P",
        icon: <Printer size={16} />,
        onSelect: () => {
          onClose();
          onPrint();
        },
      },
      {
        id: "cmd-settings",
        title: zh.toolbar.settings,
        category: "命令",
        shortcut: "Ctrl+,",
        icon: <Settings size={16} />,
        onSelect: () => {
          onClose();
          onOpenSettings();
        },
      },
    ];
  }, [
    onClose,
    onNewDocument,
    onOpenFile,
    onSaveActive,
    onToggleSidebar,
    onCycleTheme,
    onChangeViewMode,
    onOpenSettings,
    onPrint,
  ]);

  // 根据当前输入过滤文件与命令
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();

    // 如果以 > 开头，仅匹配命令
    if (q.startsWith(">")) {
      const commandQuery = q.slice(1).trim();
      if (!commandQuery) return commands;
      return commands.filter((c) => c.title.toLowerCase().includes(commandQuery));
    }

    // 匹配文档列表
    const docItems: PaletteItem[] = documents
      .filter((d) => !q || d.title.toLowerCase().includes(q) || d.virtualPath.toLowerCase().includes(q))
      .map((d) => ({
        id: `doc-${d.id}`,
        title: d.title.endsWith(".md") ? d.title : `${d.title}.md`,
        subtitle: d.virtualPath && d.virtualPath !== "/" ? d.virtualPath : undefined,
        category: "文档",
        icon: <FileText size={16} />,
        onSelect: () => {
          onClose();
          onOpenDocument(d.id);
        },
      }));

    // 匹配命令列表
    const matchedCommands = q
      ? commands.filter((c) => c.title.toLowerCase().includes(q))
      : commands;

    return [...docItems, ...matchedCommands];
  }, [query, documents, commands, onClose, onOpenDocument]);

  // 键盘快捷导航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (filteredItems.length === 0 ? 0 : (prev + 1) % filteredItems.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        filteredItems.length === 0 ? 0 : (prev - 1 + filteredItems.length) % filteredItems.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].onSelect();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // 键盘移动时保持可视项在滚动视区内
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selectedEl = list.querySelector<HTMLElement>('[data-selected="true"]');
    selectedEl?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  return createPortal(
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="palette__header">
          <Search size={18} className="palette__search-icon" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            className="palette__input"
            value={query}
            placeholder="搜索文档跳转，或键入 > 运行命令..."
            aria-label="搜索文档或命令"
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <kbd className="palette__esc">ESC</kbd>
        </div>

        <div ref={listRef} className="palette__list" role="listbox">
          {filteredItems.length === 0 ? (
            <div className="palette__empty">未找到匹配的文档或命令</div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  role="option"
                  aria-selected={isSelected}
                  data-selected={isSelected || undefined}
                  className="palette__item"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={item.onSelect}
                >
                  <div className="palette__item-left">
                    <span className="palette__item-icon">{item.icon}</span>
                    <div className="palette__item-titles">
                      <span className="palette__item-title">{item.title}</span>
                      {item.subtitle && (
                        <span className="palette__item-subtitle">{item.subtitle}</span>
                      )}
                    </div>
                  </div>
                  <div className="palette__item-right">
                    {item.shortcut ? (
                      <kbd className="palette__item-shortcut">{item.shortcut}</kbd>
                    ) : (
                      <span className="palette__item-tag">{item.category}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
