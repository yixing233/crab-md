/**
 * 预览渲染开关（Mermaid 图表 / 数学公式）（UI_DESIGN_SYSTEM.md §34「预览排版」）。
 *
 * 为什么不是纯函数直读 localStorage：`markdown.ts` 的 markdown-it 实例与
 * `livePreview.ts` 的装饰器都是模块级单例，渲染发生在任意时刻（打字、切页），
 * 不可能每次渲染都异步读存储。因此这里用**模块级可写状态**：
 * App 启动时从 localStorage 注入一次，设置页切换时同步更新。
 *
 * 安全性不变：关掉 Mermaid 渲染只是让围栏代码块走普通代码高亮路径，
 * 关掉公式只是让 `$...$` 保持原文 —— 两条路径原本就存在，且都过 DOMPurify。
 */

export interface RenderToggles {
  /** Mermaid 代码块渲染为图表；false 时按普通代码块显示源码。 */
  mermaid: boolean;
  /** 渲染 $...$ / $$...$$ 数学公式；false 时保留原文。 */
  math: boolean;
}

const toggles: RenderToggles = {
  mermaid: true,
  math: true,
};

/** 当前生效的渲染开关（快照；内部状态只经 setRenderToggles 改变）。 */
export function getRenderToggles(): Readonly<RenderToggles> {
  return { ...toggles };
}

/** 更新渲染开关（App 启动注入与设置页切换时调用）。部分更新，未提字段保持原值。 */
export function setRenderToggles(next: Partial<RenderToggles>): void {
  if (typeof next.mermaid === "boolean") toggles.mermaid = next.mermaid;
  if (typeof next.math === "boolean") toggles.math = next.math;
}

// ---------------------------------------------------------------------------
// localStorage 持久化
// ---------------------------------------------------------------------------

export const RENDER_TOGGLES_KEY = "crab-md.render-toggles";

/** 从存储原始值解析；非法 JSON 或字段缺失时逐字段回退默认（全开）。 */
export function parseRenderToggles(raw: string | null): RenderToggles {
  const fallback: RenderToggles = { mermaid: true, math: true };
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    const obj = parsed as { mermaid?: unknown; math?: unknown };
    return {
      mermaid: typeof obj.mermaid === "boolean" ? obj.mermaid : true,
      math: typeof obj.math === "boolean" ? obj.math : true,
    };
  } catch {
    return fallback;
  }
}

/** 读取并应用存储中的渲染开关；存储不可用时保持默认。返回解析出的值。 */
export function loadRenderToggles(storage: Storage | null | undefined): RenderToggles {
  const parsed = parseRenderToggles(
    typeof localStorage === "undefined" ? null : storage?.getItem(RENDER_TOGGLES_KEY) ?? null,
  );
  setRenderToggles(parsed);
  return parsed;
}
