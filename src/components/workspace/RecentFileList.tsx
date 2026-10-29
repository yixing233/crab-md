import { useCallback, useState } from "react";
import { MoreHorizontal, Pin, TriangleAlert } from "lucide-react";
import type { RecentFileView } from "../../types/document";
import { isDiskPath, samePath } from "../../lib/externalFiles";
import { buildFileActions } from "../../lib/fileActions";
import { zh } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Tooltip } from "../ui/Tooltip";
import { ContextMenu, type ContextMenuEntry } from "../ui/ContextMenu";
import { FileIcon } from "../ui/FileIcon";
import { Dialog } from "../ui/Dialog";
import "./workspace.css";

export interface RecentFileListProps {
  files: RecentFileView[];
  activePath: string | null;
  onOpen: (path: string) => void;
  onNew?: () => void;
  onOpenFilePicker?: () => void;
  onDuplicate?: (path: string, title: string) => void;
  onRename?: (path: string, title: string) => void;
  onReveal: (path: string, name: string) => void;
  onRemoveFromHistory: (path: string) => void;
  onDeleteFromDisk: (path: string) => void;
  /**
   * 删除工作区笔记本身（path 是文档 id，不是磁盘路径）。
   *
   * 与 onRemoveFromHistory 是两件事：后者只操作磁盘文件的历史登记表，
   * 传文档 id 进去永远匹配 0 行。
   */
  onDeleteDocument?: (id: string, title: string) => void;
  /** 打开「文件详情」面板（只读）。 */
  onShowDetails?: (path: string) => void;
  onTogglePin: (path: string, pinned: boolean) => void;
}

/**
 * 统一文件列表面板：对标原生文件管理器与纯文本编辑器（如 Typora / VS Code）。
 *
 * 核心设计：
 * - 纯净单行条目（图标 + 文件名 + 右侧悬浮操作），无多余卡片边框与标签堆叠；
 * - 绝对不把冗长物理路径挤进条目内（悬停 title 提示完整路径）；
 * - 统一处理新建、副本、重命名、在文件管理器中显示、置顶与彻底删除。
 */
export function RecentFileList({
  files,
  activePath,
  onOpen,
  onNew,
  onOpenFilePicker,
  onDuplicate,
  onRename,
  onReveal,
  onRemoveFromHistory,
  onDeleteFromDisk,
  onDeleteDocument,
  onShowDetails,
  onTogglePin,
}: RecentFileListProps) {
  const [menu, setMenu] = useState<{ file: RecentFileView; x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ file: RecentFileView; mode: "history" | "disk" } | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const menuItems = useCallback(
    (file: RecentFileView): ContextMenuEntry[] =>
      buildFileActions(file, {
        onTogglePin,
        onDuplicate: (path, title) => onDuplicate?.(path, title),
        onRename: (path, title) => onRename?.(path, title),
        onReveal,
        // 破坏性动作先弹确认框，确认后才真的调后端。
        onRemoveFromHistory: () => setPendingDelete({ file, mode: "history" }),
        onDeleteFromDisk: () => setPendingDelete({ file, mode: "disk" }),
        onDeleteDocument: (id, title) => onDeleteDocument?.(id, title),
        onShowDetails,
      }),
    [onTogglePin, onReveal, onDuplicate, onRename, onDeleteDocument, onShowDetails],
  );

  if (files.length === 0) {
    return (
      <EmptyState
        title="还没有打开过文档"
        description="软件中打开或创建的所有 Markdown 文件都会记录在这里。"
        action={
          <div className="recent-file-empty-actions">
            {onNew && (
              <Button variant="primary" size="sm" onClick={onNew}>
                <span>新建笔记</span>
              </Button>
            )}
            {onOpenFilePicker && (
              <Button variant="secondary" size="sm" onClick={onOpenFilePicker}>
                <span>打开文件</span>
              </Button>
            )}
          </div>
        }
      />
    );
  }

  return (
    <div className="recent-file-list" role="region" aria-label="文件列表">
      <div className="recent-file-tree" role="tree" aria-label={zh.fileTree.ariaLabel}>
        {files.map((file) => {
          const isActive = activePath
            ? samePath(file.path, activePath) || file.path === activePath || file.pathKey === activePath
            : false;

          return (
            <div key={file.pathKey} className="recent-file-row" role="treeitem">
              <button
                type="button"
                className="recent-file-item"
                data-selected={isActive || undefined}
                data-missing={!file.exists || undefined}
                aria-label={!file.exists ? `${file.name}，文件不存在` : file.name}
                onClick={() => onOpen(file.path)}
                title={file.path}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ file, x: e.clientX, y: e.clientY });
                }}
              >
                <FileIcon filename={file.name} size={14} aria-hidden />
                <span className="recent-file-name">{file.name}</span>

                {file.pinned && (
                  <Pin size={11} className="recent-file-pin" aria-label="已置顶" />
                )}

                {isDiskPath(file.path) && !file.exists && (
                  <Tooltip content="文件已从磁盘移动或删除">
                    <TriangleAlert size={13} className="recent-file-missing" aria-label="文件不存在" />
                  </Tooltip>
                )}
              </button>

              <Tooltip content={zh.fileTree.moreActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className="recent-file-more"
                  aria-label={`${file.name} ${zh.fileTree.moreActions}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenu({ file, x: r.left, y: r.bottom + 2 });
                  }}
                >
                  <MoreHorizontal size={14} aria-hidden />
                </Button>
              </Tooltip>
            </div>
          );
        })}
      </div>

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menu ? menuItems(menu.file) : []}
        onClose={closeMenu}
      />

      <Dialog
        open={pendingDelete !== null}
        title={pendingDelete?.mode === "disk" ? "彻底删除文件" : "从列表中移除"}
        confirmLabel={pendingDelete?.mode === "disk" ? "从磁盘彻底删除" : "从列表中移除"}
        cancelLabel="取消"
        destructive={pendingDelete?.mode === "disk"}
        onConfirm={() => {
          if (!pendingDelete) return;
          if (pendingDelete.mode === "disk") {
            onDeleteFromDisk(pendingDelete.file.path);
          } else {
            onRemoveFromHistory(pendingDelete.file.path);
          }
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      >
        <p>
          {pendingDelete?.mode === "disk"
            ? pendingDelete.file.exists
              ? `确定要从磁盘彻底删除文件「${pendingDelete.file.name}」吗？此操作无法撤销。`
              : `「${pendingDelete.file.name}」已不在磁盘上，这一步只会清掉它的历史记录。`
            : `确定要将「${pendingDelete?.file.name}」从历史记录中移除吗？磁盘上的物理文件不会被删除。`}
        </p>
      </Dialog>
    </div>
  );
}
