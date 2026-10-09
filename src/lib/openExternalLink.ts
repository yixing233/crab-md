/**
 * 在系统默认浏览器里打开外部链接。
 *
 * 为什么单独一个模块：打开动作要经过 `@tauri-apps/plugin-opener` 的原生 IPC，
 * 而单测 / 浏览器预览里没有 Tauri 运行时。把「能不能开」和「怎么开」拆开，
 * 让调用方能在**同步**阶段判断出「这个地址值不值得拦下这次点击」，避免
 * 把一次普通的光标落点操作变成什么都没发生。
 */

/**
 * 允许交给系统浏览器处理的协议白名单。
 *
 * 用白名单而不是黑名单：Markdown 文档里可以出现任意 `[文字](地址)`，
 * 而 `javascript:` / `data:` / `file:` 这类地址一旦真的被系统打开，
 * 后果远不止「没反应」。相对路径（`./foo.md`）与页内锚点（`#标题`）
 * 也一并排除 —— 它们要的是文档内跳转，不是唤起外部浏览器。
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** 同步判断：这个地址是否可以交由系统浏览器打开。 */
export function canOpenExternally(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (trimmed === "") return false;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(trimmed).protocol);
  } catch {
    // `new URL` 对相对路径、`#锚点` 以及各种畸形输入都会抛错 —— 都不开。
    return false;
  }
}

/**
 * 调用 Tauri opener 插件打开链接。
 *
 * 返回是否成功发起。没有 Tauri IPC（单测 / 浏览器预览）时静默失败，
 * 与 `SettingsPage.openInFileManager` 的处理保持一致：这属于锦上添花的能力，
 * 不该因为环境不同就抛出来打断用户。
 */
export async function openExternalLink(rawUrl: string): Promise<boolean> {
  if (!canOpenExternally(rawUrl)) return false;
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(rawUrl.trim());
    return true;
  } catch {
    return false;
  }
}
