/**
 * 打开系统打印对话框（用户可直接选择打印机或另存为 PDF）。
 *
 * @param documentTitle 可选的文档标题。传入时临时同步至 document.title，
 * 使得系统打印对话框在“另存为 PDF”时自动将该标题作为默认文件名。
 */
export function printPreview(documentTitle?: string): boolean {
  if (typeof window === "undefined" || typeof window.print !== "function") {
    return false;
  }

  const originalTitle = typeof document !== "undefined" ? document.title : "";
  if (documentTitle && typeof document !== "undefined") {
    document.title = documentTitle.replace(/\.(md|markdown|txt)$/i, "").trim() || originalTitle;
  }

  try {
    window.print();
    return true;
  } finally {
    if (documentTitle && typeof document !== "undefined") {
      document.title = originalTitle;
    }
  }
}
