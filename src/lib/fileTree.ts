import type { DocumentSummary } from "../types/document";

export interface TreeNode {
  /** 树节点稳定标识：文件夹用完整虚拟路径，文档用文档 id。 */
  key: string;
  name: string;
  type: "folder" | "document";
  /** 仅文档节点有值。 */
  documentId?: string;
  children?: TreeNode[];
}

/** 把 `/a/b/` 拆成 `["a","b"]`，忽略空段。 */
function splitPath(virtualPath: string): string[] {
  return virtualPath.split("/").filter((s) => s.length > 0);
}

/**
 * 由扁平文档列表构建文件树。
 *
 * 纯函数、无副作用：相同输入必得相同输出，因此可直接单测。
 * 排序规则：文件夹在前，其后同类按名称不区分大小写升序
 * （与 UI_DESIGN_SYSTEM.md §18 的资源管理器式阅读习惯一致）。
 */
export function buildFileTree(documents: DocumentSummary[]): TreeNode[] {
  const rootChildren: TreeNode[] = [];
  const folderIndex = new Map<string, TreeNode>();

  for (const doc of documents) {
    const segments = splitPath(doc.virtualPath);
    let siblings = rootChildren;
    let pathSoFar = "";

    for (const segment of segments) {
      pathSoFar += `/${segment}`;
      let folder = folderIndex.get(pathSoFar);
      if (!folder) {
        folder = { key: pathSoFar, name: segment, type: "folder", children: [] };
        folderIndex.set(pathSoFar, folder);
        siblings.push(folder);
      }
      siblings = folder.children!;
    }

    siblings.push({
      key: doc.id,
      name: doc.title,
      type: "document",
      documentId: doc.id,
    });
  }

  sortTree(rootChildren);
  return rootChildren;
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  for (const node of nodes) {
    if (node.children) {
      sortTree(node.children);
    }
  }
}
