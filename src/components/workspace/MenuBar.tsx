import { useRef, useState } from "react";
import { Button } from "../ui/Button";
import { ContextMenu, type ContextMenuEntry } from "../ui/ContextMenu";
import { zh } from "../../lib/i18n";
import "./workspace.css";

/** 一个顶级菜单：标题 + 展开后的条目（复用 ContextMenu 的条目类型）。 */
export interface MenuBarMenu {
  id: string;
  label: string;
  items: ContextMenuEntry[];
}

export interface MenuBarProps {
  menus: MenuBarMenu[];
}

/**
 * 顶部菜单栏（文件 / 编辑 / 视图 / 帮助）。
 *
 * 下拉本体复用 `ContextMenu` 原语，而不是另写一套：键盘导航、视口边界
 * 修正、点击外部收起都已在那边实现并测过（UI §13）。
 *
 * 两个容易踩的点：
 * 1. `ContextMenu` 只接受屏幕坐标，所以要拿按钮的 `getBoundingClientRect()`；
 * 2. `anchorRef` 指向**整排按钮的容器**，而不是当前展开的那一个。菜单开着时
 *    去点另一个菜单，那次点击落在「锚点之外」——若只锚定当前按钮，同一次
 *    点击会先被 React 打开、再被外部点击处理器关掉，菜单一闪就没。
 */
export function MenuBar({ menus }: MenuBarProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [openMenu, setOpenMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const openDefinition = openMenu ? menus.find((menu) => menu.id === openMenu.id) : undefined;

  return (
    <>
      <div className="app-menubar" role="menubar" aria-label={zh.menu.ariaLabel} ref={anchorRef}>
        {menus.map((menu) => {
          const expanded = openMenu?.id === menu.id;
          return (
            <Button
              key={menu.id}
              variant="ghost"
              size="sm"
              className="app-menubar__trigger"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={expanded}
              onClick={(event) => {
                // 再点一次同一个菜单就是收起（与桌面应用一致）。
                if (expanded) {
                  setOpenMenu(null);
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                setOpenMenu({ id: menu.id, x: rect.left, y: rect.bottom + 2 });
              }}
            >
              {menu.label}
            </Button>
          );
        })}
      </div>

      <ContextMenu
        open={openDefinition !== undefined}
        x={openMenu?.x ?? 0}
        y={openMenu?.y ?? 0}
        items={openDefinition?.items ?? []}
        ariaLabel={openDefinition?.label}
        anchorRef={anchorRef}
        onClose={() => setOpenMenu(null)}
      />
    </>
  );
}
