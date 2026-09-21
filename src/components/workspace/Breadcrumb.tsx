import { ChevronRight } from "lucide-react";
import { zh } from "../../lib/i18n";
import "./workspace.css";

export interface BreadcrumbProps {
  /** 文档的虚拟路径，例如 "/笔记/Go/"；根为 "/"。 */
  virtualPath: string;
  /** 当前文档标题，作为最后一段（不可点击，因为已经在这里了）。 */
  title: string;
  /**
   * 点击某一段时的回调，参数是该段累积的路径。
   * 未提供时面包屑只作展示（Phase 1 没有目录浏览，仍满足 §17 的定位需求）。
   */
  onNavigate?: (path: string) => void;
}

/** 把 "/a/b/" 拆成 [{name:"a", path:"/a/"}, {name:"b", path:"/a/b/"}]。 */
function segments(virtualPath: string): Array<{ name: string; path: string }> {
  const parts = virtualPath.split("/").filter((p) => p.length > 0);
  const out: Array<{ name: string; path: string }> = [];
  let acc = "/";
  for (const p of parts) {
    acc += `${p}/`;
    out.push({ name: p, path: acc });
  }
  return out;
}

/**
 * 面包屑（UI_DESIGN_SYSTEM.md §17、§19）。
 *
 * 让用户随时知道「当前文档在哪个目录下」。根目录本身不单独占一段，
 * 以免只有一层时出现「/ / 文档名」这种冗余显示。
 */
export function Breadcrumb({ virtualPath, title, onNavigate }: BreadcrumbProps) {
  const crumbs = segments(virtualPath);

  return (
    <nav className="breadcrumb" aria-label={zh.breadcrumb.ariaLabel}>
      {crumbs.map((c) => (
        <span className="breadcrumb__segment" key={c.path}>
          {onNavigate ? (
            <button
              type="button"
              className="breadcrumb__link"
              onClick={() => onNavigate(c.path)}
            >
              {c.name}
            </button>
          ) : (
            <span className="breadcrumb__text">{c.name}</span>
          )}
          <ChevronRight size={12} aria-hidden className="breadcrumb__sep" />
        </span>
      ))}
      {/* 当前项用 aria-current 标注，而不是靠颜色区分（UI §39）。 */}
      <span className="breadcrumb__current" aria-current="page">
        {title}
      </span>
    </nav>
  );
}
