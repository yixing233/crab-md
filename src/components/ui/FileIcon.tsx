import { FileText } from "lucide-react";
import "./fileIcon.css";

export interface FileIconProps {
  filename?: string;
  size?: number;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}

/**
 * 根据文件名后缀区分 Markdown (.md) 与纯文本 (.txt) 文件图标。
 * - .txt: 渲染 Lucide FileText（横线纯文本文档）并呈现中性灰色
 * - .md / 默认: 渲染专属 Lucide 风格的 Markdown (带 M↓ 标识) 文件图标并呈现主题色
 */
export function FileIcon({
  filename = "",
  size = 14,
  className = "",
  "aria-hidden": ariaHidden = true,
}: FileIconProps) {
  const isTxt = filename.toLowerCase().endsWith(".txt");

  if (isTxt) {
    return (
      <FileText
        size={size}
        className={`file-icon file-icon--txt ${className}`.trim()}
        aria-hidden={ariaHidden}
      />
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`file-icon file-icon--md ${className}`.trim()}
      aria-hidden={ariaHidden}
    >
      {/* 折角文件轮廓 */}
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      {/* Markdown 的 M 标识 */}
      <path d="M7 17v-5l2 2 2-2v5" />
      {/* Markdown 的 ↓ 下箭头标识 */}
      <path d="M15 13v4" />
      <path d="m13.5 15.5 1.5 1.5 1.5-1.5" />
    </svg>
  );
}
