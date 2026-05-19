# Project Workspaces — Codex-style UX with Multi-Repo & Pluggable Diff Viewers

Status: draft · 2026-05-19
Owner: TBD
Confidence: 80% on direction; 60% on diff-viewer plug-in surface (needs spike).

## Goal

Lift pi-gui from "list of repo workspaces in a sidebar" to a Codex-style **project workspace** model where:

1. A **Project** is a named bundle of 1..N repos with shared context, MRU, color/icon, and per-project preferences.
2. Switching projects is a first-class action (quick-switcher, recents, pinned, optionally a second window).
3. Each project decides **how diffs are rendered**: which viewer, which renderer per file type, and how cross-repo diffs are aggregated.
4. Existing single-repo workspaces keep working unchanged — Project is layered above, not a replacement.

Non-goals (this plan):
- Replacing pi-mono session model.
- Rewriting the sidebar from scratch.
- Cloud sync of projects (local only; export/import as JSON for now).

## Why now

- `pi-gui-dpg` (Multi-repo worktree support) already commits us to a Project notion derived from singularity's `~/.config/singularity/projects.json`. The current epic stops at "add project workspace" — the UX layer (switcher, recents, per-project settings, diff viewers) is missing.
- Singularity's `Project` model is solid as a data shape but its TUI has **no in-app project switcher** (only CLI flags). We can leapfrog with a Codex-style UI.
- Real users juggle 3–6 repos per product. A flat workspace list does not scale; per-project state does.

## Existing surface (what we build on)

- `WorkspaceRecord{kind: primary|worktree}` in `apps/desktop/src/desktop-state.ts`. Epic `pi-gui-dpg` will add `kind: project` and `projectKey/repoPaths`.
- `DesktopAppStore` + `app-store-workspace.ts` / `-worktree.ts` in `apps/desktop/electron/`.
- Catalog persistence: `userData/catalogs.json` (v2) — already has `pinned` and `lastOpenedAt` fields that are unused in UI.
- UI: `sidebar.tsx` (DnD reorder), `topbar.tsx` (env picker), `diff-panel.tsx` + `diff-inline.tsx` + `app-store-diff.ts` (single-repo git porcelain → inline renderer).

## Design

### 1. Data model

Layer projects on top of workspaces — do **not** collapse them.

```ts
// New
interface ProjectRecord {
  readonly id: string;                 // ulid; stable
  readonly key: string;                // matches singularity projects.json key when imported
  readonly displayName: string;
  readonly color?: string;             // hex; UI accent
  readonly icon?: string;              // glyph name from icons.ts
  readonly repos: readonly ProjectRepoRef[];
  readonly contextFiles: readonly string[];   // absolute paths, expanded
  readonly diffViewer?: DiffViewerConfig;     // see §3
  readonly defaults?: ProjectDefaults;        // model, thinking, autoApprove…
  readonly pinned: boolean;
  readonly lastOpenedAt?: string;             // ISO
  readonly tags: readonly string[];
  readonly source: "singularity" | "manual" | "discovered";
}

interface ProjectRepoRef {
  readonly name: string;
  readonly path: string;                // absolute
  readonly defaultBranch?: string;
  readonly role?: "root" | "sub";
}

interface ProjectDefaults {
  readonly model?: string;
  readonly thinking?: "off" | "low" | "medium" | "high";
  readonly approvalPolicy?: "ask" | "auto-edit" | "auto-all";
}
```

Workspaces gain an optional `projectId` (not just `projectKey` as in current dpg plan) for stable referencing even when the singularity key changes. The `projectKey` survives for import/sync.

### 2. Persistence

- New catalog file: `userData/projects.json` (v1) via existing `JsonCatalogStore` pattern.
- Migration: on first run, if `~/.config/singularity/projects.json` exists, import as `source: "singularity"`. Re-import is idempotent on `key`.
- Auto-discovery walker: scan a configurable root (default: `~/code`) up to N levels deep, stop at `.git`, group siblings under the same parent dir as suggested projects. Ported from singularity's `--generate-config-from-dir`.
- Secrets (per-project tokens for git providers, API keys): **OS keychain** via `keytar`, namespaced `pi-gui.project.<id>.<secretName>`. **Never** in `projects.json`. (ISO 27001 concern noted in singularity scout.)

### 3. Pluggable diff viewers

The interesting bit. Diffs today: `git status --porcelain` → per-file `git diff` → custom React `InlineDiff`. We make the **renderer** and the **source** pluggable so different projects (and file types) can use the right tool.

#### 3a. Renderer plug-in surface (renderer side)

```ts
// packages/diff-viewers/src/types.ts
export interface DiffViewer {
  readonly id: string;                  // e.g. "inline", "side-by-side", "monaco", "image", "difftastic"
  readonly displayName: string;
  readonly capabilities: {
    readonly handlesBinary?: boolean;
    readonly handlesLargeFiles?: boolean;
    readonly preferredFor?: readonly string[];   // glob or mime
  };
  // Pure component; no IPC inside.
  readonly Component: React.ComponentType<DiffViewerProps>;
}

export interface DiffViewerProps {
  readonly file: ChangedFileEntry;
  readonly unifiedDiff: string;         // git unified diff
  readonly before?: string;             // optional, lazy
  readonly after?: string;
  readonly language?: string;
  readonly theme: "light" | "dark";
}
```

Built-in viewers:
- `inline` — current `InlineDiff` (default for code).
- `side-by-side` — two-pane, scroll-synced, syntax-highlighted.
- `image` — auto-selected for `*.png|jpg|gif|webp|svg` (before/after with slider).
- `markdown` — rendered preview diff for `*.md` (preferred for docs-heavy projects).
- `binary-info` — no diff, just size/sha hint (for `*.lock`, `*.bin`).

Out-of-process viewer (spike, may slip):
- `external` — pipes the unified diff to a configured binary (`delta`, `difftastic`, `meld`) and renders ANSI/HTML in a sandboxed pane. Disabled by default; opt-in per project. Path validated.

#### 3b. Source plug-in surface (main side)

`app-store-diff.ts` becomes a coordinator that delegates to **DiffSource** strategies:

```ts
// electron/diff-sources/index.ts
export interface DiffSource {
  readonly id: string;
  list(workspace: WorkspaceContext): Promise<ChangedFileEntry[]>;
  read(workspace: WorkspaceContext, file: string): Promise<UnifiedDiff>;
}
```

Strategies:
- `git-single` — current behavior, one repo.
- `git-multi` — for project workspaces with `repoPaths`: parallel `git status` per repo, results merged with `repo:` prefix in `path`. Sorted by repo, then path.
- `git-cross-branch` — ported from singularity's `/api/project/branch/compare`: diff a feature branch across all repos against their default branches.

The renderer picks the viewer via priority: explicit per-file user override → project `diffViewer` config → built-in default for the file's language/mime.

#### 3c. Per-project config UI

Settings → Project → Diff viewer:
- Default renderer dropdown (built-ins + any registered external).
- Per-extension override table (e.g. `.md` → markdown, `.png` → image).
- "Use external tool" toggle with binary path + arg template (`{old} {new}` or `--diff <unified>`).
- Preview pane that runs the chosen viewer against a sample diff.

### 4. Codex-style switcher UX

- **Cmd/Ctrl+K** quick-switcher: fuzzy search over projects, workspaces (including worktrees), and recent sessions. Hit Enter → switch; Cmd+Enter → open in new window.
- **Cmd/Ctrl+P** → file-in-current-project (later phase, not blocking).
- Sidebar restructure:
  - Top section: **Pinned projects** (max 5, drag to reorder).
  - Middle: **Recent projects** (sorted by `lastOpenedAt`, capped at 8).
  - Each project row expands → its workspaces (primary + worktrees), grouped, with sub-repo dots.
  - Existing single-repo workspaces appear under a synthetic "Unfiled" project so the upgrade is non-destructive.
- Topbar: breadcrumb `Project ▸ Repo ▸ Environment ▸ Session`.
- **Multi-window**: `Open Project in New Window` action. Each window owns one project; IPC stays per-window. Shared state: catalog + recents only.
- Workspace-scoped UI state: remember last-active session, scroll position, and selected diff-file per workspace in `ui-state.json`.

### 5. Cross-repo branch compare view

Port singularity's project/branch endpoints into the desktop:
- New panel **"Branch compare"** at project level.
- Pick branch `feat/foo` → for each repo: does branch exist? ahead/behind vs default? aggregate diff per repo using `git-cross-branch` source + chosen viewer.
- Useful for reviewing a feature spanning api + worker + frontend in one place.

### 6. Security & MSP guardrails (Proxy / ISO 27001 / NEN 7510)

- **No plaintext secrets** in `projects.json` — keychain only.
- External diff tool path validated against an allow-list; arg template parsed, never passed through `shell: true`.
- Project import from singularity is **read-only** by default; modifying `~/.config/singularity/projects.json` requires explicit user action.
- All new IPC channels go through preload allow-list; no new direct `ipcRenderer` exposure.
- Telemetry: zero by default.

## Phasing

### Phase A — Foundation (extend epic `pi-gui-dpg`)
Already scoped: config reader, types, manager, app-store integration, sidebar indicator, modal, context injection. **Plus** two new tasks:
- A1: Auto-discovery walker (port `--generate-config-from-dir`).
- A2: Cross-repo branch compare data source (`git-cross-branch`, no UI yet).

### Phase B — Project layer (new epic)
- B1: `ProjectRecord` schema + `projects.json` catalog + migration import from singularity.
- B2: Project CRUD IPC + preload API (create, update, delete, pin, recent).
- B3: Sidebar restructure (pinned/recents/projects).
- B4: Cmd+K quick-switcher.
- B5: Project settings dialog (name, color, icon, defaults).
- B6: Multi-window: "Open in New Window".
- B7: Workspace-scoped UI state (last session, last diff file).

### Phase C — Diff viewer plug-in (new epic)
- C1: Extract `DiffViewer` interface + registry; refactor current `InlineDiff` to fit.
- C2: `DiffSource` strategy interface; refactor `app-store-diff.ts`.
- C3: `git-multi` source for project workspaces.
- C4: Built-in `side-by-side` viewer.
- C5: Built-in `image` viewer + `markdown` viewer.
- C6: Per-project diff-viewer config UI + persistence.
- C7: Branch-compare UI on top of `git-cross-branch` (depends on A2).
- C8 (spike): External viewer adapter (delta/difftastic). Time-box 1 day. Skip if sandbox story isn't crisp.

### Phase D — Polish
- D1: Per-extension renderer overrides.
- D2: Keychain integration for project secrets.
- D3: Project export/import JSON.

## Verification (self-test)

Per AGENTS.md + `verify` skill, every code-touching task ends with the relevant Electron Playwright lane:
- Phase A & B touch main+renderer → `core` lane.
- Phase C touches renderer-heavy diff UI → `core`, plus `live` for branch-compare which uses real git.
- Multi-window (B6) requires `native` lane (window lifecycle).

## Open questions

1. Do we want **per-project agent prompt injection** beyond singularity's `context_files`? (E.g. a per-project AGENTS-prelude.) — defer to Phase D.
2. Does external diff tool sandboxing meet ISO 27001 without extra controls? Spike before C8.
3. Should worktrees roll up under their parent workspace in the new sidebar, or stay siblings? Lean: roll up, with a chevron.
4. Migration: when singularity's projects.json changes, do we auto-resync or require a "Refresh" click? Lean: refresh button + filesystem watcher behind a flag.

## Risks

- **Sidebar churn**: restructuring is high-visibility. Ship behind a setting flag for one release.
- **Diff viewer registry**: easy to over-engineer. Keep registry in-process, no dynamic loading of user code (security).
- **Multi-window state**: catalogs.json contention. Use single-writer pattern (main process owns writes; renderers read).
- **Keychain on Linux**: `keytar` on Wayland needs libsecret. Fallback path: encrypted file with OS-derived key (document trade-off).
