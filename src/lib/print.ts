/**
 * 打开系统打印对话框。
 *
 * 浏览器/WebView 会把“另存为 PDF”作为系统打印目标提供给用户。
 * 这里刻意不尝试静默写入路径：不同平台的 WebView 打印能力不同，
 * 而系统对话框能正确处理字体、分页和用户的打印机选择。
 */
export function printPreview(): boolean {
  if (typeof window === "undefined" || typeof window.print !== "function") {
    return false;
  }

  window.print();
  return true;
}
