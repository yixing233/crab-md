# Markdown Editor — UI Design System & Component Specification

> Version: 0.1  
> Status: Baseline specification  
> Audience: coding agents, UI agents, maintainers, reviewers  
> Platforms: Windows + Android  
> Visual direction: lightweight productivity tool; dense but calm; editor-first

---

## 1. Purpose

This document defines the UI system for the Markdown editor: design tokens, layout rules, responsive behavior, reusable components, editor-specific components, interaction states, keyboard/touch behavior, and implementation constraints.

The goal is not pixel-identical Windows and Android layouts. The goal is a shared visual language, shared component primitives, and platform-appropriate layouts.

This document is normative for UI implementation.

---

## 2. UI Principles

### 2.1 Editor-first

The document content is the primary focus.

Chrome, navigation, toolbars, and status UI SHOULD remain visually quiet and MUST NOT compete with the editor.

### 2.2 Shared language, adaptive layout

Windows and Android SHOULD share:

- tokens
- component styling
- icon language
- status meanings
- typography hierarchy
- interaction semantics

They MUST NOT be forced into the same page layout.

### 2.3 Low visual noise

Prefer:

- subtle borders
- minimal shadow
- restrained color
- clear text hierarchy
- consistent spacing
- icon-first utility actions

Avoid:

- decorative gradients
- excessive cards
- large marketing-style surfaces
- unnecessary elevation
- visually loud status indicators

### 2.4 Component discipline

Pages MUST use shared components from the design system where an appropriate component exists.

Pages MUST NOT create one-off button/input/dialog styles solely for local use.

### 2.5 Product language

The product targets Chinese-speaking users. All user-visible text MUST be Simplified Chinese.

This includes:

- buttons, menus, labels, placeholders, tooltips
- empty / loading / error states and status vocabulary
- dialog titles and confirmation copy
- accessible names (`aria-label`, `title`) that a screen reader would read aloud

The following MUST remain English because they are not user-facing copy:

- code identifiers, CSS class names, file names
- machine-readable error codes (see `ARCHITECTURE.md` §16.1)
- developer-facing logs and diagnostics
- syntax highlighting, and user document content

Copy SHOULD be centralized in `src/lib/i18n.ts` rather than hard-coded inside
feature components, so wording stays consistent and is reviewable in one place.

Agents MUST NOT add new English UI strings. When touching existing English copy,
convert it to Chinese in the same change.

---

## 3. Design Token System

All component styles MUST consume semantic tokens.

Hard-coded theme colors inside feature components are prohibited except for cases explicitly documented as data visualization or syntax highlighting.

Recommended token file layout:

```text
src/styles/
├── tokens.css
├── theme-light.css
├── theme-dark.css
└── globals.css
```

---

## 4. Color Tokens

Exact hexadecimal values MAY evolve during visual tuning, but semantic names MUST remain stable where possible.

### 4.0 Surface hierarchy

The interface follows a paper/chrome model:

```text
--bg-app        the "paper"  — editor and preview reading surface
--bg-surface    the "chrome" — toolbar, sidebar, outline, status bar
--bg-elevated   floating layers — dialogs, menus, toasts
```

Adjacent levels MUST differ enough to be perceived without relying on
borders alone (a luminance step of roughly 8/255 or more). A paper/chrome
pair that differs by only ~2% reads as one flat surface.

The direction inverts between themes:

- Light: paper is lighter than chrome (the paper floats on the chrome)
- Dark: nearer layers are lighter than farther ones

`--bg-elevated` is lighter than `--bg-surface` in both themes.

Structural separations (chrome ↔ content) SHOULD use `--border-default`;
internal dividers within a component SHOULD use `--border-subtle`.
Elevation shadows are limited to genuinely floating layers (`--shadow-sm/md/lg`).

Required semantic tokens:

```text
--bg-app
--bg-surface
--bg-surface-hover
--bg-surface-active
--bg-elevated

--border-subtle
--border-default
--border-strong
--border-focus

--text-primary
--text-secondary
--text-muted
--text-disabled
--text-inverse

--accent
--accent-hover
--accent-active
--accent-soft

--success
--success-soft
--warning
--warning-soft
--danger
--danger-soft
--info
--info-soft

--selection-bg
--selection-text

--shadow-sm
--shadow-md
--shadow-lg
```

### 4.1 Theme rules

The application MUST support:

- Light
- Dark
- Follow system

All major components MUST be visually tested in both light and dark themes.

Normal body text MUST maintain sufficient contrast against its background.

---

## 5. Spacing Scale

Use a 4px base grid.

Recommended scale:

```text
--space-0: 0
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-5: 20px
--space-6: 24px
--space-8: 32px
--space-10: 40px
--space-12: 48px
```

Agents SHOULD prefer token values instead of arbitrary spacing values.

Repeated use of custom values such as 13px, 19px, or 27px SHOULD be treated as a design smell unless technically necessary.

---

## 6. Radius Scale

Recommended:

```text
--radius-sm: 4px
--radius-md: 8px
--radius-lg: 12px
--radius-full: 999px
```

Usage:

- small controls: `sm`
- standard buttons/inputs/menus: `md`
- dialogs/sheets/large surfaces: `lg`
- pills/avatars: `full`

Avoid excessive rounding.

---

## 7. Typography

Default UI font SHOULD use the platform/system UI font stack.

Editor font SHOULD be independently configurable and SHOULD default to a high-quality monospace font available on the platform.

Recommended UI scale:

```text
--text-xs: 12px
--text-sm: 13px
--text-md: 14px
--text-lg: 16px
--text-xl: 20px
--text-2xl: 24px
```

Recommended line heights:

```text
xs/sm: 1.35–1.45
md/lg: 1.45–1.55
long-form Markdown preview: 1.6–1.75
```

Font weights SHOULD generally be limited to:

```text
400 regular
500 medium
600 semibold
```

Use 700 sparingly.

---

## 8. Iconography

Use one consistent icon library across the application.

Recommended direction: simple outline icons.

Rules:

- Do not mix unrelated icon families.
- Utility icons SHOULD use consistent stroke weight.
- Icons inside standard controls SHOULD generally be 16–20px.
- Icon-only controls MUST provide accessible labels/tooltips where applicable.

---

## 9. Motion

Motion SHOULD be subtle and functional.

Recommended durations:

```text
fast: 100–140ms
normal: 160–220ms
slow: 240–320ms
```

Use motion for:

- menu opening
- drawer/sheet transitions
- hover/pressed state interpolation
- pane resizing feedback

Do not animate routine editor text changes.

Respect reduced-motion preferences where feasible.

---

## 10. Responsive Breakpoints

Baseline layout classes:

```text
Mobile:  < 600px
Compact: 600px–899px
Desktop: >= 900px
```

These values are starting points and MAY be refined based on actual usability testing.

### 10.1 Mobile

Default to single primary pane.

Typical structure:

```text
┌────────────────────────────┐
│ ←  Document title      ⋮   │
├────────────────────────────┤
│                            │
│          Editor            │
│                            │
├────────────────────────────┤
│ Edit     Preview    Outline│
└────────────────────────────┘
```

### 10.2 Compact

May show two panes where space permits:

```text
Sidebar + Editor
```

or

```text
Editor + Preview
```

### 10.3 Desktop

May show three regions:

```text
Sidebar + Editor + Preview
```

Preview SHOULD be optional/collapsible.

---

## 11. Desktop Workspace Layout

Recommended baseline:

```text
┌────────────────────────────────────────────────────────────┐
│ App toolbar / title region                                 │
├──────────────┬──────────────────────────┬──────────────────┤
│ Sidebar      │ Editor                   │ Preview          │
│              │                          │                  │
│ file tree    │ CodeMirror               │ Markdown render  │
│ search       │                          │                  │
│ tags         │                          │                  │
├──────────────┴──────────────────────────┴──────────────────┤
│ Status bar                                                 │
└────────────────────────────────────────────────────────────┘
```

The editor pane MUST remain the dominant pane.

Pane resizing SHOULD be supported on desktop when practical.

### 11.1 View modes

Desktop SHOULD offer an explicit view mode switch rather than only a
show/hide toggle for one pane:

```text
edit      source editor only   — preview hidden
split     editor + preview     — the default baseline above
preview   rendered reading only — source editor hidden
```

The modes are mutually exclusive visible states, so they SHOULD be presented
as a segmented control (a radio group), not as independent toggles.

The chosen mode SHOULD persist across sessions.

Below the compact breakpoint the `split` mode MAY degrade to `edit`, but the
user MUST still be able to reach the preview by switching modes explicitly.

---

## 12. Mobile Workspace Layout

Recommended baseline:

```text
Top App Bar
Editor / Preview / Outline main region
Contextual formatting toolbar
Optional bottom navigation or segmented mode control
```

The application SHOULD avoid permanent sidebars on narrow phones.

Secondary areas SHOULD use:

- drawer
- bottom sheet
- full-screen subpage

rather than compressing the editor.

---

## 13. Core UI Components

The base component set SHOULD include at least:

```text
Button
IconButton
Input
TextArea
Select
Checkbox
Switch
Tabs
Tooltip
DropdownMenu
ContextMenu
Dialog
Drawer
BottomSheet
Toast
Badge
Divider
Avatar
Spinner
Progress
EmptyState
```

Agents SHOULD extend this list only when a reusable interaction pattern genuinely exists.

---

## 14. Button Specification

### 14.1 Variants

```text
primary
secondary
ghost
danger
```

### 14.2 Sizes

```text
sm
md
lg
```

### 14.3 States

Every button MUST support:

```text
default
hover   (desktop pointer)
pressed
focus-visible
disabled
loading
```

### 14.4 Rules

- Primary actions SHOULD be limited in count per surface.
- Destructive actions MUST use danger semantics and SHOULD request confirmation when data loss is significant.
- Loading buttons SHOULD prevent duplicate submission.
- Icon-only buttons MUST have accessible names.

---

## 15. Input Specification

Inputs MUST support:

```text
default
hover
focus
invalid
disabled
read-only
```

Inputs SHOULD provide:

- label
- optional helper text
- error message

Placeholder text MUST NOT be the only label for essential fields.

---

## 16. Dialog / Sheet Rules

Use a `Dialog` for desktop/modal confirmation and focused tasks.

Use `BottomSheet` or full-screen mobile surface for actions that would be cramped in a small dialog.

Dialogs MUST have:

- clear title
- close behavior
- keyboard escape handling on desktop
- focus trapping where appropriate
- explicit primary action when action is required

Destructive confirmations SHOULD name the affected object.

---

## 17. Navigation Components

Required navigation-level components:

```text
AppToolbar
Sidebar
FileTree
Breadcrumb
DocumentTabs
CommandPalette
MobileDrawer
```

Not all components are visible on all platforms.

---

## 18. FileTree Specification

`FileTree` is a first-class product component.

Each item MAY represent:

- folder
- Markdown document

Required states:

```text
default
hover
selected
focused
renaming
dragging
drop-target
unsynced
conflict
```

### 18.1 Status display

Normal synced state SHOULD be visually quiet.

Only exceptional states SHOULD persistently show indicators:

```text
unsynced / pending
sync error
conflict
```

Avoid status icon clutter for every normal file.

### 18.2 Rename

Inline rename SHOULD:

- focus the text field automatically
- confirm with Enter
- cancel with Escape on desktop
- preserve document ID

### 18.3 Drag/drop

Desktop MAY support drag/drop reordering or moving.

Mobile drag/drop is optional and SHOULD NOT be required for core file organization.

---

## 19. Markdown Editor Components

The editor feature SHOULD be decomposed into reusable product components:

```text
MarkdownEditor
EditorToolbar
EditorStatusBar
MarkdownPreview
OutlineTree
FindPanel
DocumentTabs
Breadcrumb
SyncIndicator
ConflictDialog
```

---

## 20. MarkdownEditor Rules

The editor is based on CodeMirror 6.

It SHOULD support:

- Markdown syntax highlighting
- line/selection operations
- undo/redo
- search/replace
- bracket matching where useful
- code block highlighting
- keyboard shortcuts
- theme integration

The editor MUST use application theme tokens or mapped editor theme tokens.

The editor MUST NOT use a visual theme that feels unrelated to the rest of the application.

---

## 21. EditorToolbar

### 21.1 Desktop

Desktop MAY show a compact persistent formatting toolbar.

Recommended actions:

```text
Bold
Italic
Strikethrough
Heading
Bullet list
Numbered list
Quote
Link
Image
Inline code
Code block
```

Do not show rarely used formatting actions if they create excessive clutter.

### 21.2 Mobile

Mobile SHOULD show a reduced contextual toolbar, for example:

```text
B   I   H   Link   More
```

Additional actions SHOULD be placed under `More` / bottom sheet.

Touch targets MUST remain large enough for reliable tapping.

---

## 22. MarkdownPreview

Preview SHOULD visually resemble a clean reading surface, not a webpage inside the application.

Rules:

- content width SHOULD be capped for readability on large screens
- heading spacing MUST be consistent
- tables SHOULD scroll horizontally on narrow screens if needed
- code blocks SHOULD support horizontal scrolling rather than breaking layout
- images SHOULD fit within content bounds
- links MUST have recognizable styling
- rendered raw HTML MUST be sanitized
- a single line break in the source SHOULD render as a line break, so the preview
  matches what the editor shows. This deliberately departs from strict CommonMark
  soft-break handling. It affects rendering only — the stored file keeps its
  original newlines, so standard Markdown fidelity is preserved.

---

## 23. OutlineTree

Outline is derived from Markdown headings.

It SHOULD:

- reflect heading hierarchy
- scroll/jump to heading
- highlight current section where practical
- collapse on mobile into a drawer/sheet or dedicated mode

Outline MUST NOT replace the file tree; they are different concepts.

---

## 24. Search UI

Two search modes are recommended:

```text
Current document search
Global workspace search
```

Desktop shortcut baseline:

```text
Ctrl+F        current document
Ctrl+Shift+F  workspace search
```

Search results SHOULD display:

- document title
- path/folder context
- matching excerpt

Global search SHOULD use local indexes first.

---

## 25. Command Palette

Desktop SHOULD support a command palette.

Suggested shortcut:

```text
Ctrl+Shift+P
```

Typical commands:

```text
New document
New folder
Quick open
Toggle preview
Toggle sidebar
Change theme
Open settings
Sync now
Export
```

The command palette SHOULD be keyboard-first.

Mobile MAY omit it.

---

## 26. SyncIndicator

Sync status vocabulary MUST be consistent across the product.

Allowed user-facing states:

```text
Saved
Syncing
Offline
Sync failed
Conflict
```

Avoid exposing implementation details such as:

```text
revision 182
hash abc123
queue length 4
```

outside diagnostics/debug UI.

### 26.1 Desktop placement

Recommended in status bar or toolbar.

### 26.2 Mobile placement

Recommended as a small icon/status in the top app bar.

Normal successful sync state SHOULD be subtle.

Errors/conflicts MAY use stronger visual emphasis.

---

## 27. ConflictDialog

Conflict UI MUST preserve user agency.

It SHOULD offer:

```text
View local
View remote
View diff
Keep local
Keep remote
Keep both
```

The default presentation MUST NOT imply that either version is automatically more correct.

Destructive replacement actions SHOULD clearly state which content will be replaced.

---

## 28. Status Bar

Desktop MAY include a status bar with concise contextual information.

Example:

```text
Ln 12, Col 8      Markdown      UTF-8      Synced
```

Do not overload it with rarely useful technical data.

Mobile SHOULD generally omit a permanent status bar.

---

## 29. Keyboard Interaction Baseline

Windows desktop SHOULD support:

```text
Ctrl+N        New document
Ctrl+S        Save / flush local save
Ctrl+P        Quick open
Ctrl+F        Find in document
Ctrl+Shift+F  Global search
Ctrl+B        Bold
Ctrl+I        Italic
Ctrl+`        Inline code
Ctrl+\        Cycle view mode (edit / split / preview) — see §11.1
Ctrl+,        Settings
Ctrl+Shift+P  Command palette
```

Agents MUST avoid overriding platform-standard shortcuts without strong reason.

Shortcut handling SHOULD be centralized rather than scattered across pages.

---

## 30. Android Back Behavior

Android back navigation MUST be deterministic.

Recommended dismissal priority:

```text
Dialog
→ BottomSheet
→ Drawer
→ transient preview/submode
→ nested page
→ workspace/document list
→ system exit/background behavior
```

Back MUST NOT unexpectedly discard unsaved local edits.

---

## 31. Touch Targets

Mobile interactive targets SHOULD generally be at least approximately 44–48 logical pixels in effective tap area.

Visual icons MAY be smaller, but their hit area SHOULD remain touch-friendly.

Do not pack desktop-density icon buttons directly onto mobile without increasing hit areas.

---

## 32. Empty, Loading, Error States

Every major data surface SHOULD define:

- initial loading state
- empty state
- recoverable error state
- offline state where relevant

Examples:

File tree empty:

```text
No notes yet
Create your first Markdown document.
[New note]
```

Sync error:

```text
Sync failed
Your changes are saved on this device.
[Retry]
```

Error copy SHOULD explain whether local data is safe when relevant.

---

## 33. Toast Rules

Toasts SHOULD be reserved for lightweight confirmation or non-blocking errors.

Good uses:

```text
Copied link
Export complete
Sync restored
```

Bad uses:

- critical data-loss warnings
- conflict resolution
- actions requiring user choice

Those require persistent UI/dialogs.

---

## 34. Settings UI

Settings SHOULD be grouped by user mental model, not implementation module.

Suggested sections:

```text
Appearance
Editor
Files & Sync
Account & Devices
About
```

Do not expose internal database or API configuration in normal settings unless there is a real user need.

### 34.1 Data directory

The local data directory MUST be viewable and changeable from settings.

Rules:

- Show the **currently effective** directory, not merely the configured value.
- Changing it MUST be confirmed first, and the confirmation MUST state that
  content in the previous directory is **not deleted** and can be switched back to.
- If the directory is overridden by an environment variable, settings MUST say so
  and MUST NOT pretend the change took effect.
- A failed switch MUST leave the current directory fully usable.
- The settings file MUST NOT live inside the data directory it configures;
  it belongs in the platform application-config directory.

---

## 35. Login UI

Login is intentionally simple for v1.

Required fields:

```text
Username
Password
```

Optional:

```text
Remember this device
Server URL (only if the deployment model requires user-configurable server endpoints)
```

Login errors MUST distinguish invalid credentials from connectivity errors when possible.

---

## 36. Component Source Structure

Recommended structure:

```text
src/components/
├── ui/
│   ├── Button.tsx
│   ├── IconButton.tsx
│   ├── Input.tsx
│   ├── Dialog.tsx
│   ├── DropdownMenu.tsx
│   ├── Tooltip.tsx
│   └── ...
├── editor/
│   ├── MarkdownEditor.tsx
│   ├── EditorToolbar.tsx
│   ├── MarkdownPreview.tsx
│   ├── OutlineTree.tsx
│   └── ...
└── workspace/
    ├── Sidebar.tsx
    ├── FileTree.tsx
    ├── Breadcrumb.tsx
    ├── SyncIndicator.tsx
    └── ...
```

Pages/features SHOULD compose these components rather than reimplementing their styling.

---

## 37. Component API Guidance

Reusable components SHOULD expose semantic props rather than raw style knobs.

Prefer:

```tsx
<Button variant="danger" size="md" loading={saving} />
```

instead of:

```tsx
<Button red borderWidth={1} height={36} radius={7} />
```

The design system SHOULD control visuals centrally.

Feature code SHOULD control behavior/content.

---

## 38. State Ownership Guidance

UI components SHOULD be divided into:

- presentational primitives
- feature components with explicit state boundaries

Do not store application-wide document/sync state inside low-level UI primitives.

Example:

`Button` MUST NOT know about synchronization.

`SyncIndicator` MAY consume sync feature state.

---

## 39. Accessibility Baseline

Desktop and mobile components SHOULD support accessibility semantics.

Required considerations:

- keyboard navigation on Windows
- visible focus state
- semantic labels for icon-only controls
- adequate text/background contrast
- non-color-only error/status communication
- screen-reader labels where practical

Focus-visible rings MUST NOT be removed without replacement.

---

## 40. Content Density

Desktop SHOULD use moderately dense productivity-app spacing.

Mobile SHOULD increase touch spacing without making the interface visually oversized.

The design SHOULD feel closer to a serious editor/knowledge tool than a consumer social app.

---

## 41. Visual Direction

Target feel:

```text
Linear / VS Code / Obsidian / Notion-adjacent
```

This is a directional reference only, not a requirement to copy any specific product.

Preferred traits:

- low saturation
- subtle borders
- minimal shadow
- 6–8px dominant control radius
- high information clarity
- calm surfaces
- strong editor focus

Avoid cloning platform-specific Material or Fluent visual language so strongly that the other platform feels inconsistent.

---

## 42. Agent UI Implementation Rules

Coding/UI agents MUST follow these rules unless a task explicitly overrides them:

1. Use semantic design tokens; do not hard-code theme colors in feature components.
2. Reuse shared components before creating new primitives.
3. Keep Windows and Android visually related but layout-adaptive.
4. Keep the editor as the visually dominant surface.
5. Do not show low-level sync metadata in normal UI.
6. Do not indicate normal sync success with excessive persistent icons.
7. Preserve keyboard accessibility on desktop.
8. Preserve touch target size on Android.
9. Do not use a modal dialog where a mobile bottom sheet or page is more usable.
10. Do not silently discard unsaved content during navigation.
11. Keep component APIs semantic, not styling-parameter-heavy.
12. Test every major component in light and dark themes.
13. Add explicit empty/loading/error states for new major surfaces.
14. Follow `ARCHITECTURE.md` for sync/auth/data behavior.
15. Write all user-visible copy in Simplified Chinese, taken from `src/lib/i18n.ts` rather than hard-coded in components (see §2.5).

---

## 43. Recommended Component Delivery Order

### Phase 1 — tokens and primitives

- themes
- spacing/type/radius tokens
- Button
- IconButton
- Input
- Tooltip
- Dialog
- DropdownMenu
- Tabs
- Toast

### Phase 2 — workspace shell

- AppToolbar
- Sidebar
- FileTree
- Breadcrumb
- desktop panes
- mobile drawer

### Phase 3 — editor system

- MarkdownEditor
- EditorToolbar
- MarkdownPreview
- OutlineTree
- StatusBar

### Phase 4 — product states

- SyncIndicator
- ConflictDialog
- EmptyState
- global Search UI
- CommandPalette

### Phase 5 — settings/account

- Login
- Settings
- Account/Devices

---

## 44. UI Acceptance Criteria

A UI implementation satisfies the baseline when:

- Windows and Android clearly belong to the same product family.
- Desktop can support sidebar + editor + optional preview.
- Phone layout keeps the editor usable without permanent side panes.
- All reusable controls support light and dark themes.
- Core controls use shared token values.
- Keyboard focus is visible on Windows.
- Mobile touch controls are reliably tappable.
- File tree communicates selected/unsynced/conflict states.
- Sync status uses the defined vocabulary.
- Normal successful sync is visually quiet.
- Conflict resolution never silently chooses a winner.
- Major empty/loading/error states exist.
- Feature pages do not contain duplicated one-off button/input/dialog styling.

---

## 45. Change Policy

Changes to the following MUST update this document in the same change:

- token naming model
- responsive breakpoint model
- core shared component APIs
- sync status vocabulary
- conflict interaction model
- desktop/mobile workspace structure
- theme support requirements

