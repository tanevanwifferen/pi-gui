import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { access, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { GitWorktreeManager, type CreateWorktreeOptions } from "./worktree-manager";
import type { CatalogStorage } from "@pi-gui/catalogs";

const execFileAsync = promisify(execFile);

export interface MultiRepoWorktreeSet {
  readonly rootPath: string; // ~/.worktrees/{project}/{branch}/ — also the root repo's worktree
  readonly subRepoPaths: readonly string[]; // worktree paths for sub-repos (excludes root)
}

export interface CreateWorktreeSetInput {
  readonly projectKey: string; // e.g. "my-project" (fallback if no displayName)
  readonly projectDisplayName?: string; // e.g. "PBD Development" — used for the directory name
  readonly branchName: string; // e.g. "feat/foo"
  readonly repos: readonly {
    readonly name: string; // repo short name (used for the subdir)
    readonly path: string; // absolute path of the repo
    readonly workspaceId: string; // existing workspace id for this repo
    readonly isRoot?: boolean; // true for the primary/root repo; its worktree is placed at rootPath itself
  }[];
}

export class MultiRepoWorktreeManager {
  private readonly worktreeRoot: string;

  constructor(private readonly catalogStorage: CatalogStorage) {
    this.worktreeRoot = join(homedir(), ".worktrees");
  }

  /**
   * Creates git worktrees for all repos in the project.
   *
   * The root repo's worktree is placed at rootPath itself (so the agent's cwd
   * mirrors the development directory structure where sub-repos are siblings).
   * Sub-repo worktrees go to rootPath/{repoName}/.
   *
   * Creation is sequential for the root repo first (to ensure the parent directory
   * exists), then parallel for the sub-repos. Rolls back on any partial failure.
   */
  async createWorktreeSet(input: CreateWorktreeSetInput): Promise<MultiRepoWorktreeSet> {
    const projectDirName = sanitizeProjectNameForPath(input.projectDisplayName ?? input.projectKey);
    const sanitizedBranch = sanitizeForPath(input.branchName);
    const rootPath = join(this.worktreeRoot, projectDirName, sanitizedBranch);

    const rootRepo = input.repos.find((r) => r.isRoot);
    const subRepos = input.repos.filter((r) => !r.isRoot);

    const created: string[] = [];
    try {
      // Create the root repo's worktree at rootPath itself (sequential — must exist before sub-repos).
      if (rootRepo) {
        const rootManager = new GitWorktreeManager({ catalogStorage: this.catalogStorage });
        const workspaceRef = { workspaceId: rootRepo.workspaceId, path: rootRepo.path };
        await rootManager.createWorktree(workspaceRef, {
          path: rootPath,
          branchName: input.branchName,
        });
        created.push(rootPath);
      }

      // Create sub-repo worktrees in parallel (rootPath dir now exists).
      await Promise.all(
        subRepos.map(async (repo) => {
          const manager = new GitWorktreeManager({ catalogStorage: this.catalogStorage });
          const worktreePath = join(rootPath, sanitizeForPath(repo.name));
          const workspaceRef = { workspaceId: repo.workspaceId, path: repo.path };
          await manager.createWorktree(workspaceRef, {
            path: worktreePath,
            branchName: input.branchName,
          });
          created.push(worktreePath);
        }),
      );
    } catch (err) {
      // Rollback: remove all successfully created worktrees
      await Promise.allSettled(created.map((p) => rm(p, { recursive: true, force: true })));
      throw err;
    }

    return {
      rootPath,
      subRepoPaths: subRepos.map((repo) => join(rootPath, sanitizeForPath(repo.name))),
    };
  }

  /**
   * Removes all worktrees for a project+branch combination.
   * For each repo:
   *   1. Runs `git worktree remove --force` (best-effort)
   *   2. Deletes the remote branch via `git push <remote> --delete` (best-effort)
   * Then removes the shared root directory from disk.
   *
   * Idempotent: missing directories are ignored.
   */
  async removeWorktreeSet(
    projectKey: string,
    branchName: string,
    repos?: readonly { readonly name: string; readonly path: string; readonly isRoot?: boolean }[],
    projectDisplayName?: string,
  ): Promise<void> {
    const projectDirName = sanitizeProjectNameForPath(projectDisplayName ?? projectKey);
    const sanitizedBranch = sanitizeForPath(branchName);
    const rootPath = join(this.worktreeRoot, projectDirName, sanitizedBranch);

    if (repos && repos.length > 0) {
      await Promise.allSettled(
        repos.map(async (repo) => {
          // The root repo's worktree IS rootPath; sub-repos are rootPath/{name}.
          const worktreePath = repo.isRoot ? rootPath : join(rootPath, sanitizeForPath(repo.name));
          // Skip if the worktree directory no longer exists
          const exists = await access(worktreePath).then(() => true).catch(() => false);
          if (!exists) return;

          // 1. Detach the git worktree reference from the source repo
          await execFileAsync("git", ["-C", repo.path, "worktree", "remove", "--force", worktreePath], {
            encoding: "utf8",
          }).catch(() => undefined);

          // 2. Delete the branch from all remotes (best-effort)
          if (branchName) {
            const remotes = await getRemotes(repo.path);
            await Promise.allSettled(
              remotes.map((remote) =>
                execFileAsync("git", ["-C", repo.path, "push", remote, "--delete", branchName], {
                  encoding: "utf8",
                }).catch(() => undefined),
              ),
            );
          }
        }),
      );
    }

    await rm(rootPath, { recursive: true, force: true });
  }
}

/**
 * Sanitizes a string for safe use as a filesystem path component.
 * Throws PathSafetyError if the input is unsafe or too long.
 */
export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

/**
 * Light sanitization for a project display name used as a directory component.
 * Preserves spaces and most characters; only removes truly path-unsafe characters
 * (path separators, null bytes, etc.). Does not collapse spaces to hyphens.
 */
export function sanitizeProjectNameForPath(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new PathSafetyError("Project name cannot be empty");
  if (trimmed.length > 100) throw new PathSafetyError(`Project name too long: ${trimmed.length} chars`);
  if (trimmed.includes("..")) throw new PathSafetyError("Project name must not contain ..");
  if (trimmed.startsWith("/") || trimmed.startsWith("\\"))
    throw new PathSafetyError("Project name must not be absolute");
  // Remove only truly unsafe filesystem characters; preserve spaces and most punctuation.
  return trimmed.replace(/[/\\:*?"<>|\x00]/g, "-");
}

/**
 * Returns all configured remote names for a git repo.
 * Prefers ["origin"] when origin exists; otherwise returns all remotes.
 * Returns an empty array if no remotes are configured or on any error.
 */
async function getRemotes(repoPath: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "remote"], { encoding: "utf8" });
    const remotes = stdout.split("\n").map((r) => r.trim()).filter(Boolean);
    if (remotes.includes("origin")) return ["origin"];
    return remotes;
  } catch {
    return [];
  }
}

export function sanitizeForPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new PathSafetyError("Path component cannot be empty");
  if (trimmed.length > 100) throw new PathSafetyError(`Path component too long: ${trimmed.length} chars`);
  if (trimmed.includes("..")) throw new PathSafetyError("Path component must not contain ..");
  if (trimmed.startsWith("/") || trimmed.startsWith("\\"))
    throw new PathSafetyError("Path component must not be absolute");
  // Replace path separators and other unsafe chars with hyphens
  return trimmed.replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, "-");
}
