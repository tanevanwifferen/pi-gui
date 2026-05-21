import type { DesktopAppState, SessionRecord, WorkspaceRecord } from "./desktop-state";

export interface ThreadEnvironmentMeta {
  readonly kind: "local" | "worktree";
  readonly label: string;
  readonly branchName?: string;
  readonly detached?: boolean;
}

export interface ThreadListEntry {
  readonly workspaceId: string;
  readonly session: SessionRecord;
  readonly environment: ThreadEnvironmentMeta;
  /** Subagent sessions spawned by this session, recursively. */
  readonly subthreads: readonly ThreadListEntry[];
}

export interface ThreadGroup {
  readonly rootWorkspace: WorkspaceRecord;
  readonly threads: readonly ThreadListEntry[];
  readonly archivedThreads: readonly ThreadListEntry[];
}

export function buildThreadGroups(state: DesktopAppState): readonly ThreadGroup[] {
  const workspacesById = new Map(state.workspaces.map((workspace) => [workspace.id, workspace] as const));
  const rootWorkspaces = state.workspaces.filter((workspace) => workspace.kind === "primary" || workspace.kind === "project");
  const orphanWorktrees = state.workspaces.filter(
    (workspace) => workspace.kind === "worktree" && !workspacesById.has(workspace.rootWorkspaceId ?? ""),
  );

  const order = state.workspaceOrder;
  const sortedRoots = [...rootWorkspaces].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    // Workspaces not in the order list come first (newly added)
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return -1;
    if (bi === -1) return 1;
    return ai - bi;
  });

  return [
    ...sortedRoots.map((workspace) => buildRootGroup(state, workspacesById, workspace)),
    ...orphanWorktrees.map(buildOrphanGroup),
  ];
}

function buildRootGroup(
  state: DesktopAppState,
  workspacesById: ReadonlyMap<string, WorkspaceRecord>,
  rootWorkspace: WorkspaceRecord,
): ThreadGroup {
  const linkedWorkspaces = (state.worktreesByWorkspace[rootWorkspace.id] ?? [])
    .map((worktree) => ({
      worktree,
      workspace: worktree.linkedWorkspaceId ? workspacesById.get(worktree.linkedWorkspaceId) : undefined,
    }))
    .filter((entry): entry is { worktree: NonNullable<(typeof state.worktreesByWorkspace)[string][number]>; workspace: WorkspaceRecord } =>
      Boolean(entry.workspace),
    );

  const flatEntries: Array<Omit<ThreadListEntry, "subthreads">> = [
    ...rootWorkspace.sessions.map((session) => ({
      workspaceId: rootWorkspace.id,
      session,
      environment: {
        kind: "local" as const,
        label: "Local",
      },
    })),
    ...linkedWorkspaces.flatMap(({ workspace, worktree }) =>
      workspace.sessions.map((session) => ({
        workspaceId: workspace.id,
        session,
        environment: {
          kind: "worktree" as const,
          label: worktree.name,
          branchName: worktree.branchName,
          detached: !worktree.branchName,
        },
      })),
    ),
  ];

  flatEntries.sort((left, right) => {
    if (left.session.updatedAt !== right.session.updatedAt) {
      return right.session.updatedAt.localeCompare(left.session.updatedAt);
    }
    return left.session.title.localeCompare(right.session.title);
  });

  const threads = buildSessionTree(flatEntries);
  return partitionThreads(rootWorkspace, threads);
}

function buildOrphanGroup(workspace: WorkspaceRecord): ThreadGroup {
  const flat = workspace.sessions.map((session) => ({
    workspaceId: workspace.id,
    session,
    environment: {
      kind: "worktree" as const,
      label: workspace.name,
      branchName: workspace.branchName,
      detached: !workspace.branchName,
    },
  }));
  return partitionThreads(workspace, buildSessionTree(flat));
}

/**
 * Given a flat list of entries (no subthreads yet), build a tree by attaching
 * child sessions (those whose parentSessionId matches a sibling) recursively.
 * Root entries — those with no parent within the group — are returned.
 */
function buildSessionTree(
  entries: readonly Omit<ThreadListEntry, "subthreads">[],
): ThreadListEntry[] {
  const sessionIds = new Set(entries.map((e) => e.session.id));

  // Group children by their parent session ID.
  const childrenByParentId = new Map<string, Array<Omit<ThreadListEntry, "subthreads">>>();
  const rootEntries: Array<Omit<ThreadListEntry, "subthreads">> = [];

  for (const entry of entries) {
    const parentId = entry.session.parentSessionId;
    if (parentId && sessionIds.has(parentId)) {
      let bucket = childrenByParentId.get(parentId);
      if (!bucket) {
        bucket = [];
        childrenByParentId.set(parentId, bucket);
      }
      bucket.push(entry);
    } else {
      rootEntries.push(entry);
    }
  }

  function buildEntry(entry: Omit<ThreadListEntry, "subthreads">): ThreadListEntry {
    const children = childrenByParentId.get(entry.session.id) ?? [];
    return {
      ...entry,
      subthreads: children.map(buildEntry),
    };
  }

  return rootEntries.map(buildEntry);
}

function partitionThreads(rootWorkspace: WorkspaceRecord, entries: readonly ThreadListEntry[]): ThreadGroup {
  return {
    rootWorkspace,
    threads: entries.filter((entry) => !entry.session.archivedAt),
    archivedThreads: entries.filter((entry) => Boolean(entry.session.archivedAt)),
  };
}
