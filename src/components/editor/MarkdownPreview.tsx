import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  renderMarkdown,
  renderMermaidDiagram,
  LOCAL_IMAGE_PLACEHOLDER_RE,
  decodeLocalImageRef,
} from "../../lib/markdown";
import { canOpenExternally, openExternalLink } from "../../lib/openExternalLink";
import { zh } from "../../lib/i18n";
import { Lightbox } from "./Lightbox";
// KaTeX 的排版样式与字体。从 node_modules 导入，Vite 会把字体一并打进产物 ——
// 数学公式的排版依赖这些字体，不能走 CDN（应用要能完全离线使用）。
import "katex/dist/katex.min.css";
import "./editor.css";

let nextMermaidRenderId = 0;

/**
 * 预览重渲染的去抖延迟。
 *
 * 每个按键都全量跑 markdown-it + DOMPurify + Mermaid 探测再整体替换
 * innerHTML，小文档无感，几百 KB 的文档会明显卡。输入停止 180ms 后才
 * 重跑管线；换文档时经 `resetKey` 立即生效（旧文档闪现比慢更糟）。
 */
const PREVIEW_RENDER_DELAY_MS = 180;

/** 只把服务端生成的 UUID 识别为附件引用；其它 scheme 仍交给 sanitizer。 */
const ATTACHMENT_URI_RE = /attachment:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

// 等待 Rust 返回二进制期间使用固定的一像素图片，避免把原始 attachment://
// 交给 Markdown/DOMPurify；它是本地常量，不是用户可控的 data URI。
const PENDING_ATTACHMENT_SRC =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const ATTACHMENT_PLACEHOLDER_PREFIX = "https://crab-md-attachment.invalid/";
const ATTACHMENT_PLACEHOLDER_RE =
  /https:\/\/crab-md-attachment\.invalid\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/** 本地图片扩展名 → blob MIME 类型；svg 必须带类型才会按矢量渲染。 */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
};

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

/**
 * 把本地图片占位符替换成磁盘读出的 blob URL。
 *
 * 与附件同一条两段式管线：markdown-it 渲染时只产出占位符（能通过
 * DOMPurify），图片字节由 Rust 按文档目录解析读取，这里只做 URL 换入。
 */
function injectLocalImageUrls(html: string, urls: Readonly<Record<string, string>>): string {
  return html.replace(
    LOCAL_IMAGE_PLACEHOLDER_RE,
    (_full, encoded: string) => urls[encoded] ?? PENDING_ATTACHMENT_SRC,
  );
}

/**
 * 滚动到页内锚点。
 *
 * `#fn1` 这类字面 id 直接命中；标题锚点是 `h-<encodeURIComponent(标题)>`
 * （同名标题带 `-2` 后缀），解码后按同一规则反查第一个匹配。
 */
function scrollToAnchor(root: HTMLElement | null, rawId: string): void {
  if (!root) return;
  let decoded = rawId;
  try {
    decoded = decodeURIComponent(rawId);
  } catch {
    // 保留原样：畸形编码按字面找一次。
  }

  const direct = document.getElementById(decoded);
  if (direct) {
    direct.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const prefix = `h-${encodeURIComponent(decoded)}`;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[id]"))) {
    if (element.id === prefix || element.id.startsWith(`${prefix}-`)) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
  }
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
  /**
   * 外部文件的绝对磁盘路径。提供时（原位打开的磁盘文件），
   * 相对路径图片按其所在目录从磁盘解析；工作区文档不提供 ——
   * 图片走 attachment:// 附件协议。
   */
  documentPath?: string | null;
  /** 点击文档内互链（相对路径的本地笔记）时触发，由外层解析打开。 */
  onOpenLink?: (href: string) => void;
  /**
   * 文档身份（如标签页 id）。变化时预览立即重渲染，跳过去抖 ——
   * 否则切标签时会先看到上一篇文档的旧内容闪 180ms。
   */
  resetKey?: string | null;
}

export function MarkdownPreview({
  source,
  onScrollDOM,
  onToggleTask,
  isPlainText = false,
  documentTitle,
  documentPath,
  onOpenLink,
  resetKey,
}: MarkdownPreviewProps) {
  // 渲染输入的去抖：连续键入时只在停顿后才重跑渲染管线。
  const lastKeyRef = useRef(resetKey);
  const [deferredSource, setDeferredSource] = useState(source);

  useEffect(() => {
    if (lastKeyRef.current !== resetKey) {
      lastKeyRef.current = resetKey;
      setDeferredSource(source);
      return;
    }
    const timer = setTimeout(() => setDeferredSource(source), PREVIEW_RENDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [source, resetKey]);
  const ids = useMemo(() => attachmentIds(deferredSource), [deferredSource]);
  const idsKey = ids.join("|");
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  // 本地图片：键是占位符里整体编码后的引用，值是磁盘读出的 blob URL。
  const [localImageUrls, setLocalImageUrls] = useState<Record<string, string>>({});

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
  const renderedSource = useMemo(() => replaceAttachmentUris(deferredSource), [deferredSource]);
  // renderMarkdown 已内置 HTML 消毒（ARCHITECTURE.md §19）。
  // 仅外部文件（documentPath 存在）启用本地图片改写：工作区文档的
  // 图片走附件协议，相对路径没有解析依据。长代码块折叠对所有预览生效。
  const sanitizedHtml = useMemo(
    () =>
      renderMarkdown(renderedSource, {
        localImages: Boolean(documentPath),
        collapsibleCode: true,
      }),
    [renderedSource, documentPath],
  );

  // 从消毒后的 HTML 收集本地图片占位符（键为编码引用，逗号拼接作依赖键）。
  // 在 HTML 里收集而不是在源码里正则，可以覆盖全部图片语法（含引用式）。
  const localImageRefsKey = useMemo(() => {
    if (!documentPath) return "";
    const encoded = new Set<string>();
    for (const match of sanitizedHtml.matchAll(LOCAL_IMAGE_PLACEHOLDER_RE)) {
      if (match[1]) encoded.add(match[1]);
    }
    return [...encoded].join("\n");
  }, [sanitizedHtml, documentPath]);

  useEffect(() => {
    let cancelled = false;
    const createdUrls: string[] = [];

    if (!documentPath || !localImageRefsKey) {
      setLocalImageUrls({});
      return () => {
        cancelled = true;
      };
    }

    setLocalImageUrls({});

    void Promise.all(
      localImageRefsKey.split("\n").map(async (encoded) => {
        const reference = decodeLocalImageRef(encoded);
        if (!reference) return null;
        try {
          const bytes = await api.readLocalAsset(documentPath, reference);
          if (cancelled) return null;
          // 复制到一个确定的 ArrayBuffer，兼容 TS/浏览器对 SharedArrayBuffer
          // 的 BlobPart 类型区分。
          const buffer = new ArrayBuffer(bytes.byteLength);
          new Uint8Array(buffer).set(bytes);
          const ext = reference.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
          const blob = new Blob([buffer], { type: IMAGE_MIME_BY_EXT[ext] ?? "" });
          const url = URL.createObjectURL(blob);
          createdUrls.push(url);
          return [encoded, url] as const;
        } catch {
          // 图片可能被移动/删除/过大；保留占位图，不让整页预览失败。
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const entry of entries) {
        if (entry) next[entry[0]] = entry[1];
      }
      setLocalImageUrls(next);
    });

    return () => {
      cancelled = true;
      for (const url of createdUrls) URL.revokeObjectURL(url);
    };
  }, [localImageRefsKey, documentPath]);

  const html = useMemo(
    () =>
      injectLocalImageUrls(
        injectAttachmentUrls(sanitizedHtml, new Map(Object.entries(attachmentUrls))),
        localImageUrls,
      ),
    [sanitizedHtml, attachmentUrls, localImageUrls],
  );
  const previewRef = useRef<HTMLDivElement | null>(null);
  const setPreviewRef = useCallback(
    (el: HTMLDivElement | null) => {
      previewRef.current = el;
      onScrollDOM?.(el);
    },
    [onScrollDOM],
  );
  // 灯箱：点击预览里的图片进入全屏查看（Esc / 遮罩点击退出）。
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

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

    // 链接分流：webview 绝不能自行导航，点击必须在这里拦下。
    const anchor = target.closest<HTMLAnchorElement>("a");
    if (anchor) {
      e.preventDefault();
      e.stopPropagation();
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        // 页内锚点：脚注往返链接与 `#标题` 引用。
        scrollToAnchor(previewRef.current, href.slice(1));
        return;
      }
      if (canOpenExternally(href)) {
        // 外部链接交系统浏览器（白名单协议）。
        void openExternalLink(href);
        return;
      }
      // 相对路径的本地笔记等：交给外层按文档目录解析。
      onOpenLink?.(href);
      return;
    }

    // 图片：进入灯箱全屏查看（在链接之后 —— 包在链接里的图片跟链接走）。
    const img = target.closest<HTMLImageElement>("img");
    if (img) {
      e.preventDefault();
      e.stopPropagation();
      setLightbox({ src: img.src, alt: img.alt });
      return;
    }

    // 长代码块的「展开全部」按钮：切换折叠状态。
    const expandBtn = target.closest<HTMLButtonElement>(".code-block__expand");
    if (expandBtn) {
      e.preventDefault();
      e.stopPropagation();
      const block = expandBtn.closest<HTMLElement>(".code-block");
      if (block) {
        const collapsed = block.dataset.collapsed === "true";
        block.dataset.collapsed = collapsed ? "false" : "true";
        const total = block.dataset.lineCount ?? "";
        expandBtn.textContent = collapsed ? "收起" : `展开全部 ${total} 行`;
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
      {lightbox && (
        <Lightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
