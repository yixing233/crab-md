import { createPortal } from "react-dom";
import {
  AlignCenter,
  Columns,
  Minus,
  Rows,
} from "lucide-react";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import "./tableBar.css";

export interface TableFloatingBarProps {
  visible: boolean;
  x: number;
  y: number;
  onAddRow: () => void;
  onDeleteRow: () => void;
  onAddCol: () => void;
  onDeleteCol: () => void;
  onAlign: () => void;
}

export function TableFloatingBar({
  visible,
  x,
  y,
  onAddRow,
  onDeleteRow,
  onAddCol,
  onDeleteCol,
  onAlign,
}: TableFloatingBarProps) {
  if (!visible) return null;

  return createPortal(
    <div
      className="table-bar"
      role="toolbar"
      aria-label="表格快捷操作工具条"
      style={{
        top: Math.max(10, y - 38),
        left: Math.max(10, Math.min(x, window.innerWidth - 300)),
      }}
      onMouseDown={(e) => {
        // 阻止焦点离开编辑器
        e.preventDefault();
      }}
    >
      <div className="table-bar__group">
        <Tooltip content="在下方新增一行数据">
          <Button
            variant="ghost"
            size="sm"
            className="table-bar__btn"
            aria-label="新增行"
            onClick={onAddRow}
          >
            <Rows size={13} aria-hidden />
            <span>+行</span>
          </Button>
        </Tooltip>
        <Tooltip content="删除当前所在行">
          <Button
            variant="ghost"
            size="sm"
            className="table-bar__btn"
            aria-label="删除行"
            onClick={onDeleteRow}
          >
            <Minus size={13} aria-hidden />
            <span>-行</span>
          </Button>
        </Tooltip>
      </div>

      <div className="table-bar__separator" />

      <div className="table-bar__group">
        <Tooltip content="在右侧新增一列数据">
          <Button
            variant="ghost"
            size="sm"
            className="table-bar__btn"
            aria-label="新增列"
            onClick={onAddCol}
          >
            <Columns size={13} aria-hidden />
            <span>+列</span>
          </Button>
        </Tooltip>
        <Tooltip content="删除当前所在列">
          <Button
            variant="ghost"
            size="sm"
            className="table-bar__btn"
            aria-label="删除列"
            onClick={onDeleteCol}
          >
            <Minus size={13} aria-hidden />
            <span>-列</span>
          </Button>
        </Tooltip>
      </div>

      <div className="table-bar__separator" />

      <Tooltip content="自动美化并垂直对齐所有竖线">
        <Button
          variant="ghost"
          size="sm"
          className="table-bar__btn table-bar__btn--primary"
          aria-label="格式化对齐表格"
          onClick={onAlign}
        >
          <AlignCenter size={13} aria-hidden />
          <span>对齐</span>
        </Button>
      </Tooltip>
    </div>,
    document.body,
  );
}
