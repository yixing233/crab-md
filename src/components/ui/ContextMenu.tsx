import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import "./ui.css";

export interface ContextMenuItem {
  id: string;
  label: string;
  /** 危险操作（删除等）用 danger 语义（UI §14.4）。 */
  danger?: boolean;
  /** 快捷键提示，右对齐显示。 */
  shortcut?: string;
  /**
   * 用指定字体栈渲染 label。
   *
   * 供「选字体」这类菜单使用：读到「宋体」两个字本身就是宋体，
   * 用户不必先选一次、看一眼、再换。只有这一个用途，故是可选字段，
   * 不影响普通菜单的渲染。
   */
  fontFamily?: string;
  onSelect: () => void;
}

export interface ContextMenuProps {
  open: boolean;
  /** 期望出现的屏幕坐标（右键点、或锚点元素右下角）。 */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** 无障碍标签，说明这组操作针对什么。 */
  ariaLabel?: string;
  /**
   * 触发按钮所在的元素。
   *
   * 用于「点同一个按钮开/关」的菜单：按钮在菜单**外部**，所以点它会被
   * 外部点击逻辑先关掉，紧接着按钮自己的 onClick 又把它打开 ——
   * 表现为「怎么点都关不上」。
   *
   * 有了它，落在锚点内的按下不算「点到了外面」，开关交给按钮自己。
   */
  anchorRef?: RefObject<HTMLElement | null>;
}

/**
 * 右键 / 「更多」菜单原语（UI_DESIGN_SYSTEM.md §13 必备组件）。
 *
 * 抽成共享组件而不是各页面自造：规范 §2.4 禁止「页面仅为本处使用
 * 而自造按钮/输入/对话框样式」。FileTree 原先就有一份裸 div 版本。
 *
 * 行为要求：
 * - 点击别处、Escape、选中任一项都会关闭
 * - 超出视口时自动收回（贴右/贴下边缘不裁切）
 * - 键盘上下键在菜单项之间移动
 */
export function ContextMenu({
  open,
  x,
  y,
  items,
  onClose,
  ariaLabel,
  anchorRef,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 关闭：点击外部 / Escape。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // 菜单内部的点击由各菜单项自行处理，这里只管外部。
      if (ref.current?.contains(e.target as Node)) return;
      // 锚点（触发按钮）内的按下也不算外部：开关由按钮自己控制，
      // 否则「再点一次关闭」会变成先关后开、看起来关不掉。
      if (anchorRef?.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // 用 mousedown 而非 click：与系统菜单一致，按下即关闭。
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  // 定位：先渲染再量尺寸，然后收进视口。
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const r = el.getBoundingClientRect();
      const margin = 4;
      let left = x;
      let top = y;
      // 贴右边缘时向左翻，避免溢出被裁。
      if (left + r.width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - r.width - margin);
      }
      if (top + r.height > window.innerHeight - margin) {
        top = Math.max(margin, y - r.height);
      }
      setPos({ top, left });
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, x, y, items.length]);

  // 打开时聚焦第一项，键盘用户可直接上下选择。
  useEffect(() => {
    if (!open) return;
    const first = ref.current?.querySelector<HTMLElement>("[role='menuitem']");
    first?.focus();
  }, [open, items.length]);

  if (!open) return null;

  const onItemKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const nodes = Array.from(
      ref.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [],
    );
    if (nodes.length === 0) return;
    const idx = nodes.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown"
        ? (idx + 1) % nodes.length
        : (idx - 1 + nodes.length) % nodes.length;
    nodes[next].focus();
  };

  return createPortal(
    <div
      ref={ref}
      className="ui-menu"
      role="menu"
      aria-label={ariaLabel}
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
      onKeyDown={onItemKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          className="ui-menu__item"
          data-danger={item.danger || undefined}
          // 快捷键用 aria-keyshortcuts 暴露给辅助技术；
          // 可见的快捷键文字对屏幕阅读器隐藏，否则可访问名称会变成「重命名 F2」。
          aria-keyshortcuts={item.shortcut}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          <span
            className="ui-menu__label"
            // 字体菜单用：标签以该字体自身渲染。
            style={item.fontFamily ? { fontFamily: item.fontFamily } : undefined}
          >
            {item.label}
          </span>
          {item.shortcut && (
            <span className="ui-menu__shortcut" aria-hidden>
              {item.shortcut}
            </span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** 便捷包装：把子元素包成「右键可开菜单」的容器。 */
export function ContextMenuArea({
  children,
  onContextMenu,
}: {
  children: ReactNode;
  onContextMenu: (x: number, y: number) => void;
}) {
  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
    >
      {children}
    </div>
  );
}
