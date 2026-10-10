import { useCallback, useState } from "react";
import { FolderOpen, MoreHorizontal, Pin, Plus, TriangleAlert } from "lucide-react";
import type { RecentFileView } from "../../types/document";
import { samePath } from "../../lib/externalFiles";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Tooltip } from "../ui/Tooltip";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { FileIcon } from "../ui/FileIcon";
import { Dialog } from "../ui/Dialog";
import "./workspace.css";

export interface RecentFileListProps {
  files: RecentFileView[];
  activePath: string | null;
  onOpen: (path: string) => void;
  onNew: () => void;
  onOpenFilePicker: () => void;
  onReveal: (path: string) => void;
  onRemoveFromHistory: (path: string) => void;
  onDeleteFromDisk: (path: string) => void;
  onTogglePin: (path: string, pinned: boolean) => void;
}

/**
 * 统一文件面板：展示在软件中打开过的所有磁盘文件历史与工作台记录。
 *
 * 核心理念：
 * - 软件不存文件，一切皆磁盘文件；
 * - 列表展示真实物理路径与最后访问时间；
 * - 无论软件自建还是外部导入，身份地位完全一致。
 */
export function RecentFileList({
  files,
  activePath,
  onOpen,
  onNew,
  onOpenFilePicker,
  onReveal,
  onRemoveFromHistory,
  onDeleteFromDisk,
  onTogglePin,
}: RecentFileListProps) {
  const [menu, setMenu] = useState<{ file: RecentFileView; x: number; y: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ file: RecentFileView; mode: "history" | "disk" } | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const menuItems = useCallback(
    (file: RecentFileView): ContextMenuItem[] => [
      {
        id: "pin",
        label: file.pinned ? "取消置顶" : "置顶文档",
        onSelect: () => onTogglePin(file.path, !file.pinned),
      },
      {
        id: "reveal",
        label: "在文件管理器中显示",
        disabled: !file.exists,
        onSelect: () => onReveal(file.path),
      },
      {
        id: "remove-history",
        label: "从历史记录中移除",
        onSelect: () => setPendingDelete({ file, mode: "history" }),
      },
      {
        id: "delete-disk",
        label: "从磁盘彻底删除",
        danger: true,
        disabled: !file.exists,
        onSelect: () => setPendingDelete({ file, mode: "disk" }),
      },
    ],
    [onTogglePin, onReveal],
  );

  return (
    <div className="recent-file-list" role="region" aria-label="文件列表">
      {/* 顶部轻量工具栏：新建与打开 */}
      <div className="recent-file-list__header">
        <span className="recent-file-list__title">最近文档</span>
        <div className="recent-file-list__actions">
          <Tooltip content="新建笔记">
            <Button variant="ghost" size="sm" iconOnly aria-label="新建笔记" onClick={onNew}>
              <Plus size={15} aria-hidden />
            </Button>
          </Tooltip>
          <Tooltip content="打开本地文件">
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label="打开本地文件"
              onClick={onOpenFilePicker}
            >
              <FolderOpen size={15} aria-hidden />
            </Button>
          </Tooltip>
        </div>
      </div>

      {files.length === 0 ? (
        <EmptyState
          title="还没有打开过文档"
          description="软件中打开或创建的所有 Markdown 文件都会记录在这里。"
          action={
            <div className="recent-file-list__empty-actions">
              <Button variant="primary" size="sm" onClick={onNew}>
                <Plus size={14} aria-hidden />
                <span>新建笔记</span>
              </Button>
              <Button variant="secondary" size="sm" onClick={onOpenFilePicker}>
                <FolderOpen size={14} aria-hidden />
                <span>打开文件</span>
              </Button>
            </div>
          }
        />
      ) : (
        <ul className="recent-file-list__items" role="list">
          {files.map((file) => {
            const isActive = activePath ? samePath(file.path, activePath) : false;
            return (
              <li
                key={file.pathKey}
                className="recent-file-item"
                data-active={isActive || undefined}
                data-missing={!file.exists || undefined}
                data-pinned={file.pinned || undefined}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ file, x: e.clientX, y: e.clientY });
                }}
              >
                <button
                  type="button"
                  className="recent-file-item__body"
                  aria-label={!file.exists ? `${file.name}，文件不存在` : file.name}
                  data-missing={!file.exists || undefined}
                  onClick={() => onOpen(file.path)}
                  title={file.path}
                >
                  <span className="recent-file-item__icon">
                    <FileIcon filename={file.name} />
                  </span>

                  <span className="recent-file-item__info">
                    <span className="recent-file-item__name">
                      {file.name}
                      {file.pinned && <Pin size={11} className="recent-file-item__pin-icon" aria-label="已置顶" />}
                    </span>
                    <span className="recent-file-item__path" title={file.path}>
                      {file.path}
                    </span>
                  </span>

                  {!file.exists && (
                    <Tooltip content="文件已从磁盘移动或删除">
                      <span className="recent-file-item__missing-tag" aria-label="文件不存在">
                        <TriangleAlert size={13} aria-hidden />
                      </span>
                    </Tooltip>
                  )}
                </button>

                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className="recent-file-item__more"
                  aria-label={`文档 ${file.name} 更多操作`}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMenu({ file, x: rect.right, y: rect.bottom });
                  }}
                >
                  <MoreHorizontal size={14} aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {/* 右键/更多菜单 */}
      {menu && (
        <ContextMenu
          open={true}
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.file)}
          onClose={closeMenu}
          ariaLabel={`文档 ${menu.file.name} 操作菜单`}
        />
      )}

      {/* 确认对话框：从历史移除 vs 从磁盘物理删除 */}
      {pendingDelete && (
        <Dialog
          open={true}
          title={pendingDelete.mode === "disk" ? `彻底删除 ${pendingDelete.file.name}？` : `从历史记录中移除？`}
          confirmLabel={pendingDelete.mode === "disk" ? "删除文件" : "移除记录"}
          cancelLabel="取消"
          destructive={true}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            if (pendingDelete.mode === "disk") {
              onDeleteFromDisk(pendingDelete.file.path);
            } else {
              onRemoveFromHistory(pendingDelete.file.path);
            }
            setPendingDelete(null);
          }}
        >
          {pendingDelete.mode === "disk" ? (
            <p className="ui-dialog__desc">
              这将把该文件从你的磁盘中彻底删除，操作无法撤销：
              <br />
              <code>{pendingDelete.file.path}</code>
            </p>
          ) : (
            <p className="ui-dialog__desc">
              只从软件的最近打开记录中清除，<strong>磁盘上的原文件不会被删除</strong>。
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
