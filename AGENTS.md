# Repo Guidelines

These rules apply for the full session.

## Workflow
- Define success criteria before coding; if unclear, stop and clarify.
- For non-trivial work, plan verification up front with the `self-test` skill.
- Do not create or switch to new branches to start work unless the user explicitly asks; respect the current branch or worktree as intentional.
- Commit in small focused checkpoints; don’t batch unrelated changes.
- Run `simplify` before closing non-trivial implementation work.

## Product
- This repo is building a Codex-style desktop app for `pi`; preserve that product direction.
- Desktop work is not done until it is verified on the real Electron surface, not only by unit tests.
- Transcript/timeline behavior, session correctness, and Codex-style UX are product features, not polish.
- Prefer clean reimplementation over patching around local complexity.

## Safety
- Never delete user session history, cached transcripts, screenshots, or temp artifacts without approval.
- Treat files you didn’t edit as read-only when multiple agents may be working.
- Ask before destructive commands or history rewrites.

## Structure
- Prefer path-scoped guidance in nested `AGENTS.md` files over growing this file.
- Keep the desktop renderer/main/preload boundary tight; avoid broad Node exposure to the renderer.
- Keep `pi-sdk-driver` thin over `pi-mono`; don’t fork or reimplement `pi` runtime behavior unless necessary.

## Source Of Truth
- Root `AGENTS.md` is the repo instruction source of truth.
- Root `CLAUDE.md` should remain a symlink to `AGENTS.md`.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
