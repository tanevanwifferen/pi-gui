import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectCatalogStore, ProjectRepoRef } from "./project-catalog.js";

// ── Singularity config types ──────────────────────────────────────────────────

interface SingularityRepoDef {
  name: string;
  path: string;            // may start with ~
  default_branch?: string;
  [key: string]: unknown;
}

interface SingularityProjectDef {
  name: string;
  repos: SingularityRepoDef[];
  [key: string]: unknown;
}

interface SingularityConfig {
  projects: Record<string, SingularityProjectDef>;
  [key: string]: unknown;
}

// ── Secret field names to strip (ISO 27001) ───────────────────────────────────

const SECRET_FIELDS = new Set(["token", "api_key", "password", "secret"]);

// ── Public API ────────────────────────────────────────────────────────────────

export async function importFromSingularity(
  catalog: ProjectCatalogStore,
): Promise<{ imported: number; skipped: number }> {
  const configPath = join(homedir(), ".config", "singularity", "projects.json");

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    // Missing or unreadable — non-fatal
    return { imported: 0, skipped: 0 };
  }

  let config: SingularityConfig;
  try {
    config = JSON.parse(raw) as SingularityConfig;
  } catch {
    return { imported: 0, skipped: 0 };
  }

  if (!config || typeof config.projects !== "object" || config.projects === null) {
    return { imported: 0, skipped: 0 };
  }

  let imported = 0;
  let skipped = 0;

  for (const [key, projectDef] of Object.entries(config.projects)) {
    if (!projectDef || typeof projectDef !== "object") {
      skipped++;
      continue;
    }

    // Idempotent: skip if already cataloged under any source
    const existing = await catalog.findByKey(key);
    if (existing !== undefined) {
      skipped++;
      continue;
    }

    const repos: ProjectRepoRef[] = Array.isArray(projectDef.repos)
      ? projectDef.repos
          .filter((r): r is SingularityRepoDef => !!r && typeof r === "object")
          .map((r) => {
            const repoObj = stripSecrets(r);
            const expandedPath =
              typeof repoObj.path === "string" ? expandHome(repoObj.path) : "";
            const entry: ProjectRepoRef = {
              name: typeof repoObj.name === "string" ? repoObj.name : key,
              path: expandedPath,
              ...(typeof repoObj.default_branch === "string"
                ? { defaultBranch: repoObj.default_branch }
                : {}),
            };
            return entry;
          })
      : [];

    const displayName =
      typeof projectDef.name === "string" && projectDef.name.length > 0
        ? projectDef.name
        : key;

    await catalog.upsert({
      id: randomUUID(),
      key,
      displayName,
      repos,
      contextFiles: [],
      pinned: false,
      tags: [],
      source: "singularity",
    });

    imported++;
  }

  return { imported, skipped };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function expandHome(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return homedir() + p.slice(1);
  }
  return p;
}

function stripSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!SECRET_FIELDS.has(k.toLowerCase())) {
      result[k] = v;
    }
  }
  return result;
}
