import { useEffect, useState } from "react";
import {
  ArrowUpDown,
  Check,
  Copy,
  Download,
  FolderOpen,
  HardDrive,
  Info,
  Moon,
  RefreshCw,
  RotateCcw,
  SquarePen,
  Sun,
  SunMoon,
  Type,
  X,
} from "lucide-react";
import { useWorkspaceStore } from "../../stores/useWorkspaceStore";
import { zh } from "../../lib/i18n";
import { api } from "../../lib/api";
import {
  composeFontStack,
  EDITOR_CJK_FONTS,
  EDITOR_FONT_SIZES,
  EDITOR_LATIN_FONTS,
  FONT_SIZE_PX,
  previewStack,
  type EditorCjkFont,
  type EditorFontSize,
  type EditorLatinFont,
} from "../../lib/editorPrefs";
import {
  PREVIEW_ELEMENTS,
  type ElementTypography,
  type PreviewElementId,
  type PreviewTypography,
} from "../../lib/previewTypography";
import type { ViewMode } from "../../lib/viewMode";
import type { ThemePreference } from "../../lib/theme";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FontPicker, type FontPickerOption } from "../ui/FontPicker";
import { PreviewTypeRow } from "./PreviewTypeRow";
import { SegmentedControl, type SegmentedOption } from "../ui/SegmentedControl";
import {
  type UpdateStatus,
} from "../../lib/updater";
import { useUpdateStore } from "../../stores/useUpdateStore";
import "./settings.css";

/** 把更新状态翻成一句给用户看的话。 */
function updateMessage(status: UpdateStatus): string {
  switch (status.kind) {
    case "idle":
      return "";
    case "checking":
      return zh.settings.update.checking;
    case "up-to-date":
      return zh.settings.update.upToDate;
    case "available":
      return zh.settings.update.available(status.version);
    case "downloading":
      return status.total === null
        ? zh.settings.update.downloadingUnknown
        : zh.settings.update.downloading(Math.round((status.downloaded / status.total) * 100));
    case "ready":
      return zh.settings.update.restarting;
    case "error":
      return zh.settings.update.failed;
  }
}

/** 左侧分组。用稳定 id 而非索引，避免将来插入分组时页面错位。 */
export type SettingsSection = "appearance" | "editor" | "preview" | "files" | "about";

const SECTION_ORDER: readonly SettingsSection[] = [
  "appearance",
  "editor",
  "preview",
  "files",
  "about",
] as const;

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
  /** 同步滚动开关。 */
  syncScroll: boolean;
  onChangeSyncScroll: (enabled: boolean) => void;
  /**
   * 编辑器字号由 App 持有，不在这里自持状态。
   * 若设置页自己 useState + useEffect 应用，字号就只在「打开过设置页」
   * 之后才生效，重启应用即回到默认 —— 那是错的。
   */
  fontSize: EditorFontSize;
  onChangeFontSize: (size: EditorFontSize) => void;
  /** 字体（西文 / 中文各一项）同样由 App 持有（启动即生效，理由同字号）。 */
  latinFont: EditorLatinFont;
  onChangeLatinFont: (font: EditorLatinFont) => void;
  cjkFont: EditorCjkFont;
  onChangeCjkFont: (font: EditorCjkFont) => void;
  /**
   * 预览排版：按元素分别设置字体与字号（只影响阅读面）。
   *
   * 与编辑区那套是**两套独立设置**：编辑区是书写面，通篇一种字体最省心；
   * 预览是阅读面，标题/代码/公式各按各的才符合阅读习惯。
   */
  previewTypography: PreviewTypography;
  onChangePreviewElement: (element: PreviewElementId, next: ElementTypography) => void;
  onResetPreviewTypography: () => void;
  /**
   * 打开时要落到哪个分组（如工具栏的更新入口直达「关于」）。
   * null 表示保持上次/默认分组。
   */
  initialSection?: SettingsSection | null;
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
  syncScroll,
  onChangeSyncScroll,
  fontSize,
  onChangeFontSize,
  latinFont,
  onChangeLatinFont,
  cjkFont,
  onChangeCjkFont,
  previewTypography,
  onChangePreviewElement,
  onResetPreviewTypography,
  initialSection = null,
}: SettingsPageProps) {
  const settings = useWorkspaceStore((s) => s.settings);
  const loadSettings = useWorkspaceStore((s) => s.loadSettings);
  const setWorkspaceRoot = useWorkspaceStore((s) => s.setWorkspaceRoot);
  const resetWorkspaceRoot = useWorkspaceStore((s) => s.resetWorkspaceRoot);
  const flushActive = useWorkspaceStore((s) => s.flushActive);

  // 更新状态来自共享 store：工具栏徽标、提示条、这里三处必须是同一份，
  // 各自 useState 会互相看不见（字号曾犯过同类错）。
  const update = useUpdateStore((s) => s.status);
  const check = useUpdateStore((s) => s.check);
  const install = useUpdateStore((s) => s.install);

  const [section, setSection] = useState<SettingsSection>("appearance");
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // 待确认的目标目录；非空时弹出确认对话框。
  const [pending, setPending] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<string | null>(null);
  // 「关于」页的版本：由后端给出（与更新器比较的版本同源）。
  // 初始值用构建期常量，避免 IPC 回来前显示空白。
  const [version, setVersion] = useState<string>(__APP_VERSION__);

  // 外部指定分组（如点工具栏的更新入口）时切换过去。
  useEffect(() => {
    if (open && initialSection) setSection(initialSection);
  }, [open, initialSection]);

  // 打开时刷新，避免显示过期路径。
  useEffect(() => {
    if (!open) return;
    void loadSettings();
    void api
      .defaultWorkspaceRoot()
      .then(setDefaultRoot)
      .catch(() => setDefaultRoot(null));
    // 版本以后端为准；取不到就退回构建期常量（不影响其它功能）。
    void api
      .appVersion()
      .then(setVersion)
      .catch(() => {});
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

  /** 用户主动检查更新：失败要给出原因（与后台静默检查不同）。 */
  const handleCheckUpdate = () => void check();

  /**
   * 安装更新。**顺序不可颠倒**：
   * 1) 先把未保存内容落盘 —— 安装会关掉应用，不落盘等于丢数据；
   * 2) 落盘失败就中止，绝不在有未保存内容时关应用；
   * 3) 安装成功后再重启。
   *
   * 顺序由 store 的 install() 保证；这里只负责提供落盘回调。
   */
  const handleInstall = () => {
    setPendingInstall(null);
    void install(async () => {
      const saved = await flushActive();
      if (!saved) onChanged(zh.toast.saveFailed);
      return saved;
    });
  };

  const lockedByEnv = settings?.workspaceRootIsFromEnv === true;
  const effectiveRoot = settings?.effectiveWorkspaceRoot ?? "";

  const themeOptions: readonly SegmentedOption<ThemePreference>[] = [
    { value: "light", label: zh.settings.appearance.themeOption.light, icon: Sun },
    { value: "dark", label: zh.settings.appearance.themeOption.dark, icon: Moon },
    { value: "system", label: zh.settings.appearance.themeOption.system, icon: SunMoon },
  ];

  const fontSizeOptions: readonly SegmentedOption<EditorFontSize>[] = EDITOR_FONT_SIZES.map(
    (size) => ({
      value: size,
      label: `${zh.settings.editor.fontSizeOption[size]} ${FONT_SIZE_PX[size]}`,
    }),
  );

  /**
   * 两个字体列表。**每个选项用它自己的字体渲染名字**（§34.6）。
   *
   * 注意预览栈与最终生效栈不同：标签文字是中文（「宋体」「黑体」），
   * 若用合成栈，最前面的西文（尤其 `system-ui`，自带汉字字形）会把中文
   * 吃掉，六个选项看起来一模一样。故预览时让该选项自己的字形排第一。
   */
  const latinFontOptions: readonly FontPickerOption<EditorLatinFont>[] =
    EDITOR_LATIN_FONTS.map((font) => ({
      value: font,
      label: zh.settings.editor.latinFontOption[font],
      stack: previewStack(font, cjkFont, "latin"),
    }));

  const cjkFontOptions: readonly FontPickerOption<EditorCjkFont>[] = EDITOR_CJK_FONTS.map(
    (font) => ({
      value: font,
      label: zh.settings.editor.cjkFontOption[font],
      stack: previewStack(latinFont, font, "cjk"),
    }),
  );

  const viewModeOptions: readonly SegmentedOption<ViewMode>[] = (
    ["edit", "split", "preview"] as const
  ).map((mode) => ({ value: mode, label: zh.settings.editor.viewModeOption[mode] }));

  const syncScrollOptions: readonly SegmentedOption<"enabled" | "disabled">[] = [
    { value: "enabled", label: zh.settings.editor.syncScrollOption.enabled },
    { value: "disabled", label: zh.settings.editor.syncScrollOption.disabled },
  ];

  const SECTION_LABEL: Record<SettingsSection, string> = {
    appearance: zh.settings.sections.appearance,
    editor: zh.settings.sections.editor,
    preview: zh.settings.preview.label,
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
              {SECTION_ORDER.map((id) => (                <button
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
                      {zh.settings.editor.cjkFont}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.editor.cjkFontHint}
                    </p>
                    <FontPicker
                      value={cjkFont}
                      options={cjkFontOptions}
                      onChange={onChangeCjkFont}
                      ariaLabel={zh.settings.editor.cjkFont}
                    />
                  </div>

                  <div className="settings-field">
                    <span className="settings-field__label">
                      <Type size={14} aria-hidden />
                      {zh.settings.editor.latinFont}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.editor.latinFontHint}
                    </p>
                    <FontPicker
                      value={latinFont}
                      options={latinFontOptions}
                      onChange={onChangeLatinFont}
                      ariaLabel={zh.settings.editor.latinFont}
                    />
                    {/* 用真实的字号 + 两个字体渲染示例：三项目前互相影响，
                        分开看不出来它们合起来是什么效果。 */}
                    <p
                      className="settings-sample"
                      data-testid="font-sample"
                      style={{
                        fontSize: FONT_SIZE_PX[fontSize],
                        fontFamily: composeFontStack(latinFont, cjkFont),
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

                  <div className="settings-field">
                    <span className="settings-field__label">
                      <ArrowUpDown size={14} aria-hidden />
                      {zh.settings.editor.syncScroll}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.editor.syncScrollHint}
                    </p>
                    <SegmentedControl
                      value={syncScroll ? "enabled" : "disabled"}
                      options={syncScrollOptions}
                      onChange={(val) => onChangeSyncScroll(val === "enabled")}
                      ariaLabel={zh.settings.editor.syncScroll}
                      showLabels
                    />
                  </div>
                </section>
              )}

              {/* ---- 预览排版 ---- */}
              {section === "preview" && (
                <section className="settings-section" aria-labelledby="set-preview">
                  <h3 className="settings-section__title" id="set-preview">
                    {zh.settings.preview.label}
                  </h3>
                  <p className="settings-field__description">
                    {zh.settings.preview.description}
                  </p>

                  {/* 西文是**全局一项**：拉丁字符的差异通常只需要
                      「衬线/无衬线」一次决定，逐元素重复设置没有意义。 */}
                  <div className="settings-field">
                    <span className="settings-field__label">
                      <Type size={14} aria-hidden />
                      {zh.settings.preview.latinLabel}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.preview.latinHint}
                    </p>
                    <FontPicker
                      value={latinFont}
                      options={latinFontOptions}
                      onChange={onChangeLatinFont}
                      ariaLabel={zh.settings.preview.latinLabel}
                    />
                  </div>

                  <div className="settings-field">
                    <span className="settings-field__label">
                      <Type size={14} aria-hidden />
                      {zh.settings.preview.elementsLabel}
                    </span>
                    <div className="preview-type-list">
                      {PREVIEW_ELEMENTS.map((element) => (
                        <PreviewTypeRow
                          key={element}
                          element={element}
                          value={previewTypography[element]}
                          latinFont={latinFont}
                          onChange={(next) => onChangePreviewElement(element, next)}
                        />
                      ))}
                    </div>

                    <Button variant="secondary" size="sm" onClick={onResetPreviewTypography}>
                      <RotateCcw size={13} aria-hidden />
                      {zh.settings.preview.reset}
                    </Button>
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
                      <dd data-testid="app-version">{version}</dd>
                      <dt>{zh.settings.about.dataFormat}</dt>
                      <dd>{zh.settings.about.dataFormatValue}</dd>
                    </dl>
                  </div>

                  {/* ---- 软件更新 ---- */}
                  <div className="settings-field">
                    <span className="settings-field__label">
                      <Download size={14} aria-hidden />
                      {zh.settings.update.label}
                    </span>
                    <p className="settings-field__description">{zh.settings.update.hint}</p>

                    {/* 状态一行：空 / 检查中 / 最新 / 有新版 / 下载中 / 失败。 */}
                    <p className="settings-update-status" role="status" data-testid="update-status">
                      {updateMessage(update)}
                    </p>

                    {update.kind === "error" && (
                      <p className="settings-note settings-note--warn">
                        {update.fatal
                          ? zh.settings.update.installFailedHint
                          : zh.settings.update.failedHint}
                      </p>
                    )}

                    {/* 下载中的进度条：有总量才显示百分比，否则只显示忙态，
                        不假装知道进度。 */}
                    {update.kind === "downloading" && update.total !== null && (
                      <progress
                        className="settings-progress"
                        value={update.downloaded}
                        max={update.total}
                        aria-label={zh.settings.update.label}
                      />
                    )}

                    <div className="settings-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={update.kind === "checking" || update.kind === "downloading"}
                        onClick={() => void handleCheckUpdate()}
                      >
                        <RefreshCw size={14} aria-hidden />
                        <span>
                          {update.kind === "checking"
                            ? zh.settings.update.checking
                            : zh.settings.update.check}
                        </span>
                      </Button>

                      {update.kind === "available" && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            // 安装会关闭应用：先确认，再落盘，最后才安装。
                            // 顺序反了就会丢掉用户正在写的内容。
                            setPendingInstall(update.version);
                          }}
                        >
                          <Download size={14} aria-hidden />
                          <span>{zh.settings.update.install}</span>
                        </Button>
                      )}
                    </div>
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

      {/* 安装更新前确认：会关闭并重启应用，必须先说清。
          文案同时说明「未保存内容会先自动保存」，避免用户不敢点。 */}
      <Dialog
        open={pendingInstall !== null}
        title={zh.settings.update.confirmTitle}
        confirmLabel={zh.settings.update.confirmOk}
        cancelLabel={zh.settings.update.cancel}
        onCancel={() => setPendingInstall(null)}
        onConfirm={() => void handleInstall()}
      >
        {pendingInstall ? zh.settings.update.confirmBody(pendingInstall) : null}
      </Dialog>
    </>
  );
}
