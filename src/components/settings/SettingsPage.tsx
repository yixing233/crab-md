import { useEffect, useState } from "react";
import { Switch } from "antd";
import {
  ArrowUpDown,
  Check,
  Copy,
  Eye,
  FolderOpen,
  HardDrive,
  Moon,
  MoonStar,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  RotateCcw,
  Rows3,
  SquarePen,
  Sun,
  SunMoon,
  Type,
  X,
  ZoomIn,
  type LucideIcon,
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
  ACCENT_COLORS,
  ACCENT_PALETTES,
  DARK_STYLES,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_DARK_STYLE,
  DEFAULT_UI_DENSITY,
  DEFAULT_UI_ZOOM,
  UI_DENSITIES,
  UI_ZOOMS,
  type AccentColor,
  type DarkStyle,
  type UiDensity,
  type UiZoom,
} from "../../lib/appearancePrefs";
import {
  PREVIEW_ELEMENTS,
  type ElementTypography,
  type PreviewElementId,
  type PreviewTypography,
} from "../../lib/previewTypography";
import type { ViewMode } from "../../lib/viewMode";
import type { ThemePreference } from "../../lib/theme";
import { NAV_COLLAPSED_KEY, readStoredNavCollapsed } from "../../lib/settingsNav";
import { AUTOSAVE_MODES, type AutosaveMode } from "../../lib/editorSettings";
import type { RenderToggles } from "../../lib/renderToggles";
import { clearAllRecoveryDrafts, countRecoveryDrafts } from "../../lib/recovery";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { FontPicker, type FontPickerOption } from "../ui/FontPicker";
import { PreviewTypeRow } from "./PreviewTypeRow";
import { SegmentedControl, type SegmentedOption } from "../ui/SegmentedControl";
import "./settings.css";

/** 左侧分组。用稳定 id 而非索引，避免将来插入分组时页面错位。 */
export type SettingsSection = "appearance" | "editor" | "preview" | "files";

const SECTION_ORDER: readonly SettingsSection[] = [
  "appearance",
  "editor",
  "preview",
  "files",
] as const;

/** 各分组导航图标。与文字一起降低扫视成本（图标仅装饰，aria-hidden）。 */
const SECTION_ICON: Record<SettingsSection, LucideIcon> = {
  appearance: Palette,
  editor: PenLine,
  preview: Eye,
  files: HardDrive,
};

export interface SettingsPageProps {
  open: boolean;
  onClose: () => void;
  /** 成功反馈由外层统一出轻提示（UI §33）。 */
  onChanged: (message: string) => void;
  /** 主题偏好由 App 持有（工具栏主题按钮与这里改的是同一份状态）。 */
  themePreference: ThemePreference;
  onChangeTheme: (pref: ThemePreference) => void;
  accentColor?: AccentColor;
  onChangeAccentColor?: (color: AccentColor) => void;
  uiZoom?: UiZoom;
  onChangeUiZoom?: (zoom: UiZoom) => void;
  uiDensity?: UiDensity;
  onChangeUiDensity?: (density: UiDensity) => void;
  darkStyle?: DarkStyle;
  onChangeDarkStyle?: (style: DarkStyle) => void;
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
  /** 编辑器行为偏好（行号 / 自动换行 / 自动保存），状态由 App 持有（启动即生效）。 */
  lineNumbersOn: boolean;
  onChangeLineNumbers: (enabled: boolean) => void;
  lineWrapOn: boolean;
  onChangeLineWrap: (enabled: boolean) => void;
  autosaveMode: AutosaveMode;
  onChangeAutosaveMode: (mode: AutosaveMode) => void;
  /** 预览渲染开关（Mermaid / 公式），同样由 App 持有。 */
  renderToggles: RenderToggles;
  onChangeRenderToggles: (next: RenderToggles) => void;
}

/**
 * 设置页（UI_DESIGN_SYSTEM.md §34）。
 *
 * §34 要求按**用户心智模型**分组，而不是按实现模块 —— 因此分组是
 * 外观 / 编辑器 / 预览排版 / 文件与数据，而不是「数据库 / 路径 / 缓存」。
 *
 * 「关于」**不在这里**：它不是设置，而是应用信息 + 更新入口，
 * 已独立为 `AboutDialog`。塞进设置页意味着用户要先想到「设置」
 * 才能查自己的版本号。
 *
 * 布局用左侧分组导航 + 右侧内容，而不是把几组堆成一长列：
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
  accentColor = DEFAULT_ACCENT_COLOR,
  onChangeAccentColor,
  uiZoom = DEFAULT_UI_ZOOM,
  onChangeUiZoom,
  uiDensity = DEFAULT_UI_DENSITY,
  onChangeUiDensity,
  darkStyle = DEFAULT_DARK_STYLE,
  onChangeDarkStyle,
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
  lineNumbersOn,
  onChangeLineNumbers,
  lineWrapOn,
  onChangeLineWrap,
  autosaveMode,
  onChangeAutosaveMode,
  renderToggles,
  onChangeRenderToggles,
}: SettingsPageProps) {
  const settings = useWorkspaceStore((s) => s.settings);
  const loadSettings = useWorkspaceStore((s) => s.loadSettings);
  const setWorkspaceRoot = useWorkspaceStore((s) => s.setWorkspaceRoot);
  const resetWorkspaceRoot = useWorkspaceStore((s) => s.resetWorkspaceRoot);

  const [section, setSection] = useState<SettingsSection>("appearance");
  // 左侧导航折叠（仅显示图标）。初始值读 localStorage：纯展示偏好，
  // 与视图模式同款做法 —— 打开面板即生效，不必等挂载 effect。
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try {
      return readStoredNavCollapsed(localStorage.getItem(NAV_COLLAPSED_KEY));
    } catch {
      return false; // localStorage 不可用（隐私模式等）时保持默认展开。
    }
  });
  const [defaultRoot, setDefaultRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  // 待确认的目标目录；非空时弹出确认对话框。
  const [pending, setPending] = useState<string | null>(null);
  // 崩溃恢复草稿数量：打开设置页时清点，清理后刷新。
  const [draftCount, setDraftCount] = useState<number>(() => countRecoveryDrafts());

  // 打开时刷新草稿计数，避免显示过期数字。
  useEffect(() => {
    if (!open) return;
    setDraftCount(countRecoveryDrafts());
  }, [open]);

  // 打开时刷新，避免显示过期路径。
  useEffect(() => {
    if (!open) return;
    void loadSettings();
    void api
      .defaultWorkspaceRoot()
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

  /** 切换导航折叠并持久化；写入失败不影响本次切换（仅丢失记忆）。 */
  function toggleNavCollapsed() {
    setNavCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, String(next));
      } catch {
        // 隐私模式等场景 localStorage 只读：偏好丢就丢，功能不受影响。
      }
      return next;
    });
  }

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

  const zoomOptions: readonly SegmentedOption<UiZoom>[] = UI_ZOOMS.map((z) => ({
    value: z,
    label: zh.settings.appearance.zoomOption[z],
  }));

  const densityOptions: readonly SegmentedOption<UiDensity>[] = UI_DENSITIES.map((d) => ({
    value: d,
    label: zh.settings.appearance.densityOption[d],
  }));

  const darkStyleOptions: readonly SegmentedOption<DarkStyle>[] = DARK_STYLES.map((s) => ({
    value: s,
    label: zh.settings.appearance.darkStyleOption[s],
  }));

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

  const autosaveOptions: readonly SegmentedOption<AutosaveMode>[] = AUTOSAVE_MODES.map(
    (mode) => ({ value: mode, label: zh.settings.editor.autosaveOption[mode] }),
  );

  const SECTION_LABEL: Record<SettingsSection, string> = {
    appearance: zh.settings.sections.appearance,
    editor: zh.settings.sections.editor,
    preview: zh.settings.preview.label,
    files: zh.settings.sections.files,
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
            <nav
              className="settings-nav"
              data-collapsed={navCollapsed || undefined}
              aria-label={zh.settings.navLabel}
            >
              <div className="settings-nav__list">
                {SECTION_ORDER.map((id) => {
                  const SectionIcon = SECTION_ICON[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      className="settings-nav__item"
                      data-active={id === section || undefined}
                      aria-current={id === section ? "true" : undefined}
                      onClick={() => setSection(id)}
                      title={SECTION_LABEL[id]}
                    >
                      <span className="settings-nav__icon" aria-hidden>
                        <SectionIcon size={15} />
                      </span>
                      <span className={navCollapsed ? "settings-nav__label sr-only" : "settings-nav__label"}>
                        {SECTION_LABEL[id]}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 折叠开关：沉底到导航栏最底部 */}
              <button
                type="button"
                className="settings-nav__toggle"
                aria-label={
                  navCollapsed ? zh.settings.navCollapse.expand : zh.settings.navCollapse.collapse
                }
                aria-expanded={!navCollapsed}
                onClick={toggleNavCollapsed}
                title={navCollapsed ? zh.settings.navCollapse.expand : zh.settings.navCollapse.collapse}
              >
                <span className="settings-nav__icon" aria-hidden>
                  {navCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
                </span>
                <span className={navCollapsed ? "settings-nav__label sr-only" : "settings-nav__label"}>
                  {zh.settings.navCollapse.collapse}
                </span>
              </button>
            </nav>

            <div className="settings-content">
              {/* ---- 外观 ---- */}
              {section === "appearance" && (
                <section className="settings-section" aria-labelledby="set-appearance">
                  <h3 className="settings-section__title" id="set-appearance">
                    {zh.settings.sections.appearance}
                  </h3>

                  {/* 主题模式 */}
                  <div className="settings-field">
                    <span className="settings-field__label">
                      <SunMoon size={14} aria-hidden />
                      {zh.settings.appearance.theme}
                    </span>
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

                  {/* 主题强调色 */}
                  <div className="settings-field">
                    <span className="settings-field__label">
                      <Palette size={14} aria-hidden />
                      {zh.settings.appearance.accent}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.appearance.accentHint}
                    </p>
                    <div
                      className="settings-accent-picker"
                      role="radiogroup"
                      aria-label={zh.settings.appearance.accent}
                    >
                      {ACCENT_COLORS.map((color) => {
                        const active = color === accentColor;
                        const hex = ACCENT_PALETTES[color].previewHex;
                        return (
                          <button
                            key={color}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            aria-label={zh.settings.appearance.accentOption[color]}
                            className="settings-accent-button"
                            data-active={active || undefined}
                            onClick={() => onChangeAccentColor?.(color)}
                          >
                            <span className="settings-accent-swatch" style={{ backgroundColor: hex }} />
                            <span>{zh.settings.appearance.accentOption[color]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 界面缩放比例 */}
                  <div className="settings-field">
                    <span className="settings-field__label">
                      <ZoomIn size={14} aria-hidden />
                      {zh.settings.appearance.zoom}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.appearance.zoomHint}
                    </p>
                    <SegmentedControl
                      value={uiZoom}
                      options={zoomOptions}
                      onChange={(z) => onChangeUiZoom?.(z)}
                      ariaLabel={zh.settings.appearance.zoom}
                      showLabels
                    />
                  </div>

                  {/* 布局密度 */}
                  <div className="settings-field">
                    <span className="settings-field__label">
                      <Rows3 size={14} aria-hidden />
                      {zh.settings.appearance.density}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.appearance.densityHint}
                    </p>
                    <SegmentedControl
                      value={uiDensity}
                      options={densityOptions}
                      onChange={(d) => onChangeUiDensity?.(d)}
                      ariaLabel={zh.settings.appearance.density}
                      showLabels
                    />
                  </div>

                  {/* 深色背景风格 */}
                  <div className="settings-field">
                    <span className="settings-field__label">
                      <MoonStar size={14} aria-hidden />
                      {zh.settings.appearance.darkStyle}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.appearance.darkStyleHint}
                    </p>
                    <SegmentedControl
                      value={darkStyle}
                      options={darkStyleOptions}
                      onChange={(s) => onChangeDarkStyle?.(s)}
                      ariaLabel={zh.settings.appearance.darkStyle}
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
                      {zh.settings.editor.lineNumbers}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.editor.lineNumbersHint}
                    </p>
                    <SegmentedControl
                      value={lineNumbersOn ? "enabled" : "disabled"}
                      options={syncScrollOptions}
                      onChange={(val) => onChangeLineNumbers(val === "enabled")}
                      ariaLabel={zh.settings.editor.lineNumbers}
                      showLabels
                    />
                  </div>

                  <div className="settings-field">
                    <span className="settings-field__label">
                      <Type size={14} aria-hidden />
                      {zh.settings.editor.lineWrap}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.editor.lineWrapHint}
                    </p>
                    <SegmentedControl
                      value={lineWrapOn ? "enabled" : "disabled"}
                      options={syncScrollOptions}
                      onChange={(val) => onChangeLineWrap(val === "enabled")}
                      ariaLabel={zh.settings.editor.lineWrap}
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

                  <div className="settings-field">
                    <span className="settings-field__label">
                      <SquarePen size={14} aria-hidden />
                      {zh.settings.editor.autosave}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.editor.autosaveHint}
                    </p>
                    <SegmentedControl
                      value={autosaveMode}
                      options={autosaveOptions}
                      onChange={onChangeAutosaveMode}
                      ariaLabel={zh.settings.editor.autosave}
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
                  <p className="settings-section__desc">
                    {zh.settings.preview.description}
                  </p>

                  {/* 渲染开关：卡片化左右对齐布局（左文右关）。 */}
                  <div className="settings-field">
                    <span className="settings-field__label">
                      <Eye size={14} aria-hidden />
                      {zh.settings.preview.render}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.preview.renderHint}
                    </p>
                    <div className="settings-card-group">
                      <label className="settings-card-row">
                        <span className="settings-card-row__label">{zh.settings.preview.mermaid}</span>
                        <Switch
                          size="small"
                          checked={renderToggles.mermaid}
                          aria-label={zh.settings.preview.mermaid}
                          onChange={(checked) =>
                            onChangeRenderToggles({ ...renderToggles, mermaid: checked })
                          }
                        />
                      </label>
                      <label className="settings-card-row">
                        <span className="settings-card-row__label">{zh.settings.preview.math}</span>
                        <Switch
                          size="small"
                          checked={renderToggles.math}
                          aria-label={zh.settings.preview.math}
                          onChange={(checked) =>
                            onChangeRenderToggles({ ...renderToggles, math: checked })
                          }
                        />
                      </label>
                    </div>
                  </div>

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

                  {/* 崩溃恢复草稿：本地备份的占用情况与手动清理。
                      正常流程用不到它（保存成功自动删），这里是「我想现在就清掉」的出口。 */}
                  <div className="settings-field">
                    <span className="settings-field__label">
                      <RotateCcw size={14} aria-hidden />
                      {zh.settings.storage.recovery.label}
                    </span>
                    <p className="settings-field__description">
                      {zh.settings.storage.recovery.description}
                    </p>
                    <p className="settings-update-status" role="status">
                      {zh.settings.storage.recovery.count(draftCount)}
                    </p>
                    <div className="settings-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={draftCount === 0}
                        onClick={() => {
                          clearAllRecoveryDrafts();
                          setDraftCount(countRecoveryDrafts());
                          onChanged(zh.settings.storage.recovery.cleaned);
                        }}
                      >
                        <RotateCcw size={14} aria-hidden />
                        <span>{zh.settings.storage.recovery.clean}</span>
                      </Button>
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
    </>
  );
}
