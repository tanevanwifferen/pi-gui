import { useState } from "react";
import type { WorkspaceRecord, WorktreeRecord } from "./desktop-state";
import { ArchiveIcon, WorktreeIcon } from "./icons";
import type { ThreadGroup, ThreadListEntry } from "./thread-groups";
import { formatRelativeTime } from "./string-utils";

interface WorktreesViewProps {
  readonly workspace?: WorkspaceRecord;
  readonly worktrees: readonly WorktreeRecord[];
  readonly threadGroup?: ThreadGroup;
  readonly onRemoveWorktree: (worktreeId: string) => void;
  readonly onArchiveThread: (target: { workspaceId: string; sessionId: string }) => void;
}

export function WorktreesView({
  workspace,
  worktrees,
  threadGroup,
  onRemoveWorktree,
  onArchiveThread,
}: WorktreesViewProps) {
  if (!workspace) {
    return (
      <section className="canvas canvas--empty">
        <div className="empty-panel">
          <div className="session-header__eyebrow">Worktrees</div>
          <h1>Select a workspace</h1>
          <p>Open a project folder to manage its worktrees and threads.</p>
        </div>
      </section>
    );
  }

  const worktreeThreads = (threadGroup?.threads ?? []).filter(
    (t) => t.environment.kind === "worktree",
  );
  const threadsByWorktreeLabel = new Map<string, ThreadListEntry[]>();
  for (const thread of worktreeThreads) {
    const label = thread.environment.label;
    if (!threadsByWorktreeLabel.has(label)) {
      threadsByWorktreeLabel.set(label, []);
    }
    threadsByWorktreeLabel.get(label)!.push(thread);
  }

  return (
    <section className="canvas">
      <div className="conversation worktrees-view">
        <header className="view-header">
          <div>
            <div className="chat-header__eyebrow">Worktrees</div>
            <h1 className="view-header__title">Worktrees</h1>
            <p className="view-header__body">
              Manage worktrees and the threads running inside them.
            </p>
          </div>
        </header>

        {worktrees.length === 0 ? (
          <div className="worktrees-view__empty">
            <WorktreeIcon />
            <p>No worktrees for this workspace.</p>
          </div>
        ) : (
          <div className="worktrees-view__list">
            {worktrees.map((wt) => (
              <WorktreeSection
                key={wt.id}
                worktree={wt}
                threads={threadsByWorktreeLabel.get(wt.name) ?? []}
                onRemove={() => onRemoveWorktree(wt.id)}
                onArchiveThread={onArchiveThread}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface WorktreeSectionProps {
  readonly worktree: WorktreeRecord;
  readonly threads: readonly ThreadListEntry[];
  readonly onRemove: () => void;
  readonly onArchiveThread: (target: { workspaceId: string; sessionId: string }) => void;
}

function WorktreeSection({ worktree, threads, onRemove, onArchiveThread }: WorktreeSectionProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const statusLabel: Record<string, string> = {
    ready: "Ready",
    missing: "Missing",
    error: "Error",
  };

  return (
    <div className="worktree-section">
      <div className="worktree-section__header">
        <span className="worktree-section__icon" aria-hidden="true">
          <WorktreeIcon />
        </span>
        <div className="worktree-section__meta">
          <span className="worktree-section__name">
            {worktree.branchName ?? "(detached)"}
          </span>
          <span className="worktree-section__path" title={worktree.path}>
            {worktree.path}
          </span>
        </div>
        <span
          className={`worktree-section__status worktree-section__status--${worktree.status}`}
        >
          {statusLabel[worktree.status] ?? worktree.status}
        </span>
        <div className="worktree-section__actions">
          {confirmingRemove ? (
            <>
              <span className="worktree-section__confirm-label">Remove worktree?</span>
              <button
                className="button button--danger button--sm"
                type="button"
                onClick={() => {
                  setConfirmingRemove(false);
                  onRemove();
                }}
              >
                Remove
              </button>
              <button
                className="button button--secondary button--sm"
                type="button"
                onClick={() => setConfirmingRemove(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className="button button--danger-outline button--sm"
              type="button"
              onClick={() => setConfirmingRemove(true)}
            >
              Remove worktree
            </button>
          )}
        </div>
      </div>

      <div className="worktree-section__threads">
        {threads.length === 0 ? (
          <p className="worktree-section__no-threads">No threads in this worktree.</p>
        ) : (
          threads.map((thread) => (
            <div key={`${thread.workspaceId}:${thread.session.id}`} className="worktree-thread-row">
              <div className="worktree-thread-row__body">
                <span className="worktree-thread-row__title">{thread.session.title}</span>
                {thread.session.preview ? (
                  <span className="worktree-thread-row__preview">{thread.session.preview}</span>
                ) : null}
              </div>
              <span className="worktree-thread-row__time">
                {formatRelativeTime(thread.session.updatedAt)}
              </span>
              <button
                aria-label={`Archive ${thread.session.title}`}
                className="icon-button worktree-thread-row__archive"
                type="button"
                onClick={() =>
                  onArchiveThread({
                    workspaceId: thread.workspaceId,
                    sessionId: thread.session.id,
                  })
                }
              >
                <ArchiveIcon />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
