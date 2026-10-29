/**
 * 文件条目的操作菜单（侧栏文件树与主页文件列表共用一套）。
 *
 * 为什么集中在一处：两处列表的数据来源完全相同（recentFiles + externalFiles
 * + documents 三路合并），条目类型也有同样两种——**磁盘文件**与**工作区文档**。
 * 各写一份的话，总有一边先漏掉某种动作（主页此前就完全没有操作入口），
 * 或者对不适用该动作的条目类型也把按钮摆出来，点了却匹配 0 行。
 */
import type { ContextMenuEntry } from "../components/ui/ContextMenu";
import { isDiskPath } from "./externalFiles";

// 便于调用方只从这一处引入（分流规则与菜单规则同源）。
export { isDiskPath };
import { zh } from "./i18n";

/** 一个列表条目里与「能对它做什么」相关的字段。 */
export interface FileActionTarget {
  /** 磁盘文件是绝对路径；工作区文档是文档 id。 */
  path: string;
  name: string;
  /** 磁盘上是否还存在（工作区文档恒为 true）。 */
  exists: boolean;
  pinned: boolean;
}

export interface FileActionHandlers {
  onTogglePin: (path: string, pinned: boolean) => void;
  onDuplicate: (path: string, title: string) => void;
  onRename: (path: string, title: string) => void;
  onReveal: (path: string, name: string) => void;
  /** 从历史记录移除（仅磁盘文件有意义）。 */
  onRemoveFromHistory: (path: string) => void;
  /** 从磁盘彻底删除（仅磁盘文件有意义）。 */
  onDeleteFromDisk: (path: string) => void;
  /** 删除工作区笔记本身（仅文档条目有意义）。 */
  onDeleteDocument: (path: string, title: string) => void;
}

/**
 * 生成某个条目的菜单项。
 *
 * 只摆**对这个条目真正有效**的动作：
 * - 工作区文档的 path 是文档 id，拿它去删历史表永远匹配 0 行，
 *   所以给它的是「删除笔记」而不是「从历史记录中移除」；
 * - 磁盘文件才谈得上「历史记录」与「从磁盘彻底删除」。
 */
export function buildFileActions(
  file: FileActionTarget,
  handlers: FileActionHandlers,
): ContextMenuEntry[] {
  const items: ContextMenuEntry[] = [
    {
      id: "pin",
      label: file.pinned ? "取消置顶" : "置顶文档",
      onSelect: () => handlers.onTogglePin(file.path, !file.pinned),
    },
    {
      id: "duplicate",
      label: zh.fileTree.duplicate,
      onSelect: () => handlers.onDuplicate(file.path, file.name),
    },
    {
      id: "rename",
      label: zh.fileTree.rename,
      shortcut: "F2",
      onSelect: () => handlers.onRename(file.path, file.name),
    },
    {
      id: "reveal",
      label: zh.fileTree.revealInExplorer,
      // 文件已不在磁盘上时无从定位；文档条目由后端解析 UUID 文件名，始终可定位。
      disabled: isDiskPath(file.path) && !file.exists,
      onSelect: () => handlers.onReveal(file.path, file.name),
    },
  ];

  if (!isDiskPath(file.path)) {
    items.push({
      id: "delete-document",
      label: "删除笔记",
      danger: true,
      onSelect: () => handlers.onDeleteDocument(file.path, file.name),
    });
    return items;
  }

  items.push(
    {
      id: "remove-history",
      label: "从历史记录中移除",
      onSelect: () => handlers.onRemoveFromHistory(file.path),
    },
    {
      id: "delete-disk",
      label: "从磁盘彻底删除",
      danger: true,
      // 文件已不在磁盘上时同样要能点：磁盘那步是空操作，但记录必须清掉，
      // 否则「文件失效了却删不掉」——禁用按钮看着就像删除失效。
      onSelect: () => handlers.onDeleteFromDisk(file.path),
    },
  );
  return items;
}

/**
 * 另存副本时的默认文件名：`原名 (副本).md` → `原名 (副本 2).md` …
 *
 * 只是给个不撞名的起点，最终是否重名由后端拒绝（AlreadyExists），
 * 所以这里的编号只需「通常够用」，不必查盘确认。
 */
export function duplicateDiskName(name: string, attempt = 1): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const suffix = attempt === 1 ? " (副本)" : ` (副本 ${attempt})`;
  return `${stem}${suffix}${ext}`;
}
