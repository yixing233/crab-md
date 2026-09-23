# Markdown Editor — Architecture & Product Design Specification

> Version: 0.1  
> Status: Baseline specification  
> Audience: coding agents, maintainers, reviewers  
> Platforms: Windows + Android  
> Primary goal: local-first Markdown reading/editing with per-user isolated cloud synchronization

---

## 1. Purpose

This document defines the product architecture, data ownership model, synchronization behavior, server responsibilities, client responsibilities, security boundaries, and implementation constraints for the project.

This document is normative. Coding agents MUST treat requirements marked **MUST**, **MUST NOT**, **SHOULD**, and **MAY** as implementation constraints.

If implementation details conflict with this document, update this document first or explicitly document the deviation in the pull request / change note.

---

## 2. Product Scope

The application is a lightweight Markdown reader/editor for a small trusted user group (approximately 3–5 users).

Each user has an independent private workspace. A single user may use multiple devices, including Windows PCs and Android phones/tablets. Devices belonging to the same user synchronize the same Markdown workspace through a private server.

### 2.1 In scope

- Markdown reading and editing
- Windows and Android clients
- Local-first operation
- Offline editing
- Per-user isolated data
- Cross-device synchronization for the same account
- Attachments such as images and PDFs
- File/folder organization
- Search and basic metadata
- Conflict detection and conflict preservation
- Light / dark / follow-system themes
- Device/session management
- Manual administrator-created accounts

### 2.2 Out of scope for v1

The following MUST NOT be implemented unless a later specification explicitly adds them:

- Real-time multi-user collaborative editing
- CRDT / OT based live collaboration
- Public registration
- Email or SMS verification
- Social login
- Shared workspaces between different users
- SaaS multi-tenant administration UI
- Redis
- PostgreSQL
- message queues
- MinIO / object storage
- Elasticsearch
- microservices
- online-only editing

---

## 3. Core Architectural Principles

### 3.1 Local-first

The client MUST remain fully usable when the server is unavailable.

Editing MUST write to local storage first. Network synchronization MUST be an asynchronous follow-up action and MUST NOT block normal editing.

A temporary network failure MUST NOT cause loss of user edits.

### 3.2 Markdown remains portable

User documents MUST remain valid Markdown files.

The application MUST NOT require a proprietary document format to read the user's content.

Metadata MAY be stored separately in SQLite.

### 3.3 Per-user isolation

Each user MUST have a private server-side data root.

A user MUST NOT be able to access another user's data by changing a path, document ID, request field, or user ID.

The authenticated server session MUST determine the current user. The client MUST NOT be trusted to select the effective user ID.

### 3.4 Small-system bias

The implementation SHOULD prefer simple, inspectable components over infrastructure designed for large-scale SaaS systems.

The expected deployment target is a single 2-core / 2-GB server serving approximately 3–5 users.

---

## 4. Recommended Technology Stack

### 4.1 Client

- Tauri 2
- React
- TypeScript
- CodeMirror 6
- SQLite
- Markdown files on local storage
- markdown-it or unified for rendering
- Shiki for code highlighting where practical
- Zustand or equivalent lightweight state store

### 4.2 Server

- Go
- SQLite
- Local filesystem
- REST over HTTPS
- Caddy for TLS termination and reverse proxy
- Optional Docker / Docker Compose deployment

### 4.3 Technology constraints

Agents SHOULD NOT introduce a new framework or backend datastore unless there is a concrete requirement that cannot be reasonably solved with the stack above.

Any replacement of a core technology MUST include a documented migration rationale.

---

## 5. High-Level System Architecture

```text
Windows Client                         Android Client
┌──────────────────┐                  ┌──────────────────┐
│ Tauri 2          │                  │ Tauri 2          │
│ React/TypeScript │                  │ React/TypeScript │
│ CodeMirror 6     │                  │ CodeMirror 6     │
│ local SQLite     │                  │ local SQLite     │
│ local Markdown   │                  │ local Markdown   │
└────────┬─────────┘                  └────────┬─────────┘
         │                                     │
         └──────────── HTTPS REST ─────────────┘
                           │
                         Caddy
                           │
                     ┌─────▼─────┐
                     │  Go API   │
                     └─────┬─────┘
                           │
             ┌─────────────▼─────────────┐
             │          auth.db          │
             └─────────────┬─────────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
       user_A/         user_B/         user_C/
       meta.db         meta.db         meta.db
       notes/          notes/          notes/
       attachments/    attachments/    attachments/
```

---

## 6. Repository-Level Logical Modules

Recommended client structure:

```text
src/
├── app/
│   ├── routing/
│   ├── lifecycle/
│   └── bootstrap/
├── components/
│   ├── ui/
│   ├── editor/
│   └── workspace/
├── features/
│   ├── auth/
│   ├── documents/
│   ├── search/
│   ├── settings/
│   └── sync/
├── lib/
│   ├── db/
│   ├── markdown/
│   ├── filesystem/
│   └── api/
├── stores/
├── styles/
└── types/
```

Recommended server structure:

```text
server/
├── cmd/server/
├── internal/
│   ├── auth/
│   ├── users/
│   ├── documents/
│   ├── attachments/
│   ├── sync/
│   ├── storage/
│   └── httpapi/
├── migrations/
└── data/
```

Agents SHOULD preserve feature/module boundaries instead of placing unrelated logic in shared utility files.

---

## 7. Server Data Layout

Recommended filesystem layout:

```text
data/
├── auth.db
└── users/
    ├── <user-uuid-A>/
    │   ├── metadata.db
    │   ├── notes/
    │   │   ├── <document-uuid>.md
    │   │   └── ...
    │   └── attachments/
    │       ├── <attachment-uuid>
    │       └── ...
    ├── <user-uuid-B>/
    └── ...
```

### 7.1 Important storage rule

User-facing filenames and virtual folder paths MUST NOT be used directly as trusted server filesystem paths.

The server SHOULD store documents by opaque UUID-like IDs.

Example:

```text
notes/01993ab2-....md
```

while the user-visible metadata may be:

```text
title: Go Basics
virtual_path: /Development/Go/
```

This prevents path traversal and simplifies renaming.

---

## 8. Authentication and Session Model

### 8.1 Account creation

Accounts are administrator-created in v1.

No public registration flow is required.

### 8.2 Password storage

Passwords MUST NOT be stored in plaintext.

Passwords SHOULD be hashed using Argon2id.

### 8.3 Device/session tokens

Each device SHOULD receive its own revocable token after successful login.

A user may have multiple active device sessions.

Recommended conceptual model:

```text
users
- id
- username
- password_hash
- created_at
- disabled

devices
- id
- user_id
- device_name
- token_hash
- created_at
- last_seen_at
- revoked_at
```

### 8.4 Authorization boundary

Every authenticated API handler MUST derive `current_user_id` from the validated token/session.

The server MUST NOT authorize access based on a `user_id` supplied by the request body, path, query string, or client-side state.

Prefer:

```http
GET /api/notes
```

instead of:

```http
GET /api/users/:user_id/notes
```

for normal user operations.

---

## 9. Per-User Metadata Database

Each user SHOULD have a dedicated SQLite metadata database.

Suggested tables:

```text
documents
- id
- title
- virtual_path
- revision
- content_hash
- created_at
- updated_at
- deleted_at
- size

attachments
- id
- filename
- stored_name
- mime_type
- content_hash
- size
- created_at
- deleted_at

sync_log
- revision
- object_id
- object_type
- action
- created_at
```

Exact schema MAY evolve, but the per-user isolation invariant MUST remain.

---

## 10. Client Local Storage

Each client MUST maintain a local workspace so that editing works offline.

Recommended logical layout:

```text
workspace/
├── notes/
│   ├── <document-uuid>.md
│   └── ...
├── attachments/
└── .app/
    └── metadata.db
```

The local SQLite database SHOULD track:

```text
- document ID
- title
- virtual path
- local revision
- last known remote revision
- content hash
- dirty state
- sync state
- created/updated timestamps
- deleted state
```

---

## 11. Document Identity

A document MUST have a stable opaque ID independent of its title and folder path.

Renaming or moving a document MUST NOT change its document ID.

Recommended ID format: UUIDv7, ULID, or another collision-resistant sortable identifier.

Agents MUST NOT use title/path as the primary identity of a document.

---

## 12. Synchronization Model

### 12.1 General model

Synchronization is version-based, not real-time collaborative.

Each document MUST have at least:

```text
id
revision
content_hash
updated_at
```

### 12.2 Local save flow

1. User edits a document.
2. Client writes the content locally immediately or after a short editor debounce.
3. Client marks the document dirty.
4. Client schedules upload after a short synchronization debounce.
5. Upload occurs when network connectivity is available.
6. On success, client updates last-known remote revision and clears dirty state.

### 12.3 Recommended synchronization triggers

The client SHOULD attempt sync on:

- app launch
- app returning to foreground
- successful login
- document save, debounced approximately 1–3 seconds
- explicit manual refresh
- network reconnect

### 12.4 Manifest-first sync

The server SHOULD expose a lightweight manifest endpoint so clients can compare revisions/hashes without downloading all documents.

Example conceptual response:

```json
{
  "documents": [
    {
      "id": "01...",
      "revision": 18,
      "hash": "sha256:...",
      "deleted": false
    }
  ]
}
```

### 12.5 Upload precondition

A document upload SHOULD include the client's last known base revision.

Example:

```text
client base revision = 18
server current revision = 18
=> accept update, create revision 19
```

If:

```text
client base revision = 18
server current revision = 19
```

then the server MUST reject the update as a conflict rather than silently overwrite the remote version.

---

## 13. Conflict Handling

v1 MUST preserve both sides of a conflict.

The system MUST NOT silently discard either version.

Recommended behavior:

```text
Original note.md
Conflicted note (Android 2026-09-21 13-35).md
```

or equivalent internal conflict representation.

The UI SHOULD provide:

- local version
- remote version
- diff view where practical
- keep local
- keep remote
- keep both

Automatic semantic merge MAY be introduced later but is not required for v1.

CRDT MUST NOT be introduced solely to solve ordinary rare conflicts.

---

## 14. Deletion Model

Deletes SHOULD be soft deletes during synchronization.

A delete operation SHOULD carry a tombstone state and revision so that another device does not accidentally recreate an older document.

Permanent cleanup MAY occur after a retention period or manual maintenance process.

---

## 15. Attachment Model

Attachments SHOULD be stored outside Markdown files.

Markdown MAY reference attachments using an app-resolved stable identifier or relative logical path.

Attachments MUST be scoped to the authenticated user's data root.

The server MUST validate attachment IDs and MUST NOT expose arbitrary filesystem paths.

Large attachment uploads SHOULD have a reasonable server-side size limit configurable by deployment.

---

## 16. API Baseline

The exact paths MAY change, but the following capability surface is expected:

```http
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/devices
DELETE /api/devices/:id

GET    /api/sync/manifest

GET    /api/notes
GET    /api/notes/:id
PUT    /api/notes/:id
DELETE /api/notes/:id

POST   /api/attachments
GET    /api/attachments/:id
DELETE /api/attachments/:id
```

### 16.1 API rules

- All non-login endpoints MUST require authentication unless explicitly documented otherwise.
- User data endpoints MUST operate only on the authenticated user's data root.
- Document IDs MUST be validated as opaque IDs.
- The server MUST reject path traversal input.
- Error responses SHOULD use stable machine-readable error codes.

Example error envelope:

```json
{
  "error": {
    "code": "SYNC_CONFLICT",
    "message": "Document changed on another device."
  }
}
```

---

## 17. Search

Search SHOULD be local-first.

For v1, the client MAY use SQLite FTS5 for document title/content indexing.

Server-side full-text search is not required.

Search indexing MUST NOT block normal editing.

---

## 18. Reliability Rules

### 18.1 Saving

The editor MUST prioritize local durability over network success.

Closing or backgrounding the app MUST NOT intentionally discard unsaved content.

### 18.2 Atomic writes

Where practical, Markdown file writes SHOULD use an atomic-write strategy:

1. write temporary file
2. fsync/close
3. rename/replace target

### 18.3 Database migrations

Client and server SQLite schema changes MUST use versioned migrations.

Agents MUST NOT silently change schema assumptions without migration handling.

---

## 19. Security Baseline

The system MUST:

- use HTTPS in deployment
- hash passwords securely
- store only token hashes server-side where practical
- validate all IDs and paths
- prevent traversal outside user roots
- scope every data operation to authenticated user
- avoid returning internal filesystem paths to clients
- sanitize rendered Markdown HTML
- avoid executing raw user HTML by default unless explicitly enabled and safely sanitized

The client MUST treat synchronized content as untrusted input when rendering HTML.

---

## 20. Backup and Restore

The server layout SHOULD make per-user backup simple.

A complete user backup SHOULD be possible by copying or archiving that user's directory plus relevant account metadata.

Example:

```text
users/<user-id>/
```

The deployment SHOULD include a documented periodic backup mechanism.

Backup implementation is operational infrastructure and does not require a distributed backup system.

### 20.1 Document Import and Export

Distinct from whole-workspace backup (§20): this is moving **one document** in or
out as a plain `.md` file, so users can cooperate with other editors.

- Exported content MUST be the document body verbatim — no application-private
  metadata, no wrapper. What the user sees in the editor is what lands on disk.
- Import MUST create a **new document with a fresh identity** (a new UUID, §11),
  never overwrite or adopt an existing document. Importing the same file twice
  MUST yield two independent documents.
- Both directions MUST refuse paths **inside the workspace**: writing into
  `notes/` bypasses UUID-based identity, and writing into `.app/` corrupts the
  metadata database. The check MUST be performed on canonicalized paths, so
  `notes/../..` cannot be used to escape.
- Both directions MUST enforce a size limit before reading the whole file into
  memory; a size-limited check MUST NOT leave a partial file or a metadata row
  behind on failure.
- The file picker only supplies a path. Reading and writing MUST still happen in
  the application layer (§7.1); the client MUST NOT be granted filesystem
  permissions of its own.
- A cancelled picker is **not** an error and MUST NOT surface a failure message.

---

## 21. Performance Expectations

Target scale:

- 3–5 users
- multiple devices per user
- thousands of Markdown notes per user are acceptable
- typical Markdown files are small
- attachment storage is expected to dominate disk usage

The architecture SHOULD optimize for simplicity and responsiveness rather than high concurrent throughput.

The server MUST remain functional within a 2-core / 2-GB environment under expected use.

---

## 22. Platform-Specific Guidance

### 22.1 Windows

- Desktop layout MAY expose multiple panes simultaneously.
- Keyboard shortcuts are first-class interactions.
- Drag/drop MAY be supported where useful.

### 22.2 Android

- Storage behavior MUST respect Android platform restrictions.
- Do not assume unrestricted filesystem paths.
- Use app-controlled workspace storage unless a platform-safe explicit import/export flow is implemented.
- Back navigation MUST be deliberately handled.
- Touch targets MUST follow the UI specification.

---

## 23. Logging and Diagnostics

The application SHOULD log operational failures useful for debugging, including:

- sync failures
- database migration failures
- document I/O failures
- authentication failures
- conflict creation

Logs MUST NOT contain passwords, raw authentication tokens, or unnecessary document contents.

A debug view MAY expose revision/hash information, but normal users SHOULD NOT see low-level sync metadata during ordinary use.

---

## 24. Agent Implementation Rules

Coding agents MUST follow these rules unless the task explicitly overrides them:

1. Preserve local-first behavior.
2. Never make successful network access a prerequisite for basic editing.
3. Never use client-supplied user IDs as the authorization source of truth.
4. Keep user data isolated by server-side authenticated user context.
5. Preserve standard Markdown files as user content.
6. Keep document identity independent from filename/title/path.
7. Do not silently overwrite on revision conflicts.
8. Avoid introducing infrastructure not required by the 3–5 user target.
9. Prefer simple modules with explicit responsibilities.
10. Add migrations when changing persistent schemas.
11. Add or update tests when modifying sync/auth/storage invariants.
12. Keep UI concerns consistent with `UI_DESIGN_SYSTEM.md`.

---

## 25. Recommended Implementation Order

### Phase 1 — local editor

- Tauri shell
- React app
- local workspace
- Markdown editor
- Markdown preview
- local document CRUD
- local metadata database

### Phase 2 — authentication and server storage

- Go server
- auth.db
- admin-created users
- login/session flow
- per-user data roots

### Phase 3 — synchronization

- manifest endpoint
- upload/download
- revision tracking
- dirty queue
- offline retry
- conflict handling

### Phase 4 — attachments and search

- attachment upload/download
- local search index
- global search UI

### Phase 5 — polish

- device/session management
- backup/export
- diagnostics
- edge-case hardening

---

## 26. Acceptance Criteria for v1 Architecture

A build satisfies the baseline architecture when all of the following are true:

- A user can edit Markdown offline on Windows.
- A user can edit Markdown offline on Android.
- Local edits persist across application restart.
- The same account can synchronize notes between Windows and Android.
- Different user accounts cannot access each other's notes through normal API manipulation.
- Renaming a note does not change its document identity.
- Conflicting edits are preserved rather than silently overwritten.
- Server restart does not lose persisted data.
- Normal usage does not require Redis, PostgreSQL, message queues, or object storage.
- The system runs on the target 2-core / 2-GB server.

---

## 27. Change Policy

When a future task requires changing one of the following invariants, this document MUST be updated in the same change:

- local-first behavior
- per-user isolation model
- synchronization revision model
- document identity rules
- server storage model
- authentication trust boundary
- conflict behavior

---

## 28. Application Updates

The desktop client supports checking for, downloading, and installing updates
published as GitHub Releases.

### 28.1 Trust model

Update packages MUST be cryptographically signed, and the client MUST verify the
signature **before** installing. Verification happens in the backend: the public
key is compiled into the app configuration, and the frontend cannot skip or
influence it.

The private key MUST NOT be committed. For CI it lives in a repository secret;
for local builds it lives outside the repository. Losing it means existing
installs can no longer receive updates — there is no recovery path short of a
manual reinstall, so it MUST be backed up.

### 28.2 Update manifest

The manifest (`latest.json`) MUST be generated from the build artifacts, not
hand-written, and MUST list per platform:

- the target version,
- the download URL for that exact release tag,
- the signature of that artifact.

The URL MUST point at the versioned tag (`releases/download/<tag>/<file>`),
not at `latest`. Under concurrent or re-rolled releases, `latest` can resolve to
a different version than the manifest advertises, producing a
"downloaded X, installed Y" inconsistency.

The published release MUST include the manifest **and** every signature file it
references. A manifest naming a file the release does not contain becomes a
download failure for every user on that platform.

### 28.3 Client behaviour

Automatic checks MUST be:

- **throttled** — at most once per day. Checking on every launch is more
  disruptive than not updating.
- **silent on failure** — an unreachable network, a blocked GitHub, or a
  misconfigured proxy are normal conditions and MUST NOT surface an error,
  block the UI, or affect editing. Only an explicitly user-initiated check
  reports a failure.
- **non-installing** — a discovered update is reported, never applied on its own.

Failure to persist the throttle timestamp (private browsing, quota) MUST NOT
break the flow; at worst it costs one extra check.

### 28.4 Installing

Installing restarts the application, therefore:

1. unsaved content MUST be flushed **before** installation begins;
2. if flushing fails, installation MUST be aborted — losing user data to ship an
   update is never an acceptable trade;
3. the user MUST confirm first, and the confirmation MUST state that the
   application will restart.

### 28.5 Version consistency

The release tag, `package.json`, and `tauri.conf.json` MUST carry the same
version. A mismatch makes the installed version differ from the version the
manifest advertises, which shows up as a permanently re-offered update (or one
that never appears). CI enforces this before building.

