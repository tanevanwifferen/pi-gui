import { execFile } from "node:child_process";

/**
 * Allow-list of permitted external diff tool binary names.
 * Disabled by default — callers must validate the tool path before invoking.
 */
const ALLOWED_TOOL_NAMES = ["delta", "difftastic", "diff-highlight"];

/**
 * Returns true if the binary name of `toolPath` is in the allow-list.
 * Matching is done on the basename only; users should supply full absolute
 * paths so the OS resolves unambiguously without PATH search.
 */
export function isAllowedTool(toolPath: string): boolean {
  const name = toolPath.split("/").pop() ?? toolPath;
  return ALLOWED_TOOL_NAMES.some(
    (allowed) => name === allowed || name.startsWith(allowed + "."),
  );
}

/**
 * Run an external diff tool with the unified diff fed via stdin.
 *
 * Security controls enforced here:
 * - Binary name must match the allow-list (no arbitrary execution)
 * - Shell metacharacters are rejected in the tool path
 * - `shell: false` — no shell interpolation
 * - `env: {}` — empty environment, prevents leaking tokens/secrets to the child
 * - 10 s timeout kills hung tools
 * - 5 MB maxBuffer caps output
 */
export function runExternalDiffTool(
  toolPath: string,
  diffText: string,
): Promise<string> {
  if (!isAllowedTool(toolPath)) {
    return Promise.reject(new Error(`Tool not in allow-list: ${toolPath}`));
  }
  // Belt-and-suspenders: reject obvious shell injection chars even though
  // shell:false already prevents interpretation.
  if (/[;&|`$<>]/.test(toolPath)) {
    return Promise.reject(new Error("Tool path contains disallowed characters"));
  }
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      toolPath,
      [], // no user-supplied args in v1
      {
        shell: false, // MUST remain false — never set to true
        env: {}, // empty env — prevents env-var leakage to child process
        encoding: "utf8",
        maxBuffer: 5 * 1024 * 1024,
        timeout: 10_000,
      },
      (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          resolve(stdout as string);
        }
      },
    );
    child.stdin?.end(diffText, "utf8");
  });
}
