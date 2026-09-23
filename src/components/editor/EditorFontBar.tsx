import { useRef, useState } from "react";
import { ALargeSmall, ChevronDown } from "lucide-react";
import { Button } from "../ui/Button";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { Tooltip } from "../ui/Tooltip";
import { zh } from "../../lib/i18n";
import {
  composeFontStack,
  EDITOR_FONT_FAMILY_IDS,
  isCjkFontId,
  isLatinFontId,
  previewStack,
  type EditorCjkFont,
  type EditorFontFamilyId,
  type EditorLatinFont,
} from "../../lib/editorPrefs";
import "./editor.css";

export interface EditorFontBarProps {
  /** 覆盖当前选区设置的字体栈；无选区时作用于接下来输入的内容。 */
  onPick: (stack: string) => void;
  /** 移除字体（选区内的，或光标处尚未输入的空 span）。 */
  onClear: () => void;
  /** 选区是否已有字体。 */
  hasFont: boolean;
  /** 当前设置里的西文 / 中文字体，「默认」项据此合成。 */
  defaultLatin: EditorLatinFont;
  defaultCjk: EditorCjkFont;
}

/**
 * 编辑器内的字体入口（UI §34.6）。
 *
 * 形态是**一个图标按钮 + 点击弹出下拉**，而不是常驻的一排字体按钮：
 * 后者占掉一整条横向空间，且八个中文字形并排会把格式工具栏挤乱。
 * 字体是低频操作，收进下拉既省空间也不喧宾夺主（§2.1）。
 *
 * 下拉复用 `ContextMenu` 原语而非自造：视口收敛、Escape、点击外部、
 * 键盘上下导航都已经过测试，重写一遍只会多一处会坏的地方。
 */
export function EditorFontBar({
  onPick,
  onClear,
  hasFont,
  defaultLatin,
  defaultCjk,
}: EditorFontBarProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  // 打开时的坐标：锚点按钮的左下角，与工具栏下拉一致。
  const [pos, setPos] = useState({ x: 0, y: 0 });

  /** 把一维 id 解析成完整字体栈；「默认」用当前设置的组合。 */
  function stackOf(id: EditorFontFamilyId): string {
    if (id === "system") return composeFontStack(defaultLatin, defaultCjk);
    if (isLatinFontId(id)) return composeFontStack(id, defaultCjk);
    if (isCjkFontId(id)) return composeFontStack(defaultLatin, id);
    return composeFontStack(defaultLatin, defaultCjk);
  }

  /**
   * 下拉项的**预览**字体。
   *
   * 两个都必须用**该项自己**的字形，不能用当前的默认设置：
   * - 标签是中文（「宋体」「等宽」），若让西文排最前，西文为
   *   「系统默认」（`system-ui`，自带汉字字形）时会把中文吃掉，
   *   所有项看起来一模一样（实测缺陷）。
   * - 用 defaultLatin 渲染西文项也是错的：那样 Times 与等宽会都显示成
   *   当前默认字体，用户看不出这两项是什么。
   */
  function previewStackOf(id: EditorFontFamilyId): string {
    if (isCjkFontId(id)) return previewStack(defaultLatin, id, "cjk");
    if (isLatinFontId(id)) return previewStack(id, defaultCjk, "latin");
    // 「默认」项：展示当前设置实际合成出来的样子。
    return previewStack(defaultLatin, defaultCjk, "latin");
  }

  const label = (id: EditorFontFamilyId) => zh.editor.quickFontOption[id];

  const items: ContextMenuItem[] = EDITOR_FONT_FAMILY_IDS.map((id) => ({
    id,
    label: label(id),
    fontFamily: previewStackOf(id),
    onSelect: () => onPick(stackOf(id)),
  }));

  // 「清除」只在选区确实有字体时才加，否则是个永远无效的项。
  if (hasFont) {
    items.push({
      id: "clear",
      label: zh.editor.quickFontClear,
      onSelect: onClear,
    });
  }

  function openMenu() {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom + 4 });
    setOpen(true);
  }

  // 没有选区也能用：此时作用于**接下来输入的内容**，所以按钮永不因缺选区禁用。
  const tip = zh.editor.quickFontHint;

  return (
    <div className="editor-font-entry" ref={anchorRef}>
      <Tooltip content={tip}>
        <Button
          variant="ghost"
          size="sm"
          className="editor-toolbar__button"
          aria-label={zh.editor.quickFont}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openMenu())}
        >
          {/* 图标 + 小箭头：让「点了会弹东西」这件事本身可预期。 */}
          <ALargeSmall size={15} strokeWidth={2} aria-hidden />
          <ChevronDown size={9} aria-hidden className="editor-font-entry__caret" />
        </Button>
      </Tooltip>

      <ContextMenu
        open={open}
        x={pos.x}
        y={pos.y}
        items={items}
        onClose={() => setOpen(false)}
        ariaLabel={zh.editor.quickFont}
        anchorRef={anchorRef}
      />
    </div>
  );
}
