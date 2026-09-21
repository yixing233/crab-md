import { useMemo } from "react";
import { FileText, Folder, Plus } from "lucide-react";
import { buildFileTree, type TreeNode } from "../../lib/fileTree";
import type { DocumentSummary } from "../../types/document";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import "./workspace.css";

export interface FileTreeProps {
  documents: DocumentSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function FileTree({ documents, activeId, onSelect, onCreate }: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(documents), [documents]);

  if (documents.length === 0) {
    return (
      <EmptyState
        title="No notes yet"
        description="Create your first Markdown document."
        action={
          <Button variant="primary" size="sm" onClick={onCreate}>
            <Plus size={14} />
            New note
          </Button>
        }
      />
    );
  }

  return (
    <div className="file-tree" role="tree" aria-label="Notes">
      {tree.map((node) => (
        <TreeItem key={node.key} node={node} activeId={activeId} onSelect={onSelect} depth={0} />
      ))}
    </div>
  );
}

interface TreeItemProps {
  node: TreeNode;
  activeId: string | null;
  onSelect: (id: string) => void;
  depth: number;
}

function TreeItem({ node, activeId, onSelect, depth }: TreeItemProps) {
  if (node.type === "folder") {
    return (
      <div className="file-tree__group">
        <div className="file-tree__folder" style={{ paddingLeft: depth * 12 + 8 }}>
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
          />
        ))}
      </div>
    );
  }

  const selected = node.documentId === activeId;
  return (
    <button
      type="button"
      role="treeitem"
      aria-selected={selected}
      className="file-tree__item"
      data-selected={selected || undefined}
      style={{ paddingLeft: depth * 12 + 8 }}
      onClick={() => node.documentId && onSelect(node.documentId)}
    >
      <FileText size={14} aria-hidden />
      <span className="file-tree__label">{node.name}</span>
    </button>
  );
}
