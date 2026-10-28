# Project context

Every factory agent reads this before working. The orchestrator updates it when a
merge changes the stack or the test command.

## Snapshot (2026-10-27)

- Repo: empty. `main` has no source code yet.
- Language and runtime: none chosen yet. Installed: Node.js 20.9, npm 10.1, Python 3.12.
- Test command: none yet.

## Defaults while the repo is empty

The first job sets the stack. Unless its spec says otherwise, the builder uses:

- Node.js 20+, ES modules (`"type": "module"` in `package.json`), no runtime dependencies.
- Built-in test runner: `"test": "node --test test/"` in `package.json`, run with `npm test`.
- Layout: code in `src/`, tests in `test/`, one `<module>.test.js` per module.

## Conventions

- Commits: Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). No AI
  attribution and no `Co-Authored-By` lines.
- Branches: `factory/<job-id>`, created from `main`, one per job, in `.worktrees/<job-id>`.
- Shell: prefer `rg`, `fd`, `bat`, and `eza` over `grep`, `find`, `cat`, and `ls`.
- Keep each change small and inside the spec; no unrelated refactors.
