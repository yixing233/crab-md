import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Folder, MoreHorizontal, Plus } from "lucide-react";
import { buildFileTree, type TreeNode } from "../../lib/fileTree";
import type { DocumentSummary } from "../../types/document";
import { zh } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Tooltip } from "../ui/Tooltip";
import "./workspace.css";

export interface FileTreeProps {
  documents: DocumentSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  /** 重命名（UI_DESIGN_SYSTEM.md §18.2）。 */
  onRename: (id: string, title: string) => void;
  /** 请求删除；确认对话框由上层负责。 */
  onRequestDelete: (id: string, title: string) => void;
}

export function FileTree({
  documents,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onRequestDelete,
}: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(documents), [documents]);

  // 行内重命名状态：一次只能重命名一项（§18.2）。
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // 打开上下文菜单的文档 id + 屏幕坐标。
  const [menu, setMenu] = useState<{ id: string; title: string; x: number; y: number } | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  // 点击别处 / Escape 关闭菜单。
  useEffect(() => {
    if (!menu) return;
    const onDown = () => closeMenu();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, closeMenu]);

  const startRename = useCallback((id: string) => {
    setRenamingId(id);
    setMenu(null);
  }, []);

  const commitRename = useCallback(
    (id: string, next: string, original: string) => {
      setRenamingId(null);
      const trimmed = next.trim();
      // 空名或未改动就不调用后端，避免无意义的写与报错。
      if (!trimmed || trimmed === original) return;
      onRename(id, trimmed);
    },
    [onRename],
  );

  if (documents.length === 0) {
    return (
      <EmptyState
        title={zh.fileTree.emptyTitle}
        description={zh.fileTree.emptyDescription}
        action={
          <Button variant="primary" size="sm" onClick={onCreate}>
            <Plus size={14} aria-hidden />
            <span>{zh.fileTree.newNote}</span>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <div className="file-tree" role="tree" aria-label={zh.fileTree.ariaLabel}>
        {tree.map((node) => (
          <TreeItem
            key={node.key}
            node={node}
            activeId={activeId}
            onSelect={onSelect}
            depth={0}
            renamingId={renamingId}
            onStartRename={startRename}
            onCommitRename={commitRename}
            onCancelRename={() => setRenamingId(null)}
            onOpenMenu={(id, title, x, y) => setMenu({ id, title, x, y })}
          />
        ))}
      </div>

      {menu && (
        <div
          className="context-menu"
          role="menu"
          style={{ position: "fixed", left: menu.x, top: menu.y }}
          // 菜单自身被点击时不要触发外层的关闭逻辑。
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className="context-menu__item"
            onClick={() => startRename(menu.id)}
          >
            {zh.fileTree.rename}
          </button>
          <button
            type="button"
            role="menuitem"
            className="context-menu__item context-menu__item--danger"
            onClick={() => {
              onRequestDelete(menu.id, menu.title);
              closeMenu();
            }}
          >
            {zh.fileTree.delete}
          </button>
        </div>
      )}
    </>
  );
}

interface TreeItemProps {
  node: TreeNode;
  activeId: string | null;
  onSelect: (id: string) => void;
  depth: number;
  renamingId: string | null;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, next: string, original: string) => void;
  onCancelRename: () => void;
  onOpenMenu: (id: string, title: string, x: number, y: number) => void;
}

function TreeItem({
  node,
  activeId,
  onSelect,
  depth,
  renamingId,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onOpenMenu,
}: TreeItemProps) {
  if (node.type === "folder") {
    return (
      <div className="file-tree__group">
        <div className="file-tree__folder" style={{ paddingLeft: depth * 14 + 10 }}>
          <Folder size={14} aria-hidden />
          <span>{node.name}</span>
        </div>
        {node.children?.map((child) => (
          <TreeItem
            key={child.key}
            node={child}
            activeId={activeId}
            onSelect={onSelect}
            depth={depth + 1}
            renamingId={renamingId}
            onStartRename={onStartRename}
            onCommitRename={onCommitRename}
            onCancelRename={onCancelRename}
            onOpenMenu={onOpenMenu}
          />
        ))}
      </div>
    );
  }

  const id = node.documentId!;
  const selected = id === activeId;
  const renaming = id === renamingId;

  if (renaming) {
    return (
      <RenameField
        initial={node.name}
        depth={depth}
        onCommit={(next) => onCommitRename(id, next, node.name)}
        onCancel={onCancelRename}
      />
    );
  }

  return (
    <div className="file-tree__row">
      <button
        type="button"
        role="treeitem"
        aria-selected={selected}
        className="file-tree__item"
        data-selected={selected || undefined}
        style={{ paddingLeft: depth * 14 + 10 }}
        onClick={() => onSelect(id)}
        onContextMenu={(e) => {
          // 右键打开菜单；触屏用户用右侧的「更多」按钮。
          e.preventDefault();
          onOpenMenu(id, node.name, e.clientX, e.clientY);
        }}
        onKeyDown={(e) => {
          if (e.key === "F2") {
            e.preventDefault();
            onStartRename(id);
          } else if (e.key === "Delete") {
            e.preventDefault();
            onOpenMenu(id, node.name, e.currentTarget.getBoundingClientRect().right, e.currentTarget.getBoundingClientRect().top);
          }
        }}
      >
        <FileText size={14} aria-hidden />
        <span className="file-tree__label">{node.name}</span>
      </button>

      <Tooltip content={zh.fileTree.moreActions}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          className="file-tree__more"
          aria-label={`${node.name} ${zh.fileTree.moreActions}`}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onOpenMenu(id, node.name, r.left, r.bottom + 2);
          }}
        >
          <MoreHorizontal size={14} aria-hidden />
        </Button>
      </Tooltip>
    </div>
  );
}

interface RenameFieldProps {
  initial: string;
  depth: number;
  onCommit: (next: string) => void;
  onCancel: () => void;
}

/** 行内重命名输入（UI_DESIGN_SYSTEM.md §18.2）。 */
function RenameField({ initial, depth, onCommit, onCancel }: RenameFieldProps) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initial);
  // 用 ref 记住是否已结束，避免 onBlur 在 Escape 之后又提交一次。
  const settled = useRef(false);

  // 自动聚焦并全选，用户可直接输入新名字（§18.2 第一条）。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (settled.current) return;
    settled.current = true;
    onCommit(value);
  };
  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  return (
    <div className="file-tree__row" style={{ paddingLeft: depth * 14 + 10 }}>
      <input
        ref={ref}
        className="file-tree__rename"
        aria-label={zh.fileTree.renameLabel}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        // 失焦即提交，符合文件管理器的普遍预期。
        onBlur={commit}
      />
    </div>
  );
}
