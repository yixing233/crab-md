import { useEffect, useState } from "react";
import { Drawer } from "antd";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { countText } from "../../lib/wordCount";
import { formatBytes, formatStamp } from "../../lib/format";
import type { FileDetails as FileDetailsView } from "../../types/document";
import { zh } from "../../lib/i18n";
import "./fileDetails.css";

export interface FileDetailsPanelProps {
  /** 要查看的条目；null 表示关闭。磁盘路径与工作区文档 id 都可以。 */
  path: string | null;
  onClose: () => void;
}

/**
 * 「文件详情」面板。
 *
 * 用 Drawer 而不是 Dialog：详情是**只读的旁注**，不该像确认框那样截住
 * 整个界面让人先处理它。用户可以滑动看列表、对着详情核对，Esc 或点遮罩关掉。
 *
 * 数据由后端一次给全（`file_details` 命令）：这些字段本来散在文件系统、
 * 历史表、文档表三处，前端自己拼必然漏。
 */
export function FileDetailsPanel({ path, onClose }: FileDetailsPanelProps) {
  const [details, setDetails] = useState<FileDetailsView | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (path === null) {
      // 关闭时清掉上一条：下次打开别的文件时不该先闪一下旧数据。
      setDetails(null);
      setError(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);
    void useWorkspaceStore
      .getState()
      .loadFileDetails(path)
      .then((result) => {
        if (cancelled) return;
        if (result) setDetails(result);
        else setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  const stats = details?.text != null ? countText(details.text) : null;

  return (
    <Drawer
      open={path !== null}
      onClose={onClose}
      title={zh.details.title}
      placement="right"
      // antd 6 起 `width` 已弃用，尺寸改由 size 控制；
      // 详情内容是短行标签+值，用 default(378px) 足够。
      size="default"
      // 与 Dialog 同一层级：面板之上、菜单之下。
      zIndex={1100}
      destroyOnHidden
      styles={{
        header: { padding: "var(--space-5) var(--space-5) 0" },
        body: { padding: "var(--space-4) var(--space-5) var(--space-5)" },
        section: { background: "var(--bg-elevated)" },
      }}
    >
      {error ? (
        <p className="file-details__error">{zh.details.loadFailed}</p>
      ) : !details ? (
        <p className="file-details__loading">{loading ? zh.details.loading : ""}</p>
      ) : (
        <dl className="file-details">
          <Row label={zh.details.name} value={details.name} />
          {/* 路径是详情里最重要的一项：用等宽字体、允许折行，完整显示。 */}
          <Row label={zh.details.path} value={details.path} mono wrap />
          <Row label={zh.details.size} value={formatBytes(details.size)} />
          {details.createdAt && (
            <Row label={zh.details.created} value={formatStamp(details.createdAt)} />
          )}
          {details.modifiedAt && (
            <Row label={zh.details.modified} value={formatStamp(details.modifiedAt)} />
          )}
          {details.openedAt && (
            <Row label={zh.details.opened} value={formatStamp(details.openedAt)} />
          )}
          <Row label={zh.details.pinned} value={details.pinned ? "是" : "否"} />
          {!details.exists && (
            <Row label={zh.details.status} value={zh.details.missing} tone="danger" />
          )}
          {stats && (
            <>
              <Row label={zh.details.words} value={stats.words.toLocaleString()} />
              <Row label={zh.details.characters} value={stats.characters.toLocaleString()} />
              <Row
                label={zh.details.readingTime}
                value={zh.details.readingMinutes(stats.readingTimeMin)}
              />
            </>
          )}
        </dl>
      )}
    </Drawer>
  );
}

/** 详情里的一行：左标签、右值。 */
function Row({
  label,
  value,
  mono = false,
  wrap = false,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
  tone?: "danger";
}) {
  return (
    <>
      <dt className="file-details__label">{label}</dt>
      <dd
        className="file-details__value"
        data-mono={mono || undefined}
        data-wrap={wrap || undefined}
        data-tone={tone}
        title={value}
      >
        {value}
      </dd>
    </>
  );
}
