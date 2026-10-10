import { useCallback, useState } from "react";
import { FileInput, MoreHorizontal, TriangleAlert } from "lucide-react";
import type { ExternalFileView } from "../../types/document";
import { externalPathOf, samePath } from "../../lib/externalFiles";
import { zh } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Tooltip } from "../ui/Tooltip";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { FileIcon } from "../ui/FileIcon";
import { Dialog } from "../ui/Dialog";
import "./workspace.css";

export interface ExternalFileListProps {
  /** 打开过的外部文件（来自工作区数据库，不含正文）。 */
  files: ExternalFileView[];
  /** 当前激活标签页的 `ext:` id；用于高亮。 */
  activeId: string | null;
  /** 打开某个外部文件（重新从磁盘读取）。 */
  onOpen: (path: string) => void;
  /** 在系统文件管理器里定位该文件。 */
  onReveal: (path: string) => void;
  /** 从列表移除记录（不删除磁盘文件）；确认对话框由本组件负责。 */
  onForget: (path: string) => void;
  /** 打开文件选择器（空态的主操作）。 */
  onOpenFilePicker: () => void;
}

/**
 * 外部文件面板：从磁盘直接打开、**原位编辑**的文件清单。
 *
 * 与文件树（工作区笔记）的区别是根本性的：这些文件不属于工作区，
 * 应用不复制它们的正文，只把「路径 + 名称」记在数据库里。
 * 因此面板按路径展示、按路径打开，不支持重命名/删除等会改动
 * 工作区结构的操作 —— 那些属于文件管理器。
 *
 * 记录来自数据库，所以重启后清单还在：这正是用户要的行为，
 * 不必再走一遍文件选择器。
 */
export function ExternalFileList({
  files,
  activeId,
  onOpen,
  onReveal,
  onForget,
  onOpenFilePicker,
}: ExternalFileListProps) {
  // 菜单锚点与坐标；用共享 ContextMenu 渲染。
  const [menu, setMenu] = useState<{ file: ExternalFileView; x: number; y: number } | null>(null);
  // 待确认移除的记录；非空时显示对话框。
  const [pendingForget, setPendingForget] = useState<ExternalFileView | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const menuItems = useCallback(
    (file: ExternalFileView): ContextMenuItem[] => [
      {
        id: "reveal",
        label: zh.externalFiles.reveal,
        disabled: file.missing,
        onSelect: () => {
          setMenu(null);
          onReveal(file.path);
        },
      },
      {
        id: "forget",
        label: zh.externalFiles.forget,
        danger: true,
        onSelect: () => {
          setMenu(null);
          setPendingForget(file);
        },
      },
    ],
    [onReveal],
  );

  if (files.length === 0) {
    return (
      <EmptyState
        title={zh.externalFiles.emptyTitle}
        description={zh.externalFiles.emptyDescription}
        action={
          <Button variant="primary" size="sm" onClick={onOpenFilePicker}>
            <FileInput size={14} aria-hidden />
            <span>{zh.fileTree.openFile}</span>
          </Button>
        }
      />
    );
  }

  // 当前激活的外部文件路径（若激活的不是外部标签页则为 null）。
  // 用路径归一比较而不是字符串相等：库里的写法与标签 id 的写法
  // 可能大小写/分隔符不同，严格相等会让高亮时有时无。
  const activePath = activeId ? externalPathOf(activeId) : null;

  return (
    <>
      <div className="external-list" role="list" aria-label={zh.externalFiles.ariaLabel}>
        {files.map((file) => {
          const selected = activePath !== null && samePath(activePath, file.path);
          return (
            <div key={file.path} className="external-list__row" role="listitem">
              <button
                type="button"
                aria-current={selected || undefined}
                aria-label={zh.externalFiles.itemLabel(file.name, file.missing)}
                className="external-list__item"
                data-selected={selected || undefined}
                data-missing={file.missing || undefined}
                title={file.path}
                onClick={() => onOpen(file.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ file, x: e.clientX, y: e.clientY });
                }}
              >
                <FileIcon filename={file.name} size={14} aria-hidden />
                <span className="external-list__label">{file.name}</span>
                {file.missing && (
                  <Tooltip content={zh.externalFiles.missingHint}>
                    <TriangleAlert
                      size={13}
                      className="external-list__missing"
                      aria-hidden
                    />
                  </Tooltip>
                )}
              </button>

              <Tooltip content={zh.externalFiles.moreActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className="external-list__more"
                  aria-label={`${file.name} ${zh.externalFiles.moreActions}`}
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
        ariaLabel={menu?.file.name}
      />

      <Dialog
        open={pendingForget !== null}
        title={zh.externalFiles.removeTitle}
        confirmLabel={zh.externalFiles.removeConfirm}
        cancelLabel={zh.externalFiles.cancel}
        destructive
        onCancel={() => setPendingForget(null)}
        onConfirm={() => {
          const target = pendingForget;
          setPendingForget(null);
          if (target) onForget(target.path);
        }}
      >
        {/* 必须说清「只移除记录、不删文件」，否则用户不敢点。 */}
        {pendingForget ? zh.externalFiles.removeBody(pendingForget.name) : null}
      </Dialog>
    </>
  );
}
