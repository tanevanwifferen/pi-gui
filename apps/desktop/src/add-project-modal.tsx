import { useEffect, useState } from "react";
import type { PiDesktopApi } from "./ipc";
import type { DesktopAppState } from "./desktop-state";

// ProjectRecord shape (inline to avoid electron-side import)
interface ProjectRecord {
  id: string;
  key: string;
  displayName: string;
  repos: readonly { name: string; path: string; role?: string }[];
  source: string;
  pinned: boolean;
  tags: readonly string[];
  contextFiles: readonly string[];
}

interface AddProjectModalProps {
  readonly api: PiDesktopApi;
  readonly onClose: () => void;
  readonly onAdded: (state: DesktopAppState) => void;
}

export function AddProjectModal({ api, onClose, onAdded }: AddProjectModalProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    // api.listProjects() exists in preload from pi-gui-588
    (api as any).listProjects()
      .then((p: ProjectRecord[]) => {
        setProjects(p);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(String(e));
        setLoading(false);
      });
  }, [api]);

  async function handleSelect(project: ProjectRecord) {
    if (submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const rootRepo = project.repos.find((r) => r.role === "root") ?? project.repos[0];
      if (!rootRepo) {
        setError("Project has no repos configured.");
        setSubmitting(false);
        return;
      }
      const result = await (api as any).addProjectWorkspace({
        projectKey: project.key,
        displayName: project.displayName,
        rootPath: rootRepo.path,
        repoPaths: project.repos.map((r) => r.path),
      });
      onAdded(result);
      onClose();
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Add project workspace</h2>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {loading && <div className="modal-loading">Loading projects…</div>}
          {error && <div className="modal-error">{error}</div>}
          {!loading && !error && projects.length === 0 && (
            <div className="modal-empty">
              No projects found. Add projects to{" "}
              <code>~/.config/singularity/projects.json</code> or run{" "}
              <strong>Import from Singularity</strong> in Settings.
            </div>
          )}
          {!loading && projects.length > 0 && (
            <ul className="project-list">
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    className="project-list-item"
                    onClick={() => handleSelect(project)}
                    disabled={submitting}
                  >
                    <span className="project-list-item__name">{project.displayName}</span>
                    <span className="project-list-item__meta">
                      {project.repos.length} repo{project.repos.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
