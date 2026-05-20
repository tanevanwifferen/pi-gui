import { useState, useEffect, useRef, useMemo, useCallback, type KeyboardEvent } from "react";
import type { DesktopAppState, WorkspaceRecord, SessionRecord } from "./desktop-state";
import type { PiDesktopApi } from "./ipc";

type SwitcherEntry =
  | { kind: "workspace"; workspace: WorkspaceRecord }
  | { kind: "session"; workspace: WorkspaceRecord; session: SessionRecord };

function scoreEntry(entry: SwitcherEntry, query: string): number {
  const q = query.toLowerCase();
  const label = entryLabel(entry).toLowerCase();
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  // character subsequence match
  let si = 0;
  for (const c of label) {
    if (c === q[si]) si++;
  }
  return si === q.length ? 40 : 0;
}

function entryLabel(entry: SwitcherEntry): string {
  if (entry.kind === "workspace") return entry.workspace.name;
  return `${entry.workspace.name} › ${entry.session.title || "Untitled"}`;
}

function entrySubLabel(entry: SwitcherEntry): string {
  if (entry.kind === "workspace") {
    return entry.workspace.kind === "project"
      ? `Project · ${entry.workspace.repoPaths?.length ?? 1} repos`
      : entry.workspace.kind === "worktree"
      ? "Worktree"
      : entry.workspace.path;
  }
  return entry.session.preview || "";
}

interface QuickSwitcherProps {
  readonly state: DesktopAppState;
  readonly api: PiDesktopApi;
  readonly onClose: () => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly onSelectSession: (workspaceId: string, sessionId: string) => void;
}

export function QuickSwitcher({ state, api: _api, onClose, onSelectWorkspace, onSelectSession }: QuickSwitcherProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const allEntries = useMemo((): SwitcherEntry[] => {
    const entries: SwitcherEntry[] = [];
    for (const ws of state.workspaces) {
      entries.push({ kind: "workspace", workspace: ws });
      for (const session of ws.sessions) {
        if (!session.archivedAt) {
          entries.push({ kind: "session", workspace: ws, session });
        }
      }
    }
    return entries;
  }, [state.workspaces]);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      // Default order: workspaces by lastOpenedAt, then their sessions
      return allEntries.slice(0, 50);
    }
    return allEntries
      .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ entry }) => entry)
      .slice(0, 50);
  }, [allEntries, query]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const entry = filtered[selectedIndex];
        if (!entry) return;
        if (entry.kind === "workspace") {
          onSelectWorkspace(entry.workspace.id);
        } else {
          onSelectSession(entry.workspace.id, entry.session.id);
        }
        onClose();
      }
    },
    [filtered, selectedIndex, onClose, onSelectWorkspace, onSelectSession],
  );

  return (
    <div className="quick-switcher-overlay" onClick={onClose}>
      <div className="quick-switcher" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Quick switcher">
        <div className="quick-switcher__input-wrap">
          <input
            ref={inputRef}
            className="quick-switcher__input"
            type="text"
            placeholder="Search workspaces, sessions…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <ul className="quick-switcher__list" role="listbox">
          {filtered.map((entry, i) => (
            <li
              key={entry.kind === "workspace" ? entry.workspace.id : `${entry.workspace.id}/${entry.session.id}`}
              className={`quick-switcher__item quick-switcher__item--${entry.kind} ${i === selectedIndex ? "quick-switcher__item--selected" : ""}`}
              role="option"
              aria-selected={i === selectedIndex}
              onClick={() => {
                if (entry.kind === "workspace") onSelectWorkspace(entry.workspace.id);
                else onSelectSession(entry.workspace.id, entry.session.id);
                onClose();
              }}
            >
              <span className="quick-switcher__label">{entryLabel(entry)}</span>
              <span className="quick-switcher__sub">{entrySubLabel(entry)}</span>
            </li>
          ))}
          {filtered.length === 0 && <li className="quick-switcher__empty">No results</li>}
        </ul>
        <div className="quick-switcher__footer">
          <span>
            <kbd>↩</kbd> to select
          </span>
          <span>
            <kbd>↑↓</kbd> to navigate
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
