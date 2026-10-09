/**
 * 代码块按钮图标（编辑器即时渲染与预览栏共用）
 *
 * 单独成模块是为了避免循环依赖：`livePreview.ts` 已经 import `markdown.ts`，
 * 若把常量放在其中任一侧，另一侧再反向 import 就会形成环。
 */
export const COPY_ICON_SVG =
  '<svg class="code-block__copy-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
  '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>' +
  "</svg>";

export const CHECK_ICON_SVG =
  '<svg class="code-block__copy-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20 6 9 17l-5-5"/>' +
  "</svg>";
