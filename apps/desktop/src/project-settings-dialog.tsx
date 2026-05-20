import { useState, useEffect } from "react";
import type { PiDesktopApi } from "./ipc";

// Inline ProjectRecord type (avoid electron-side import)
interface ProjectRecord {
  id: string;
  key: string;
  displayName: string;
  color?: string;
  icon?: string;
  repos: readonly { name: string; path: string; role?: string }[];
  defaults?: {
    model?: string;
    thinking?: "off" | "low" | "medium" | "high";
    approvalPolicy?: "ask" | "auto-edit" | "auto-all";
  };
  pinned: boolean;
  tags: readonly string[];
  contextFiles: readonly string[];
  source: string;
  lastOpenedAt?: string;
  diffViewer?: { viewerId?: string };
}

type Tab = "general" | "repos" | "advanced";

interface ProjectSettingsDialogProps {
  readonly projectId: string;
  readonly api: PiDesktopApi;
  readonly onClose: () => void;
  readonly onUpdated?: (project: ProjectRecord) => void;
}

export function ProjectSettingsDialog({ projectId, api, onClose, onUpdated }: ProjectSettingsDialogProps) {
  const [tab, setTab] = useState<Tab>("general");
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Editable fields
  const [displayName, setDisplayName] = useState("");
  const [color, setColor] = useState("");
  const [defaultThinking, setDefaultThinking] = useState<string>("off");
  const [approvalPolicy, setApprovalPolicy] = useState<string>("ask");

  useEffect(() => {
    setLoading(true);
    (api as any).listProjects()
      .then((projects: ProjectRecord[]) => {
        const p = projects.find((x) => x.id === projectId);
        if (!p) { setError("Project not found."); setLoading(false); return; }
        setProject(p);
        setDisplayName(p.displayName);
        setColor(p.color ?? "");
        setDefaultThinking(p.defaults?.thinking ?? "off");
        setApprovalPolicy(p.defaults?.approvalPolicy ?? "ask");
        setLoading(false);
      })
      .catch((e: unknown) => { setError(String(e)); setLoading(false); });
  }, [api, projectId]);

  async function handleSave() {
    if (!project || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const patch: Partial<ProjectRecord> = {
        displayName: displayName.trim() || project.displayName,
        color: color || undefined,
        defaults: {
          ...project.defaults,
          thinking: defaultThinking as NonNullable<ProjectRecord["defaults"]>["thinking"],
          approvalPolicy: approvalPolicy as NonNullable<ProjectRecord["defaults"]>["approvalPolicy"],
        },
      };
      const updated = await (api as any).updateProject(project.id, patch);
      setProject(updated);
      onUpdated?.(updated);
      setSaving(false);
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog modal-dialog--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Project settings{project ? ` — ${project.displayName}` : ""}</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <nav className="modal-tabs">
          {(["general", "repos", "advanced"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`modal-tab ${tab === t ? "modal-tab--active" : ""}`}
              onClick={() => setTab(t)}
              type="button"
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>

        <div className="modal-body">
          {loading && <div className="modal-loading">Loading…</div>}
          {error && <div className="modal-error">{error}</div>}
          {!loading && project && (
            <>
              {tab === "general" && (
                <div className="settings-section">
                  <div className="settings-group">
                    <div className="settings-row">
                      <div className="settings-row__label">
                        <div className="settings-row__title">Display name</div>
                      </div>
                      <div className="settings-row__control">
                        <input
                          className="settings-input"
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row__label">
                        <div className="settings-row__title">Accent color</div>
                        <div className="settings-row__description">Hex color for project accent (e.g. #ff6b6b)</div>
                      </div>
                      <div className="settings-row__control">
                        <input
                          className="settings-input settings-input--color"
                          type="text"
                          placeholder="#007aff"
                          value={color}
                          onChange={(e) => setColor(e.target.value)}
                        />
                        {color && /^#[0-9a-fA-F]{3,6}$/.test(color) && (
                          <span
                            className="settings-color-preview"
                            style={{ background: color }}
                          />
                        )}
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row__label">
                        <div className="settings-row__title">Default thinking level</div>
                      </div>
                      <div className="settings-row__control">
                        <select
                          className="settings-select"
                          value={defaultThinking}
                          onChange={(e) => setDefaultThinking(e.target.value)}
                        >
                          {["off", "low", "medium", "high"].map((v) => (
                            <option key={v} value={v}>{v.charAt(0).toUpperCase() + v.slice(1)}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row__label">
                        <div className="settings-row__title">Default approval policy</div>
                      </div>
                      <div className="settings-row__control">
                        <select
                          className="settings-select"
                          value={approvalPolicy}
                          onChange={(e) => setApprovalPolicy(e.target.value)}
                        >
                          <option value="ask">Ask (default)</option>
                          <option value="auto-edit">Auto-approve edits</option>
                          <option value="auto-all">Auto-approve all</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {tab === "repos" && (
                <div className="settings-section">
                  <h3 className="settings-section__title">Repositories</h3>
                  <div className="settings-group">
                    {project.repos.length === 0 ? (
                      <div className="modal-empty">No repos configured.</div>
                    ) : (
                      project.repos.map((repo) => (
                        <div key={repo.path} className="settings-row">
                          <div className="settings-row__label">
                            <div className="settings-row__title">{repo.name}</div>
                            <div className="settings-row__description">{repo.path}</div>
                          </div>
                          <div className="settings-row__control">
                            <span className="settings-row__value">{repo.role ?? "sub"}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {tab === "advanced" && (
                <div className="settings-section">
                  <h3 className="settings-section__title">Advanced</h3>
                  <div className="settings-group">
                    <div className="settings-row">
                      <div className="settings-row__label">
                        <div className="settings-row__title">Project key</div>
                        <div className="settings-row__description">Stable identifier used for worktree paths</div>
                      </div>
                      <div className="settings-row__control">
                        <span className="settings-row__value">{project.key}</span>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row__label">
                        <div className="settings-row__title">Source</div>
                      </div>
                      <div className="settings-row__control">
                        <span className="settings-row__value">{project.source}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {!loading && project && (
          <div className="modal-footer">
            {error && <span className="modal-error modal-error--inline">{error}</span>}
            <button className="button button--secondary" onClick={onClose}>Cancel</button>
            <button className="button button--primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
