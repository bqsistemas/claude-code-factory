# claude-code-factory

A small software factory made of one Claude Code skill, seven subagents, and
markdown files. You give it a feature; it writes a spec, builds on a branch, runs
four reviews in parallel, and either merges to `main` or asks you.

```
feature → spec-writer → builder → [security · ux · ui · code] → approver → merge | needs-human
                           ▲                    │
                           └──── any CHANGES ───┘  (max 2 rounds)
```

## Use it

Commit the factory files to `main` first, then run `/factory` from the main
checkout on `main`. Builders branch from `main` into `.worktrees/`.

```sh
claude                                    # in this repo
/factory add a slugify utility            # run one feature through the loop
/factory next                             # run the first unchecked item in factory/backlog.md
/factory approve 003-rate-limiting        # merge a needs-human job
/factory rework 003-rate-limiting "use an in-house limiter"
```

Watch it on the dashboard:

```sh
cd factory && python3 -m http.server 8000
open http://localhost:8000/dashboard.html         # live board
open http://localhost:8000/dashboard.html?demo    # sample data
```

## Where things live

| Path | What it is |
|------|------------|
| `.claude/skills/factory/SKILL.md` | The orchestrator: the loop diagram and the steps. Edit this to change the factory. |
| `.claude/agents/*.md` | One subagent per box: `spec-writer`, `builder`, `review-{security,ux,ui,code}`, `approver`. |
| `factory/project.md` | Language, test command, and conventions. Every agent reads it. |
| `factory/backlog.md` | Feature queue for `/factory next`. |
| `factory/board.json` | Job state. Only the orchestrator writes it; the dashboard polls it. |
| `factory/jobs/<id>/` | `feature.md`, `spec.md`, `build.md`, `round-<n>/review-*.md`, `decision.md`. |
| `.worktrees/<id>/` | The builder's git worktree on branch `factory/<id>`. |

`board.json`, `jobs/`, and `.worktrees/` are local runtime state and are gitignored.

## Rules the loop keeps

- Agents get context from files, not the conversation, and each writes only its own file.
- Reviews start with `VERDICT: PASS` or `VERDICT: CHANGES`; `decision.md` starts with `APPROVE` or `ESCALATE`.
- A round ends only when all four review files exist. The same named builder
  (`builder-<id>`) is resumed for each round.
- The approver escalates anything that needs human judgment: auth, payments, data
  migrations, secrets, new dependencies, or breaking changes.
