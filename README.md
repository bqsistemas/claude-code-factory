# claude-code-factory

A small software factory made of one Claude Code skill, eight subagents, a few
dependency-free Node scripts, and markdown files. Its queue is this repo's GitHub
issues: label an issue `factory`, run `/factory run`, and each issue goes through
intake, spec, build, a deterministic gate, routed reviews and approval. It ends as a
merged PR, a PR waiting for you, a question on the issue, or a rejection.

```
issue (label: factory)
  → intake (fable)       ACCEPT | NEEDS-INFO | REJECT, risk + surfaces, posted on the issue
  → route (script)       reviewers + models from config.json
  → spec-writer (opus)   spec.md
  → builder              commits, pushes factory/<id>, opens a draft PR "Closes #<n>"
  → gate (script)        checks.sh + protected tests; FAIL → back to the builder
  → reviewers (routed)   code always; ux + ui for ui; security for security; WAIT FOR ALL
  → approver (opus)      APPROVE → sync, re-gate, gh pr merge | ESCALATE → you merge the PR
```

## Use it

One-time setup, from the main checkout on `main`:

```sh
gh auth login                    # gh must be logged in
factory/bin/setup                # creates the factory, factory:needs-info and factory:needs-human labels
sh factory/checks.sh             # the repo's checks must pass on main
```

Then, in Claude Code:

```sh
/factory run                     # every open issue labeled factory, 3 at a time; also resumes
/factory issue 12                # one issue now
/factory add a slugify utility   # opens a labeled issue, then runs it
/factory rework 12               # a needs-human job goes back to the builder with the PR's review comments
```

There is no approve command. When a job needs you, its PR is ready for review with
the approver's reasoning as a comment: merge the PR to approve it, or leave review
comments and run `/factory rework <issue>`. Only comments from the repo owner, members
and collaborators reach the builder. A job that stopped before it had a PR (for
example, a blocked spec) is resumed the same way, from the stage where it stopped. A
NEEDS-INFO issue waits for its author to reply on the issue; the next `/factory run`
picks the reply up. A rejected issue should be closed.

`/factory run` ends with `factory/bin/job summary`: each job's issue, stage, cost and
time, and a total.

In Codex, invoke the repository skill with `$factory`:

```text
$factory run
$factory issue 12
$factory add a slugify utility
$factory rework 12
```

## Compatibilidad con Codex

La factory conserva una **spine portable** y ahora incluye un adaptador nativo
para Codex. Claude Code sigue usando `/factory`; Codex usa `$factory`. Ambos
leen y actualizan los mismos archivos de trabajo y ejecutan los mismos scripts
de transición.

### Qué ya es portable

- `factory/lib/job.js`: estados, worktrees, transiciones, PRs y merge.
- `factory/lib/route.js`: reviewers por riesgo y superficie.
- `factory/lib/gate.js`: gate determinista y tests protegidos.
- `factory/bin/job`, `gate`, `route` y `setup`.
- GitHub como cola y frontera de confianza.
- `factory/jobs/<id>/job.json` y `factory/board.json` como estado compartido.

### Qué está acoplado a Claude Code

- `.claude/skills/factory/SKILL.md` define `/factory run`, `/factory issue` y
  `/factory rework`, además de la orquestación en background.
- `.claude/agents/*.md` usa frontmatter, herramientas y aliases de modelos de
  Claude (`opus`, `sonnet`, `haiku`, `fable`).
- El builder usa un hook `Stop` de Claude.
- `factory/lib/util.js` busca transcripts en `~/.claude/projects`.
- `factory/lib/cost.js` interpreta JSONL de transcripts Claude.
- `factory/lib/nudge.js` interpreta el payload del hook de Claude.

### Implementación actual

- `.agents/skills/factory/SKILL.md` implementa `$factory run`, `$factory issue`,
  `$factory add` y `$factory rework` reutilizando `factory/bin/job`, `gate` y
  `route`. No duplica la máquina de estados.
- `factory/config.json` conserva el routing Claude y agrega `providers.codex`.
  Un job Codex se crea con `factory/bin/job new <issue> --provider codex`; al
  pasar intake, el proveedor y los modelos resueltos quedan persistidos en
  `job.json`.
- `.codex/agents/*.toml` registra los ocho roles de la factory como subagentes
  Codex. Cada perfil referencia el contrato existente en `.claude/agents/` y
  conserva sus límites de lectura/escritura y protocolos de primera línea.
- Los reviewers se lanzan en paralelo y el adaptador espera todos los archivos
  antes de avanzar. El gate sigue siendo la autoridad determinista y los merges
  siguen pasando por `factory/bin/job`.
- Claude y Codex pueden reanudar el mismo `job.json`; no deben ejecutar el mismo
  job simultáneamente porque todavía no existe un lease entre procesos.

### Limitaciones conocidas y siguiente fase

- `factory/lib/cost.js` solo interpreta transcripts JSONL de Claude. Un job
  ejecutado desde Codex puede mostrar `$0.00` aunque su uso no haya sido medido;
  ese valor **no** debe interpretarse como costo verificado. La siguiente fase
  debe agregar un adaptador de usage por proveedor y mostrar `unknown` cuando no
  exista una fuente confiable.
- El routing Claude conserva aliases (`opus`, `sonnet`, `haiku`, `fable`). Codex
  usa los IDs configurados en `providers.codex` (`gpt-6-luna` y
  `gpt-6.1-sol`); su disponibilidad depende de la cuenta, plan y cliente, por
  lo que deben validarse antes de ejecutar una cola real.
- El hook `Stop` de `.claude/agents/builder.md` sigue siendo específico de Claude.
  En Codex el gate explícito (`factory/bin/gate`) es la barrera obligatoria.
- No se agregó persistencia ni una migración a Agents API: GitHub, worktrees,
  scripts y artefactos de etapa siguen siendo la frontera compartida.

La compatibilidad está cubierta por `test/codex-factory.test.js` y
`test/codex-routing.test.js`, que verifican el skill, los ocho perfiles, el
routing por proveedor, la persistencia del modelo y la permanencia del
adaptador Claude.

Referencias oficiales: [skills de Codex](https://learn.chatgpt.com/docs/build-skills),
[subagentes y agentes personalizados](https://learn.chatgpt.com/docs/agent-configuration/subagents)
y [modo no interactivo](https://learn.chatgpt.com/docs/non-interactive-mode).

Watch it on the dashboard:

```sh
cd factory && python3 -m http.server 8000
open http://localhost:8000/dashboard.html         # live board
open http://localhost:8000/dashboard.html?demo    # sample data
```

## Where things live

| Path | What it is |
|------|------------|
| `.claude/skills/factory/SKILL.md` | The orchestrator: the pipeline, commands and stage steps. Edit this to change the factory. |
| `.claude/agents/*.md` | One subagent per role: `intake`, `spec-writer`, `builder`, `review-{security,ux,ui,code}`, `approver`. |
| `.agents/skills/factory/SKILL.md` | Codex adapter for `$factory`; reuses the Claude pipeline contract and shared scripts. |
| `.codex/agents/*.toml` | Codex profiles that map one-to-one to the eight existing factory roles. |
| `factory/config.json` | Concurrency, max rounds, the routing table, models, prices, protected tests, the repo URL. |
| `factory/checks.sh` | The repo's checks (here: `npm test`). The gate runs the main checkout's copy. |
| `factory/bin/job` | The only writer of `job.json` and `board.json`. Refuses illegal transitions and does the GitHub side effects. |
| `factory/bin/gate` | Runs `checks.sh` in the job's worktree, fails on edits to protected tests, writes `round-N/checks.md`. |
| `factory/bin/route` | Prints the builder and reviewer models for a job's `intake.md`. |
| `factory/bin/nudge` | The builder's Stop hook: runs the checks before it finishes. Advisory; the gate decides. |
| `factory/bin/setup` | Creates the three GitHub labels. |
| `factory/lib/*.js` | The scripts' code (Node 20 ESM, no dependencies), imported by the tests. |
| `factory/project.md` | Language, test command, and conventions. Every agent reads it. |
| `factory/board.json` | Every `job.json`; the dashboard polls it. |
| `factory/jobs/<id>/` | `job.json`, `issue.md`, `intake.md`, `spec.md`, `build.md`, `round-N/checks.md`, `round-N/review-*.md`, `decision.md`, `merge-checks.md`. |
| `.worktrees/<id>/` | The job's git worktree on branch `factory/<id>`, from `origin/main`. Port `3000 + <job number>`. |

`board.json`, `jobs/`, and `.worktrees/` are local runtime state and are gitignored.

## Rules the loop keeps

- GitHub issues are the queue. The `factory` label is the trust boundary: only
  people with triage or write access can add it, and `job new` re-checks it.
- Issue text reaches agents only as quoted data in `issue.md`, never as a prompt.
- Agents get context from files, not the conversation; each writes only its own file
  and replies with that file's first line.
- No reviewer runs before the gate passes. A round ends only when every routed review
  file exists (WAIT FOR ALL). The same named builder (`builder-<id>`) is resumed for
  each round, up to `max_rounds` (a gate failure uses a round).
- Push only `factory/*` branches, merge only with `gh pr merge` after syncing with
  `origin/main` and gating again, never deploy. One PR per issue.
- The approver escalates anything that needs human judgment: auth, payments, data
  migrations, secrets, new dependencies, or breaking changes.
- The `/game` page still teaches the v1 loop; a later job updates it.
