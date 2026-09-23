import { useLayoutEffect, useRef, useState } from "react";
import {
  Bold,
  Code,
  Ellipsis,
  Heading,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
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
import "./editor.css";

const ICONS: Record<MarkdownActionId, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  heading: Heading,
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
}

/**
 * 动作分组（仅影响视觉排布，不改变 `EDITOR_ACTIONS` 的语义顺序）。
 * 组间画竖线，避免一排图标看起来像毛坯房式的裸按钮堆。
 */
const GROUPS: ReadonlyArray<ReadonlyArray<MarkdownActionId>> = [
  ["bold", "italic", "strikethrough", "inlineCode"],
  ["heading", "bulletList", "orderedList", "quote"],
  ["link", "image", "codeBlock"],
  // 表格与公式是「插入结构」类动作，与上面的代码块同族，但单独成组
  // 以免那一组过长，同时让「插入数据/数学」在视觉上可被一眼找到。
  ["table", "math", "mathBlock"],
];

/**
 * 单个格式动作按钮（工具栏与「更多」菜单共用渲染逻辑）。
 */
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
  // 提示里带上快捷键；用自绘 Tooltip 而非 title 属性，
  // 以便控制延迟并让外观跟随主题（UI §13 必备组件）。
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

/**
 * 编辑器格式工具栏（UI_DESIGN_SYSTEM.md §21.1）。
 *
 * 桌面端常驻一条紧凑工具栏。按钮只发语义化动作 id，具体如何改文本
 * 由 `lib/markdownActions.ts` 的纯函数决定 —— 工具栏不碰文本。
 * 文案取自 `lib/i18n.ts`（§2.5：界面文案一律简体中文）。
 *
 * **不换行**：宽度不足时，末尾放不下的动作收进行尾的「更多」菜单。
 * 换行会让工具栏高度随宽度变化，正文跟着上下跳动；
 * 决策由 `lib/toolbarLayout.ts` 的纯函数给出，这里只负责测量与渲染。
 */
export function EditorToolbar({ onAction }: EditorToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreRef = useRef<HTMLSpanElement | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  // 量工具栏可用于摆放按钮的宽度。
  //
  // 用 ResizeObserver 监听自身尺寸：窗口缩放、侧栏拖拽、预览折叠
  // 都会改变它，而这些都不触发 window.resize（拖分隔条时窗口尺寸不变）。
  // 首次同步测量放在 useLayoutEffect，避免首帧闪一下全部按钮。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const style = getComputedStyle(el);
      const padLeft = parseFloat(style.paddingLeft) || 0;
      const padRight = parseFloat(style.paddingRight) || 0;
      setAvailable(el.clientWidth - padLeft - padRight);
    };

    measure();

    // jsdom（单测）与旧 WebView 没有 ResizeObserver —— 此时退回 window.resize，
    // 并在量不到宽度时由纯函数决定「全部显示」，不会误收起。
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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

  const renderSlot = (slot: ToolbarSlot<MarkdownActionId>, key: string) =>
    slot.kind === "separator" ? (
      <span key={key} className="editor-toolbar__separator" aria-hidden />
    ) : (
      <ActionButton key={key} id={slot.id} onAction={onAction} />
    );

  return (
    <div
      ref={ref}
      className="editor-toolbar"
      role="toolbar"
      aria-label={zh.editor.toolbarAriaLabel}
    >
      {visible.map((slot, i) => renderSlot(slot, `${slot.kind}-${i}`))}

      {overflow.length > 0 && (
        <span className="editor-toolbar__more" ref={moreRef}>
          <Tooltip content={zh.editor.moreActions}>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              className="editor-toolbar__button"
              aria-label={zh.editor.moreActions}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => (menuOpen ? setMenuOpen(false) : openMore())}
            >
              <Ellipsis size={15} strokeWidth={2} aria-hidden />
            </Button>
          </Tooltip>
          <ContextMenu
            open={menuOpen}
            x={menuPos.x}
            y={menuPos.y}
            items={menuItems}
            onClose={() => setMenuOpen(false)}
            ariaLabel={zh.editor.moreActions}
            anchorRef={moreRef}
          />
        </span>
      )}
    </div>
  );
}
