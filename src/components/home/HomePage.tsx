import { useState, useMemo, useEffect, useRef } from "react";
import { Input, Table } from "antd";
import {
  ArrowRight,
  Clock,
  FileInput,
  FilePlus,
  FileSearch,
  FileText,
  HardDrive,
  Keyboard,
  MoreHorizontal,
  Pin,
  Search,
  Settings,
  TriangleAlert,
} from "lucide-react";
import type { DocumentSummary, ExternalFileView, RecentFileView, SearchHit } from "../../types/document";
import { pathKey } from "../../lib/externalFiles";
import { buildFileActions } from "../../lib/fileActions";
import { formatBytes, formatDate } from "../../lib/format";
import { api } from "../../lib/api";
import { Button } from "../ui/Button";
import { ContextMenu } from "../ui/ContextMenu";
import { Tooltip } from "../ui/Tooltip";
import { FileIcon } from "../ui/FileIcon";
import { zh } from "../../lib/i18n";
import "./home.css";

export interface HomePageProps {
  documents: DocumentSummary[];
  recentFiles?: RecentFileView[];
  /** 旧外部文件清单（历史版本只登记了这张表；缺了它主页会漏文件）。 */
  externalFiles?: ExternalFileView[];
  onOpenDocument: (id: string) => void;
  onOpenPath?: (path: string) => void;
  onNewDocument: () => void;
  onOpenFile: () => void;
  onOpenSettings: () => void;
  workspacePath?: string | null;
  /** 全文检索函数；默认使用后端 api.searchDocuments。 */
  onSearchFullText?: (query: string) => Promise<SearchHit[]>;

  // ---- 文件操作（与侧栏文件树同一套，见 lib/fileActions） ----
  //
  // 主页此前只能「点开看」：重命名、另存副本、置顶、定位、删除一概没有，
  // 用户要改一个文件的任何属性都得先切到侧栏或编辑器里再找一遍。
  onTogglePin?: (path: string, pinned: boolean) => void;
  onDuplicateFile?: (path: string, title: string) => void;
  onRenameFile?: (path: string, title: string) => void;
  onRevealFile?: (path: string, name: string) => void;
  onRemoveFromHistory?: (path: string) => void;
  onDeleteFromDisk?: (path: string) => void;
  onDeleteDocument?: (id: string, title: string) => void;
  /** 打开「文件详情」面板（只读）。 */
  onShowDetails?: (path: string) => void;
}

/** 主页文件列表条目：磁盘文件用路径当 id，工作区文档用文档 id。 */
interface HomeFileItem {
  id: string;
  title: string;
  path: string;
  updatedAt: string;
  size: number;
  isPath: boolean;
  /** 磁盘上是否还存在；工作区文档恒为 true。 */
  exists: boolean;
  pinned: boolean;
  /** 列表里显示的路径。工作区文档的 path 是文档 id，不能直接拿来展示。 */
  displayPath: string;
}

/**
 * 工作区笔记在磁盘上的真实路径。
 *
 * 软件自建的笔记也存在磁盘上（`<数据目录>/notes/<uuid>.md`），只是文件名
 * 是 UUID。列表里必须显示完整路径 —— 用户要找的就是「这个文件在哪」，
 * 显示 `/` 等于什么都没说。
 *
 * `notes` 这一段必须与 Rust 的 `workspace::NOTES_DIR` 保持一致。
 */
function workspaceNotePath(workspaceRoot: string | null | undefined, id: string): string {
  if (!workspaceRoot) return "/";
  const sep = workspaceRoot.includes("\\") ? "\\" : "/";
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  return `${root}${sep}notes${sep}${id}.md`;
}


/**
 * 列表里显示的文件名：补上 .md 后缀。
 *
 * 工作区文档的 title 是「笔记名」不带后缀，磁盘文件带。列表要能横向
 * 比较就得统一 —— 但不要改文档本身的标题，那只是显示层的事。
 */
function fileDisplayName(title: string): string {
  if (title.toLowerCase().endsWith(".txt") || title.toLowerCase().endsWith(".md")) {
    return title;
  }
  return `${title}.md`;
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
  recentFiles,
  externalFiles,
  onOpenDocument,
  onOpenPath,
  onNewDocument,
  onOpenFile,
  onOpenSettings,
  onTogglePin,
  onDuplicateFile,
  onRenameFile,
  onRevealFile,
  onRemoveFromHistory,
  onDeleteFromDisk,
  onDeleteDocument,
  onShowDetails,
  workspacePath,
  onSearchFullText,
}: HomePageProps) {
  const [searchQuery, setSearchQuery] = useState("");
  // 右键/更多按钮打开的操作菜单；null 表示关闭。
  const [menu, setMenu] = useState<{ item: HomeFileItem; x: number; y: number } | null>(null);
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 统一文件列表：磁盘历史 + 旧外部清单 + 工作区文档，按路径归一键去重，
  // 再按更新时间倒序。与侧栏文件树同一套合并规则 —— 任何一张清单单独展示
  // 都会藏掉另外两份里的文件：刚通过「打开方式」打开的文件只登记在旧外部
  // 清单里，应用内新建、从未当磁盘文件打开过的笔记只在文档表里。
  const displayedDocs = useMemo<HomeFileItem[]>(() => {
    const items: HomeFileItem[] = [];
    const seen = new Set<string>();

    const pushDiskFile = (f: {
      path: string;
      name: string;
      size: number;
      openedAt: string;
      pinned?: boolean;
      /** 统一历史的 exists 与旧清单的 missing 是同一件事的两种写法。 */
      exists: boolean;
    }) => {
      items.push({
        id: f.path,
        title: f.name,
        path: f.path,
        updatedAt: f.openedAt,
        size: f.size,
        isPath: true,
        exists: f.exists,
        pinned: f.pinned ?? false,
        displayPath: f.path,
      });
      seen.add(pathKey(f.path));
      seen.add(f.name.toLowerCase());
    };

    for (const f of recentFiles ?? []) pushDiskFile(f);
    for (const f of externalFiles ?? []) {
      if (!seen.has(pathKey(f.path))) {
        pushDiskFile({ ...f, exists: !f.missing });
      }
    }

    for (const d of documents) {
      const idKey = d.id.toLowerCase();
      const nameKey = d.title.toLowerCase();
      if (seen.has(idKey) || seen.has(nameKey) || seen.has(`${nameKey}.md`)) continue;
      items.push({
        id: d.id,
        title: d.title,
        path: d.id,
        updatedAt: d.updatedAt,
        size: d.size,
        isPath: false,
        exists: true,
        pinned: false,
        displayPath: workspaceNotePath(workspacePath, d.id),
      });
      seen.add(idKey);
    }

    const ts = (iso: string) => {
      const t = new Date(iso).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    return items.sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt));
  }, [recentFiles, externalFiles, documents, workspacePath]);

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
        // 异常或非 Tauri 环境下的降级匹配：在统一列表里按标题过滤
        const localHits: SearchHit[] = displayedDocs
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
  }, [searchQuery, displayedDocs, onSearchFullText]);

  const isSearchActive = searchQuery.trim().length > 0;

  /** 打开某一行的操作菜单（右键，或右侧「更多」按钮）。 */
  const openMenu = (item: HomeFileItem, x: number, y: number) => setMenu({ item, x, y });

  /** 这一行当前可用的操作。与侧栏文件树共用同一套规则（lib/fileActions）。 */
  const menuItems = menu
    ? buildFileActions(
        {
          path: menu.item.path,
          name: menu.item.title,
          exists: menu.item.exists,
          pinned: menu.item.pinned,
        },
        {
        onTogglePin: (path, pinned) => onTogglePin?.(path, pinned),
        onDuplicate: (path, title) => onDuplicateFile?.(path, title),
        onRename: (path, title) => onRenameFile?.(path, title),
        onReveal: (path, name) => onRevealFile?.(path, name),
        onRemoveFromHistory: (path) => onRemoveFromHistory?.(path),
        onDeleteFromDisk: (path) => onDeleteFromDisk?.(path),
        onDeleteDocument: (id, title) => onDeleteDocument?.(id, title),
          onShowDetails,
        },
      )
    : [];

  return (
    <div className="home-page" role="region" aria-label="工作区主页">
      <div className="home-page__container">
        {/* 主体两栏布局：左侧 65% 主区 + 右侧 35% 侧边工作区 */}
        <div className="home-main-grid">
          {/* 左栏：搜索栏、完整文件列表或全文检索结果 */}
          <section className="home-content-section" aria-label={isSearchActive ? "搜索结果" : "文件列表"}>
            {/* 全局全文搜索输入框（antd Input，allowClear 自带清除） */}
            <div className="home-search-bar">
              <Search size={16} className="home-search-bar__icon" aria-hidden />
              <Input
                className="home-search-bar__input"
                variant="borderless"
                value={searchQuery}
                placeholder="全局全文搜索：键入关键词检索所有笔记的标题与正文..."
                aria-label="全局全文搜索"
                allowClear
                onChange={(e) => setSearchQuery(e.target.value)}
              />
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
                    <h2 className="home-section-bar__heading">文件</h2>
                    <span className="home-section-bar__count">{displayedDocs.length} 篇文档</span>
                  </>
                )}
              </div>

              {isSearchActive && (
                <button
                  type="button"
                  className="home-back-recents-btn"
                  onClick={() => setSearchQuery("")}
                >
                  返回文件列表
                </button>
              )}
            </div>

            {/* 列表渲染：无文档、无匹配或列表卡片 */}
            {displayedDocs.length === 0 ? (
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
                  const doc = displayedDocs.find((d) => d.id === hit.id);
                  const displayName = hit.title.toLowerCase().endsWith(".txt")
                    ? hit.title
                    : hit.title.endsWith(".md")
                      ? hit.title
                      : `${hit.title}.md`;
                  const folder = doc?.displayPath ?? "/";
                  const handleSelect = () => {
                    if (doc?.isPath && onOpenPath) onOpenPath(hit.id);
                    else onOpenDocument(hit.id);
                  };
                  return (
                    <div
                      key={hit.id}
                      className="home-note-row home-note-row--search-hit"
                      role="button"
                      tabIndex={0}
                      onClick={handleSelect}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelect();
                        }
                      }}
                    >
                      {/* 与常态行同一套网格列，否则搜索态的行会被挤进一格。 */}
                      <div className="home-note-row__icon-wrap">
                        <FileIcon filename={displayName} size={22} />
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
                        <span className="home-note-row__path" title={folder}>
                          {folder}
                        </span>
                      </div>
                      <span className="home-note-row__size">
                        {doc ? formatBytes(doc.size) : ""}
                      </span>
                      <div className="home-note-row__right">
                        {doc && (
                          <span className="home-note-row__date">{formatDate(doc.updatedAt)}</span>
                        )}
                        <ArrowRight size={14} className="home-note-row__arrow" aria-hidden />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* 常态文件列表：用 antd Table。
                 列表里只放「看名字就能决定下一步」的信息：名称、大小、
                 修改时间。完整路径收进详情面板 —— 一屏之内重复七遍
                 C:\Users\Administrator\... 只是噪音，不帮助选择。 */
              <Table<HomeFileItem>
                className="home-file-table"
                dataSource={displayedDocs}
                rowKey="id"
                size="middle"
                pagination={false}
                // 固定表格布局：auto 布局下长文件名会把表格撑得比容器还宽，
                // 连带把右侧栏挤出视口（网格列被内容撑破）。
                tableLayout="fixed"
                showSorterTooltip={false}
                onRow={(doc) => ({
                  onClick: () => {
                    if (doc.isPath && onOpenPath) onOpenPath(doc.id);
                    else onOpenDocument(doc.id);
                  },
                  onContextMenu: (e) => {
                    e.preventDefault();
                    openMenu(doc, e.clientX, e.clientY);
                  },
                  // 行本身可点开，也要能被 Tab 到、用键盘打开。
                  tabIndex: 0,
                  onKeyDown: (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (doc.isPath && onOpenPath) onOpenPath(doc.id);
                      else onOpenDocument(doc.id);
                    }
                    // Shift+F10 与菜单键：键盘用户也能打开操作菜单。
                    if (e.key === "F10" && e.shiftKey) {
                      e.preventDefault();
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      openMenu(doc, r.left + 24, r.bottom - 8);
                    }
                  },
                })}
                rowClassName={(doc) => (doc.exists ? "" : "home-file-table__row--missing")}
                columns={[
                  {
                    title: zh.details.name,
                    dataIndex: "title",
                    key: "name",
                    ellipsis: true,
                    // 名称不排序：用户找文件靠搜索与修改时间，按字典序排
                    // 只会把「刚改过的」打散（默认顺序就是它）。
                    render: (_: unknown, doc) => {
                      const displayName = fileDisplayName(doc.title);
                      return (
                        <span className="home-file-table__name">
                          <FileIcon filename={displayName} size={18} />
                          <span className="home-file-table__title" title={displayName}>
                            {displayName}
                          </span>
                          {doc.pinned && (
                            <Pin size={11} className="home-note-row__pinned" aria-label="已置顶" />
                          )}
                          {!doc.exists && (
                            <Tooltip content="文件已从磁盘移动或删除">
                              <TriangleAlert
                                size={13}
                                className="home-note-row__missing"
                                aria-label="文件不存在"
                              />
                            </Tooltip>
                          )}
                        </span>
                      );
                    },
                  },
                  {
                    title: zh.details.size,
                    dataIndex: "size",
                    key: "size",
                    width: 96,
                    align: "right",
                    sorter: (a, b) => a.size - b.size,
                    render: (size: number) => (
                      <span className="home-file-table__meta">{formatBytes(size)}</span>
                    ),
                  },
                  {
                    title: zh.details.modified,
                    dataIndex: "updatedAt",
                    key: "updatedAt",
                    width: 132,
                    align: "right",
                    sorter: (a, b) =>
                      new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
                    render: (updatedAt: string) => (
                      <span className="home-file-table__meta">{formatDate(updatedAt)}</span>
                    ),
                  },
                  {
                    // 操作列紧贴最右：与列表其它列同一套网格，不会左右跳动。
                    key: "actions",
                    width: 44,
                    render: (_: unknown, doc) => {
                      const displayName = fileDisplayName(doc.title);
                      return (
                        <Tooltip content={zh.fileTree.moreActions}>
                          <Button
                            variant="ghost"
                            size="sm"
                            iconOnly
                            className="home-note-row__more"
                            aria-label={`${displayName} ${zh.fileTree.moreActions}`}
                            onClick={(e) => {
                              // 别把点击冒泡成「打开文件」。
                              e.stopPropagation();
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              openMenu(doc, r.left, r.bottom + 2);
                            }}
                          >
                            <MoreHorizontal size={14} aria-hidden />
                          </Button>
                        </Tooltip>
                      );
                    },
                  },
                ]}
              />
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
                  <div className="home-card-action__icon home-card-action__icon--file">
                    <FileInput size={16} />
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

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        onClose={() => setMenu(null)}
        ariaLabel={menu ? `${menu.item.title} 的操作` : undefined}
      />
    </div>
  );
}
