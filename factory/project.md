# Project context

Every factory agent reads this before working. The orchestrator updates it when a
merge changes the stack or the test command.

## Snapshot (2026-10-27, after job 001)

- App: gamified landing page served by a zero-dependency Node HTTP server.
- Language and runtime: Node.js 20+, ES modules (`"type": "module"`), no runtime
  dependencies. Installed: Node.js 20.9, npm 10.1, Python 3.12.
- Run: `npm start` (listens on `PORT`, default 3000).
- Test command: `npm test` (`node --test test/`, built-in runner).

## Layout

- `src/app.js`: `createApp()` returns an unstarted `http.Server`. Routes are an
  exact-match map of URL path to file in `public/`; never build file paths from the request.
- `src/server.js`: entrypoint, calls `listen`.
- `public/`: `index.html` and `styles.css`. New static files must be added to the route map.
- `test/`: one `<module>.test.js` per module; tests start the app on port 0.

## Landing page contract

- Every response sends `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'self'` (no inline scripts or styles).
- Stable ids that later jobs build on: `#welcome`, `#level`, `#xp` (a `<progress>`),
  `#quest-log`. Each shipped feature adds one item to `#quest-log`.
- Theme colors are CSS custom properties on `:root`; animations respect
  `prefers-reduced-motion`.

## Conventions

- Commits: Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). No AI
  attribution and no `Co-Authored-By` lines.
- Branches: `factory/<job-id>`, created from `main`, one per job, in `.worktrees/<job-id>`.
- Shell: prefer `rg`, `fd`, `bat`, and `eza` over `grep`, `find`, `cat`, and `ls`.
- Keep each change small and inside the spec; no unrelated refactors.
