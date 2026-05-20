import { useMemo } from "react";
import { registerDiffViewer } from "./registry";
import type { DiffViewer, DiffViewerProps } from "./types";
import { InlineDiff } from "../diff-inline";

/** Very minimal markdown → safe HTML (no XSS: escape HTML first, then add tags) */
function renderMarkdown(md: string): string {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    // Code blocks
    .replace(/```[\s\S]*?```/g, (m) => `<pre><code>${m.slice(3, -3).replace(/^\w+\n/, "")}</code></pre>`)
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Headers
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold/italic
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    // Lists
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    // Paragraphs
    .replace(/\n\n/g, "</p><p>")
    // Wrap
    .replace(/^(.+)$/, "<p>$1</p>");
}

function MarkdownDiffViewer({ file: _file, unifiedDiff, before, after, language: _language }: DiffViewerProps) {
  const renderedBefore = useMemo(() => (before ? renderMarkdown(before) : null), [before]);
  const renderedAfter = useMemo(() => (after ? renderMarkdown(after) : null), [after]);

  if (renderedBefore !== null || renderedAfter !== null) {
    return (
      <div className="diff-markdown-viewer">
        <div className="diff-markdown-viewer__pane">
          <div className="diff-markdown-viewer__label">Before</div>
          <div
            className="diff-markdown-viewer__content"
            dangerouslySetInnerHTML={{ __html: renderedBefore ?? "<em>File did not exist</em>" }}
          />
        </div>
        <div className="diff-markdown-viewer__pane">
          <div className="diff-markdown-viewer__label">After</div>
          <div
            className="diff-markdown-viewer__content"
            dangerouslySetInnerHTML={{ __html: renderedAfter ?? "<em>File deleted</em>" }}
          />
        </div>
      </div>
    );
  }

  // Fallback to inline diff
  return <InlineDiff diff={unifiedDiff} language="markdown" />;
}

export const markdownDiffViewer: DiffViewer = {
  id: "markdown",
  displayName: "Markdown preview",
  capabilities: {
    preferredFor: ["*.md", "*.mdx", "*.markdown"],
  },
  Component: MarkdownDiffViewer,
};

registerDiffViewer(markdownDiffViewer);
