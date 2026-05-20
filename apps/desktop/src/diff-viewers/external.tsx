import { useState, useEffect } from "react";
import type { DiffViewer, DiffViewerProps } from "./types";

/**
 * ExternalDiffViewer — pipes the unified diff to an allow-listed binary
 * (e.g. delta, difftastic) via the `diff:runExternalTool` IPC channel and
 * renders the plain-text stdout in a scrollable <pre>.
 *
 * NOT registered by default. Callers that want to opt in must explicitly call:
 *   import { registerDiffViewer } from "./registry";
 *   import { externalDiffViewer } from "./external";
 *   registerDiffViewer(externalDiffViewer);
 *
 * The binary path is read from `window.__externalDiffToolPath` at render time
 * so it can be set from project settings without a module reload.
 */
function ExternalDiffViewer({ unifiedDiff }: DiffViewerProps) {
  const [output, setOutput] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const toolPath = (window as unknown as Record<string, unknown>)
      .__externalDiffToolPath as string | undefined;
    if (!toolPath || !unifiedDiff) {
      setOutput(undefined);
      setError(undefined);
      return;
    }
    setError(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.piApp as any)
      .runExternalDiffTool(toolPath, unifiedDiff)
      .then((out: string) => setOutput(out))
      .catch((e: unknown) => setError(String(e)));
  }, [unifiedDiff]);

  if (error) {
    return <div className="diff-external-error">{error}</div>;
  }
  if (output === undefined) {
    return (
      <div className="diff-external-placeholder">
        External tool output will appear here.
      </div>
    );
  }
  return (
    <pre className="diff-external-output">
      {/* Strip ANSI SGR escape codes for safe plain-text rendering.
          Output is placed as text content — no innerHTML / dangerouslySetInnerHTML. */}
      {output.replace(/\x1B\[[0-9;]*m/g, "")}
    </pre>
  );
}

export const externalDiffViewer: DiffViewer = {
  id: "external",
  displayName: "External tool (delta/difftastic)",
  capabilities: {},
  Component: ExternalDiffViewer,
};

// Do NOT call registerDiffViewer here — this viewer is opt-in only.
