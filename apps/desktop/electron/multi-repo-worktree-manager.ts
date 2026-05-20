import { homedir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { GitWorktreeManager, type CreateWorktreeOptions } from "./worktree-manager";
import type { CatalogStorage } from "@pi-gui/catalogs";

export interface MultiRepoWorktreeSet {
  readonly rootPath: string; // ~/.worktrees/{project}/{branch}/
  readonly paths: readonly string[]; // one path per repo
}

export interface CreateWorktreeSetInput {
  readonly projectKey: string; // e.g. "my-project"
  readonly branchName: string; // e.g. "feat/foo"
  readonly repos: readonly {
    readonly name: string; // repo short name (used for the subdir)
    readonly path: string; // absolute path of the repo
    readonly workspaceId: string; // existing workspace id for this repo
  }[];
}

export class MultiRepoWorktreeManager {
  private readonly worktreeRoot: string;

  constructor(private readonly catalogStorage: CatalogStorage) {
    this.worktreeRoot = join(homedir(), ".worktrees");
  }

  /**
   * Creates git worktrees for all repos in the project concurrently.
   * Rolls back on any partial failure (removes all created worktrees).
   */
  async createWorktreeSet(input: CreateWorktreeSetInput): Promise<MultiRepoWorktreeSet> {
    const sanitizedKey = sanitizeForPath(input.projectKey);
    const sanitizedBranch = sanitizeForPath(input.branchName);
    const rootPath = join(this.worktreeRoot, sanitizedKey, sanitizedBranch);

    const created: string[] = [];
    try {
      await Promise.all(
        input.repos.map(async (repo) => {
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
      paths: input.repos.map((repo) => join(rootPath, sanitizeForPath(repo.name))),
    };
  }

  /**
   * Removes all worktrees for a project+branch combination.
   * Idempotent: missing directories are ignored.
   */
  async removeWorktreeSet(projectKey: string, branchName: string): Promise<void> {
    const sanitizedKey = sanitizeForPath(projectKey);
    const sanitizedBranch = sanitizeForPath(branchName);
    const rootPath = join(this.worktreeRoot, sanitizedKey, sanitizedBranch);
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
