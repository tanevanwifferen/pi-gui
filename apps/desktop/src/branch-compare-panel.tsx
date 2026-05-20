import { useState, useEffect, useCallback } from "react";
import type { PiDesktopApi } from "./ipc";
import type { WorkspaceRecord } from "./desktop-state";
import { getDiffViewer, getDefaultDiffViewer } from "./diff-viewers/index";
import { extensionToLanguage } from "./syntax-highlight";

interface RepoBranchInfo {
  repoPath: string;
  repoName: string;
  featureBranchExists: boolean;
  baseBranch: string;
  aheadCount: number;
  behindCount: number;
}

interface ChangedFile {
  path: string;
  status: string;
  staged: boolean;
}

interface BranchComparePanelProps {
  readonly workspace: WorkspaceRecord;
  readonly api: PiDesktopApi;
}

export function BranchComparePanel({ workspace, api }: BranchComparePanelProps) {
  const [featureBranch, setFeatureBranch] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [infos, setInfos] = useState<RepoBranchInfo[]>([]);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffText, setDiffText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const runCompare = useCallback(async () => {
    if (!featureBranch.trim()) return;
    setLoading(true);
    setError(undefined);
    setFiles([]);
    setInfos([]);
    try {
      const [newInfos, newFiles] = await Promise.all([
        (api as any).branchCompareInfos(workspace.id, featureBranch.trim(), baseBranch.trim() || undefined),
        (api as any).branchCompareFiles(workspace.id, featureBranch.trim(), baseBranch.trim() || undefined),
      ]);
      setInfos(newInfos);
      setFiles(newFiles);
      if (newFiles.length > 0) {
        setSelectedFile(newFiles[0].path);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [api, workspace.id, featureBranch, baseBranch]);

  useEffect(() => {
    if (!selectedFile) { setDiffText(""); return; }
    void (api as any)
      .branchCompareDiff(workspace.id, featureBranch, selectedFile, baseBranch || undefined)
      .then((result: { text: string }) => setDiffText(result.text))
      .catch(() => setDiffText(""));
  }, [api, workspace.id, featureBranch, baseBranch, selectedFile]);

  const language = selectedFile ? extensionToLanguage(selectedFile) : undefined;
  const Viewer = (getDiffViewer("inline") ?? getDefaultDiffViewer()).Component;

  return (
    <div className="branch-compare-panel">
      <div className="branch-compare-panel__controls">
        <input
          className="branch-compare-panel__input"
          type="text"
          placeholder="Feature branch (e.g. feat/my-feature)"
          value={featureBranch}
          onChange={(e) => setFeatureBranch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void runCompare(); }}
        />
        <input
          className="branch-compare-panel__input"
          type="text"
          placeholder="Base branch (leave blank for auto-detect)"
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
        />
        <button
          className="button button--primary"
          onClick={runCompare}
          disabled={loading || !featureBranch.trim()}
        >
          {loading ? "Comparing…" : "Compare"}
        </button>
      </div>

      {error && <div className="branch-compare-panel__error">{error}</div>}

      {infos.length > 0 && (
        <div className="branch-compare-panel__repo-summary">
          {infos.map((info) => (
            <div key={info.repoPath} className={`branch-compare-panel__repo ${info.featureBranchExists ? "" : "branch-compare-panel__repo--missing"}`.trim()}>
              <span className="branch-compare-panel__repo-name">{info.repoName}</span>
              {info.featureBranchExists ? (
                <span className="branch-compare-panel__repo-stat">
                  +{info.aheadCount} −{info.behindCount} vs {info.baseBranch}
                </span>
              ) : (
                <span className="branch-compare-panel__repo-missing">branch not found</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="branch-compare-panel__body">
        {files.length > 0 && (
          <ul className="branch-compare-panel__file-list">
            {files.map((f) => (
              <li key={f.path}>
                <button
                  className={`branch-compare-panel__file-btn ${f.path === selectedFile ? "branch-compare-panel__file-btn--active" : ""}`}
                  onClick={() => setSelectedFile(f.path)}
                >
                  {f.path}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="branch-compare-panel__diff">
          {diffText ? (
            <Viewer
              file={{ path: selectedFile ?? "", status: "modified", staged: false }}
              unifiedDiff={diffText}
              language={language}
              theme="dark"
            />
          ) : selectedFile ? (
            <div className="branch-compare-panel__empty">Loading diff…</div>
          ) : files.length === 0 && !loading ? (
            <div className="branch-compare-panel__empty">
              {featureBranch ? "No changed files found." : "Enter a feature branch name above and click Compare."}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
