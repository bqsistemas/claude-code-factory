---
name: factory
description: Run the software factory. Turns a feature request into a spec, a build on its own branch, four parallel reviews, and an approval decision that merges to main or escalates to a human. Use for /factory <feature>, /factory next, /factory approve <job-id>, /factory rework <job-id> <note>.
argument-hint: <feature> | next | approve <job-id> | rework <job-id> <note>
---

# Factory orchestrator

The session running this skill is the orchestrator. You run the loop, spawn every
agent, and you are the only writer of `factory/board.json`. You write only
`board.json`, `backlog.md`, `feature.md`, and `review-human.md`. Every spec, build,
review, and decision comes from an agent, and each agent writes exactly one file.

## The loop (edit this to change the factory)

```
                   ┌──────────────────┐
                   │     feature      │
                   └─────────┬────────┘
                             ▼
                   ┌──────────────────┐
                   │   spec-writer    │
                   │       opus       │
                   └─────────┬────────┘
                             ▼
                   ┌──────────────────┐
                   │     builder      │◄────────────────────┐
                   │       opus       │                     │
                   └─────────┬────────┘                     │
        ┌─────────────┬──────┴──────┬─────────────┐         │
        ▼             ▼             ▼             ▼         │
  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐   │
  │  security │ │     ux    │ │ ui design │ │    code   │   │
  │    opus   │ │   sonnet  │ │   sonnet  │ │   sonnet  │   │
  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘ └─────┬─────┘   │
        └─────────────┴──────┬──────┴─────────────┘         │
                             ▼                              │
                   ┌──────────────────┐   any CHANGES:      │
                   │   WAIT FOR ALL   ├─────────────────────┘
                   │   4 reviews in   │   resume builder
                   └─────────┬────────┘   (max 2 rounds)
                             ▼ all PASS
                   ┌──────────────────┐
                   │     approver     │
                   │       opus       │
                   └─┬───────────────┬┘
             APPROVE │               │ ESCALATE
                     ▼               ▼
              ┌─────────────┐ ┌─────────────┐
              │merge to main│ │ needs-human │ ◄── /factory approve
              └─────────────┘ └─────────────┘
```

Agents live in `.claude/agents/`: `spec-writer`, `builder`, `review-security`,
`review-ux`, `review-ui`, `review-code`, `approver`. When you spawn one, pass the
model shown in its box as `model`. "max 2 rounds" means at most two review rounds
per job (raised by `/factory rework`).

## Files

```
factory/
  project.md                 language, test command, conventions (all agents read it)
  board.json                 job state; you write it, the dashboard polls it
  backlog.md                 queue for /factory next
  dashboard.html             visual board
  jobs/<job-id>/
    feature.md               the request, written by you
    spec.md                  spec-writer
    build.md                 builder (rewritten every round)
    round-<n>/review-security.md, review-ux.md, review-ui.md, review-code.md
    round-<n>/review-human.md   you, only on /factory rework
    decision.md              approver
.worktrees/<job-id>/         builder's git worktree on branch factory/<job-id>
```

`factory/board.json`, `factory/jobs/`, and `.worktrees/` are gitignored runtime state.

## Board

```json
{
  "updated": "2026-10-27T14:05:00Z",
  "jobs": [{
    "id": "003-rate-limiting",
    "title": "Rate limiting",
    "branch": "factory/003-rate-limiting",
    "stage": "review",
    "round": 2,
    "max_round": 2,
    "reviews": { "security": "CHANGES", "ux": "PASS", "ui": "pending", "code": "PASS" },
    "history": [{ "security": "CHANGES", "ux": "PASS", "ui": "PASS", "code": "CHANGES" }],
    "decision": null,
    "builder": "builder-003-rate-limiting",
    "note": "",
    "updated": "2026-10-27T14:05:00Z"
  }]
}
```

- `stage`: `spec` | `build` | `review` | `approval` | `merged` | `needs-human`
- `reviews`: the current round. Each value is `pending`, `PASS`, or `CHANGES`.
- `history`: earlier rounds, oldest first.
- `note`: one line explaining the current state (shown on the card).

On every change: read the whole file, change one job, set both `updated` fields to
now (UTC), write it to `factory/board.json.tmp`, then `mv` it over `board.json` so the
dashboard never reads half a file. Update on every stage change and every verdict, so
the dashboard moves live.

## Checking agent output

Before spawning the builder or the approver, delete its old output (`build.md` or
`decision.md`), so a missing file always means the agent failed. After every agent
returns, its file must exist and start with the right first line:

| Agent | File | First line |
|-------|------|------------|
| spec-writer | `spec.md` | any |
| builder | `build.md` | `STATUS: READY` |
| review-* | `round-<n>/review-<lens>.md` | `VERDICT: PASS` or `VERDICT: CHANGES` |
| approver | `decision.md` | `APPROVE` or `ESCALATE` |

If a reviewer's file is missing or malformed, spawn that reviewer once more. In every
other failure case (or a second reviewer failure), set `needs-human` with a `note`
that names the agent and the reason (for `STATUS: BLOCKED`, the line under it), then
stop.

## /factory <feature>

1. **Set up**
   - Run from the main checkout: `git rev-parse --show-toplevel` must be the first
     path in `git worktree list`, the current branch must be `main`, and the factory
     files (`.claude/`, `factory/`) must be committed there. If not, stop and tell
     the user. All paths below are relative to that checkout.
   - If `factory/board.json` is missing, create it as `{ "updated": "<now>", "jobs": [] }`.
   - If `factory/project.md` is missing, inspect the repo and write it (language,
     test command, layout, conventions).
   - Job id: the next 3-digit number after the highest id on the board, plus a
     kebab-case slug of at most 4 words, for example `004-csv-export`.
   - Write `factory/jobs/<id>/feature.md`: `# <Title>`, a blank line, then the
     request verbatim.
   - Add the job to the board: `stage: "spec"`, `round: 0`, `max_round: 2`,
     `reviews: {}`, `history: []`, `decision: null`, `builder: "builder-<id>"`.

2. **Spec**: spawn `spec-writer` with the prompt `Job folder: factory/jobs/<id>/`.
   Wait for it and check its output.

3. **Build**: set `stage: "build"`. Spawn `builder` with `name: "builder-<id>"` and
   the prompt:
   ```
   Job folder: factory/jobs/<id>/
   Branch: factory/<id>
   Worktree: .worktrees/<id>
   First build.
   ```
   If your Agent tool returns an agent ID instead of taking a name, store that ID in
   the job's `builder` field and use it for SendMessage.
   Wait for it and check its output.

4. **Review round n** (n = round + 1)
   - Create `factory/jobs/<id>/round-<n>/`. On the board, move the current
     `reviews` into `history` (unless it is empty), then set `stage: "review"`,
     `round: n`, and all four reviews to `pending`.
   - Spawn `review-security`, `review-ux`, `review-ui`, and `review-code` in ONE
     message so they run in parallel. Give each the prompt:
     ```
     Job folder: factory/jobs/<id>/
     Round folder: factory/jobs/<id>/round-<n>/
     Branch: factory/<id>
     Worktree: .worktrees/<id>
     ```
   - As each reviewer finishes, check its output and set its chip to `PASS` or
     `CHANGES`.
   - **WAIT FOR ALL.** The round is done only when all four `review-*.md` files exist
     in the round folder with a valid first line. Check the folder itself; a
     completion notification is not a file. Never message the builder while a round
     is open.

5. **Route**
   - Every review is `PASS`: go to step 6.
   - Any `CHANGES` and `n < max_round`: set `stage: "build"` and resume the same
     builder with SendMessage to `builder-<id>`:
     ```
     Round <n> needs changes. Read factory/jobs/<id>/round-<n>/,
     fix every CHANGES finding, re-run the tests, commit, and rewrite build.md.
     ```
     Delete `build.md` first. Wait for the builder, check its output, then run
     step 4 again with n + 1.
   - Any `CHANGES` and `n == max_round`: go to step 6 anyway. The approver will
     escalate.

6. **Approval**: set `stage: "approval"`. Spawn `approver` with the same four-line
   prompt as the reviewers, using the last round folder. Check its output, then read
   `decision.md`:
   - First line `APPROVE`: merge (below), then set `stage: "merged"`,
     `decision: "APPROVE"`.
   - First line `ESCALATE`: set `stage: "needs-human"`, `decision: "ESCALATE"`, and
     `note` to the second line. Tell the user the reason and the two ways forward:
     `/factory approve <id>` or `/factory rework <id> <note>`.

**Merge**: in the main checkout, on `main`, with no uncommitted changes to tracked
files, run `git merge --no-ff factory/<id> -m "chore(factory): merge <id>"`, then
`git worktree remove .worktrees/<id>`. If the merge conflicts, run
`git merge --abort`, set `needs-human` with
`note: "merge conflict: /factory rework <id> rebase onto main"`, and stop.
If the merge changed the stack or test command, update `factory/project.md` and
commit it as `chore(factory): update project context`. Never push.

## /factory next

Read `factory/backlog.md` and take the first `- [ ]` line. Run step 1 of
`/factory <text>` to get the job id, then change the line to
`- [x] <text> → <job-id>` and continue the loop at step 2. If nothing is unchecked,
tell the user the backlog is empty.

## /factory approve <job-id>

The job must be in `needs-human` with `round >= 1`, and
`git rev-parse --verify factory/<id>` must succeed; otherwise tell the user why and
stop (suggest `/factory rework`). This command is the human's approval, so run
**Merge** above, then set `stage: "merged"`, `decision: "APPROVE (human)"`,
`note: "approved by human"`.

## /factory rework <job-id> <note>

Use this for any job that isn't `merged`: escalated jobs, merge conflicts, and runs
that stopped mid-loop (for example, the session ended).

If `round` is 0 (the spec or first build failed), append `## Human note` and the
note to `feature.md`, then restart the loop at step 2.

Otherwise, with n = the job's current round:

1. Write `factory/jobs/<id>/round-<n>/review-human.md`:
   ```
   VERDICT: CHANGES

   # Human review (round <n>)

   <note>
   ```
2. On the board: set `reviews.human` to `CHANGES`, `stage: "build"`,
   `decision: null`, `note: "rework requested"`, and `max_round: n + 2`.
3. Resume `builder-<id>` with the step 5 message for round n. If the builder can't
   be reached (for example, in a new session), spawn a fresh `builder` with the same
   name and the prompt from step 3, replacing `First build.` with
   `Resume: read round-<n>/ first.`; it rebuilds its context from the job files.
4. Continue at step 4 with n + 1.

## Rules

- Every command runs from the main checkout on `main` (the first check in step 1).
- Agents get context from files, not from this conversation. Prompts carry paths
  only; never paste the conversation into them.
- Each agent writes only its own file. Never edit an agent's file for it.
- Every review starts with `VERDICT: PASS` or `VERDICT: CHANGES`. `decision.md`
  starts with `APPROVE` or `ESCALATE`.
- Run one job at a time. When a job reaches `merged` or `needs-human`, report to the
  user in two or three lines and stop.
- Dashboard: `cd factory && python3 -m http.server 8000`, then open
  http://localhost:8000/dashboard.html.
