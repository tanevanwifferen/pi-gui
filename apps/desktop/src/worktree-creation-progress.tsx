interface WorktreeCreationProgressProps {
  readonly repoCount: number;
  readonly state: "creating" | "done" | "failed";
  readonly error?: string;
  readonly onRetry?: () => void;
  readonly onDismiss: () => void;
}

export function WorktreeCreationProgress({
  repoCount,
  state,
  error,
  onRetry,
  onDismiss,
}: WorktreeCreationProgressProps) {
  return (
    <div className="worktree-progress-overlay">
      <div className="worktree-progress">
        {state === "creating" && (
          <>
            <div className="worktree-progress__spinner" aria-label="Creating" />
            <div className="worktree-progress__title">
              Creating worktrees for {repoCount} repo{repoCount !== 1 ? "s" : ""}…
            </div>
            <div className="worktree-progress__sub">This may take a few seconds.</div>
          </>
        )}
        {state === "done" && (
          <>
            <div className="worktree-progress__icon">✓</div>
            <div className="worktree-progress__title">Worktrees created</div>
            <button className="button button--primary" onClick={onDismiss}>Continue</button>
          </>
        )}
        {state === "failed" && (
          <>
            <div className="worktree-progress__icon worktree-progress__icon--error">⚠️</div>
            <div className="worktree-progress__title">Worktree creation failed</div>
            {error && <div className="worktree-progress__error">{error}</div>}
            <div className="worktree-progress__actions">
              {onRetry && (
                <button className="button button--secondary" onClick={onRetry}>Retry</button>
              )}
              <button className="button button--secondary" onClick={onDismiss}>Dismiss</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
