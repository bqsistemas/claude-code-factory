# Project context

Every factory agent reads this before working. The orchestrator updates it when a
merge changes the stack or the test command.

## Snapshot (2026-10-28, after job 007)

- App: gamified landing page plus a factory learning game at `/game`, served by a
  zero-dependency Node HTTP server.
- Language and runtime: Node.js 20+, ES modules (`"type": "module"`), no runtime
  dependencies. Installed: Node.js 20.9, npm 10.1, Python 3.12.
- Dev dependencies (exact-pinned): `remotion`, `@remotion/player`, `react`,
  `react-dom`, `esbuild`. No WebGL: three.js was removed in job 007. Run
  `npm install` before building the game. Keep
  `dependencies` empty; a test enforces it.
- Run: `npm start` (listens on `PORT`, default 3000).
- Test command: `npm test` (`node --test test/`, built-in runner).
- Game build: `npm run build:game` bundles `src/game/main.jsx` into the committed
  `public/game.js`. Rebuild and commit it whenever `src/game/` changes.

## Layout

- `src/app.js`: `createApp()` returns an unstarted `http.Server`. Routes are an
  exact-match map of URL path to file in `public/`; never build file paths from the request.
- `src/server.js`: entrypoint, calls `listen`.
- `public/`: `index.html`, `game.html`, `game.js` (built bundle) and `styles.css`.
  New static files must be added to the route map.
- `src/game/`: `engine.js` (plain JS: loop stages, questions, scoring; runs in Node
  and the browser), `scene.js` (plain JS: `iso()` isometric projection, station
  boxes, `FLOOR_VIEWBOX`, package path, composition size), `FactoryLoop.jsx`
  (Remotion composition: fullscreen iso-glow SVG factory floor, a dark hairline
  drawing with one accent colour on the live station and belt), `Octopus.jsx` (2D
  agent characters, used in the caption), `main.jsx` (Player + quiz UI).
- iso-glow style comes from the `/iso-glow` skill (`~/.claude/skills/iso-glow/`).
  The `iso` kernel is adapted from iso-figure (MIT), credited in `scene.js`; `game.html`
  carries a "Made with ISO-GLOW" credit link. Human-approved in job 007.
  `engine.js` must match `.claude/agents/` names and models; a test checks it.
- `factory/avatars.js`: the octopus agent characters, shared by the dashboard and the
  game bundle. Rebuild `public/game.js` whenever it changes.
- `FactoryLoop.jsx` copies layout numbers from `styles.css` (breakpoint, panel width,
  bottom-panel height, HUD height) to fit the iso floor; change both together.
- `docs/juego-factory.md`: Spanish guide to the game.
- `test/`: one `<module>.test.js` per module; tests start the app on port 0.

## Landing page contract

- Every response sends `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'self'` (no inline scripts or styles).
- Stable ids that later jobs build on: `#welcome`, `#level`, `#xp` (a `<progress>`),
  `#quest-log`. Each shipped feature adds one item to `#quest-log`.
- Theme colors are CSS custom properties on `:root`; animations respect
  `prefers-reduced-motion`.
- The CSP blocks the `<style>` tag `@remotion/player` injects; its rules live in
  `styles.css` instead. Do not relax the CSP to allow inline styles.
- Game UI text is Spanish (`lang="es"`); the landing page stays English.

## Conventions

- Commits: Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). No AI
  attribution and no `Co-Authored-By` lines.
- Branches: `factory/<job-id>`, created from `main`, one per job, in `.worktrees/<job-id>`.
- Shell: prefer `rg`, `fd`, `bat`, and `eza` over `grep`, `find`, `cat`, and `ls`.
- Keep each change small and inside the spec; no unrelated refactors.
