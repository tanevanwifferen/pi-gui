import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { DiffSource, WorkspaceContext, UnifiedDiff, ChangedFileEntry } from "./types";

const execFileAsync = promisify(execFile);

export interface CrossBranchContext extends WorkspaceContext {
  readonly featureBranch: string;   // e.g. "feat/my-feature"
  readonly baseBranch?: string;     // default: auto-detect (main/master/HEAD)
}

export interface RepoBranchInfo {
  readonly repoPath: string;
  readonly repoName: string;
  readonly featureBranchExists: boolean;
  readonly baseBranch: string;
  readonly aheadCount: number;      // commits ahead of base
  readonly behindCount: number;     // commits behind base
}

/**
 * Detect the default branch for a repo (tries origin/HEAD, then main, then master).
 */
async function detectDefaultBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
      { cwd: repoPath }
    );
    const branch = stdout.trim().replace(/^origin\//, "");
    if (branch) return branch;
  } catch { /* fallback */ }
  for (const candidate of ["main", "master"]) {
    try {
      await execFileAsync("git", ["rev-parse", "--verify", candidate], { cwd: repoPath });
      return candidate;
    } catch { /* try next */ }
  }
  return "main";
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", branch], { cwd: repoPath });
    return true;
  } catch {
    return false;
  }
}

async function aheadBehind(
  repoPath: string,
  base: string,
  feature: string
): Promise<{ ahead: number; behind: number }> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--left-right", "--count", `${base}...${feature}`],
      { cwd: repoPath }
    );
    const [behindStr, aheadStr] = stdout.trim().split("\t");
    return {
      ahead: parseInt(aheadStr ?? "0", 10),
      behind: parseInt(behindStr ?? "0", 10),
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

/**
 * Get per-repo branch info for a cross-branch context.
 */
export async function getRepoBranchInfos(ctx: CrossBranchContext): Promise<RepoBranchInfo[]> {
  const repoPaths = ctx.repoPaths ?? [ctx.path];
  return Promise.all(
    repoPaths.map(async (repoPath) => {
      const baseBranch = ctx.baseBranch ?? (await detectDefaultBranch(repoPath));
      const featureBranchExists = await branchExists(repoPath, ctx.featureBranch);
      const { ahead, behind } = featureBranchExists
        ? await aheadBehind(repoPath, baseBranch, ctx.featureBranch)
        : { ahead: 0, behind: 0 };
      return {
        repoPath,
        repoName: path.basename(repoPath),
        featureBranchExists,
        baseBranch,
        aheadCount: ahead,
        behindCount: behind,
      };
    })
  );
}

function parseNameStatus(s: string): ChangedFileEntry["status"] {
  switch ((s[0] ?? "").toUpperCase()) {
    case "A": return "added";
    case "D": return "deleted";
    default:  return "modified";
  }
}

export const gitCrossBranchSource: DiffSource = {
  id: "git-cross-branch",

  async list(workspace: WorkspaceContext): Promise<ChangedFileEntry[]> {
    const ctx = workspace as CrossBranchContext;
    if (!ctx.featureBranch) return [];
    const repoPaths = ctx.repoPaths ?? [ctx.path];

    const results = await Promise.all(
      repoPaths.map(async (repoPath) => {
        const repoName = path.basename(repoPath);
        const baseBranch = ctx.baseBranch ?? (await detectDefaultBranch(repoPath));
        const exists = await branchExists(repoPath, ctx.featureBranch);
        if (!exists) return [];
        try {
          const { stdout } = await execFileAsync(
            "git",
            ["diff", "--name-status", `${baseBranch}...${ctx.featureBranch}`],
            { cwd: repoPath, maxBuffer: 2 * 1024 * 1024 }
          );
          return stdout
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const [statusChar, ...rest] = line.split("\t");
              const filePath = rest[rest.length - 1] ?? "";
              return {
                path: `${repoName}:${filePath}`,
                status: parseNameStatus(statusChar ?? ""),
                staged: false,
              } satisfies ChangedFileEntry;
            });
        } catch {
          return [];
        }
      })
    );

    return results.flat().sort((a, b) => a.path.localeCompare(b.path));
  },

  async read(workspace: WorkspaceContext, file: string): Promise<UnifiedDiff> {
    const ctx = workspace as CrossBranchContext;
    const colonIdx = file.indexOf(":");
    const repoName = colonIdx >= 0 ? file.slice(0, colonIdx) : "";
    const relPath = colonIdx >= 0 ? file.slice(colonIdx + 1) : file;
    const repoPaths = ctx.repoPaths ?? [ctx.path];
    const repoPath =
      repoPaths.find((p) => path.basename(p) === repoName) ?? ctx.path;
    const baseBranch = ctx.baseBranch ?? (await detectDefaultBranch(repoPath));
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff", `${baseBranch}...${ctx.featureBranch}`, "--", relPath],
        { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 }
      );
      return { text: stdout };
    } catch {
      return { text: "" };
    }
  },
};
