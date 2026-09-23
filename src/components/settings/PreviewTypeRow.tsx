import { useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "../ui/Button";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { Tooltip } from "../ui/Tooltip";
import { zh } from "../../lib/i18n";
import {
  composePreviewFontStack,
  stepSizeDown,
  stepSizeUp,
  type ElementTypography,
  type PreviewElementId,
} from "../../lib/previewTypography";
import type { EditorLatinFont } from "../../lib/editorPrefs";
import { EDITOR_CJK_FONTS } from "../../lib/editorPrefs";
import "./settings.css";

export interface PreviewTypeRowProps {
  element: PreviewElementId;
  value: ElementTypography;
  /** 全局西文字体：每个元素都用它，所以只在这里读一次。 */
  latinFont: EditorLatinFont;
  onChange: (next: ElementTypography) => void;
}

/**
 * 单类预览元素的排版行：中文字体下拉 + 字号增减。
 *
 * 为什么不用 `FontPicker`：那是「一次选一个」的场景，8 个选项铺成列表。
 * 这里有 11 类元素，若每类都铺 8 个按钮就是 88 个 —— 页面会失控。
 * 故字体收进下拉（复用 ContextMenu 原语），字号用 −/+（有限阶梯，相邻即一档）。
 *
 * 拉丁字符不在此处设置：它是**全局一项**（见设置页顶部的西文字体），
 * 每个元素重复设置一遍没有意义。
 */
export function PreviewTypeRow({
  element,
  value,
  latinFont,
  onChange,
}: PreviewTypeRowProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const items: ContextMenuItem[] = EDITOR_CJK_FONTS.map((font) => ({
    id: font,
    label: zh.settings.preview.cjkFontOption[font],
    // 每项用该项自己的中文字形渲染 —— 选择列表的核心价值。
    fontFamily: composePreviewFontStack(latinFont, font),
    onSelect: () => onChange({ ...value, cjkFont: font }),
  }));

  function openMenu() {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left, y: r.bottom + 4 });
    setOpen(true);
  }

  const sizeDown = stepSizeDown(element, value.sizePx);
  const sizeUp = stepSizeUp(element, value.sizePx);

  return (
    <div className="preview-type-row">
      <span className="preview-type-row__name">{zh.settings.preview.element[element]}</span>

      <div className="preview-type-row__font" ref={anchorRef}>
        <Tooltip content={zh.settings.preview.changeFont}>
          <Button
            variant="secondary"
            size="sm"
            className="preview-type-row__font-button"
            aria-label={`${zh.settings.preview.element[element]}　${zh.settings.preview.font}`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => (open ? setOpen(false) : openMenu())}
          >
            {/* 用该字体自身渲染，一眼看出当前选的是什么。 */}
            <span
              className="preview-type-row__font-name"
              style={{ fontFamily: composePreviewFontStack(latinFont, value.cjkFont) }}
            >
              {zh.settings.preview.cjkFontOption[value.cjkFont]}
            </span>
          </Button>
        </Tooltip>

        <ContextMenu
          open={open}
          x={pos.x}
          y={pos.y}
          items={items}
          onClose={() => setOpen(false)}
          ariaLabel={`${zh.settings.preview.element[element]}　${zh.settings.preview.font}`}
          anchorRef={anchorRef}
        />
      </div>

      {/* 字号：−/+ 走有限阶梯，相邻即一档；到端点时禁用而不是静默无效。 */}
      <div className="preview-type-row__size">
        <Tooltip content={zh.settings.preview.smaller}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={`${zh.settings.preview.element[element]}　${zh.settings.preview.smaller}`}
            disabled={sizeDown === value.sizePx}
            onClick={() => onChange({ ...value, sizePx: sizeDown })}
          >
            <Minus size={13} aria-hidden />
          </Button>
        </Tooltip>

        <span
          className="preview-type-row__size-value"
          data-testid={`preview-size-${element}`}
        >
          {value.sizePx}
        </span>

        <Tooltip content={zh.settings.preview.larger}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={`${zh.settings.preview.element[element]}　${zh.settings.preview.larger}`}
            disabled={sizeUp === value.sizePx}
            onClick={() => onChange({ ...value, sizePx: sizeUp })}
          >
            <Plus size={13} aria-hidden />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
