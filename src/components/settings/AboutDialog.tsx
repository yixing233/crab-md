import { useEffect, useRef, useState } from "react";
import { BookOpen, Download, RefreshCw, X } from "lucide-react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { useUpdateStore } from "../../stores/useUpdateStore";
import { api } from "../../lib/api";
import { zh } from "../../lib/i18n";
import type { UpdateStatus } from "../../lib/updater";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import "./settings.css";
import "./about.css";

/** 把更新状态翻成一句给用户看的话。 */
function updateMessage(status: UpdateStatus): string {
  switch (status.kind) {
    case "idle":
      return "";
    case "checking":
      return zh.update.checking;
    case "up-to-date":
      return zh.update.upToDate;
    case "available":
      return zh.update.available(status.version);
    case "downloading":
      return status.total === null
        ? zh.update.downloadingUnknown
        : zh.update.downloading(Math.round((status.downloaded / status.total) * 100));
    case "ready":
      return zh.update.restarting;
    case "error":
      return zh.update.failed;
  }
}

export interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  /** 安装前自动落盘失败时通知外层（由 App 出轻提示）。 */
  onSaveFailed?: (message: string) => void;
}

/**
 * 「关于」对话框（UI_DESIGN_SYSTEM.md §16、§34）。
 *
 * 为什么独立成对话框而不是设置页的第五个分组：关于不是「设置」，
 * 它只是一堆事实信息与一个安装入口。放在设置里意味着用户要先想到
 * 「设置」才能找到自己的版本号。
 *
 * 为什么自绘面板、不复用 `Dialog`：面板内还要弹安装确认框。
 * 两个 `Dialog` 各装一份 Escape 监听，一次按键会同时关掉两层；
 * 这与设置面板的取舍相同（见 `SettingsPage.tsx` 的说明）。
 * 外层 Escape 用 `pendingInstall !== null` 让位给确认框 ——
 * 两者都注册在 window 捕获阶段，外层先跑，故必须自己提前返回。
 *
 * 同理不做 Tab 焦点陷阱：内层确认框会自己做，外层再抢一次焦点
 * 会把用户顶回面板内。§16 的「焦点陷阱」是 where appropriate。
 */
export function AboutDialog({ open, onClose, onSaveFailed }: AboutDialogProps) {
  const flushActive = useWorkspaceStore((s) => s.flushActive);

  // 更新状态来自共享 store：工具栏徽标、提示条、这里必须是同一份，
  // 各自 useState 会互相看不见（字号曾犯过同类错）。
  const update = useUpdateStore((s) => s.status);
  const check = useUpdateStore((s) => s.check);
  const install = useUpdateStore((s) => s.install);

  const panelRef = useRef<HTMLDivElement | null>(null);
  // 版本以后端为准（与更新检查同源）；初始值用构建期常量，避免显示空白。
  const [version, setVersion] = useState<string>(__APP_VERSION__);
  const [pendingInstall, setPendingInstall] = useState<string | null>(null);

  // 打开时把焦点移进对话框，关闭后归还 —— 否则键盘用户会丢失位置。
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current
      ?.querySelector<HTMLElement>(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      )
      ?.focus();
    return () => previouslyFocused?.focus?.();
  }, [open]);

  // 打开时拉一次真实版本；取不到就沿用构建期常量（不影响其它功能）。
  useEffect(() => {
    if (!open) return;
    void api
      .appVersion()
      .then(setVersion)
      .catch(() => {});
  }, [open]);

  // Escape 关闭 —— 但安装确认框打开时让它先处理。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 确认框自己会处理 Escape；面板让位，避免一次按键关掉两层。
      if (pendingInstall !== null) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pendingInstall, onClose]);

  if (!open) return null;

  /** 安装前先落盘：顺序反了就会丢掉用户正在写的内容。 */
  function handleInstall() {
    setPendingInstall(null);
    void install(async () => {
      const saved = await flushActive();
      if (!saved) onSaveFailed?.(zh.toast.saveFailed);
      return saved;
    });
  }

  return (
    <>
      <div className="about-overlay" onMouseDown={onClose}>
        <div
          ref={panelRef}
          className="about-panel"
          role="dialog"
          aria-modal="true"
          aria-label={zh.about.title}
          // 阻止冒泡：点击面板内部不应关闭对话框。
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="about-panel__header">
            <div className="about-panel__brand">
              {/* 品牌标记：与首页同一枚图标，纯令牌着色（§2.3 不用装饰性渐变）。 */}
              <span className="about-panel__mark" aria-hidden>
                <BookOpen size={16} strokeWidth={2.2} />
              </span>
              <h2 className="about-panel__title">{zh.about.title}</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={zh.about.close}
              onClick={onClose}
            >
              <X size={16} aria-hidden />
            </Button>
          </header>

          <div className="about-body">
            {/* ---- 应用信息：只放事实，不放推广内容（§34）。
                应用名在标题里已出现，这里不再重复，直接给事实。 ---- */}
            <p className="about-lead">{zh.about.description}</p>

            <dl className="about-meta">
              <dt>{zh.about.versionLabel}</dt>
              <dd className="about-meta__version" data-testid="app-version">
                {version}
              </dd>
              <dt>{zh.about.dataFormat}</dt>
              <dd>{zh.about.dataFormatValue}</dd>
            </dl>
          </div>

          {/* ---- 软件更新：贴底固定，动作与标题同行，不再浮在空白里。 ---- */}
          <footer className="about-footer">
            <div className="about-footer__row">
              <span className="settings-field__label">
                <Download size={14} aria-hidden />
                {zh.update.label}
              </span>

              <div className="settings-actions about-footer__actions">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={update.kind === "checking" || update.kind === "downloading"}
                  onClick={() => void check()}
                >
                  <RefreshCw size={14} aria-hidden />
                  <span>
                    {update.kind === "checking" ? zh.update.checking : zh.update.check}
                  </span>
                </Button>

                {update.kind === "available" && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      // 安装会关闭应用：先确认，再落盘，最后才安装。
                      setPendingInstall(update.version);
                    }}
                  >
                    <Download size={14} aria-hidden />
                    <span>{zh.update.install}</span>
                  </Button>
                )}
              </div>
            </div>

            <p className="settings-field__description">{zh.update.hint}</p>

            {/* 状态一行：空 / 检查中 / 最新 / 有新版 / 下载中 / 失败。 */}
            <p className="settings-update-status" role="status" data-testid="update-status">
              {updateMessage(update)}
            </p>

            {update.kind === "error" && (
              <p className="settings-note settings-note--warn">
                {update.fatal ? zh.update.installFailedHint : zh.update.failedHint}
              </p>
            )}

            {/* 下载中的进度条：有总量才显示百分比，否则只显示忙态，
                不假装知道进度。 */}
            {update.kind === "downloading" && update.total !== null && (
              <progress
                className="settings-progress"
                value={update.downloaded}
                max={update.total}
                aria-label={zh.update.label}
              />
            )}
          </footer>
        </div>
      </div>

      {/* 安装更新前确认：会关闭并重启应用，必须先说清。
          与面板同级而非嵌套 —— 否则点它还顺带关掉整个关于对话框。 */}
      <Dialog
        open={pendingInstall !== null}
        title={zh.update.confirmTitle}
        confirmLabel={zh.update.confirmOk}
        cancelLabel={zh.update.cancel}
        onCancel={() => setPendingInstall(null)}
        onConfirm={handleInstall}
      >
        {pendingInstall ? zh.update.confirmBody(pendingInstall) : null}
      </Dialog>
    </>
  );
}
