import { registerDiffViewer } from "./registry";
import type { DiffViewer, DiffViewerProps } from "./types";
import { InlineDiff } from "../diff-inline";

function InlineDiffViewer({ file, unifiedDiff, language }: DiffViewerProps) {
  return <InlineDiff diff={unifiedDiff} language={language} />;
}

export const inlineDiffViewer: DiffViewer = {
  id: "inline",
  displayName: "Inline diff",
  capabilities: {
    preferredFor: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.go", "*.rs"],
  },
  Component: InlineDiffViewer,
};

registerDiffViewer(inlineDiffViewer);
