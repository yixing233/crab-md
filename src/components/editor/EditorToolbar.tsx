import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUpDown,
  Bold,
  ChevronDown,
  Code,
  Ellipsis,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Search,
  Sigma,
  SquareCode,
  SquareFunction,
  Strikethrough,
  Table,
  type LucideIcon,
} from "lucide-react";
import { EDITOR_ACTIONS, type MarkdownActionId } from "../../lib/markdownActions";
import { computeToolbarLayout, type ToolbarSlot } from "../../lib/toolbarLayout";
import { zh } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { ViewModeSwitch } from "../ui/ViewModeSwitch";
import type { ViewMode } from "../../lib/viewMode";
import "./editor.css";

const ICONS: Record<MarkdownActionId, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  heading: Heading,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  h4: Heading4,
  h5: Heading5,
  h6: Heading6,
  bulletList: List,
  orderedList: ListOrdered,
  quote: Quote,
  link: LinkIcon,
  image: ImageIcon,
  inlineCode: Code,
  codeBlock: SquareCode,
  table: Table,
  math: Sigma,
  mathBlock: SquareFunction,
};

export interface EditorToolbarProps {
  /** 点击某个格式化动作；由编辑器把这动作作用到当前选区。 */
  onAction: (action: MarkdownActionId) => void;
  /** 视图模式：仅编辑 / 分栏 / 仅阅读。 */
  viewMode?: ViewMode;
  /** 切换视图模式。 */
  onChangeViewMode?: (mode: ViewMode) => void;
  /** 是否开启编辑/预览同步滚动。 */
  syncScroll?: boolean;
  /** 切换同步滚动。 */
  onToggleSyncScroll?: () => void;
  /** 是否展示格式化动作（在纯阅读模式下可隐藏）。 */
  showFormatting?: boolean;
  /** 文档内查找回调。 */
  onSearch?: () => void;
}

const GROUPS: ReadonlyArray<ReadonlyArray<MarkdownActionId>> = [
  ["bold", "italic", "strikethrough", "inlineCode"],
  ["heading", "bulletList", "orderedList", "quote"],
  ["link", "image", "codeBlock"],
  ["table", "math", "mathBlock"],
];

function ActionButton({
  id,
  onAction,
  className,
}: {
  id: MarkdownActionId;
  onAction: (id: MarkdownActionId) => void;
  className?: string;
}) {
  const action = EDITOR_ACTIONS.find((a) => a.id === id);
  const Icon = ICONS[id];
  const label = zh.editor.actions[id];
  const tip = action?.shortcut ? `${label}　${action.shortcut}` : label;

  return (
    <Tooltip content={tip}>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        className={className ?? "editor-toolbar__button"}
        aria-label={label}
        onClick={() => onAction(id)}
      >
        <Icon size={15} strokeWidth={2} aria-hidden />
      </Button>
    </Tooltip>
  );
}

function HeadingGroup({ onAction }: { onAction: (id: MarkdownActionId) => void }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) {
      setPos({ x: r.left, y: r.bottom + 4 });
      setOpen(true);
    }
  };

  const items: ContextMenuItem[] = [
    {
      id: "h1",
      label: "H1",
      shortcut: "Ctrl+Alt+1",
      onSelect: () => onAction("h1"),
    },
    {
      id: "h2",
      label: "H2",
      shortcut: "Ctrl+Alt+2",
      onSelect: () => onAction("h2"),
    },
    {
      id: "h3",
      label: "H3",
      shortcut: "Ctrl+Alt+3",
      onSelect: () => onAction("h3"),
    },
    {
      id: "h4",
      label: "H4",
      shortcut: "Ctrl+Alt+4",
      onSelect: () => onAction("h4"),
    },
    {
      id: "h5",
      label: "H5",
      shortcut: "Ctrl+Alt+5",
      onSelect: () => onAction("h5"),
    },
    {
      id: "h6",
      label: "H6",
      shortcut: "Ctrl+Alt+6",
      onSelect: () => onAction("h6"),
    },
  ];

  return (
    <div
      ref={anchorRef}
      className="editor-toolbar__heading-group"
      onContextMenu={(e) => {
        e.preventDefault();
        handleOpen(e);
      }}
    >
      <ActionButton id="heading" onAction={onAction} />
      <Tooltip content="选择标题级别 (H1 ~ H6)">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          className="editor-toolbar__heading-arrow"
          aria-label="选择标题级别"
          aria-haspopup="menu"
          onClick={handleOpen}
        >
          <ChevronDown size={11} strokeWidth={2} aria-hidden />
        </Button>
      </Tooltip>
      <ContextMenu
        open={open}
        x={pos.x}
        y={pos.y}
        items={items}
        onClose={() => setOpen(false)}
        ariaLabel="标题级别选择"
      />
    </div>
  );
}

export function EditorToolbar({
  onAction,
  viewMode,
  onChangeViewMode,
  syncScroll = true,
  onToggleSyncScroll,
  showFormatting = true,
  onSearch,
}: EditorToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLSpanElement | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const style = getComputedStyle(el);
      const padLeft = parseFloat(style.paddingLeft) || 0;
      const padRight = parseFloat(style.paddingRight) || 0;
      // 预留右侧视图控制区域的大约空间
      const rightReserved = viewMode ? (onSearch ? 190 : 160) : (onSearch ? 40 : 0);
      setAvailable(Math.max(0, el.clientWidth - padLeft - padRight - rightReserved));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode]);

  const { visible, overflow } = computeToolbarLayout(GROUPS, available);

  const menuItems: ContextMenuItem[] = overflow.map((id) => {
    const action = EDITOR_ACTIONS.find((a) => a.id === id);
    const label = zh.editor.actions[id];
    return {
      id,
      label,
      shortcut: action?.shortcut,
      onSelect: () => onAction(id),
    };
  });

  function openMore() {
    const r = moreRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ x: r.left, y: r.bottom + 4 });
    setMenuOpen(true);
  }

  const renderSlot = (slot: ToolbarSlot<MarkdownActionId>, key: string) => {
    if (slot.kind === "separator") {
      return <span key={key} className="editor-toolbar__separator" aria-hidden />;
    }
    if (slot.id === "heading") {
      return <HeadingGroup key={key} onAction={onAction} />;
    }
    return <ActionButton key={key} id={slot.id} onAction={onAction} />;
  };

  return (
    <div
      ref={ref}
      className="editor-toolbar"
      role="toolbar"
      aria-label={zh.editor.toolbarAriaLabel}
    >
      {/* 左侧：格式化操作 */}
      {showFormatting && visible.map((slot, i) => renderSlot(slot, `${slot.kind}-${i}`))}

      {showFormatting && overflow.length > 0 && (
        <span ref={moreRef} className="editor-toolbar__more">
          <Tooltip content="更多操作">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              className="editor-toolbar__button"
              aria-label="更多格式"
              aria-haspopup="menu"
              onClick={openMore}
            >
              <Ellipsis size={15} strokeWidth={2} aria-hidden />
            </Button>
          </Tooltip>
        </span>
      )}

      {/* 弹性占位：将视图控制推到右侧 */}
      <span className="editor-toolbar__spacer" />

      {/* 右侧：文档内查找、视图模式切换与同步滚动开关 */}
      {(viewMode || onSearch) && (
        <div className="editor-toolbar__right">
          {onSearch && (
            <Tooltip content={`${zh.toolbar.search}　Ctrl+F`}>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                onClick={onSearch}
                aria-label={zh.toolbar.search}
              >
                <Search size={15} strokeWidth={2} aria-hidden />
              </Button>
            </Tooltip>
          )}

          {viewMode && onChangeViewMode && (
            <ViewModeSwitch value={viewMode} onChange={onChangeViewMode} />
          )}

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
                <ArrowUpDown size={15} strokeWidth={2} aria-hidden />
              </Button>
            </Tooltip>
          )}
        </div>
      )}

      <ContextMenu
        open={menuOpen}
        x={menuPos.x}
        y={menuPos.y}
        items={menuItems}
        ariaLabel="更多格式操作"
        onClose={() => setMenuOpen(false)}
      />
    </div>
  );
}
