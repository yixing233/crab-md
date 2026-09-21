import { useCallback, useMemo, useState } from "react";
import { FileText, Folder, MoreHorizontal, Plus } from "lucide-react";
import { buildFileTree, type TreeNode } from "../../lib/fileTree";
import type { DocumentSummary } from "../../types/document";
import { zh } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Tooltip } from "../ui/Tooltip";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { InlineEdit } from "../ui/InlineEdit";
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
  // 菜单锚点与坐标；用共享 ContextMenu 渲染。
  const [menu, setMenu] = useState<{ id: string; title: string; x: number; y: number } | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  // 菜单里的「删除」只上报请求，确认由上层负责（破坏性操作须确认，§14.4）。
  const menuItems = useCallback(
    (id: string, title: string): ContextMenuItem[] => [
      {
        id: "rename",
        label: zh.fileTree.rename,
        shortcut: "F2",
        onSelect: () => {
          setRenamingId(id);
          closeMenu();
        },
      },
      {
        id: "delete",
        label: zh.fileTree.delete,
        danger: true,
        onSelect: () => onRequestDelete(id, title),
      },
    ],
    [closeMenu, onRequestDelete],
  );

  const startRename = useCallback((id: string) => {
    setRenamingId(id);
    setMenu(null);
  }, []);

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
            onCommitRename={(id, next) => {
              setRenamingId(null);
              onRename(id, next);
            }}
            onCancelRename={() => setRenamingId(null)}
            onOpenMenu={(id, title, x, y) => setMenu({ id, title, x, y })}
          />
        ))}
      </div>

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menu ? menuItems(menu.id, menu.title) : []}
        onClose={closeMenu}
        ariaLabel={menu?.title}
      />
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
  onCommitRename: (id: string, next: string) => void;
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

  if (id === renamingId) {
    return (
      <div className="file-tree__row" style={{ paddingLeft: depth * 14 + 10 }}>
        <InlineEdit
          initialValue={node.name}
          ariaLabel={zh.fileTree.renameLabel}
          onCommit={(next) => onCommitRename(id, next)}
          onCancel={onCancelRename}
        />
      </div>
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
            const r = e.currentTarget.getBoundingClientRect();
            onOpenMenu(id, node.name, r.right, r.top);
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
