import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Check, ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";
import "./ui.css";

export interface ContextMenuItem {
  id: string;
  label: string;
  /** 危险操作（删除等）用 danger 语义（UI §14.4）。 */
  danger?: boolean;
  /** 快捷键提示，右对齐显示。 */
  shortcut?: string;
  /** 用指定字体栈渲染 label，供字体选择菜单预览字体。 */
  fontFamily?: string;
  /** 设置时使用 menuitemradio 语义并显示选中标记。 */
  checked?: boolean;
  /** 当前上下文不可执行时禁用（例如没有选中文本时的复制）。 */
  disabled?: boolean;
  onSelect: () => void;
}

export interface ContextMenuSeparator {
  id: string;
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator | ContextMenuSubmenu;

/** 共享菜单支持多层嵌套子菜单，避免右键菜单过长。 */
export interface ContextMenuSubmenu {
  id: string;
  label: string;
  submenu: Array<ContextMenuEntry>;
}

export interface ContextMenuProps {
  open: boolean;
  /** 期望出现的屏幕坐标（右键点、或锚点元素右下角）。 */
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
  /** 无障碍标签，说明这组操作针对什么。 */
  ariaLabel?: string;
  /** 触发按钮所在元素；按下锚点时交由触发按钮自行开关。 */
  anchorRef?: RefObject<HTMLElement | null>;
}

function directMenuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(
    menu?.querySelectorAll<HTMLElement>(
      "button[role='menuitem']:not(:disabled), button[role='menuitemradio']:not(:disabled)",
    ) ?? [],
  ).filter((item) => item.parentElement === menu);
}

interface MenuPanelProps {
  items: ContextMenuEntry[];
  ariaLabel?: string;
  pos: { top: number; left: number } | null;
  onClose: () => void;
  depth?: number;
  onRequestCloseThis?: (returnFocus?: boolean) => void;
}

function MenuPanel({
  items,
  ariaLabel,
  pos,
  onClose,
  depth = 0,
  onRequestCloseThis,
}: MenuPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const [submenuPos, setSubmenuPos] = useState<{ top: number; left: number } | null>(null);
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [focusSubmenuRequest, setFocusSubmenuRequest] = useState(0);

  const activeSubmenu = activeSubmenuId
    ? items.find(
        (item): item is ContextMenuSubmenu =>
          "submenu" in item && item.id === activeSubmenuId,
      )
    : undefined;

  const closeChildSubmenu = (returnFocus = false) => {
    setActiveSubmenuId(null);
    setSubmenuPos(null);
    if (returnFocus) activeTriggerRef.current?.focus();
  };

  const showChildSubmenu = (
    submenu: ContextMenuSubmenu,
    trigger: HTMLButtonElement,
    focusFirst: boolean,
  ) => {
    activeTriggerRef.current = trigger;
    if (activeSubmenuId !== submenu.id) {
      setActiveSubmenuId(submenu.id);
      setSubmenuPos(null);
    }
    if (focusFirst) setFocusSubmenuRequest((r) => r + 1);
  };

  // 定位子菜单：优先向右展开，若空间不足向左翻转
  useLayoutEffect(() => {
    if (!activeSubmenu) {
      setSubmenuPos(null);
      return;
    }
    const trigger = activeTriggerRef.current;
    if (!trigger) return;

    const measure = () => {
      const childEl = document.querySelector<HTMLElement>(
        `[data-menu-depth="${depth + 1}"]`,
      );
      if (!childEl) return;

      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = childEl.getBoundingClientRect();
      const margin = 4;
      const left =
        triggerRect.right + menuRect.width <= window.innerWidth - margin
          ? triggerRect.right
          : Math.max(margin, triggerRect.left - menuRect.width);
      const top = Math.min(
        Math.max(margin, triggerRect.top),
        Math.max(margin, window.innerHeight - menuRect.height - margin),
      );
      setSubmenuPos({ top, left });
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeSubmenuId, activeSubmenu?.submenu.length, depth]);

  // 初次打开或获得焦点
  useEffect(() => {
    if (depth === 0) {
      directMenuItems(panelRef.current)[0]?.focus();
    }
  }, [depth]);

  useEffect(() => {
    if (focusSubmenuRequest === 0) return;
    const childEl = document.querySelector<HTMLDivElement>(
      `[data-menu-depth="${depth + 1}"]`,
    );
    directMenuItems(childEl)[0]?.focus();
  }, [focusSubmenuRequest, depth]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const nodes = directMenuItems(panelRef.current);
      if (nodes.length === 0) return;
      const idx = nodes.indexOf(document.activeElement as HTMLElement);
      const next =
        e.key === "ArrowDown"
          ? (idx + 1) % nodes.length
          : (idx - 1 + nodes.length) % nodes.length;
      nodes[next]?.focus();
      return;
    }

    if (e.key === "ArrowRight") {
      const target = e.target as HTMLElement;
      if (target.dataset.submenuId) {
        const sub = items.find(
          (item): item is ContextMenuSubmenu =>
            "submenu" in item && item.id === target.dataset.submenuId,
        );
        if (sub) {
          e.preventDefault();
          showChildSubmenu(sub, target as HTMLButtonElement, true);
        }
      }
      return;
    }

    if (e.key === "ArrowLeft") {
      if (depth > 0) {
        e.preventDefault();
        onRequestCloseThis?.(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (activeSubmenuId) {
        closeChildSubmenu(true);
      } else if (depth > 0) {
        onRequestCloseThis?.(true);
      } else {
        onClose();
      }
    }
  };

  const renderItem = (item: ContextMenuItem) => (
    <button
      key={item.id}
      type="button"
      role={item.checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={item.checked}
      aria-disabled={item.disabled || undefined}
      className="ui-menu__item"
      data-danger={item.danger || undefined}
      disabled={item.disabled}
      aria-keyshortcuts={item.shortcut}
      onPointerEnter={() => {
        closeChildSubmenu();
      }}
      onClick={() => {
        if (item.disabled) return;
        item.onSelect();
        onClose();
      }}
    >
      <span
        className="ui-menu__label"
        style={item.fontFamily ? { fontFamily: item.fontFamily } : undefined}
      >
        {item.label}
      </span>
      {item.checked && <Check size={14} aria-hidden className="ui-menu__check" />}
      {item.shortcut && (
        <span className="ui-menu__shortcut" aria-hidden>
          {item.shortcut}
        </span>
      )}
    </button>
  );

  return (
    <>
      <div
        ref={panelRef}
        className={`ui-menu ${depth > 0 ? "ui-menu--submenu" : ""}`}
        role="menu"
        aria-label={ariaLabel}
        data-menu-depth={depth}
        style={{
          ...(pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }),
          zIndex: 1200 + depth,
        }}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => {
          if ("separator" in item) {
            return <div key={item.id} role="separator" className="ui-menu__separator" />;
          }
          if ("submenu" in item) {
            const expanded = activeSubmenuId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={expanded}
                className="ui-menu__item ui-menu__item--submenu"
                data-submenu-id={item.id}
                ref={(element) => {
                  if (expanded && element) activeTriggerRef.current = element;
                }}
                onPointerEnter={(e) => {
                  if (activeSubmenuId !== item.id) {
                    showChildSubmenu(item, e.currentTarget, false);
                  }
                }}
                onClick={(e) => showChildSubmenu(item, e.currentTarget, true)}
              >
                <span className="ui-menu__label">{item.label}</span>
                <ChevronRight
                  size={14}
                  aria-hidden
                  className="ui-menu__submenu-indicator"
                />
              </button>
            );
          }
          return renderItem(item);
        })}
      </div>

      {activeSubmenu && (
        <MenuPanel
          items={activeSubmenu.submenu}
          ariaLabel={activeSubmenu.label}
          pos={submenuPos}
          onClose={onClose}
          depth={depth + 1}
          onRequestCloseThis={closeChildSubmenu}
        />
      )}
    </>
  );
}

/**
 * 右键 / 「更多」菜单原语（UI_DESIGN_SYSTEM.md §13 必备组件）。
 * 支持多层嵌套子菜单、视口边界定位、点击外部收起与键盘导航。
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
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 关闭：点击外部 / Escape
  useEffect(() => {
    if (!open) return;
    let clickListenerAttached = false;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest?.(".ui-menu") || anchorRef?.current?.contains(target)) return;
      onClose();
    };

    const timer = setTimeout(() => {
      window.addEventListener("click", onClickOutside);
      clickListenerAttached = true;
    }, 0);

    return () => {
      clearTimeout(timer);
      if (clickListenerAttached) {
        window.removeEventListener("click", onClickOutside);
      }
    };
  }, [open, onClose, anchorRef]);

  // 定位主菜单
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }

    const measure = () => {
      const rootEl = document.querySelector<HTMLElement>('[data-menu-depth="0"]');
      if (!rootEl) return;
      const r = rootEl.getBoundingClientRect();
      const margin = 4;
      let left = x;
      let top = y;
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

  if (!open) return null;

  return createPortal(
    <MenuPanel
      items={items}
      ariaLabel={ariaLabel}
      pos={pos}
      onClose={onClose}
      depth={0}
    />,
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
