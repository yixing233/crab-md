import { Fragment } from "react";
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
  Sigma,
  SquareCode,
  SquareFunction,
  Strikethrough,
  Table,
  type LucideIcon,
} from "lucide-react";
import { EDITOR_ACTIONS, type MarkdownActionId } from "../../lib/markdownActions";
import { zh } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
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
  table: Table,
  math: Sigma,
  mathBlock: SquareFunction,
};

export interface EditorToolbarProps {
  /** 点击某个格式化动作；由编辑器把这动作作用到当前选区。 */
  onAction: (action: MarkdownActionId) => void;
}

/**
 * 动作分组（仅影响视觉排布，不改变 `EDITOR_ACTIONS` 的语义顺序）。
 * 组间画竖线，避免一排图标看起来像毛坯房式的裸按钮堆。
 */
const GROUPS: ReadonlyArray<ReadonlyArray<MarkdownActionId>> = [
  ["bold", "italic", "strikethrough", "inlineCode"],
  ["heading", "bulletList", "orderedList", "quote"],
  ["link", "image", "codeBlock"],
  // 表格与公式是「插入结构」类动作，与上面的代码块同族，但单独成组
  // 以免那一组过长，同时让「插入数据/数学」在视觉上可被一眼找到。
  ["table", "math", "mathBlock"],
];

/**
 * 编辑器格式工具栏（UI_DESIGN_SYSTEM.md §21.1）。
 *
 * 桌面端常驻一条紧凑工具栏。按钮只发语义化动作 id，具体如何改文本
 * 由 `lib/markdownActions.ts` 的纯函数决定 —— 工具栏不碰文本。
 * 文案取自 `lib/i18n.ts`（§2.5：界面文案一律简体中文）。
 */
export function EditorToolbar({ onAction }: EditorToolbarProps) {
  const byId = new Map(EDITOR_ACTIONS.map((a) => [a.id, a]));

  return (
    <div className="editor-toolbar" role="toolbar" aria-label={zh.editor.toolbarAriaLabel}>
      {GROUPS.map((group, gi) => (
        <Fragment key={gi}>
          {gi > 0 && <span className="editor-toolbar__separator" aria-hidden />}
          {group.map((id) => {
            const action = byId.get(id);
            if (!action) return null;
            const Icon = ICONS[id];
            const label = zh.editor.actions[id];
            // 提示里带上快捷键；用自绘 Tooltip 而非 title 属性，
            // 以便控制延迟并让外观跟随主题（UI §13 必备组件）。
            const tip = action.shortcut ? `${label}　${action.shortcut}` : label;
            return (
              <Tooltip key={id} content={tip}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className="editor-toolbar__button"
                  aria-label={label}
                  onClick={() => onAction(id)}
                >
                  <Icon size={15} strokeWidth={2} aria-hidden />
                </Button>
              </Tooltip>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
