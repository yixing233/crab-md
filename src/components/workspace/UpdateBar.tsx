import { Download, X } from "lucide-react";
import { Button } from "../ui/Button";
import { zh } from "../../lib/i18n";
import { useUpdateStore } from "../../stores/useUpdateStore";
import "./workspace.css";

export interface UpdateBarProps {
  /** 点「安装」后先落盘；返回 false 表示落盘失败，应中止安装。 */
  onInstall: () => void;
}

/**
 * 更新提示条（常驻，位于工具栏之下）。
 *
 * 为什么不用 Toast（UI §33）：
 * §33 明确把「需要用户做出选择」列为 toast 的**反例**，这类信息必须
 * 用持久 UI。此前的实现是一条 2.2 秒就消失的 toast —— 错过之后用户
 * 再也看不到，等于没有提示。
 *
 * 为什么放在工具栏下方而不是浮层：
 * §2.1 要求不与编辑器争主体。提示条占据文档区上方一条，
 * 不遮挡内容、不阻断操作，但**持续可见**。
 */
export function UpdateBar({ onInstall }: UpdateBarProps) {
  const status = useUpdateStore((s) => s.status);
  const barDismissed = useUpdateStore((s) => s.barDismissed);
  const dismissBar = useUpdateStore((s) => s.dismissBar);

  // 只在「有新版且未被关掉」时出现；下载/安装中保持可见以显示进度。
  const visible =
    (status.kind === "available" && !barDismissed) ||
    status.kind === "downloading" ||
    status.kind === "ready";

  if (!visible) return null;

  const busy = status.kind === "downloading" || status.kind === "ready";

  // 进度只在 downloading 状态下有意义；从该分支直接取值，
  // 不要先算好再依赖收窄后的状态（收窄会随分支丢失）。
  const progress =
    status.kind === "downloading" && status.total !== null && status.total > 0
      ? { value: status.downloaded, max: status.total }
      : null;

  const text =
    status.kind === "downloading"
      ? progress === null
        ? zh.settings.update.downloadingUnknown
        : zh.settings.update.downloading(
            Math.round((progress.value / progress.max) * 100),
          )
      : status.kind === "ready"
        ? zh.settings.update.restarting
        : status.kind === "available"
          ? zh.settings.update.available(status.version)
          : "";

  return (
    <div className="update-bar" role="status" aria-live="polite" data-testid="update-bar">
      <Download size={15} aria-hidden className="update-bar__icon" />

      <span className="update-bar__text">{text}</span>

      {/* 有总量才显示进度条：拿不到总大小时不假装知道进度。 */}
      {progress !== null && (
        <progress
          className="update-bar__progress"
          value={progress.value}
          max={progress.max}
          aria-label={zh.settings.update.label}
        />
      )}

      <span className="update-bar__spacer" />

      <Button variant="primary" size="sm" disabled={busy} onClick={onInstall}>
        {zh.settings.update.install}
      </Button>

      {/* 忙时不提供关闭：安装已开始，中途关掉会让人以为没在装。 */}
      {!busy && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={zh.settings.update.dismiss}
          onClick={dismissBar}
        >
          <X size={14} aria-hidden />
        </Button>
      )}
    </div>
  );
}
