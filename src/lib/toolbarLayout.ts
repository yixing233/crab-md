/**
 * 格式工具栏的自适应布局计算（UI_DESIGN_SYSTEM.md §21.1）。
 *
 * 工具栏按钮**不得换行**：换行会让工具栏随宽度变化而改变高度，
 * 编辑器正文跟着上下跳动，而且第二行的按钮很难被注意到。
 * 宽度不足时，把放不下的动作收进一个「更多」菜单。
 *
 * 抽成纯函数而不是写进组件里：真实宽度依赖 ResizeObserver 与布局，
 * 在 jsdom 里量不到（clientWidth 恒为 0）。把**决策**与**测量**分开，
 * 决策就能被完整单测覆盖，组件只负责把测量结果喂进来。
 */

/** 单个图标按钮宽度：与 `.ui-button[data-size="sm"][data-icon-only]` 一致。 */
export const TOOLBAR_ITEM_WIDTH = 28;

/** 相邻项间距：与 `.editor-toolbar` 的 `gap` 一致（--space-1）。 */
export const TOOLBAR_ITEM_GAP = 4;

/** 分组竖线占位：1px 线 + 左右各 4px margin（--space-1）。 */
export const TOOLBAR_SEPARATOR_WIDTH = 9;

/** 扁平化后的一项：动作按钮，或组间竖线。 */
export type ToolbarSlot<T> =
  | { kind: "action"; id: T }
  | { kind: "separator" };

/**
 * 把分组展开成「动作 + 组间竖线」的线性序列。
 *
 * 空组不产生竖线 —— 否则会出现连续两条竖线这种明显的排版瑕疵。
 */
export function buildSlots<T>(groups: readonly (readonly T[])[]): ToolbarSlot<T>[] {
  const slots: ToolbarSlot<T>[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    if (slots.length > 0) slots.push({ kind: "separator" });
    for (const id of group) slots.push({ kind: "action", id });
  }
  return slots;
}

/** 一行 slot 的总占用宽度（含项间距）。 */
export function slotsWidth<T>(slots: readonly ToolbarSlot<T>[]): number {
  if (slots.length === 0) return 0;
  let total = 0;
  for (const slot of slots) {
    total += slot.kind === "separator" ? TOOLBAR_SEPARATOR_WIDTH : TOOLBAR_ITEM_WIDTH;
  }
  // n 项之间有 n-1 个 gap。
  return total + TOOLBAR_ITEM_GAP * (slots.length - 1);
}

export interface ToolbarLayout<T> {
  /** 直接显示在工具栏上的 slot（含组间竖线）。 */
  visible: ToolbarSlot<T>[];
  /** 收进「更多」菜单的动作；为空表示无需该菜单。 */
  overflow: T[];
}

/**
 * 计算自适应布局。
 *
 * @param groups 动作分组（语义顺序不可变，只影响竖线位置）。
 * @param availableWidth 工具栏可用于摆放按钮的宽度（已扣掉左右内边距）。
 *   **小于等于 0 视为「量不到」**，此时显示全部 —— jsdom 与首帧都属这种情况，
 *   宁可多显示也不要因为量不到而误收起。
 * @param reserveForMoreButton 是否为「更多」按钮预留位置。
 */
export function computeToolbarLayout<T>(
  groups: readonly (readonly T[])[],
  availableWidth: number,
): ToolbarLayout<T> {
  const all = buildSlots(groups);
  const allActions = all.filter((s): s is { kind: "action"; id: T } => s.kind === "action");

  // 量不到宽度：不做任何折叠。
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { visible: all, overflow: [] };
  }

  if (slotsWidth(all) <= availableWidth) {
    return { visible: all, overflow: [] };
  }

  // 放不下：需要「更多」按钮。它自己也占宽度，还要与前面的项留一个 gap。
  const moreCost = TOOLBAR_ITEM_WIDTH + TOOLBAR_ITEM_GAP;

  // 从**前**往後取动作（越靠前越常用），直到再加一个就放不下。
  const taken: T[] = [];
  for (const action of allActions) {
    const candidate = buildSlotsFromTaken(groups, taken, action.id);
    if (slotsWidth(candidate) + moreCost <= availableWidth) {
      taken.push(action.id);
    } else {
      break;
    }
  }

  const visible = buildSlotsFromTaken(groups, taken);
  const takenSet = new Set(taken);
  const overflow = allActions.filter((a) => !takenSet.has(a.id)).map((a) => a.id);

  return { visible, overflow };
}

/**
 * 按「已保留的动作集合」重建 slot 序列，并清除因折叠产生的无效竖线。
 *
 * 必须重建而不是裁剪原序列：裁掉中间的动作后，原来那条竖线可能变成
 * 行首、行尾，或与另一条相邻 —— 三种都是可见的排版错误。
 */
function buildSlotsFromTaken<T>(
  groups: readonly (readonly T[])[],
  taken: readonly T[],
  alsoInclude?: T,
): ToolbarSlot<T>[] {
  const keep = new Set(taken);
  if (alsoInclude !== undefined) keep.add(alsoInclude);

  const keptGroups = groups
    .map((g) => g.filter((id) => keep.has(id)))
    .filter((g) => g.length > 0);

  return buildSlots(keptGroups);
}
