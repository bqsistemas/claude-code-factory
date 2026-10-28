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
comments and run `/factory rework <issue>`. A NEEDS-INFO issue waits for its author
to reply on the issue; the next `/factory run` picks the reply up.

`/factory run` ends with `factory/bin/job summary`: each job's issue, stage, cost and
time, and a total.

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
