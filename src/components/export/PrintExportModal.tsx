import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileDown, Printer, X } from "lucide-react";
import { renderMarkdown } from "../../lib/markdown";
import { printPreview } from "../../lib/print";
import { Button } from "../ui/Button";
import { SegmentedControl } from "../ui/SegmentedControl";
import "./printModal.css";

export interface PrintExportModalProps {
  open: boolean;
  documentTitle: string;
  content: string;
  isPlainText?: boolean;
  onClose: () => void;
}

export function PrintExportModal({
  open,
  documentTitle,
  content,
  isPlainText = false,
  onClose,
}: PrintExportModalProps) {
  const [paperSize, setPaperSize] = useState<"a4" | "a5" | "letter">("a4");
  const [marginLevel, setMarginLevel] = useState<"compact" | "standard" | "wide">("standard");
  const [showTitle, setShowTitle] = useState(true);
  const [showDate, setShowDate] = useState(true);
  const [showPageNumbers, setShowPageNumbers] = useState(true);
  const [theme, setTheme] = useState<"custom" | "classic" | "modern">("custom");

  // Esc 键关闭弹窗
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const html = useMemo(() => {
    if (isPlainText || !content) return "";
    return renderMarkdown(content);
  }, [content, isPlainText]);

  const marginMap = {
    compact: "12mm",
    standard: "18mm",
    wide: "26mm",
  };

  const marginPaddingMap = {
    compact: "20px 24px",
    standard: "32px 36px",
    wide: "44px 48px",
  };

  const handleExecutePrint = () => {
    // 注入打印动态配置样式表
    const styleId = "crab-md-print-config";
    let el = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = styleId;
      document.head.appendChild(el);
    }

    const marginValue = marginMap[marginLevel];
    el.textContent = `
      @media print {
        @page {
          size: ${paperSize.toUpperCase()};
          margin: ${marginValue};
        }
        ${!showTitle ? ".print-header { display: none !important; }" : ""}
        ${!showDate ? ".print-header__meta { display: none !important; }" : ""}
        ${
          theme === "classic"
            ? ".markdown-preview, .markdown-preview * { font-family: Georgia, 'Songti SC', 'SimSun', serif !important; }"
            : theme === "modern"
              ? ".markdown-preview, .markdown-preview * { font-family: system-ui, -apple-system, sans-serif !important; }"
              : ""
        }
      }
    `;

    // 唤起系统打印
    printPreview(documentTitle);
    onClose();
  };

  if (!open) return null;

  const displayTitle = documentTitle.replace(/\.(md|txt)$/i, "") || "无标题文档";
  const dateStr = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return createPortal(
    <div className="print-modal-overlay" role="dialog" aria-modal="true" aria-label="导出 PDF 与排版打印">
      <div className="print-modal">
        {/* 对话框顶栏 */}
        <div className="print-modal__header">
          <h2 className="print-modal__title">
            <Printer size={18} className="text-accent" aria-hidden />
            <span>导出 PDF 与排版打印</span>
          </h2>
          <button
            type="button"
            className="print-modal__close-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* 对话框主体：左侧 A4 真实纸张预览，右侧参数设置 */}
        <div className="print-modal__body">
          {/* 左侧预览区 */}
          <div className="print-modal__preview-area">
            <div
              className="print-modal__paper"
              style={{
                padding: marginPaddingMap[marginLevel],
                fontFamily:
                  theme === "classic"
                    ? "Georgia, 'Songti SC', 'SimSun', serif"
                    : theme === "modern"
                      ? "system-ui, -apple-system, sans-serif"
                      : "var(--preview-font-body, var(--font-ui))",
              }}
            >
              {/* 题头 */}
              {showTitle && (
                <div className="print-modal__paper-header">
                  <h1
                    className="print-modal__paper-title"
                    style={{
                      fontFamily:
                        theme === "classic"
                          ? "Georgia, 'Songti SC', 'SimSun', serif"
                          : theme === "modern"
                            ? "system-ui, -apple-system, sans-serif"
                            : "var(--preview-font-h1, var(--font-ui))",
                    }}
                  >
                    {displayTitle}
                  </h1>
                  {showDate && <p className="print-modal__paper-date">导出日期：{dateStr}</p>}
                </div>
              )}

              {/* 正文 */}
              <div className="print-modal__paper-content">
                {isPlainText ? (
                  <pre className="plain-text-body">{content}</pre>
                ) : (
                  <div
                    className="markdown-preview"
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                )}
              </div>

              {/* 页脚 */}
              {showPageNumbers && (
                <div className="print-modal__paper-footer">第 1 页</div>
              )}
            </div>
          </div>

          {/* 右侧设置区 */}
          <div className="print-modal__sidebar">
            <div className="print-modal__settings">
              {/* 纸张规格 */}
              <div className="print-modal__group">
                <span className="print-modal__group-title">纸张规格</span>
                <SegmentedControl
                  ariaLabel="纸张规格"
                  value={paperSize}
                  onChange={(v) => setPaperSize(v as "a4" | "a5" | "letter")}
                  options={[
                    { value: "a4", label: "A4" },
                    { value: "a5", label: "A5" },
                    { value: "letter", label: "Letter" },
                  ]}
                />
              </div>

              {/* 页面边距 */}
              <div className="print-modal__group">
                <span className="print-modal__group-title">页边距</span>
                <SegmentedControl
                  ariaLabel="页边距"
                  value={marginLevel}
                  onChange={(v) => setMarginLevel(v as "compact" | "standard" | "wide")}
                  options={[
                    { value: "compact", label: "紧凑 (12mm)" },
                    { value: "standard", label: "标准 (18mm)" },
                    { value: "wide", label: "宽松 (26mm)" },
                  ]}
                />
              </div>

              {/* 题头与信息 */}
              <div className="print-modal__group">
                <span className="print-modal__group-title">文档题头</span>
                <div className="print-modal__checkbox-list">
                  <label className="print-modal__checkbox-label">
                    <input
                      type="checkbox"
                      checked={showTitle}
                      onChange={(e) => setShowTitle(e.target.checked)}
                    />
                    <span>在首部包含文档正式大标题</span>
                  </label>
                  <label className="print-modal__checkbox-label">
                    <input
                      type="checkbox"
                      checked={showDate}
                      disabled={!showTitle}
                      onChange={(e) => setShowDate(e.target.checked)}
                    />
                    <span>显示导出时间信息</span>
                  </label>
                  <label className="print-modal__checkbox-label">
                    <input
                      type="checkbox"
                      checked={showPageNumbers}
                      onChange={(e) => setShowPageNumbers(e.target.checked)}
                    />
                    <span>显示底部居中页码</span>
                  </label>
                </div>
              </div>

              {/* 排版字体风格 */}
              <div className="print-modal__group">
                <span className="print-modal__group-title">排版字体风格</span>
                <select
                  className="print-modal__select"
                  value={theme}
                  aria-label="排版字体风格"
                  onChange={(e) => setTheme(e.target.value as "custom" | "classic" | "modern")}
                >
                  <option value="custom">跟随应用设置（完全忠于你的偏好）</option>
                  <option value="modern">现代科技（清晰无衬线体）</option>
                  <option value="classic">经典文雅（书籍/学术衬线体）</option>
                </select>
              </div>
            </div>

            {/* 底部按钮栏 */}
            <div className="print-modal__actions">
              <Button variant="ghost" onClick={onClose}>
                取消
              </Button>
              <Button variant="primary" onClick={handleExecutePrint}>
                <FileDown size={15} aria-hidden />
                <span>导出 PDF / 打印</span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
