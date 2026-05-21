import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { MultiRepoWorktreeManager } from "./multi-repo-worktree-manager";
import { homedir } from "node:os";
import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { WorktreeCatalogEntry } from "@pi-gui/catalogs";
import type { WorkspaceRef } from "@pi-gui/session-driver";
import type { CreateWorktreeInput, DesktopAppState, RemoveWorktreeInput, StartThreadInput } from "../src/desktop-state";
import { sendMessageToSession } from "./app-store-composer";
import type { CreateWorktreeOptions } from "./worktree-manager";
import type { AppStoreInternals } from "./app-store-internals";
import { NEW_THREAD_PLACEHOLDER_TITLE } from "./thread-title-constants";

/* ── Public methods ─────────────────────────────────────── */

export async function createWorktree(store: AppStoreInternals, input: CreateWorktreeInput): Promise<DesktopAppState> {
  await store.initialize();
  const rootWorkspace = store.workspaceRefFromState(input.workspaceId);
  if (!rootWorkspace) {
    return store.withError(`Unknown workspace: ${input.workspaceId}`);
  }

  // Get full workspace record to check for multi-repo project
  const rootWorkspaceRecord = store.state.workspaces.find((w) => w.id === input.workspaceId);

  if (rootWorkspaceRecord?.repoPaths && rootWorkspaceRecord.repoPaths.length > 0) {
    return store.withErrorHandling(async () => {
      const repos = buildRepoList(rootWorkspace.workspaceId, rootWorkspaceRecord);
      const manager = new MultiRepoWorktreeManager(store.catalogStore);
      const branchName = `worktree-${Date.now()}`;
      await manager.createWorktreeSet({
        projectKey: rootWorkspaceRecord.projectKey ?? rootWorkspaceRecord.id,
        projectDisplayName: rootWorkspaceRecord.name,
        branchName,
        repos,
      });
      // refreshWorktrees on the root workspace will now discover the rootPath as a linked
      // worktree (since the root repo's worktree IS rootPath, a real git worktree).
      return store.refreshState({ refreshWorktrees: true });
    });
  }

  return store.withErrorHandling(async () => {
    const createOptions = buildWorktreeOptions(
      store,
      rootWorkspace,
      input.fromSessionWorkspaceId,
      input.fromSessionId,
    );
    const created = await store.worktreeManager.createWorktree(rootWorkspace, createOptions);
    const synced = await store.driver.syncWorkspace(created.path, created.displayName);
    if (input.fromSessionId) {
      await store.driver.createSession(
        synced.workspace,
        { title: sessionTitleForWorktree(store, input.fromSessionWorkspaceId ?? input.workspaceId, input.fromSessionId) },
      );
    }

    return store.refreshState({
      selectedWorkspaceId: created.path,
      selectedSessionId: "",
      composerDraft: "",
      clearLastError: true,
      refreshWorktrees: false,
    });
  });
}

export async function removeWorktree(store: AppStoreInternals, input: RemoveWorktreeInput): Promise<DesktopAppState> {
  await store.initialize();
  const rootWorkspace = store.workspaceRefFromState(input.workspaceId);
  if (!rootWorkspace) {
    return store.withError(`Unknown workspace: ${input.workspaceId}`);
  }

  const rootWorkspaceRecord = store.state.workspaces.find((w) => w.id === input.workspaceId);

  // Multi-repo projects: the worktree is the root repo's git worktree directory, which also
  // contains sub-repo worktrees as children. Use MultiRepoWorktreeManager for proper cleanup.
  if (rootWorkspaceRecord?.repoPaths && rootWorkspaceRecord.repoPaths.length > 0) {
    return store.withErrorHandling(async () => {
      // Resolve the branch name from the catalog or from the worktree directory.
      const worktreeEntry = await store.catalogStore.worktrees.getWorktree(input.worktreeId);
      const branchName = worktreeEntry?.branchName ?? basename(input.worktreeId);

      const repos = buildRepoList(rootWorkspace.workspaceId, rootWorkspaceRecord);

      const manager = new MultiRepoWorktreeManager(store.catalogStore);
      const projectKey = rootWorkspaceRecord.projectKey ?? rootWorkspaceRecord.id;
      // removeWorktreeSet handles git worktree remove + remote branch delete + rm -rf
      await manager.removeWorktreeSet(projectKey, branchName, repos, rootWorkspaceRecord.name);

      // Remove the synced workspace entry from the driver (best-effort)
      await store.driver.removeWorkspace(input.worktreeId).catch(() => undefined);

      const selectedWorkspaceId =
        store.state.selectedWorkspaceId === input.worktreeId ? input.workspaceId : store.state.selectedWorkspaceId;
      const selectedSessionId =
        store.state.selectedWorkspaceId === input.worktreeId ? "" : store.state.selectedSessionId;
      return store.refreshState({
        selectedWorkspaceId,
        selectedSessionId,
        composerDraft: "",
        clearLastError: true,
        refreshWorktrees: true,
      });
    });
  }

  return store.withErrorHandling(async () => {
    const worktree = await store.catalogStore.worktrees.getWorktree(input.worktreeId);
    await store.worktreeManager.removeWorktree(rootWorkspace, input.worktreeId);
    if (worktree?.path) {
      await store.driver.removeWorkspace(worktree.path).catch(() => undefined);
    }

    const selectedWorkspaceId =
      store.state.selectedWorkspaceId === input.worktreeId ? input.workspaceId : store.state.selectedWorkspaceId;
    const selectedSessionId =
      store.state.selectedWorkspaceId === input.worktreeId ? "" : store.state.selectedSessionId;
    return store.refreshState({
      selectedWorkspaceId,
      selectedSessionId,
      composerDraft: "",
      clearLastError: true,
      refreshWorktrees: false,
    });
  });
}

/* ── Worktree checkout helpers ─────────────────────────── */

const execFileAsync = promisify(execFile);

async function gitCheckoutDetached(repoPath: string): Promise<void> {
  await execFileAsync("git", ["-C", repoPath, "checkout", "--detach", "HEAD"], { encoding: "utf8" });
}

async function gitCheckoutBranch(repoPath: string, branch: string): Promise<void> {
  await execFileAsync("git", ["-C", repoPath, "checkout", branch], { encoding: "utf8" });
}

/**
 * Checkout all worktree directories (linked worktrees only) as detached HEAD.
 * Works for single-repo and multi-repo project workspaces.
 */
export async function checkoutWorktreesDetached(
  store: AppStoreInternals,
  input: { workspaceId: string },
): Promise<{ results: { path: string; ok: boolean; error?: string }[] }> {
  await store.initialize();

  const workspace = store.state.workspaces.find((w) => w.id === input.workspaceId);
  if (!workspace) throw new Error(`Unknown workspace: ${input.workspaceId}`);

  // Collect all worktree paths for this workspace (and its sub-repos if multi-repo).
  const allWorktrees = Object.values(store.state.worktreesByWorkspace).flat();
  const rootWorkspaceId = workspace.rootWorkspaceId ?? workspace.id;
  const linkedWorktrees = allWorktrees.filter(
    (wt) => wt.rootWorkspaceId === rootWorkspaceId && wt.status === "ready",
  );

  const results: { path: string; ok: boolean; error?: string }[] = [];
  await Promise.all(
    linkedWorktrees.map(async (wt) => {
      try {
        await gitCheckoutDetached(wt.path);
        results.push({ path: wt.path, ok: true });
      } catch (err) {
        results.push({ path: wt.path, ok: false, error: String(err) });
      }
    }),
  );
  return { results };
}

/**
 * Checkout a branch in all primary repo directories of a workspace.
 * For single-repo workspaces: one checkout. For multi-repo: one per sub-repo.
 */
export async function checkoutMainBranch(
  store: AppStoreInternals,
  input: { workspaceId: string; branch: string },
): Promise<{ results: { path: string; ok: boolean; error?: string }[] }> {
  await store.initialize();

  const workspace = store.state.workspaces.find((w) => w.id === input.workspaceId);
  if (!workspace) throw new Error(`Unknown workspace: ${input.workspaceId}`);

  // For a multi-repo workspace use all repoPaths, otherwise the workspace path itself.
  const paths: readonly string[] =
    workspace.repoPaths && workspace.repoPaths.length > 0
      ? workspace.repoPaths
      : [workspace.path];

  const results: { path: string; ok: boolean; error?: string }[] = [];
  await Promise.all(
    paths.map(async (repoPath) => {
      try {
        await gitCheckoutBranch(repoPath, input.branch);
        results.push({ path: repoPath, ok: true });
      } catch (err) {
        results.push({ path: repoPath, ok: false, error: String(err) });
      }
    }),
  );
  return { results };
}

export async function startThread(store: AppStoreInternals, input: StartThreadInput): Promise<DesktopAppState> {
  await store.initialize();
  const rootWorkspace = store.workspaceRefFromState(input.rootWorkspaceId);
  if (!rootWorkspace) {
    return store.withError(`Unknown workspace: ${input.rootWorkspaceId}`);
  }

  return store.withErrorHandling(async () => {
    let targetWorkspace = rootWorkspace;
    let createdWorktreeContext: WorktreeContextInfo | undefined;

    if (input.environment === "worktree") {
      if (input.existingWorktreeId) {
        // Reuse an existing worktree: find its linked workspace and add a session there.
        const allWorktrees = Object.values(store.state.worktreesByWorkspace).flat();
        const existing = allWorktrees.find((wt) => wt.id === input.existingWorktreeId);
        const linkedWorkspace = existing?.linkedWorkspaceId
          ? store.workspaceRefFromState(existing.linkedWorkspaceId)
          : undefined;
        if (!linkedWorkspace) {
          throw new Error(`Worktree ${input.existingWorktreeId} not found or has no linked workspace`);
        }
        targetWorkspace = linkedWorkspace;
      } else {
        const wsRecord = store.state.workspaces.find((w) => w.id === input.rootWorkspaceId);

        if (wsRecord?.repoPaths && wsRecord.repoPaths.length > 0) {
          // Multi-repo: check out all repos as worktrees; start pi in the shared root dir.
          const manager = new MultiRepoWorktreeManager(store.catalogStore);
          const suffix = shortUniqueSuffix();
          const preferredTitle = shortDisplayTitle(input.prompt?.trim());
          const baseLabel = preferredTitle ? clampSlug(slugify(preferredTitle), 18) : "wt";
          const folderName = `${baseLabel}-${suffix}`;
          const branchName = `pi/${folderName}`;
          const projectKey = wsRecord.projectKey ?? wsRecord.id;
          const repos = buildRepoList(rootWorkspace.workspaceId, wsRecord);
          const worktreeSet = await manager.createWorktreeSet({
            projectKey,
            projectDisplayName: wsRecord.name,
            branchName,
            repos,
          });
          const displayName = preferredTitle || `Worktree ${suffix}`;
          // rootPath IS the root repo's worktree — a valid git dir with sub-repos as children.
          const synced = await store.driver.syncWorkspace(worktreeSet.rootPath, displayName);
          targetWorkspace = synced.workspace;
          createdWorktreeContext = {
            branchName,
            subRepoPaths: worktreeSet.subRepoPaths,
            rootPath: worktreeSet.rootPath,
          };
        } else {
          // Single-repo: existing behaviour.
          const worktreeOptions = buildWorktreeOptions(store, rootWorkspace, undefined, undefined, input.prompt);
          const created = await store.worktreeManager.createWorktree(rootWorkspace, worktreeOptions);
          const synced = await store.driver.syncWorkspace(created.path, created.displayName);
          targetWorkspace = synced.workspace;
          createdWorktreeContext = {
            branchName: worktreeOptions.branchName,
            subRepoPaths: [],
            rootPath: created.path,
          };
        }
      }
    }

    const rawPrompt = input.prompt?.trim() ?? "";
    const wsRecord = store.state.workspaces.find((w) => w.id === input.rootWorkspaceId);
    const contextPrefix = createdWorktreeContext
      ? buildWorktreeContextMessage(wsRecord, createdWorktreeContext)
      : buildMultiRepoContext(wsRecord);
    const prompt = contextPrefix
      ? contextPrefix + (rawPrompt ? "\n\n" + rawPrompt : "")
      : rawPrompt;
    const attachments = input.attachments ?? [];
    const createOptions = (await store.buildCreateSessionOptions(targetWorkspace.workspaceId)) ?? {};
    const initialModel =
      input.provider && input.modelId
        ? { provider: input.provider, modelId: input.modelId }
        : createOptions.initialModel;
    const initialThinkingLevel = input.thinkingLevel ?? createOptions.initialThinkingLevel;
    const session = await store.driver.createSession(targetWorkspace, {
      ...createOptions,
      title: NEW_THREAD_PLACEHOLDER_TITLE,
      ...(initialModel ? { initialModel } : {}),
      ...(initialThinkingLevel ? { initialThinkingLevel } : {}),
    });
    const key = sessionKey(session.ref);
    store.sessionState.transcriptCache.set(key, []);
    store.sessionState.loadedTranscriptKeys.add(key);
    store.updateSessionConfig(session.ref, session.config);
    const autoTitleAbortController = new AbortController();
    const pendingAutoTitle = {
      requestToken: randomUUID(),
      cancel: () => autoTitleAbortController.abort(),
    };
    store.setPendingAutoTitle(session.ref, pendingAutoTitle);

    // Navigate to thread view immediately so streaming deltas render live.
    // Set selection eagerly so that any subscription replay events
    // (fired by ensureSessionReady inside refreshState) read the new
    // session ID instead of the stale one.
    store.state = {
      ...store.state,
      selectedWorkspaceId: session.ref.workspaceId,
      selectedSessionId: session.ref.sessionId,
    };
    const state = await store.refreshState({
      selectedWorkspaceId: session.ref.workspaceId,
      selectedSessionId: session.ref.sessionId,
      composerDraft: "",
      clearLastError: true,
      refreshWorktrees: input.environment === "worktree" && !input.existingWorktreeId,
      activeView: "threads",
    });

    // Fire message in background — assistantDelta events flow through
    // handleSessionEvent → emit() and update React while on the thread view
    if (prompt || attachments.length > 0) {
      void sendMessageToSession(store, session.ref, prompt, attachments, {
        rollbackOptimisticMessageOnError: false,
      }).catch((error) => {
        void store.withError(error);
      });
    }
    if (prompt) {
      void generateAndApplyAutoTitle(store, session.ref, targetWorkspace, {
        prompt,
        requestToken: pendingAutoTitle.requestToken,
        signal: autoTitleAbortController.signal,
        ...(initialModel ? { model: initialModel } : {}),
        ...(initialThinkingLevel ? { thinkingLevel: initialThinkingLevel } : {}),
      });
    } else {
      store.clearPendingAutoTitle(session.ref);
    }

    return state;
  });
}

export async function syncAndListWorktrees(
  store: AppStoreInternals,
  workspaces: readonly {
    workspaceId: string;
    path: string;
    displayName: string;
    sortOrder: number;
    lastOpenedAt: string;
  }[],
): Promise<readonly WorktreeCatalogEntry[]> {
  const existing = await store.catalogStore.worktrees.listWorktrees();
  const existingPrimaryByWorkspaceId = new Set(
    existing.worktrees.filter((worktree) => worktree.kind === "primary").map((worktree) => worktree.workspaceId),
  );
  const inspected = await Promise.all(
    workspaces.map(async (workspace) => {
      try {
        const inspection = await store.worktreeManager.inspectWorkspace(workspace);
        return {
          workspace,
          ...inspection,
        };
      } catch {
        return {
          workspace,
          canonicalPath: workspace.path,
          commonDir: `workspace:${workspace.workspaceId}`,
        };
      }
    }),
  );
  const groups = new Map<string, typeof inspected>();

  for (const entry of inspected) {
    const group = groups.get(entry.commonDir);
    if (group) {
      group.push(entry);
    } else {
      groups.set(entry.commonDir, [entry]);
    }
  }

  const syncRoots = [...groups.values()]
    .map((group) =>
      [...group].sort((left, right) => {
        const leftIsExistingPrimary = existingPrimaryByWorkspaceId.has(left.workspace.workspaceId);
        const rightIsExistingPrimary = existingPrimaryByWorkspaceId.has(right.workspace.workspaceId);
        if (leftIsExistingPrimary !== rightIsExistingPrimary) {
          return leftIsExistingPrimary ? -1 : 1;
        }
        if (left.workspace.sortOrder !== right.workspace.sortOrder) {
          return left.workspace.sortOrder - right.workspace.sortOrder;
        }
        if (left.workspace.lastOpenedAt !== right.workspace.lastOpenedAt) {
          return left.workspace.lastOpenedAt.localeCompare(right.workspace.lastOpenedAt);
        }
        if (left.canonicalPath.length !== right.canonicalPath.length) {
          return left.canonicalPath.length - right.canonicalPath.length;
        }
        return left.workspace.displayName.localeCompare(right.workspace.displayName);
      })[0],
    )
    .filter((entry): entry is (typeof inspected)[number] => Boolean(entry));
  const syncRootWorkspaceIds = new Set(syncRoots.map((entry) => entry.workspace.workspaceId));
  const staleWorkspaceIds = inspected
    .map((entry) => entry.workspace.workspaceId)
    .filter((workspaceId) => !syncRootWorkspaceIds.has(workspaceId));

  await Promise.all(
    syncRoots.map((entry) =>
      store.worktreeManager
        .refreshWorktrees({
          workspaceId: entry.workspace.workspaceId,
          path: entry.workspace.path,
          displayName: entry.workspace.displayName,
        })
        .catch(() => undefined),
    ),
  );
  await Promise.all(
    staleWorkspaceIds.map((workspaceId) =>
      store.catalogStore.worktrees.replaceWorkspaceWorktrees(workspaceId, []).catch(() => undefined),
    ),
  );

  return (await store.catalogStore.worktrees.listWorktrees()).worktrees;
}

/**
 * Build default worktree options — used both by `createWorktree` and `startThread`
 * (which lives in the main store).
 */
export function buildWorktreeOptions(
  store: AppStoreInternals,
  workspace: WorkspaceRef,
  fromSessionWorkspaceId?: string,
  fromSessionId?: string,
  titleHint?: string,
): CreateWorktreeOptions {
  const sessionTitle =
    fromSessionId && fromSessionWorkspaceId
      ? sessionTitleForWorktree(store, fromSessionWorkspaceId, fromSessionId)
      : undefined;
  const preferredTitle = shortDisplayTitle(titleHint?.trim() || sessionTitle);
  const suffix = shortUniqueSuffix();
  const baseLabel = preferredTitle
    ? clampSlug(slugify(preferredTitle), 18)
    : "wt";
  const folderName = `${baseLabel}-${suffix}`;
  const repoName = clampSlug(slugify(basename(workspace.path) || "repo"), 20);
  const displayName = preferredTitle || `Worktree ${suffix}`;
  return {
    path: join(homedir(), ".pi", "worktrees", repoName, folderName),
    displayName,
    branchName: `pi/${folderName}`,
    startPoint: "HEAD",
  };
}

/* ── Private helpers ─────────────────────────────────────── */

async function generateAndApplyAutoTitle(
  store: AppStoreInternals,
  sessionRef: { workspaceId: string; sessionId: string },
  workspace: WorkspaceRef,
  options: {
    readonly prompt: string;
    readonly requestToken: string;
    readonly signal: AbortSignal;
    readonly model?: { provider: string; modelId: string };
    readonly thinkingLevel?: string;
  },
): Promise<void> {
  const clearMatchingPendingTitle = () => {
    const pendingAutoTitle = store.getPendingAutoTitle(sessionRef);
    if (pendingAutoTitle?.requestToken === options.requestToken) {
      store.clearPendingAutoTitle(sessionRef);
    }
  };

  try {
    const generatedTitle = await store.driver.generateThreadTitle(workspace, {
      prompt: options.prompt,
      signal: options.signal,
      ...(options.model ? { model: options.model } : {}),
      ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
    });
    if (!generatedTitle) {
      clearMatchingPendingTitle();
      return;
    }
    const pendingAutoTitle = store.getPendingAutoTitle(sessionRef);
    const currentSession = store.sessionFromState(sessionRef);
    if (
      !pendingAutoTitle ||
      pendingAutoTitle.requestToken !== options.requestToken ||
      currentSession?.title !== NEW_THREAD_PLACEHOLDER_TITLE
    ) {
      return;
    }

    store.clearPendingAutoTitle(sessionRef);
    await store.driver.renameSession(sessionRef, generatedTitle);
  } catch {
    clearMatchingPendingTitle();
  }
}

function sessionTitleForWorktree(store: AppStoreInternals, workspaceId: string, sessionId: string): string | undefined {
  return store.state.workspaces
    .find((workspace) => workspace.id === workspaceId)
    ?.sessions.find((session) => session.id === sessionId)
    ?.title.trim();
}

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "worktree";
}

function clampSlug(value: string, limit = 28): string {
  if (value.length <= limit) {
    return value;
  }
  const trimmed = value.slice(0, limit).replace(/-+$/g, "");
  return trimmed || "worktree";
}

function shortUniqueSuffix(): string {
  return randomUUID().slice(0, 6);
}

/**
 * If the workspace is a multi-repo project workspace, build a context prefix
 * that tells the agent about the sub-repo layout.
 * Returns undefined for single-repo workspaces.
 */
function buildMultiRepoContext(
  workspace: { projectKey?: string; name?: string; repoPaths?: readonly string[] } | undefined,
): string | undefined {
  const repoPaths = workspace?.repoPaths;
  if (!repoPaths || repoPaths.length === 0) return undefined;
  const label = workspace?.projectKey ?? workspace?.name ?? "project";
  const lines = [
    "[Multi-repo project context]",
    `Project: ${label}`,
    "Sub-repo paths:",
    ...repoPaths.map((p) => `- ${basename(p)}: ${p}`),
    "",
  ];
  return lines.join("\n");
}

interface WorktreeContextInfo {
  readonly branchName?: string;
  /** Worktree paths for sub-repos (excludes the root repo, whose worktree IS rootPath). */
  readonly subRepoPaths: readonly string[];
  readonly rootPath: string;
}

/**
 * Builds a prompt injection for a freshly-created worktree, telling the agent
 * that the branch is already checked out and where the repos live.
 *
 * For multi-repo projects:
 *   - rootPath is the root repo's worktree (agent cwd)
 *   - sub-repos are direct children of rootPath (./repoName/)
 */
function buildWorktreeContextMessage(
  workspace: { projectKey?: string; name?: string } | undefined,
  ctx: WorktreeContextInfo,
): string {
  const isMultiRepo = ctx.subRepoPaths.length > 0;
  const label = workspace?.projectKey ?? workspace?.name ?? "project";
  const lines: string[] = [
    "[Worktree context]",
  ];
  if (isMultiRepo) {
    lines.push(`Project: ${label}`);
  }
  if (ctx.branchName) {
    lines.push(`Branch: ${ctx.branchName} (already checked out${isMultiRepo ? " in all repos" : ""})`);
  }
  lines.push(`Working directory: ${ctx.rootPath}`);
  if (isMultiRepo) {
    lines.push("", "Sub-repos are checked out as direct children of the working directory:");
    for (const p of ctx.subRepoPaths) {
      lines.push(`- ./${basename(p)}/  (${p})`);
    }
  }
  lines.push("", "The worktree is ready. Work directly in the paths above — do not create additional branches or worktrees.");
  return lines.join("\n");
}

/**
 * Builds the repos list for multi-repo worktree creation, marking the root repo.
 * The root repo's worktree will be placed at rootPath itself (agent cwd);
 * sub-repos go to rootPath/{repoName}/.
 */
function buildRepoList(
  rootWorkspaceId: string,
  wsRecord: { path: string; repoPaths?: readonly string[]; id: string },
): Array<{ name: string; path: string; workspaceId: string; isRoot: boolean }> {
  return (wsRecord.repoPaths ?? []).map((repoPath, index) => ({
    name: basename(repoPath),
    path: repoPath,
    workspaceId: repoPath === wsRecord.path ? rootWorkspaceId : `${rootWorkspaceId}-repo-${index}`,
    isRoot: repoPath === wsRecord.path,
  }));
}

function shortDisplayTitle(value: string | undefined, limit = 44): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 3).trimEnd()}...` : trimmed;
}
