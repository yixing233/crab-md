# Unified Disk-File Editor & Metadata Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the artificial split between "internal workspace documents" and "external files", unifying the product architecture into a pure local-first Markdown editor & reader where all files live directly on the user's disk file system and SQLite acts strictly as an index, metadata registry, and session state cache.

**Architecture:** 
- The backend replaces the dual `documents` (UUID-based vault notes) and `external_files` tables with a single, unified `opened_files` table plus an FTS5 full-text search index table `files_fts`.
- Creating a new document produces an in-memory draft; saving it prompts for a disk location (or uses a default directory), writing directly to a normal `.md` file on the filesystem and indexing its metadata into SQLite.
- The frontend unifies `Sidebar`, `TabBar`, and `useWorkspaceStore`: no more "文件" vs "外部文件" tabs; tabs represent either a real disk path or an in-memory draft; the sidebar presents a unified recent document history and folder index.

**Tech Stack:** Tauri 2 (Rust, `rusqlite`, `fts5`), React 19, TypeScript, Ant Design 6 (for adapted UI controls), Zustand, Vitest.

---

## File Structure & Map of Changes

### Backend (Rust & SQLite)
- `src-tauri/src/db/mod.rs`: Add schema migration v3 defining unified `opened_files` and `files_fts` tables.
- `src-tauri/src/db/opened_files.rs` (new): DAO for file metadata upsert, touch, list by recent, search, and session state.
- `src-tauri/src/model.rs`: Unified `FileRecord`, `FileSummary`, and `FileSessionState` structs.
- `src-tauri/src/commands/documents.rs`: Refactor commands: `open_file`, `save_file`, `create_file_at`, `list_recent_files`, `remove_from_history`, `delete_file_on_disk`, `search_files`, `update_file_session`.
- `src-tauri/src/lib.rs`: Expose updated Tauri invoke handlers.

### Frontend (TypeScript, Store, UI)
- `src/types/document.ts`: Replace separate `DocumentSummary`/`ExternalFileView` with unified `FileRecord` and `DraftDocument`.
- `src/lib/api.ts`: Update API client to invoke unified Tauri commands.
- `src/stores/useWorkspaceStore.ts`: Replace `documents` and `externalFiles` states with unified `recentFiles` and active draft state.
- `src/components/workspace/Sidebar.tsx`: Remove "external" tab; provide unified "文档" (Recent files / File list) and "大纲" (Outline).
- `src/components/workspace/RecentFileList.tsx` (new, replaces `ExternalFileList.tsx` and vault-centric `FileTree.tsx`): Unified file list with pinned status, last opened timestamp, rename, and remove actions.
- `src/components/workspace/TabBar.tsx`: Unify tab IDs into `path` (for saved files) and `draft:${id}` (for new drafts).
- `src/components/home/HomePage.tsx`: Search and display the unified recent files list.
- `src/components/workspace/CloseDocumentModal.tsx`: Handle in-memory draft save-as vs existing file save.
- `src/App.tsx`: Coordinate draft creation, disk file opening, unified saving, and session state saving.
- `ARCHITECTURE.md`: Update architecture documentation to reflect the pure editor/reader philosophy.

---

### Task 1: SQLite Schema Migration & Unified Model (Rust)

**Files:**
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/model.rs`
- Test: `src-tauri/src/db/mod.rs` (in-tree unit tests)

- [ ] **Step 1: Define the unified schema migration in `src-tauri/src/db/mod.rs`**

Add migration `3` to `migration_sql(version: i32)` in `src-tauri/src/db/mod.rs`:
```rust
3 => Some(
    r#"
CREATE TABLE opened_files (
    path_key      TEXT PRIMARY KEY,
    path          TEXT NOT NULL,
    name          TEXT NOT NULL,
    size          INTEGER NOT NULL DEFAULT 0,
    modified_at   TEXT NOT NULL,
    opened_at     TEXT NOT NULL,
    pinned        INTEGER NOT NULL DEFAULT 0,
    cursor_line   INTEGER NOT NULL DEFAULT 1,
    cursor_col    INTEGER NOT NULL DEFAULT 1,
    scroll_ratio  REAL NOT NULL DEFAULT 0.0
);
CREATE INDEX idx_opened_files_sort ON opened_files(pinned DESC, opened_at DESC);

CREATE VIRTUAL TABLE files_fts USING fts5(
    path_key UNINDEXED,
    path UNINDEXED,
    name,
    body,
    tokenize = 'trigram'
);
"#,
),
```
Bump `LATEST_VERSION` to `3`.

- [ ] **Step 2: Update model structs in `src-tauri/src/model.rs`**

Add:
```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileRecord {
    pub path_key: String,
    pub path: String,
    pub name: String,
    pub size: i64,
    pub modified_at: String,
    pub opened_at: String,
    pub pinned: bool,
    pub cursor_line: u32,
    pub cursor_col: u32,
    pub scroll_ratio: f64,
}
```

- [ ] **Step 3: Run cargo test to verify migration succeeds**

Run: `cargo test --manifest-path src-tauri/Cargo.toml migration`
Expected: PASS

---

### Task 2: Backend DB Module for Unified Files (`opened_files.rs`)

**Files:**
- Create: `src-tauri/src/db/opened_files.rs`
- Modify: `src-tauri/src/db/mod.rs` (register module)
- Test: `src-tauri/src/db/opened_files.rs`

- [ ] **Step 1: Write failing unit tests for `opened_files` CRUD & FTS**

Write tests in `src-tauri/src/db/opened_files.rs`:
- `upsert_and_list_sorted_by_opened_at`
- `pin_file_bubbles_to_top`
- `update_session_coordinates`
- `fts_search_matches_content`
- `remove_file_cleans_record_and_fts`

- [ ] **Step 2: Implement `opened_files.rs`**

Implement:
- `path_key(raw: &str) -> String` (normalize Windows vs POSIX paths)
- `record_file(conn, path, name, size, modified_at, opened_at, body)`: upsert into `opened_files` and `files_fts`
- `update_session(conn, path, cursor_line, cursor_col, scroll_ratio)`
- `set_pinned(conn, path, pinned)`
- `list(conn) -> AppResult<Vec<FileRecord>>`
- `remove(conn, path) -> AppResult<()>`
- `search(conn, query) -> AppResult<Vec<FileSearchResult>>`

- [ ] **Step 3: Run tests to verify all pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml opened_files`
Expected: PASS

---

### Task 3: Backend Tauri Commands & Service Refactoring

**Files:**
- Modify: `src-tauri/src/commands/documents.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/commands/documents.rs`

- [ ] **Step 1: Implement unified disk I/O commands in `src-tauri/src/commands/documents.rs`**

Commands:
1. `open_file(path: String) -> AppResult<OpenFileResponse>`:
   - Reads content directly from disk `std::fs::read_to_string(&path)`.
   - Records metadata and indexes content into `opened_files` and `files_fts`.
   - Returns `{ content, record }`.
2. `save_file(path: String, content: String) -> AppResult<FileRecord>`:
   - Atomically writes to disk path via temp file + rename.
   - Updates `opened_files` (mtime, size) and `files_fts`.
3. `create_file(path: String, content: String) -> AppResult<FileRecord>`:
   - Checks if file already exists; if not, writes and records in SQLite.
4. `list_recent_files() -> AppResult<Vec<FileRecord>>`:
   - Returns sorted recent files list.
5. `remove_from_history(path: String) -> AppResult<()>`:
   - Removes record from SQLite without deleting the disk file.
6. `delete_file_on_disk(path: String) -> AppResult<()>`:
   - Deletes file from disk and removes record from SQLite.
7. `search_files(query: String) -> AppResult<Vec<FileSearchResult>>`:
   - Queries FTS index.
8. `update_file_session(path: String, cursor_line: u32, cursor_col: u32, scroll_ratio: f64) -> AppResult<()>`:
   - Saves reading/editing position for the file.

- [ ] **Step 2: Register updated commands in `src-tauri/src/lib.rs`**

Register the new commands in `tauri::generate_handler![...]`.

- [ ] **Step 3: Run backend integration tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

---

### Task 4: Frontend Types & API Client

**Files:**
- Modify: `src/types/document.ts`
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Update `src/types/document.ts`**

Define unified types:
```typescript
export interface FileRecord {
  pathKey: string;
  path: string;
  name: string;
  size: number;
  modifiedAt: string;
  openedAt: string;
  pinned: boolean;
  cursorLine: number;
  cursorCol: number;
  scrollRatio: number;
}

export interface OpenFileResponse {
  content: string;
  record: FileRecord;
}

export interface FileSearchResult {
  path: string;
  name: string;
  snippet: string;
}

export interface DraftDocument {
  id: string; // e.g. "draft-1"
  title: string;
  content: string;
  isDirty: boolean;
  createdAt: number;
}
```

- [ ] **Step 2: Update `src/lib/api.ts`**

Implement:
```typescript
openFile: (path: string) => call<OpenFileResponse>("open_file", { path }),
saveFile: (path: string, content: string) => call<FileRecord>("save_file", { path, content }),
createFile: (path: string, content: string) => call<FileRecord>("create_file", { path, content }),
listRecentFiles: () => call<FileRecord[]>("list_recent_files"),
removeFromHistory: (path: string) => call<void>("remove_from_history", { path }),
deleteFileOnDisk: (path: string) => call<void>("delete_file_on_disk", { path }),
searchFiles: (query: string) => call<FileSearchResult[]>("search_files", { query }),
updateFileSession: (path: string, cursorLine: number, cursorCol: number, scrollRatio: number) =>
  call<void>("update_file_session", { path, cursorLine, cursorCol, scrollRatio }),
```

---

### Task 5: Refactor Store (`useWorkspaceStore.ts`)

**Files:**
- Modify: `src/stores/useWorkspaceStore.ts`
- Test: `src/stores/useWorkspaceStore.test.ts`

- [ ] **Step 1: Update store state shape**

```typescript
interface WorkspaceState {
  recentFiles: FileRecord[];
  activePath: string | null;
  activeDraftId: string | null;
  drafts: Record<string, DraftDocument>;
  loading: boolean;
  error: string | null;
  
  loadRecentFiles: () => Promise<void>;
  openFile: (path: string) => Promise<OpenFileResponse | null>;
  saveActiveFile: (content: string) => Promise<boolean>;
  saveDraftToDisk: (draftId: string, targetPath: string) => Promise<boolean>;
  createDraft: (title?: string) => string;
  closeTab: (tabId: string) => void;
  removeRecentFile: (path: string) => Promise<void>;
  deleteFile: (path: string) => Promise<boolean>;
  setPinned: (path: string, pinned: boolean) => Promise<void>;
}
```

- [ ] **Step 2: Update store tests and verify**

Run: `npx vitest run src/stores/useWorkspaceStore.test.ts`
Expected: PASS

---

### Task 6: Unified Recent Files Component (`RecentFileList.tsx`) & Sidebar

**Files:**
- Create: `src/components/workspace/RecentFileList.tsx`
- Modify: `src/components/workspace/Sidebar.tsx`
- Delete: `src/components/workspace/ExternalFileList.tsx`
- Test: `src/components/workspace/Sidebar.test.tsx`

- [ ] **Step 1: Build `RecentFileList.tsx`**

A clean, unified list of recent disk files:
- Shows file name, folder path snippet, file size, last opened time.
- Context menu: Pin/Unpin, Open file location in explorer, Remove from history, Delete file on disk.
- Keyboard navigation (Arrow keys, Enter, Delete).

- [ ] **Step 2: Simplify `Sidebar.tsx`**

Remove the "外部文件" tab!
The sidebar tabs become:
1. `files` ("文档" / "历史"): Renders `RecentFileList`.
2. `outline` ("大纲"): Renders document outline.

- [ ] **Step 3: Run Sidebar tests**

Run: `npx vitest run src/components/workspace/Sidebar.test.tsx`
Expected: PASS

---

### Task 7: TabBar & Main Window Integration (`App.tsx`)

**Files:**
- Modify: `src/components/workspace/TabBar.tsx`
- Modify: `src/App.tsx`
- Test: `src/components/workspace/TabBar.test.tsx`
- Test: `src/App.test.tsx`

- [ ] **Step 1: Unify tab management in `App.tsx`**

A tab is identified by:
- A saved file path: `path`
- An unsaved draft: `draft:${id}`
No more UUID-to-path mappings or `ext-` base64 hashes.

- [ ] **Step 2: Implement "New Note" & "Save As" flow**

- Clicking `Ctrl+N` or "新建笔记" generates an in-memory draft (Tab title "未命名笔记").
- Editing marks it dirty.
- Pressing `Ctrl+S`:
  - If it's a draft: opens Tauri `save` dialog (`@tauri-apps/plugin-dialog`) for the user to choose where on their disk to save the `.md` file. Once saved, it seamlessly becomes an active disk file tab and registers into SQLite.
  - If it's already an existing disk file: writes directly to disk.

- [ ] **Step 3: Update and run App tests**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS

---

### Task 8: HomePage & Search Unification

**Files:**
- Modify: `src/components/home/HomePage.tsx`
- Modify: `src/components/workspace/CommandPalette.tsx`
- Test: `src/components/home/HomePage.test.tsx`

- [ ] **Step 1: Update `HomePage.tsx`**

- Search input uses `api.searchFiles` to query FTS5 across all opened files.
- Recent files stream displays items from `recentFiles`.
- "新建笔记" creates a draft.
- "导入本地文件" renamed to "打开本地文件" (invokes open file dialog and opens the selected file directly).

- [ ] **Step 2: Run HomePage tests**

Run: `npx vitest run src/components/home/HomePage.test.tsx`
Expected: PASS

---

### Task 9: Documentation & Full Verification

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `UI_DESIGN_SYSTEM.md`

- [ ] **Step 1: Update `ARCHITECTURE.md`**

Document the normative rule:
- Crab-MD is a lightweight desktop editor & reader for local disk files.
- Files belong exclusively to the user's filesystem; the app does not store or isolate files in an internal vault.
- SQLite is an index, metadata registry, and session state cache.

- [ ] **Step 2: Run full test suite & production build**

Run: `npx vitest run --maxWorkers=2`
Expected: PASS (all tests pass)

Run: `npm run build`
Expected: PASS (exit code 0)

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-10-unified-disk-file-model.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
