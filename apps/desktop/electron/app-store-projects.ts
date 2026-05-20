import type { AppStoreInternals } from "./app-store-internals";
import type { ProjectRecord } from "./project-catalog";
import { importFromSingularity } from "./singularity-importer";

export async function listProjects(store: AppStoreInternals): Promise<ProjectRecord[]> {
  return store.projectCatalog.list();
}

export async function createProject(
  store: AppStoreInternals,
  record: Omit<ProjectRecord, "id">,
): Promise<ProjectRecord> {
  const id = crypto.randomUUID();
  const project: ProjectRecord = { ...record, id };
  await store.projectCatalog.upsert(project);
  return project;
}

export async function updateProject(
  store: AppStoreInternals,
  id: string,
  patch: Partial<Omit<ProjectRecord, "id">>,
): Promise<ProjectRecord> {
  const existing = (await store.projectCatalog.list()).find((p) => p.id === id);
  if (!existing) throw new Error(`Project not found: ${id}`);
  const updated: ProjectRecord = { ...existing, ...patch, id };
  await store.projectCatalog.upsert(updated);
  return updated;
}

export async function deleteProject(store: AppStoreInternals, id: string): Promise<void> {
  await store.projectCatalog.remove(id);
}

export async function pinProject(
  store: AppStoreInternals,
  id: string,
  pinned: boolean,
): Promise<ProjectRecord> {
  return updateProject(store, id, { pinned });
}

export async function touchProject(
  store: AppStoreInternals,
  id: string,
): Promise<ProjectRecord> {
  return updateProject(store, id, { lastOpenedAt: new Date().toISOString() });
}

export async function importSingularity(
  store: AppStoreInternals,
): Promise<{ imported: number; skipped: number }> {
  return importFromSingularity(store.projectCatalog);
}
