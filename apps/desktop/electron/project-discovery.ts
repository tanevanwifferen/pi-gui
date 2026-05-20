import { readdir, stat } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import type { ProjectRepoRef } from "./project-catalog";

export interface DiscoveryOptions {
  readonly rootDir: string;           // default: ~/code
  readonly maxDepth?: number;          // default: 4
  readonly ignore?: readonly string[]; // dir names to skip
}

export interface DiscoveredProject {
  readonly key: string;               // e.g. "my-app" (parent dir name)
  readonly displayName: string;       // titlecase of key
  readonly repos: readonly ProjectRepoRef[];
}

const DEFAULT_IGNORE = ["node_modules", ".git", "dist", "out", "build", ".cache", ".next"];

/**
 * Recursively scans rootDir for git repos, groups siblings under the same
 * parent into suggested projects. Returns suggested DiscoveredProject[].
 * Non-fatal: returns [] on any fs error.
 */
export async function discoverProjects(opts: DiscoveryOptions): Promise<DiscoveredProject[]> {
  const maxDepth = opts.maxDepth ?? 4;
  const ignore = new Set(opts.ignore ?? DEFAULT_IGNORE);

  // Map from parent dir → list of git repo absolute paths found inside it
  const reposByParent = new Map<string, string[]>();

  try {
    await walk(opts.rootDir, 0, maxDepth, ignore, reposByParent);
  } catch {
    return [];
  }

  const projects: DiscoveredProject[] = [];
  for (const [parentDir, repoPaths] of reposByParent) {
    if (repoPaths.length === 0) continue;
    const key = basename(parentDir);
    const repos: ProjectRepoRef[] = repoPaths.map((p, i) => ({
      name: basename(p),
      path: p,
      role: i === 0 ? "root" : "sub",
    }));
    projects.push({
      key,
      displayName: toDisplayName(key),
      repos,
    });
  }

  return projects;
}

async function walk(
  dir: string,
  depth: number,
  maxDepth: number,
  ignore: Set<string>,
  reposByParent: Map<string, string[]>,
): Promise<void> {
  if (depth > maxDepth) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  // Check if this directory itself is a git repo
  if (entries.includes(".git")) {
    const parent = dirname(dir);
    const list = reposByParent.get(parent);
    if (list) {
      list.push(dir);
    } else {
      reposByParent.set(parent, [dir]);
    }
    // Don't descend further into git repos
    return;
  }

  // Recurse into non-ignored subdirectories in parallel
  const filtered = entries.filter((name) => !ignore.has(name));
  await Promise.all(
    filtered.map(async (name) => {
      const full = join(dir, name);
      try {
        const s = await stat(full);
        if (s.isDirectory()) {
          await walk(full, depth + 1, maxDepth, ignore, reposByParent);
        }
      } catch {
        // skip unreadable entries
      }
    }),
  );
}

function toDisplayName(key: string): string {
  return key
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
