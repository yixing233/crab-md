import {
  Bold,
  Code,
  Heading,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  Strikethrough,
  type LucideIcon,
} from "lucide-react";
import { EDITOR_ACTIONS, type MarkdownActionId } from "../../lib/markdownActions";
import { Button } from "../ui/Button";
import "./editor.css";

const ICONS: Record<MarkdownActionId, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  heading: Heading,
  bulletList: List,
  orderedList: ListOrdered,
  quote: Quote,
  link: LinkIcon,
  image: ImageIcon,
  inlineCode: Code,
  codeBlock: SquareCode,
};

export interface EditorToolbarProps {
  /** 点击某个格式化动作；由编辑器把这动作作用到当前选区。 */
  onAction: (action: MarkdownActionId) => void;
}

/**
 * 编辑器格式工具栏（UI_DESIGN_SYSTEM.md §21.1）。
 *
 * 桌面端常驻一条紧凑工具栏。按钮只发语义化动作 id，具体如何改文本
 * 由 `lib/markdownActions.ts` 的纯函数决定 —— 工具栏不碰文本。
 */
export function EditorToolbar({ onAction }: EditorToolbarProps) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
      {EDITOR_ACTIONS.map((action) => {
        const Icon = ICONS[action.id];
        const title = action.shortcut ? `${action.label} (${action.shortcut})` : action.label;
        return (
          <Button
            key={action.id}
            variant="ghost"
            size="sm"
            className="editor-toolbar__button"
            title={title}
            aria-label={action.label}
            onClick={() => onAction(action.id)}
          >
            <Icon size={15} />
          </Button>
        );
      })}
    </div>
  );
}
