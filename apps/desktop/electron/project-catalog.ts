import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ProjectRepoRef {
  readonly name: string;
  readonly path: string;           // absolute
  readonly defaultBranch?: string;
  readonly role?: "root" | "sub";
}

export interface ProjectDefaults {
  readonly model?: string;
  readonly thinking?: "off" | "low" | "medium" | "high";
  readonly approvalPolicy?: "ask" | "auto-edit" | "auto-all";
}

export interface DiffViewerConfig {
  readonly viewerId?: string;
  readonly overrides?: Readonly<Record<string, string>>; // file extension -> viewer id
}

export interface ProjectRecord {
  readonly id: string;             // ulid or uuid
  readonly key: string;            // matches singularity projects.json key for imported projects
  readonly displayName: string;
  readonly color?: string;         // hex color
  readonly icon?: string;          // icon name
  readonly repos: readonly ProjectRepoRef[];
  readonly contextFiles: readonly string[];
  readonly diffViewer?: DiffViewerConfig;
  readonly defaults?: ProjectDefaults;
  readonly pinned: boolean;
  readonly lastOpenedAt?: string;  // ISO
  readonly tags: readonly string[];
  readonly source: "singularity" | "manual" | "discovered";
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class ProjectCatalogStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataDir: string) {
    this.filePath = join(userDataDir, "projects.json");
  }

  async list(): Promise<ProjectRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed as ProjectRecord[];
    } catch {
      return [];
    }
  }

  async upsert(record: ProjectRecord): Promise<void> {
    const records = await this.list();
    const index = records.findIndex((r) => r.id === record.id);
    let next: ProjectRecord[];
    if (index >= 0) {
      next = [...records.slice(0, index), record, ...records.slice(index + 1)];
    } else {
      next = [...records, record];
    }
    await this.persist(next);
  }

  async remove(id: string): Promise<void> {
    const records = await this.list();
    const next = records.filter((r) => r.id !== id);
    await this.persist(next);
  }

  async findByKey(key: string): Promise<ProjectRecord | undefined> {
    const records = await this.list();
    return records.find((r) => r.key === key);
  }

  private async persist(records: ProjectRecord[]): Promise<void> {
    const filePath = this.filePath;
    const operation = this.writeQueue.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      const payload = `${JSON.stringify(records, null, 2)}\n`;
      await writeFile(tmpPath, payload, "utf8");
      try {
        await unlink(filePath);
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }
      }
      await rename(tmpPath, filePath);
    });

    this.writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );

    await operation;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as Record<string, unknown>).code === "string" &&
    ((error as Record<string, unknown>).code === "ENOENT" ||
      (error as Record<string, unknown>).code === "ENOTDIR")
  );
}
