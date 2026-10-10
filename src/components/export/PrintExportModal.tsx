import { useMemo, useState } from "react";
import { Checkbox, Modal, Select } from "antd";
import { FileDown, Printer } from "lucide-react";
import { renderMarkdown } from "../../lib/markdown";
import { printPreview } from "../../lib/print";
import { Button } from "../ui/Button";
import "./printModal.css";

export interface PrintExportModalProps {
  open: boolean;
  documentTitle: string;
  content: string;
  isPlainText?: boolean;
  onClose: () => void;
}

/**
 * 导出 PDF 与排版打印弹窗 —— 基于 Ant Design Modal 适配层。
 *
 * 统一对话框的焦点管理、Escape 监听、遮罩层与进出场动画，
 * 视觉令牌映射到应用明暗主题。
 */
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

  return (
    <Modal
      open={open}
      title={
        <h2 className="print-modal__title">
          <Printer size={18} className="text-accent" aria-hidden />
          <span>导出 PDF 与排版打印</span>
        </h2>
      }
      onCancel={onClose}
      footer={null}
      width="min(1040px, 95vw)"
      centered
      destroyOnHidden
      className="print-modal-dialog"
      aria-label="导出 PDF 与排版打印"
      styles={{
        container: {
          padding: 0,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.4)",
          overflow: "hidden",
          height: "min(760px, 92vh)",
          display: "flex",
          flexDirection: "column",
        },
        header: {
          height: "52px",
          padding: "0 var(--space-6)",
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          marginBottom: 0,
        },
        body: {
          flex: "1 1 auto",
          display: "flex",
          minHeight: 0,
          padding: 0,
          overflow: "hidden",
        },
        mask: {
          backgroundColor: "rgba(0, 0, 0, 0.65)",
          backdropFilter: "blur(8px)",
        },
      }}
    >
      <div className="print-modal__body" style={{ width: "100%", height: "100%" }}>
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
            {/* 纸张规格 - 使用 Ant Design 下拉组件 */}
            <div className="print-modal__group">
              <span className="print-modal__group-title">纸张规格</span>
              <Select
                value={paperSize}
                onChange={(v) => setPaperSize(v)}
                aria-label="纸张规格"
                options={[
                  { value: "a4", label: "A4 (210 × 297 mm)" },
                  { value: "a5", label: "A5 (148 × 210 mm)" },
                  { value: "letter", label: "Letter (216 × 279 mm)" },
                ]}
                style={{ width: "100%" }}
              />
            </div>

            {/* 页面边距 - 使用 Ant Design 下拉组件 */}
            <div className="print-modal__group">
              <span className="print-modal__group-title">页边距</span>
              <Select
                value={marginLevel}
                onChange={(v) => setMarginLevel(v)}
                aria-label="页边距"
                options={[
                  { value: "compact", label: "紧凑 (12 mm)" },
                  { value: "standard", label: "标准 (18 mm)" },
                  { value: "wide", label: "宽松 (26 mm)" },
                ]}
                style={{ width: "100%" }}
              />
            </div>

            {/* 排版字体风格 - 使用 Ant Design 下拉组件 */}
            <div className="print-modal__group">
              <span className="print-modal__group-title">排版字体风格</span>
              <Select
                value={theme}
                onChange={(v) => setTheme(v)}
                aria-label="排版字体风格"
                options={[
                  { value: "custom", label: "跟随应用设置 (完全忠于你的偏好)" },
                  { value: "modern", label: "现代科技 (清晰无衬线体)" },
                  { value: "classic", label: "经典文雅 (书籍/学术衬线体)" },
                ]}
                style={{ width: "100%" }}
              />
            </div>

            {/* 题头与信息 - 使用 Ant Design 复选框组件 */}
            <div className="print-modal__group">
              <span className="print-modal__group-title">文档题头与页脚</span>
              <div className="print-modal__checkbox-list">
                <Checkbox
                  checked={showTitle}
                  onChange={(e) => setShowTitle(e.target.checked)}
                >
                  包含文档正式大标题
                </Checkbox>
                <Checkbox
                  checked={showDate}
                  disabled={!showTitle}
                  onChange={(e) => setShowDate(e.target.checked)}
                >
                  显示导出时间信息
                </Checkbox>
                <Checkbox
                  checked={showPageNumbers}
                  onChange={(e) => setShowPageNumbers(e.target.checked)}
                >
                  显示底部居中页码
                </Checkbox>
              </div>
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
    </Modal>
  );
}