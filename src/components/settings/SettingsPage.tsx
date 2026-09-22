import { useEffect, useState } from "react";
import { FolderOpen, HardDrive, RotateCcw, X } from "lucide-react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { zh } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import "./settings.css";

export interface SettingsPageProps {
  open: boolean;
  onClose: () => void;
  /** 切换成功后由外层给出轻提示（UI §33）。 */
  onChanged: (message: string) => void;
}

/**
 * 设置页（UI_DESIGN_SYSTEM.md §34）。
 *
 * §34 要求按**用户心智模型**分组，而不是按实现模块。
 * 因此这里以「文件与数据」为组，而不是「数据库 / 路径配置」。
 *
 * 当前只有一项设置（数据目录）—— Phase 5 的账号、外观等后续加入。
 * 不为显得充实而堆放还没实现的开关。
 *
 * 面板自带遮罩，不复用 `Dialog`：面板内还要弹确认对话框，
 * 两个 `Dialog` 嵌套会各自装 Escape 监听与 Tab 焦点陷阱，
 * 按一次 Escape 会同时关掉两层。
 */
export function SettingsPage({ open, onClose, onChanged }: SettingsPageProps) {
  const settings = useWorkspaceStore((s) => s.settings);
  const loadSettings = useWorkspaceStore((s) => s.loadSettings);
  const setWorkspaceRoot = useWorkspaceStore((s) => s.setWorkspaceRoot);
  const resetWorkspaceRoot = useWorkspaceStore((s) => s.resetWorkspaceRoot);

  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 待确认的目标目录；非空时弹出确认对话框。
  const [pending, setPending] = useState<string | null>(null);

  // 打开时刷新，避免显示过期路径。
  useEffect(() => {
    if (!open) return;
    void loadSettings();
    void import("../../lib/api")
      .then(({ api }) => api.defaultWorkspaceRoot())
      .then(setDefaultRoot)
      .catch(() => setDefaultRoot(null));
  }, [open, loadSettings]);

  // Escape 关闭面板 —— 但确认对话框打开时让它先处理（见下方判断）。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // 确认框自己会处理 Escape；面板让位，避免一次按键关掉两层。
      if (pending !== null) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending, onClose]);

  if (!open) return null;

  /** 弹出系统目录选择器，返回所选路径（取消则为 null）。 */
  async function pickFolder(): Promise<string | null> {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: zh.settings.storage.label,
      });
      return typeof picked === "string" ? picked : null;
    } catch {
      // 无 Tauri IPC（单测 / 浏览器预览）时没有原生选择器。
      return null;
    }
  }

  const applySwitch = async (path: string) => {
    setBusy(true);
    const ok = await setWorkspaceRoot(path);
    setBusy(false);
    setPending(null);
    if (ok) onChanged(zh.settings.storage.done);
  };

  const lockedByEnv = settings?.workspaceRootIsFromEnv === true;

  return (
    <>
      <div className="settings-overlay" onMouseDown={onClose}>
        <div
          className="settings-panel"
          role="dialog"
          aria-modal="true"
          aria-label={zh.settings.title}
          // 点击面板内部不应关闭。
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="settings-panel__header">
            <h2 className="settings-panel__title">{zh.settings.title}</h2>
            <Button variant="ghost" size="sm" iconOnly aria-label={zh.settings.close} onClick={onClose}>
              <X size={16} aria-hidden />
            </Button>
          </header>

          <section className="settings-section" aria-labelledby="settings-files">
            <h3 className="settings-section__title" id="settings-files">
              {zh.settings.sections.files}
            </h3>

            <div className="settings-field">
              <span className="settings-field__label">
                <HardDrive size={14} aria-hidden />
                {zh.settings.storage.label}
              </span>
              <p className="settings-field__description">{zh.settings.storage.description}</p>

              {/* 当前生效路径：用 code 而非输入框 —— 它是结果，不是可编辑项。 */}
              <code className="settings-path" data-testid="effective-workspace-root">
                {settings?.effectiveWorkspaceRoot ?? "…"}
              </code>

              {lockedByEnv && (
                <p className="settings-note settings-note--warn" role="status">
                  {zh.settings.storage.fromEnvNote}
                </p>
              )}

              <div className="settings-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || lockedByEnv}
                  onClick={async () => {
                    const picked = await pickFolder();
                    if (picked && picked !== settings?.effectiveWorkspaceRoot) setPending(picked);
                  }}
                >
                  <FolderOpen size={14} aria-hidden />
                  <span>{zh.settings.storage.browse}</span>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !settings?.workspaceRoot || lockedByEnv}
                  onClick={async () => {
                    setBusy(true);
                    const ok = await resetWorkspaceRoot();
                    setBusy(false);
                    if (ok) onChanged(zh.settings.storage.done);
                  }}
                >
                  <RotateCcw size={14} aria-hidden />
                  <span>{zh.settings.storage.reset}</span>
                </Button>
              </div>

              {defaultRoot && (
                <p className="settings-field__hint">
                  {zh.settings.storage.defaultHint}：<code>{defaultRoot}</code>
                </p>
              )}
              {settings?.configPath && (
                <p className="settings-field__hint">
                  {zh.settings.storage.configFile}：<code>{settings.configPath}</code>
                </p>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* 切换目录前确认：用户需要知道「看不到旧笔记」不等于「被删除」。 */}
      <Dialog
        open={pending !== null}
        title={zh.settings.storage.confirmTitle}
        confirmLabel={zh.settings.storage.confirmOk}
        cancelLabel={zh.settings.storage.cancel}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) void applySwitch(pending);
        }}
      >
        {pending ? zh.settings.storage.confirmBody(pending) : null}
      </Dialog>
    </>
  );
}
