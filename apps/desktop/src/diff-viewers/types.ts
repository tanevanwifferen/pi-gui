import type { ComponentType } from "react";

export interface ChangedFileEntry {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "untracked";
  readonly staged: boolean;
}

export interface DiffViewerProps {
  readonly file: ChangedFileEntry;
  readonly unifiedDiff: string;       // raw unified diff text
  readonly before?: string;           // optional full file content before
  readonly after?: string;            // optional full file content after
  readonly language?: string;         // syntax highlight language hint
  readonly theme: "light" | "dark";
}

export interface DiffViewerCapabilities {
  readonly handlesBinary?: boolean;
  readonly handlesLargeFiles?: boolean;
  readonly preferredFor?: readonly string[];  // glob patterns or mime types
}

export interface DiffViewer {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: DiffViewerCapabilities;
  readonly Component: ComponentType<DiffViewerProps>;
}
