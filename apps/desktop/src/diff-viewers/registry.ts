import type { DiffViewer } from "./types";

const viewers = new Map<string, DiffViewer>();

export function registerDiffViewer(viewer: DiffViewer): void {
  viewers.set(viewer.id, viewer);
}

export function getDiffViewer(id: string): DiffViewer | undefined {
  return viewers.get(id);
}

export function getDefaultDiffViewer(): DiffViewer {
  const inline = viewers.get("inline");
  if (!inline) throw new Error("inline diff viewer not registered");
  return inline;
}

export function listDiffViewers(): DiffViewer[] {
  return Array.from(viewers.values());
}
