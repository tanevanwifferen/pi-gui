# External Diff Tool Adapter — Threat Model

## Summary

The external diff tool adapter (`diff:runExternalTool` IPC channel) allows an
opt-in, allow-listed binary (e.g. `delta`, `difftastic`, `diff-highlight`) to
receive a unified diff via stdin and return formatted output for display.

## Controls implemented

| Control | Implementation |
|---------|---------------|
| Allow-list by binary name | `isAllowedTool()` — only `delta`, `difftastic`, `diff-highlight` permitted |
| Shell injection prevention | `shell: false` in `execFile` options — no shell interpolation occurs |
| Shell metachar rejection | Belt-and-suspenders regex rejects `;`, `&`, `\|`, `` ` ``, `$`, `<`, `>` in path |
| Env-var isolation | `env: {}` — child process receives an empty environment; no tokens/keys leaked |
| No user-supplied args (v1) | Arg array is always `[]`; no user-controlled arguments passed |
| Output size cap | `maxBuffer: 5 MB` — prevents OOM from pathological tool output |
| Hung tool kill | `timeout: 10 000 ms` — child killed if it does not exit within 10 s |
| Opt-in only | `externalDiffViewer` is not registered by default; requires explicit `registerDiffViewer()` call |
| Safe rendering | Output placed as `<pre>` text content; no `innerHTML`/`dangerouslySetInnerHTML` |
| ANSI stripping | SGR codes stripped (`\x1B\[[0-9;]*m`) before display |

## Known gaps

1. **Allow-list is name-based, not hash-based.**  
   A malicious binary named `delta` placed earlier in `PATH` could execute.
   Mitigation: users should supply a full absolute path (e.g. `/usr/local/bin/delta`);
   cryptographic path validation against a signed binary is future hardening.

2. **No OS-level network sandbox.**  
   The child process can make outbound network calls. There is no OS-level
   sandboxing (e.g. macOS App Sandbox, Linux seccomp). Documented risk;
   acceptable for a local developer tool where the binary is user-installed.

3. **ANSI stripping is not exhaustive.**  
   The regex strips SGR codes only. Other escape sequences (OSC, DCS, APC)
   pass through as literal text inside `<pre>`, which is benign but may
   render as noise. Exhaustive stripping is a future improvement.

4. **Windows: empty `env: {}`.**  
   On Windows, tools may fail without `USERPROFILE`, `TEMP`, `SystemRoot` etc.
   Full Windows support is deferred; the feature remains Linux/macOS only for now.

5. **Arg template deferred.**  
   v1 passes no arguments. If users need `--color=always` etc., a safe
   arg-template parser (tokenise, no shell eval) is required before that is enabled.

## ISO 27001 / NEN 7510 considerations

- Feature is **disabled by default**; requires explicit opt-in per project configuration.
- The allow-list and arg handling contain no secrets.
- Tool output is rendered in a sandboxed `<pre>` element (no script execution path).
- Env isolation (`env: {}`) prevents accidental exfiltration of API keys or
  session tokens present in the main process environment.
- Security incidents involving this feature should be reported to `security@proxy.nl`.
