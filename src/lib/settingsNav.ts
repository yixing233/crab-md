/**
 * 设置页左侧分组导航的折叠偏好（UI §34）。
 *
 * 折叠是**纯展示偏好**：只影响设置面板自身的布局，与主题、视图模式一样
 * 存 localStorage 而非数据库 —— 设置面板能打开就说明本地存储可用，
 * 不值得为它走一趟 Rust 命令层。
 *
 * 纯函数、不依赖 DOM，便于单测。
 */

export const NAV_COLLAPSED_KEY = "crab-md.settings-nav-collapsed";

/** 校验并读取折叠偏好；缺失或非法时回退到展开（默认态）。 */
export function readStoredNavCollapsed(raw: string | null): boolean {
  if (raw === "true") return true;
  return false;
}
