import { useRef, useMemo, useCallback, type ReactNode } from "react";
import { registerDiffViewer } from "./registry";
import type { DiffViewer, DiffViewerProps } from "./types";
import { highlightLine, MAX_HIGHLIGHTED_LINES } from "../syntax-highlight";
import type { HighlightLine } from "../syntax-highlight";

interface SideLine {
  readonly lineNo?: number;
  readonly content: string;
  readonly kind: "added" | "removed" | "context" | "empty";
}

function parseSideBySide(diff: string): { left: SideLine[]; right: SideLine[] } {
  const left: SideLine[] = [];
  const right: SideLine[] = [];

  const lines = diff.split("\n");

  // Track current line numbers for each side
  let leftLineNo = 1;
  let rightLineNo = 1;

  // Buffers to collect removed/added runs within a hunk so we can emit them
  // aligned (removed block first left, added block first right).
  let removedBuf: SideLine[] = [];
  let addedBuf: SideLine[] = [];

  const flushHunkBuffers = () => {
    // Align removed vs added: pair them up, fill shorter side with empties.
    const maxLen = Math.max(removedBuf.length, addedBuf.length);
    for (let i = 0; i < maxLen; i++) {
      left.push(removedBuf[i] ?? { kind: "empty", content: "" });
      right.push(addedBuf[i] ?? { kind: "empty", content: "" });
    }
    removedBuf = [];
    addedBuf = [];
  };

  for (const raw of lines) {
    // Hunk header: @@ -l,s +r,s @@
    if (raw.startsWith("@@")) {
      flushHunkBuffers();
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)?/.exec(raw);
      if (match) {
        leftLineNo = parseInt(match[1]!, 10);
        rightLineNo = parseInt(match[2]!, 10);
      }
      // Emit hunk header on both panes as context (no line number)
      left.push({ kind: "context", content: raw });
      right.push({ kind: "context", content: raw });
      continue;
    }

    // Skip file header lines (--- / +++)
    if (raw.startsWith("---") || raw.startsWith("+++")) {
      continue;
    }

    if (raw.startsWith("-")) {
      // Removed: left only
      removedBuf.push({ kind: "removed", lineNo: leftLineNo, content: raw.slice(1) });
      leftLineNo += 1;
    } else if (raw.startsWith("+")) {
      // Added: right only
      addedBuf.push({ kind: "added", lineNo: rightLineNo, content: raw.slice(1) });
      rightLineNo += 1;
    } else {
      // Context (space) or plain line — flush pending add/remove buffers first
      flushHunkBuffers();
      const content = raw.startsWith(" ") ? raw.slice(1) : raw;
      if (content === "" && raw === "") {
        // Blank line at end of diff — skip noise
        continue;
      }
      left.push({ kind: "context", lineNo: leftLineNo, content });
      right.push({ kind: "context", lineNo: rightLineNo, content });
      leftLineNo += 1;
      rightLineNo += 1;
    }
  }

  // Flush any trailing buffered adds/removes
  flushHunkBuffers();

  return { left, right };
}

function renderTokens(tokens: HighlightLine): ReactNode {
  return tokens.map((token, index) =>
    typeof token === "string" ? (
      token
    ) : (
      <span className={token.className} key={index}>
        {renderTokens(token.children)}
      </span>
    ),
  );
}

function renderHighlighted(content: string, language: string): ReactNode {
  const tokens = highlightLine(content, language);
  return renderTokens(tokens);
}

function Pane({
  lines,
  highlightActive,
  language,
  paneRef,
  onScroll,
  side,
}: {
  readonly lines: SideLine[];
  readonly highlightActive: boolean;
  readonly language: string | undefined;
  readonly paneRef: React.RefObject<HTMLDivElement | null>;
  readonly onScroll: () => void;
  readonly side: "left" | "right";
}) {
  return (
    <div
      className={`diff-side-by-side__pane diff-side-by-side__pane--${side}`}
      ref={paneRef}
      onScroll={onScroll}
    >
      <pre className="diff-sbs-pre">
        {lines.map((line, i) => (
          <div key={i} className={`diff-sbs-line diff-sbs-line--${line.kind}`}>
            <span className="diff-sbs-line__no">{line.lineNo ?? ""}</span>
            <span className="diff-sbs-line__content">
              {highlightActive && line.kind !== "empty" && language !== undefined
                ? renderHighlighted(line.content, language)
                : line.content}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function SideBySideDiffViewer({ unifiedDiff, language, theme }: DiffViewerProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const { left, right } = useMemo(() => parseSideBySide(unifiedDiff), [unifiedDiff]);

  const totalLines = left.length + right.length;
  const highlightActive =
    language !== undefined && totalLines <= MAX_HIGHLIGHTED_LINES * 2;

  const syncLeft = useCallback(() => {
    if (leftRef.current && rightRef.current) {
      rightRef.current.scrollTop = leftRef.current.scrollTop;
    }
  }, []);

  const syncRight = useCallback(() => {
    if (leftRef.current && rightRef.current) {
      leftRef.current.scrollTop = rightRef.current.scrollTop;
    }
  }, []);

  return (
    <div className="diff-side-by-side" data-theme={theme}>
      <Pane
        lines={left}
        highlightActive={highlightActive}
        language={language}
        paneRef={leftRef}
        onScroll={syncLeft}
        side="left"
      />
      <Pane
        lines={right}
        highlightActive={highlightActive}
        language={language}
        paneRef={rightRef}
        onScroll={syncRight}
        side="right"
      />
    </div>
  );
}

export const sideBySideDiffViewer: DiffViewer = {
  id: "side-by-side",
  displayName: "Side by side",
  capabilities: {
    preferredFor: ["*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.go", "*.rs", "*.css"],
  },
  Component: SideBySideDiffViewer,
};

registerDiffViewer(sideBySideDiffViewer);
