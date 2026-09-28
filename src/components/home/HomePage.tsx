import { useState, useMemo, useEffect, useRef } from "react";
import {
  ArrowRight,
  BookOpen,
  Clock,
  FilePlus,
  FileSearch,
  FileText,
  FolderOpen,
  HardDrive,
  Keyboard,
  Search,
  Settings,
  X,
} from "lucide-react";
import type { DocumentSummary, SearchHit } from "../../types/document";
import { api } from "../../lib/api";
import { Button } from "../ui/Button";
import { FileIcon } from "../ui/FileIcon";
import { zh } from "../../lib/i18n";
import "./home.css";

export interface HomePageProps {
  documents: DocumentSummary[];
  onOpenDocument: (id: string) => void;
  onNewDocument: () => void;
  onOpenFile: () => void;
  onOpenSettings: () => void;
  workspacePath?: string | null;
  /** 全文检索函数；默认使用后端 api.searchDocuments。 */
  onSearchFullText?: (query: string) => Promise<SearchHit[]>;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return `今天 ${timeStr}`;
    return `${d.toLocaleDateString([], { month: "2-digit", day: "2-digit" })} ${timeStr}`;
  } catch {
    return iso;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** 渲染带 FTS 关键词高亮标记的匹配正文片段。 */
function renderSnippet(snippet: string) {
  if (!snippet) return null;
  // FTS5 会用 [关键词] 标记匹配词
  const parts = snippet.split(/(\[[^\]]+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("[") && part.endsWith("]")) {
          return (
            <mark key={i} className="home-search-mark">
              {part.slice(1, -1)}
            </mark>
          );
        }
        return part;
      })}
    </>
  );
}

export function HomePage({
  documents,
  onOpenDocument,
  onNewDocument,
  onOpenFile,
  onOpenSettings,
  workspacePath,
  onSearchFullText,
}: HomePageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 全文搜索执行与防抖
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setIsSearching(true);

    searchTimerRef.current = setTimeout(async () => {
      const searchFn = onSearchFullText ?? api.searchDocuments;
      try {
        const hits = await searchFn(q);
        setSearchResults(hits);
      } catch {
        // 异常或非 Tauri 环境下的降级匹配
        const localHits: SearchHit[] = documents
          .filter((d) => d.title.toLowerCase().includes(q.toLowerCase()))
          .map((d) => ({
            id: d.id,
            title: d.title,
            snippet: `匹配标题: ${d.title}`,
          }));
        setSearchResults(localHits);
      } finally {
        setIsSearching(false);
      }
    }, 150);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, documents, onSearchFullText]);

  // 按更新时间降序排布的最近笔记列表
  const recentDocs = useMemo(() => {
    return [...documents].sort((a, b) => {
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [documents]);

  const isSearchActive = searchQuery.trim().length > 0;

  return (
    <div className="home-page" role="region" aria-label="工作区主页">
      <div className="home-page__container">
        {/* 顶部优雅欢迎条 */}
        <header className="home-header">
          <div className="home-header__brand">
            <div className="home-header__logo">
              <BookOpen size={24} strokeWidth={2.2} />
            </div>
            <div className="home-header__titles">
              <div className="home-header__headline">
                <h1 className="home-header__title">
                  {getGreeting()}，欢迎使用 Crab-MD
                </h1>
                <span className="home-header__badge">
                  v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.1.1"}
                </span>
              </div>
              <p className="home-header__subtitle">
                本地优先的轻量 Markdown 写作与阅读空间 · 实时保存 · 纯净专注
              </p>
            </div>
          </div>

          <div className="home-header__actions">
            <Button
              variant="primary"
              size="md"
              className="home-header__cta"
              aria-label="创建新笔记"
              onClick={onNewDocument}
            >
              <FilePlus size={16} />
              <span>新建笔记</span>
              <kbd className="home-header__kbd">Ctrl+N</kbd>
            </Button>
          </div>
        </header>

        {/* 主体两栏布局：左侧 65% 主区 + 右侧 35% 侧边工作区 */}
        <div className="home-main-grid">
          {/* 左栏：搜索栏、最近笔记流或全文检索结果 */}
          <section className="home-content-section" aria-label={isSearchActive ? "搜索结果" : "最近笔记"}>
            {/* 全局全文搜索输入框 */}
            <div className="home-search-bar">
              <Search size={16} className="home-search-bar__icon" aria-hidden />
              <input
                type="text"
                className="home-search-bar__input"
                value={searchQuery}
                placeholder="全局全文搜索：键入关键词检索所有笔记的标题与正文..."
                aria-label="全局全文搜索"
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="home-search-bar__clear"
                  onClick={() => setSearchQuery("")}
                  aria-label="清除搜索"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* 分区头部指示 */}
            <div className="home-section-bar">
              <div className="home-section-bar__left">
                {isSearchActive ? (
                  <>
                    <FileSearch size={16} className="home-section-bar__icon" aria-hidden />
                    <h2 className="home-section-bar__heading">搜索结果: “{searchQuery}”</h2>
                    <span className="home-section-bar__count">
                      {isSearching ? "检索中..." : `共 ${searchResults?.length ?? 0} 条匹配`}
                    </span>
                  </>
                ) : (
                  <>
                    <Clock size={16} className="home-section-bar__icon" aria-hidden />
                    <h2 className="home-section-bar__heading">最近笔记</h2>
                    <span className="home-section-bar__count">{documents.length} 篇文档</span>
                  </>
                )}
              </div>

              {isSearchActive && (
                <button
                  type="button"
                  className="home-back-recents-btn"
                  onClick={() => setSearchQuery("")}
                >
                  返回最近笔记
                </button>
              )}
            </div>

            {/* 列表渲染：无文档、无匹配或列表卡片 */}
            {documents.length === 0 ? (
              <div className="home-empty">
                <div className="home-empty__icon">
                  <FileText size={40} strokeWidth={1.5} />
                </div>
                <h3 className="home-empty__title">{zh.fileTree.emptyTitle}</h3>
                <p className="home-empty__desc">
                  当前工作区还没有任何笔记，点击下方按钮即刻开始记录想法。
                </p>
                <Button variant="primary" size="md" onClick={onNewDocument}>
                  <FilePlus size={15} />
                  <span>{zh.fileTree.newNote}</span>
                </Button>
              </div>
            ) : isSearchActive && searchResults && searchResults.length === 0 && !isSearching ? (
              <div className="home-empty home-empty--no-match">
                <Search size={32} strokeWidth={1.5} className="home-empty__icon" />
                <h3 className="home-empty__title">未找到匹配内容</h3>
                <p className="home-empty__desc">未在任何笔记的标题或正文中检索到关键词 “{searchQuery}”。</p>
                <Button variant="secondary" size="sm" onClick={() => setSearchQuery("")}>
                  清除搜索关键词
                </Button>
              </div>
            ) : isSearchActive && searchResults ? (
              /* 全文搜索结果列表（带正文高亮片段） */
              <div className="home-notes-list">
                {searchResults.map((hit) => {
                  const doc = documents.find((d) => d.id === hit.id);
                  const displayName = hit.title.toLowerCase().endsWith(".txt")
                    ? hit.title
                    : hit.title.endsWith(".md")
                      ? hit.title
                      : `${hit.title}.md`;
                  const folder = doc?.virtualPath && doc.virtualPath !== "/" ? doc.virtualPath : "/";
                  return (
                    <div
                      key={hit.id}
                      className="home-note-row home-note-row--search-hit"
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenDocument(hit.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenDocument(hit.id);
                        }
                      }}
                    >
                      <div className="home-note-row__left">
                        <div className="home-note-row__icon-wrap">
                          <FileIcon filename={displayName} size={16} />
                        </div>
                        <div className="home-note-row__info">
                          <span className="home-note-row__title" title={displayName}>
                            {displayName}
                          </span>
                          {/* 正文搜索高亮匹配片段 */}
                          {hit.snippet && (
                            <p className="home-note-row__snippet">
                              {renderSnippet(hit.snippet)}
                            </p>
                          )}
                          <div className="home-note-row__meta">
                            <span className="home-note-row__path">{folder}</span>
                            {doc && (
                              <>
                                <span className="home-note-row__dot">·</span>
                                <span className="home-note-row__size">{formatBytes(doc.size)}</span>
                                <span className="home-note-row__dot">·</span>
                                <span>{formatDate(doc.updatedAt)}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="home-note-row__right">
                        <ArrowRight size={14} className="home-note-row__arrow" aria-hidden />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* 常态最近笔记列表 */
              <div className="home-notes-list">
                {recentDocs.slice(0, 10).map((doc) => {
                  const displayName = doc.title.toLowerCase().endsWith(".txt")
                    ? doc.title
                    : doc.title.endsWith(".md")
                      ? doc.title
                      : `${doc.title}.md`;
                  const folder = doc.virtualPath && doc.virtualPath !== "/" ? doc.virtualPath : "/";
                  return (
                    <div
                      key={doc.id}
                      className="home-note-row"
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenDocument(doc.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenDocument(doc.id);
                        }
                      }}
                    >
                      <div className="home-note-row__left">
                        <div className="home-note-row__icon-wrap">
                          <FileIcon filename={displayName} size={16} />
                        </div>
                        <div className="home-note-row__info">
                          <span className="home-note-row__title" title={displayName}>
                            {displayName}
                          </span>
                          <div className="home-note-row__meta">
                            <span className="home-note-row__path">{folder}</span>
                            <span className="home-note-row__dot">·</span>
                            <span className="home-note-row__size">{formatBytes(doc.size)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="home-note-row__right">
                        <span className="home-note-row__date">{formatDate(doc.updatedAt)}</span>
                        <ArrowRight size={14} className="home-note-row__arrow" aria-hidden />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 右栏：快捷操作、存储概况与常用快捷键 */}
          <div className="home-side-panel">
            {/* 快捷操作区 */}
            <div className="home-card">
              <h3 className="home-card__title">快捷操作</h3>
              <div className="home-card__actions">
                <button
                  type="button"
                  className="home-card-action"
                  aria-label="导入本地文件"
                  onClick={onOpenFile}
                >
                  <div className="home-card-action__icon home-card-action__icon--folder">
                    <FolderOpen size={16} />
                  </div>
                  <div className="home-card-action__text">
                    <span className="home-card-action__label">导入本地文件</span>
                    <span className="home-card-action__hint">从磁盘导入现存 .md 文本</span>
                  </div>
                  <kbd className="home-card-action__kbd">Ctrl+O</kbd>
                </button>

                <button
                  type="button"
                  className="home-card-action"
                  aria-label="打开设置页"
                  onClick={onOpenSettings}
                >
                  <div className="home-card-action__icon home-card-action__icon--settings">
                    <Settings size={16} />
                  </div>
                  <div className="home-card-action__text">
                    <span className="home-card-action__label">{zh.toolbar.settings}</span>
                    <span className="home-card-action__hint">字体排版、主题与存储目录</span>
                  </div>
                  <kbd className="home-card-action__kbd">Ctrl+,</kbd>
                </button>
              </div>
            </div>

            {/* 常用快捷键 */}
            <div className="home-card">
              <div className="home-card__header-inline">
                <Keyboard size={15} className="home-card__icon-inline" aria-hidden />
                <h3 className="home-card__title">常用快捷键</h3>
              </div>
              <div className="home-shortcuts-table">
                <div className="home-shortcut-row">
                  <div className="home-shortcut-keys">
                    <kbd>Ctrl</kbd><span className="home-plus">+</span><kbd>N</kbd>
                  </div>
                  <span className="home-shortcut-label">新建笔记</span>
                </div>
                <div className="home-shortcut-row">
                  <div className="home-shortcut-keys">
                    <kbd>Ctrl</kbd><span className="home-plus">+</span><kbd>S</kbd>
                  </div>
                  <span className="home-shortcut-label">保存文档</span>
                </div>
                <div className="home-shortcut-row">
                  <div className="home-shortcut-keys">
                    <kbd>Ctrl</kbd><span className="home-plus">+</span><kbd>F</kbd>
                  </div>
                  <span className="home-shortcut-label">文档内查找</span>
                </div>
                <div className="home-shortcut-row">
                  <div className="home-shortcut-keys">
                    <kbd>Ctrl</kbd><span className="home-plus">+</span><kbd>W</kbd>
                  </div>
                  <span className="home-shortcut-label">关闭当前标签</span>
                </div>
                <div className="home-shortcut-row">
                  <div className="home-shortcut-keys">
                    <kbd>Ctrl</kbd><span className="home-plus">+</span><kbd>\</kbd>
                  </div>
                  <span className="home-shortcut-label">切换视图模式</span>
                </div>
                <div className="home-shortcut-row">
                  <div className="home-shortcut-keys">
                    <kbd>Ctrl</kbd><span className="home-plus">+</span><kbd>Shift</kbd><span className="home-plus">+</span><kbd>O</kbd>
                  </div>
                  <span className="home-shortcut-label">开关大纲侧栏</span>
                </div>
              </div>
            </div>

            {/* 本地工作区存储概况 */}
            {workspacePath && (
              <div className="home-card home-card--compact">
                <div className="home-card__header-inline">
                  <HardDrive size={14} className="home-card__icon-inline" aria-hidden />
                  <span className="home-card__subtitle">本地工作区目录</span>
                </div>
                <code className="home-card__code" title={workspacePath}>
                  {workspacePath}
                </code>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
