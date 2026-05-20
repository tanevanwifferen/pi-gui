export type { DiffSource, WorkspaceContext, UnifiedDiff, ChangedFileEntry } from "./types";
export { gitSingleSource } from "./git-single";
export { gitMultiSource } from "./git-multi";

import type { DiffSource } from "./types";
import { gitSingleSource } from "./git-single";
import { gitMultiSource } from "./git-multi";

const registry = new Map<string, DiffSource>([
  [gitSingleSource.id, gitSingleSource],
  [gitMultiSource.id, gitMultiSource],
]);

export function getDiffSource(id: string): DiffSource | undefined {
  return registry.get(id);
}

export function getDefaultDiffSource(): DiffSource {
  return gitSingleSource;
}
