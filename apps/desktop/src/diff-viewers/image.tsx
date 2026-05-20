import { registerDiffViewer } from "./registry";
import type { DiffViewer, DiffViewerProps } from "./types";

function ImageDiffViewer({ file, unifiedDiff, before, after }: DiffViewerProps) {
  const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
  const isSvg = ext === "svg";

  // If we have before/after content, show them side by side
  if (before !== undefined || after !== undefined) {
    return (
      <div className="diff-image-viewer">
        <div className="diff-image-viewer__pane">
          <div className="diff-image-viewer__label">Before</div>
          {before ? (
            <img
              className="diff-image-viewer__img"
              src={`data:image/${isSvg ? "svg+xml" : ext};base64,${before}`}
              alt="before"
            />
          ) : (
            <div className="diff-image-viewer__absent">File did not exist</div>
          )}
        </div>
        <div className="diff-image-viewer__pane">
          <div className="diff-image-viewer__label">After</div>
          {after ? (
            <img
              className="diff-image-viewer__img"
              src={`data:image/${isSvg ? "svg+xml" : ext};base64,${after}`}
              alt="after"
            />
          ) : (
            <div className="diff-image-viewer__absent">File deleted</div>
          )}
        </div>
      </div>
    );
  }

  // Fallback: show diff header / binary info
  return (
    <div className="diff-image-viewer diff-image-viewer--fallback">
      <div className="diff-image-viewer__icon">🖼️</div>
      <div className="diff-image-viewer__name">{file.path}</div>
      <div className="diff-image-viewer__status">
        {file.status === "added"
          ? "New image file"
          : file.status === "deleted"
            ? "Image file deleted"
            : "Image file changed"}
      </div>
      {unifiedDiff && (
        <pre className="diff-image-viewer__raw">{unifiedDiff.slice(0, 500)}</pre>
      )}
    </div>
  );
}

export const imageDiffViewer: DiffViewer = {
  id: "image",
  displayName: "Image viewer",
  capabilities: {
    handlesBinary: true,
    preferredFor: ["*.png", "*.jpg", "*.jpeg", "*.gif", "*.webp", "*.svg", "*.ico", "*.bmp"],
  },
  Component: ImageDiffViewer,
};

registerDiffViewer(imageDiffViewer);
