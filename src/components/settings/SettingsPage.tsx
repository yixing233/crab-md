import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  FolderOpen,
  HardDrive,
  Info,
  Moon,
  RotateCcw,
  SquarePen,
  Sun,
  SunMoon,
  Type,
  X,
} from "lucide-react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { zh } from "../../lib/i18n";
import {
  FONT_FAMILY_STACK,
  FONT_SIZE_PX,
  type EditorFontFamily,
  type EditorFontSize,
} from "../../lib/editorPrefs";
import type { ViewMode } from "../../lib/viewMode";
import type { ThemePreference } from "../../lib/theme";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { SegmentedControl, type SegmentedOption } from "../ui/SegmentedControl";
import "./settings.css";

/** 左侧分组。用稳定 id 而非索引，避免将来插入分组时页面错位。 */
type SectionId = "appearance" | "editor" | "files" | "about";

const SECTION_ORDER: readonly SectionId[] = ["appearance", "editor", "files", "about"] as const;

export interface SettingsPageProps {
  open: boolean;
  onClose: () => void;
  /** 成功反馈由外层统一出轻提示（UI §33）。 */
  onChanged: (message: string) => void;
  /** 主题偏好由 App 持有（工具栏主题按钮与这里改的是同一份状态）。 */
  themePreference: ThemePreference;
  onChangeTheme: (pref: ThemePreference) => void;
  /** 视图模式同样由 App 持有。 */
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  /**
   * 编辑器字号由 App 持有，不在这里自持状态。
   * 若设置页自己 useState + useEffect 应用，字号就只在「打开过设置页」
   * 之后才生效，重启应用即回到默认 —— 那是错的。
   */
  fontSize: EditorFontSize;
  onChangeFontSize: (size: EditorFontSize) => void;
  /** 字体族同样由 App 持有（启动即生效，理由同字号）。 */
  fontFamily: EditorFontFamily;
  onChangeFontFamily: (family: EditorFontFamily) => void;
}

/**
 * 设置页（UI_DESIGN_SYSTEM.md §34）。
 *
 * §34 要求按**用户心智模型**分组，而不是按实现模块 —— 因此分组是
 * 外观 / 编辑器 / 文件与数据 / 关于，而不是「数据库 / 路径 / 缓存」。
 *
 * 布局用左侧分组导航 + 右侧内容，而不是把四组堆成一长列：
 * 一列到底时用户要滚动才能确认「还有没有别的设置」。
 *
 * 面板自带遮罩，不复用 `Dialog`：面板内还要弹确认对话框，
 * 两个 `Dialog` 嵌套会各自装 Escape 监听与 Tab 焦点陷阱，
 * 按一次 Escape 会同时关掉两层。
 */
export function SettingsPage({
  open,
  onClose,
  onChanged,
  themePreference,
  onChangeTheme,
  viewMode,
  onChangeViewMode,
  fontSize,
  onChangeFontSize,
  fontFamily,
  onChangeFontFamily,
}: SettingsPageProps) {
  const settings = useWorkspaceStore((s) => s.settings);
  const loadSettings = useWorkspaceStore((s) => s.loadSettings);
  const setWorkspaceRoot = useWorkspaceStore((s) => s.setWorkspaceRoot);
  const resetWorkspaceRoot = useWorkspaceStore((s) => s.resetWorkspaceRoot);

  const [section, setSection] = useState<SectionId>("appearance");
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
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

  // Escape 关闭面板 —— 但确认对话框打开时让它先处理。
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

  /** 在系统文件管理器里打开数据目录（用 opener 插件，不新增依赖）。 */
  async function openInFileManager(path: string) {
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(path);
    } catch {
      // 环境不支持时静默失败：这不是关键路径，不该打断用户。
    }
  }

  async function copyPath(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      onChanged(zh.settings.storage.copyFailed);
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
  const effectiveRoot = settings?.effectiveWorkspaceRoot ?? "";

  const themeOptions: readonly SegmentedOption<ThemePreference>[] = [
    { value: "light", label: zh.settings.appearance.themeOption.light, icon: Sun },
    { value: "dark", label: zh.settings.appearance.themeOption.dark, icon: Moon },
    { value: "system", label: zh.settings.appearance.themeOption.system, icon: SunMoon },
  ];

  const fontSizeOptions: readonly SegmentedOption<EditorFontSize>[] = (
    ["sm", "md", "lg"] as const
  ).map((size) => ({
    value: size,
    label: `${zh.settings.editor.fontSizeOption[size]} ${FONT_SIZE_PX[size]}`,
  }));

  const fontFamilyOptions: readonly SegmentedOption<EditorFontFamily>[] = (
    ["sans", "serif", "mono"] as const
  ).map((family) => ({ value: family, label: zh.settings.editor.fontFamilyOption[family] }));

  const viewModeOptions: readonly SegmentedOption<ViewMode>[] = (
    ["edit", "split", "preview"] as const
  ).map((mode) => ({ value: mode, label: zh.settings.editor.viewModeOption[mode] }));

  const SECTION_LABEL: Record<SectionId, string> = {
    appearance: zh.settings.sections.appearance,
    editor: zh.settings.sections.editor,
    files: zh.settings.sections.files,
    about: zh.settings.sections.about,
  };

  return (
    <>
      <div className="settings-overlay" onMouseDown={onClose}>
        <div
          className="settings-panel"
          role="dialog"
          aria-modal="true"
          aria-label={zh.settings.title}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header className="settings-panel__header">
            <h2 className="settings-panel__title">{zh.settings.title}</h2>
            <Button variant="ghost" size="sm" iconOnly aria-label={zh.settings.close} onClick={onClose}>
              <X size={16} aria-hidden />
            </Button>
          </header>

          <div className="settings-body">
            {/* 左侧分组导航：让用户一眼看到「一共有几组」，不必滚动确认。 */}
            <nav className="settings-nav" aria-label={zh.settings.navLabel}>
              {SECTION_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="settings-nav__item"
                  data-active={id === section || undefined}
                  aria-current={id === section ? "true" : undefined}
                  onClick={() => setSection(id)}
                >
                  {SECTION_LABEL[id]}
                </button>
              ))}
            </nav>

            <div className="settings-content">
              {/* ---- 外观 ---- */}
              {section === "appearance" && (
                <section className="settings-section" aria-labelledby="set-appearance">
                  <h3 className="settings-section__title" id="set-appearance">
                    {zh.settings.sections.appearance}
                  </h3>

                  <div className="settings-field">
                    <span className="settings-field__label">{zh.settings.appearance.theme}</span>
                    <p className="settings-field__description">
                      {zh.settings.appearance.themeHint}
                    </p>
                    <SegmentedControl
                      value={themePreference}
                      options={themeOptions}
                      onChange={onChangeTheme}
                      ariaLabel={zh.settings.appearance.theme}
                      showLabels
                    />
                  </div>
                </section>
              )}

              {/* ---- 编辑器 ---- */}
              {section === "editor" && (
                <section className="settings-section" aria-labelledby="set-editor">
                  <h3 className="settings-section__title" id="set-editor">
                    {zh.settings.sections.editor}
                  </h3>

                  <div className="settings-field">
                    <span className="settings-field__label">
                      <Type size={14} aria-hidden />
                      {zh.settings.editor.fontSize}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.editor.fontSizeHint}
                    </p>
                    <SegmentedControl
                      value={fontSize}
                      options={fontSizeOptions}
                      onChange={onChangeFontSize}
                      ariaLabel={zh.settings.editor.fontSize}
                      showLabels
                    />
                  </div>

                  <div className="settings-field">
                    <span className="settings-field__label">
                      <Type size={14} aria-hidden />
                      {zh.settings.editor.fontFamily}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.editor.fontFamilyHint}
                    </p>
                    <SegmentedControl
                      value={fontFamily}
                      options={fontFamilyOptions}
                      onChange={onChangeFontFamily}
                      ariaLabel={zh.settings.editor.fontFamily}
                      showLabels
                    />
                    {/* 用真实的字号 + 字体族渲染示例：两项目前互相影响，
                        分开看不出来它们合起来是什么效果。 */}
                    <p
                      className="settings-sample"
                      data-testid="font-sample"
                      style={{
                        fontSize: FONT_SIZE_PX[fontSize],
                        fontFamily: FONT_FAMILY_STACK[fontFamily],
                      }}
                    >
                      示例文本 Sample 123
                    </p>
                  </div>

                  <div className="settings-field">
                    <span className="settings-field__label">
                      <SquarePen size={14} aria-hidden />
                      {zh.settings.editor.viewMode}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.editor.viewModeHint}
                    </p>
                    <SegmentedControl
                      value={viewMode}
                      options={viewModeOptions}
                      onChange={onChangeViewMode}
                      ariaLabel={zh.settings.editor.viewMode}
                      showLabels
                    />
                  </div>
                </section>
              )}

              {/* ---- 文件与数据 ---- */}
              {section === "files" && (
                <section className="settings-section" aria-labelledby="set-files">
                  <h3 className="settings-section__title" id="set-files">
                    {zh.settings.sections.files}
                  </h3>

                  <div className="settings-field">
                    <span className="settings-field__label">
                      <HardDrive size={14} aria-hidden />
                      {zh.settings.storage.label}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.storage.description}
                    </p>

                    {/* 路径整行显示、末尾省略，靠 title 提供全文 ——
                        之前用 break-all 把路径在任意字符处折断，很难读。 */}
                    <div className="settings-path-row">
                      <code
                        className="settings-path"
                        data-testid="effective-workspace-root"
                        title={effectiveRoot}
                      >
                        {effectiveRoot || "…"}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        iconOnly
                        aria-label={zh.settings.storage.copyPath}
                        disabled={!effectiveRoot}
                        onClick={() => void copyPath(effectiveRoot)}
                      >
                        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                      </Button>
                    </div>

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
                          if (picked && picked !== effectiveRoot) setPending(picked);
                        }}
                      >
                        <FolderOpen size={14} aria-hidden />
                        <span>{zh.settings.storage.browse}</span>
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!effectiveRoot}
                        onClick={() => void openInFileManager(effectiveRoot)}
                      >
                        <HardDrive size={14} aria-hidden />
                        <span>{zh.settings.storage.open}</span>
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

                    <dl className="settings-meta">
                      {defaultRoot && (
                        <>
                          <dt>{zh.settings.storage.defaultHint}</dt>
                          <dd title={defaultRoot}>{defaultRoot}</dd>
                        </>
                      )}
                      {settings?.configPath && (
                        <>
                          <dt>{zh.settings.storage.configFile}</dt>
                          <dd title={settings.configPath}>{settings.configPath}</dd>
                        </>
                      )}
                    </dl>
                  </div>
                </section>
              )}

              {/* ---- 关于 ---- */}
              {section === "about" && (
                <section className="settings-section" aria-labelledby="set-about">
                  <h3 className="settings-section__title" id="set-about">
                    {zh.settings.sections.about}
                  </h3>

                  <div className="settings-field">
                    <span className="settings-field__label">
                      <Info size={14} aria-hidden />
                      {zh.app.name}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.about.description}
                    </p>
                    <dl className="settings-meta">
                      <dt>{zh.settings.about.versionLabel}</dt>
                      <dd data-testid="app-version">{__APP_VERSION__}</dd>
                      <dt>{zh.settings.about.dataFormat}</dt>
                      <dd>{zh.settings.about.dataFormatValue}</dd>
                    </dl>
                  </div>
                </section>
              )}
            </div>
          </div>
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
