import path from "node:path";
import { execFile } from "node:child_process";

import type { DiffSource, WorkspaceContext, UnifiedDiff, ChangedFileEntry } from "./types";

// ---------------------------------------------------------------------------
// Helpers (mirror git-single.ts logic, parameterised on repoPath)
// ---------------------------------------------------------------------------

function parseStatus(xy: string): ChangedFileEntry["status"] {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";

  if (x === "?" && y === "?") {
    return "untracked";
  }
  if (x === "A" || y === "A") {
    return "added";
  }
  if (x === "D" || y === "D") {
    return "deleted";
  }
  return "modified";
}

function isFullyStaged(xy: string): boolean {
  const x = xy[0] ?? " ";
  const y = xy[1] ?? " ";
  if (x === "?" || x === " ") return false;
  return y === " ";
}

function repoName(repoPath: string): string {
  return path.basename(repoPath);
}

function validateFilePath(repoPath: string, filePath: string): string {
  const resolved = path.resolve(repoPath, filePath);
  if (!resolved.startsWith(repoPath + path.sep) && resolved !== repoPath) {
    throw new Error("Path escapes workspace");
  }
  return filePath;
}

// ---------------------------------------------------------------------------
// Per-repo helpers
// ---------------------------------------------------------------------------

function getChangedFilesForRepo(repoPath: string): Promise<ChangedFileEntry[]> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["status", "--porcelain"],
      { cwd: repoPath, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        const entries: ChangedFileEntry[] = [];
        for (const line of stdout.split("\n")) {
          if (!line.trim()) continue;
          const xy = line.slice(0, 2);
          let filePath = line.slice(3).trim();
          const renameArrow = filePath.indexOf(" -> ");
          if (renameArrow >= 0) {
            filePath = filePath.slice(renameArrow + 4);
          }
          entries.push({
            path: filePath,
            status: parseStatus(xy),
            staged: isFullyStaged(xy),
          });
        }
        resolve(entries);
      },
    );
  });
}

function getFileDiffForRepo(repoPath: string, filePath: string): Promise<string> {
  validateFilePath(repoPath, filePath);
  return new Promise((resolve) => {
    execFile(
      "git",
      ["diff", "--", filePath],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          execFile(
            "git",
            ["diff", "--cached", "--", filePath],
            { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 },
            (error2, stdout2) => {
              if (!error2 && stdout2.trim()) {
                resolve(stdout2);
                return;
              }
              execFile(
                "git",
                ["diff", "--no-index", "--", "/dev/null", filePath],
                { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 },
                (_error3, stdout3) => {
                  resolve(stdout3 || "");
                },
              );
            },
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// DiffSource implementation
// ---------------------------------------------------------------------------

export const gitMultiSource: DiffSource = {
  id: "git-multi",

  async list(workspace: WorkspaceContext): Promise<ChangedFileEntry[]> {
    const repoPaths = workspace.repoPaths ?? [workspace.path];
    const results = await Promise.all(
      repoPaths.map(async (repoPath) => {
        const files = await getChangedFilesForRepo(repoPath);
        const name = repoName(repoPath);
        return files.map((f) => ({ ...f, path: `${name}:${f.path}` }));
      }),
    );
    // Flatten and stable-sort: by repoName prefix first, then by file path
    return results
      .flat()
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
  },

  async read(workspace: WorkspaceContext, file: string): Promise<UnifiedDiff> {
    const colonIdx = file.indexOf(":");
    if (colonIdx < 0) {
      // Fallback: treat as single-repo path in workspace.path
      const text = await getFileDiffForRepo(workspace.path, file);
      return { text };
    }
    const name = file.slice(0, colonIdx);
    const relPath = file.slice(colonIdx + 1);
    const repoPaths = workspace.repoPaths ?? [workspace.path];
    const repoPath = repoPaths.find((p) => repoName(p) === name) ?? workspace.path;
    const text = await getFileDiffForRepo(repoPath, relPath);
    return { text };
  },
};
