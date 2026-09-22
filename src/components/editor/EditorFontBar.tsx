import { X } from "lucide-react";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
import { zh } from "../../lib/i18n";
import {
  composeFontStack,
  EDITOR_FONT_FAMILY_IDS,
  isCjkFontId,
  isLatinFontId,
  previewStack,
  type EditorFontFamilyId,
} from "../../lib/editorPrefs";
import "./editor.css";

export interface EditorFontBarProps {
  /** 覆盖当前选区设置的字体栈。 */
  onPick: (stack: string) => void;
  /** 移除选区已有的字体。 */
  onClear: () => void;
  /** 选区是否已有字体。 */
  hasFont: boolean;
  /** 选区是否为空 —— 空选区时按钮禁用并说明原因。 */
  hasSelection: boolean;
  /** 当前设置里的西文 / 中文字体，「默认」项据此合成。 */
  defaultLatin: Parameters<typeof composeFontStack>[0];
  defaultCjk: Parameters<typeof composeFontStack>[1];
}

/**
 * 编辑器内的快速字体条（UI §34.6）。
 *
 * 为什么放在编辑器里而不是只留设置页：
 * 设置页改的是**全局默认字体**，而「这一段用宋体」是**就地决策** ——
 * 每次都要开设置页、改全局、再关掉，等于把局部需求当成全局配置。
 * 这里点一下就直接写进选区。
 *
 * 选项比设置页精简（用短名）：它是一条常驻的窄工具条，不是配置面板。
 */
export function EditorFontBar({
  onPick,
  onClear,
  hasFont,
  hasSelection,
  defaultLatin,
  defaultCjk,
}: EditorFontBarProps) {
  /** 把一维 id 解析成完整字体栈；「默认」用当前设置的组合。 */
  function stackOf(id: EditorFontFamilyId): string {
    if (id === "system") return composeFontStack(defaultLatin, defaultCjk);
    if (isLatinFontId(id)) return composeFontStack(id, defaultCjk);
    if (isCjkFontId(id)) return composeFontStack(defaultLatin, id);
    return composeFontStack(defaultLatin, defaultCjk);
  }

  /**
   * 标签的**预览**字体。不能直接用 stackOf：标签是中文（「宋体」「黑体」），
   * 而合成栈最前面是西文；当西文为「系统默认」（`system-ui`，自带汉字字形）
   * 时会把中文吃掉，八个按钮看起来全一样。
   */
  function previewStackOf(id: EditorFontFamilyId): string {
    if (isCjkFontId(id)) return previewStack(defaultLatin, id, "cjk");
    return previewStack(defaultLatin, defaultCjk, "latin");
  }

  const label = (id: EditorFontFamilyId) => zh.editor.quickFontOption[id];
  const tip = (id: EditorFontFamilyId) =>
    hasSelection ? label(id) : `${label(id)}　${zh.editor.quickFontNoSelection}`;

  return (
    <div className="editor-font-bar" role="toolbar" aria-label={zh.editor.quickFont}>
      <span className="editor-font-bar__label">{zh.editor.quickFont}</span>

      {EDITOR_FONT_FAMILY_IDS.map((id) => (
        <Tooltip key={id} content={tip(id)}>
          <Button
            variant="ghost"
            size="sm"
            className="editor-font-bar__item"
            aria-label={label(id)}
            disabled={!hasSelection}
            onClick={() => onPick(stackOf(id))}
          >
            {/* 用该字体自身渲染短名，一眼看得出选的是什么。 */}
            <span style={{ fontFamily: previewStackOf(id) }}>{label(id)}</span>
          </Button>
        </Tooltip>
      ))}

      {/* 只在选区确实有字体时才给「清除」，否则是个永远无效的按钮。 */}
      {hasFont && (
        <Tooltip content={zh.editor.quickFontClear}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={zh.editor.quickFontClear}
            onClick={onClear}
          >
            <X size={13} aria-hidden />
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
