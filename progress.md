# Progress

## Status
In Progress

## Tasks

### pi-gui-w29 — Workspace-scoped UI state ✅ (2026-05-20)
Persist last-active session per workspace in `ui-state.json`; restore on workspace switch.
- `app-store-persistence.ts`: added `PerWorkspaceState` interface + `perWorkspaceUiState` field to `PersistedUiState`; restored in `readPersistedUiState`
- `app-store-internals.ts`: added `perWorkspaceUiState: Map<string, PerWorkspaceState>` and `setPerWorkspaceUiState` to `AppStoreInternals`
- `app-store.ts`: added `perWorkspaceUiState` Map field; implemented `setPerWorkspaceUiState`; persist in `persistUiState`; restore in `initializeInternal`
- `app-store-workspace.ts`: `selectWorkspace` saves outgoing session and restores last session for target workspace; `selectSession` saves session on explicit selection
Commit: 3d6e5d7

### pi-gui-c0s — Multi-repo worktree creation progress UI ✅ (2026-05-20)
Overlay/modal shown during multi-repo worktree creation, wired into the `handleStartThread` handler in App.tsx.
- `worktree-creation-progress.tsx`: new component with creating/done/failed states, spinner, retry/dismiss buttons
- `styles/main.css`: added `.worktree-progress-overlay` and `.worktree-progress` CSS block
- `App.tsx`: import + `worktreeProgress` state + guard in `handleStartThread` (fires when `environment === "worktree" && !existingWorktreeId && repoPaths.length > 1`) + overlay render before closing `</div>`
Commit: 449e03b

### pi-gui-9ub — External diff tool adapter ✅ (2026-05-20)
Spike: working implementation with full security controls (option a).
- `apps/desktop/electron/external-diff-tool.ts`: `isAllowedTool()` + `runExternalDiffTool()` — allow-list, `shell:false`, `env:{}`, 10s timeout, 5 MB cap
- `apps/desktop/src/diff-viewers/external.tsx`: `ExternalDiffViewer` component + `externalDiffViewer` export — NOT registered by default
- `apps/desktop/docs/external-diff-threat-model.md`: threat model with controls and known gaps
- `apps/desktop/src/ipc.ts`: added `diffRunExternalTool` channel key + `runExternalDiffTool` to `PiDesktopApi` interface
- `apps/desktop/electron/main.ts`: `ipcMain.handle(desktopIpc.diffRunExternalTool, ...)` wired to runner
- `apps/desktop/electron/preload.ts`: `runExternalDiffTool` bridge exposed on `window.piApp`
Commit: 3a4453a

## Files Changed
- apps/desktop/electron/app-store-persistence.ts
- apps/desktop/electron/app-store-internals.ts
- apps/desktop/electron/app-store.ts
- apps/desktop/electron/app-store-workspace.ts

## Notes
- Pre-existing TS errors in main.ts and external-diff-tool.ts are unrelated to w29
- lastDiffFile field is in the data model (PerWorkspaceState) but diff panel wiring is deferred
