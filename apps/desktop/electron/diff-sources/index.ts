export type { DiffSource, WorkspaceContext, UnifiedDiff, ChangedFileEntry } from "./types";
export { gitSingleSource } from "./git-single";

import type { DiffSource } from "./types";
import { gitSingleSource } from "./git-single";

const registry = new Map<string, DiffSource>([[gitSingleSource.id, gitSingleSource]]);

export function getDiffSource(id: string): DiffSource | undefined {
  return registry.get(id);
}

export function getDefaultDiffSource(): DiffSource {
  return gitSingleSource;
}
