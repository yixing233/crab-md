import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { renderMarkdown, renderMermaidDiagram } from "../../lib/markdown";
import { zh } from "../../lib/i18n";
// KaTeX 的排版样式与字体。从 node_modules 导入，Vite 会把字体一并打进产物 ——
// 数学公式的排版依赖这些字体，不能走 CDN（应用要能完全离线使用）。
import "katex/dist/katex.min.css";
import "./editor.css";

let nextMermaidRenderId = 0;

/** 只把服务端生成的 UUID 识别为附件引用；其它 scheme 仍交给 sanitizer。 */
const ATTACHMENT_URI_RE = /attachment:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

// 等待 Rust 返回二进制期间使用固定的一像素图片，避免把原始 attachment://
// 交给 Markdown/DOMPurify；它是本地常量，不是用户可控的 data URI。
const PENDING_ATTACHMENT_SRC =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const ATTACHMENT_PLACEHOLDER_PREFIX = "https://crab-md-attachment.invalid/";
const ATTACHMENT_PLACEHOLDER_RE =
  /https:\/\/crab-md-attachment\.invalid\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

function attachmentIds(source: string): string[] {
  const ids = new Set<string>();
  for (const match of source.matchAll(ATTACHMENT_URI_RE)) {
    const id = match[1];
    if (id) ids.add(id.toLowerCase());
  }
  return [...ids];
}

function replaceAttachmentUris(source: string): string {
  return source.replace(ATTACHMENT_URI_RE, (_full, rawId: string) => {
    return `${ATTACHMENT_PLACEHOLDER_PREFIX}${rawId.toLowerCase()}`;
  });
}

/**
 * DOMPurify 默认会剥掉 blob:，所以先让 Markdown 处理一个固定的 https
 * 占位符，再把占位符替换成由 URL.createObjectURL 产生的内部 URL。
 * 用户输入只能影响严格 UUID 的占位符，不能借此注入任意 HTML/协议。
 */
function injectAttachmentUrls(html: string, urls: ReadonlyMap<string, string>): string {
  return html.replace(ATTACHMENT_PLACEHOLDER_RE, (_full, rawId: string) => {
    return urls.get(rawId.toLowerCase()) ?? PENDING_ATTACHMENT_SRC;
  });
}

export interface MarkdownPreviewProps {
  source: string;
  /** 上报可滚动的根 DOM 容器，供编辑/预览同步滚动机制监听。 */
  onScrollDOM?: (el: HTMLElement | null) => void;
  /** 点击任务清单复选框时触发，用于切换源码中的 [ ] ↔ [x]。 */
  onToggleTask?: (taskIndex: number) => void;
  /** 是否为纯文本格式（.txt）：若是，原样保留文本排版展示，不渲染 Markdown。 */
  isPlainText?: boolean;
  /** 文档标题，供打印时自动生成出版级题头。 */
  documentTitle?: string;
}

export function MarkdownPreview({
  source,
  onScrollDOM,
  onToggleTask,
  isPlainText = false,
  documentTitle,
}: MarkdownPreviewProps) {
  const ids = useMemo(() => attachmentIds(source), [source]);
  const idsKey = ids.join("|");
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];

    // 清掉上一组引用，避免短暂显示旧图片。
    setAttachmentUrls({});

    if (
      ids.length === 0 ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      return () => {
        cancelled = true;
      };
    }

    void Promise.all(
      ids.map(async (id) => {
        try {
          const bytes = await api.readAttachment(id);
          if (cancelled) return null;
          // 复制到一个确定的 ArrayBuffer，兼容 TS/浏览器对 SharedArrayBuffer
          // 的 BlobPart 类型区分。
          const buffer = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(buffer).set(bytes);
          const url = URL.createObjectURL(new Blob([buffer]));
          createdUrls.push(url);
          return [id, url] as const;
        } catch {
          // 附件可能在文档同步/清理后暂时不存在；保留占位图，不让整页预览失败。
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setAttachmentUrls(next);
    });

    return () => {
      cancelled = true;
      for (const url of createdUrls) URL.revokeObjectURL(url);
    };
  }, [idsKey]);

  // 先替换成固定 https 占位符交给 Markdown/DOMPurify；未知 attachment://
  // 与其它不安全协议不会因此被放行。sanitized HTML 生成后才注入内部 ObjectURL。
  const renderedSource = useMemo(() => replaceAttachmentUris(source), [source]);
  // renderMarkdown 已内置 HTML 消毒（ARCHITECTURE.md §19）。
  const html = useMemo(() => {
    const sanitized = renderMarkdown(renderedSource);
    return injectAttachmentUrls(sanitized, new Map(Object.entries(attachmentUrls)));
  }, [renderedSource, attachmentUrls]);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const setPreviewRef = useCallback(
    (el: HTMLDivElement | null) => {
      previewRef.current = el;
      onScrollDOM?.(el);
    },
    [onScrollDOM],
  );

  useEffect(() => {
    const root = previewRef.current;
    if (!root) return;

    const blocks = Array.from(
      root.querySelectorAll<HTMLElement>("[data-mermaid-source]"),
    );
    if (blocks.length === 0) return;

    let cancelled = false;

    // Render each diagram independently. A malformed block should keep its
    // escaped source while valid sibling diagrams can still be displayed.
    void Promise.all(
      blocks.map(async (block) => {
        const sourceElement = block.querySelector("code");
        const diagramSource = sourceElement?.textContent ?? "";
        if (!diagramSource.trim()) {
          block.dataset.mermaidState = "error";
          return;
        }

        const id = `mermaid-preview-${++nextMermaidRenderId}`;
        try {
          const svg = await renderMermaidDiagram(diagramSource, id);
          if (cancelled) return;
          // renderMermaidDiagram has already performed the second DOMPurify
          // pass; replacing the source is safe only after that promise settles.
          block.innerHTML = svg;
          block.dataset.mermaidState = "rendered";
        } catch {
          // Keep the original <pre><code> source in place on parse/render
          // failures instead of turning a bad diagram into a blank preview.
          if (!cancelled) block.dataset.mermaidState = "error";
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [html]);

  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // 交互式任务列表复选框点击
    const checkbox = target.closest<HTMLInputElement>(".task-list-item-checkbox");
    if (checkbox) {
      e.stopPropagation();
      const idxStr = checkbox.dataset.taskIndex;
      if (idxStr !== undefined) {
        const taskIdx = parseInt(idxStr, 10);
        if (!isNaN(taskIdx)) {
          onToggleTask?.(taskIdx);
        }
      }
      return;
    }

    const copyBtn = target.closest<HTMLButtonElement>(".code-block__copy");
    if (!copyBtn) return;

    e.preventDefault();
    e.stopPropagation();

    const codeBlock = copyBtn.closest<HTMLElement>(".code-block");
    const codeElement = codeBlock?.querySelector("pre code");
    const codeText = codeElement?.textContent ?? "";

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(codeText);
      // 按钮已改为纯图标，反馈只能靠 data-copied 驱动颜色变化
      // （见 .code-block__copy[data-copied="true"]）。
      copyBtn.dataset.copied = "true";
      setTimeout(() => {
        delete copyBtn.dataset.copied;
      }, 1500);
    }
  };

  const printHeader = documentTitle ? (
    <div className="print-header" aria-hidden="true">
      <h1 className="print-header__title">{documentTitle.replace(/\.(md|txt)$/i, "")}</h1>
      <div className="print-header__meta">
        <span>导出时间：{new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })}</span>
      </div>
      <hr className="print-header__divider" />
    </div>
  ) : null;

  if (isPlainText) {
    return (
      <div
        ref={setPreviewRef}
        className="markdown-preview markdown-preview--plain-text"
      >
        {printHeader}
        <pre className="plain-text-body">{source}</pre>
      </div>
    );
  }

  if (!html) {
    return (
      <div
        ref={setPreviewRef}
        className="markdown-preview markdown-preview--empty"
      >
        {zh.preview.empty}
      </div>
    );
  }

  return (
    <div
      ref={setPreviewRef}
      className="markdown-preview"
      onClick={handlePreviewClick}
    >
      {printHeader}
      <div
        className="markdown-preview-content"
        // 内容已由 DOMPurify 消毒，见 lib/markdown.ts。
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
