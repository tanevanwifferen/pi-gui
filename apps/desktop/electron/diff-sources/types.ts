export interface ChangedFileEntry {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

export interface WorkspaceContext {
  readonly workspaceId: string;
  readonly path: string;             // root repo absolute path
  readonly repoPaths?: readonly string[];  // for multi-repo; undefined = single-repo
}

export interface UnifiedDiff {
  readonly text: string;             // raw unified diff text
}

export interface DiffSource {
  readonly id: string;
  list(workspace: WorkspaceContext): Promise<ChangedFileEntry[]>;
  read(workspace: WorkspaceContext, file: string): Promise<UnifiedDiff>;
}
