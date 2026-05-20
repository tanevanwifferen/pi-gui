export type { DiffSource, WorkspaceContext, UnifiedDiff, ChangedFileEntry } from "./types";
export { gitSingleSource } from "./git-single";
export { gitMultiSource } from "./git-multi";
export { gitCrossBranchSource } from "./git-cross-branch";
export type { CrossBranchContext, RepoBranchInfo } from "./git-cross-branch";

import type { DiffSource } from "./types";
import { gitSingleSource } from "./git-single";
import { gitMultiSource } from "./git-multi";
import { gitCrossBranchSource } from "./git-cross-branch";

const registry = new Map<string, DiffSource>([
  [gitSingleSource.id, gitSingleSource],
  [gitMultiSource.id, gitMultiSource],
  [gitCrossBranchSource.id, gitCrossBranchSource],
]);

export function getDiffSource(id: string): DiffSource | undefined {
  return registry.get(id);
}

export function getDefaultDiffSource(): DiffSource {
  return gitSingleSource;
}
