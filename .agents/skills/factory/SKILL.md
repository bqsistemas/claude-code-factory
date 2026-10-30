---
name: factory
description: Run the AI Software Factory from Codex. It drains GitHub issues labelled factory through intake, spec, build, gate, routed reviews and approval while reusing factory/bin/job as the only state writer.
argument-hint: run | issue <n> | rework <n> | <feature>
---

# Factory orchestrator for Codex

You are the Factory orchestrator. This is the Codex adapter for the existing
Claude-compatible pipeline; it does not create a second state machine. Reuse
`factory/bin/job`, `factory/bin/gate`, `factory/bin/route` and the files under
`factory/jobs/<id>/` exactly as the Claude path does.

The supported invocations are `$factory run`, `$factory issue <n>`,
`$factory add <feature>` and `$factory rework <n>`. The existing Claude
`/factory` skill remains unchanged and continues to be supported.

## Non-negotiable invariants

- Run from the main checkout on `main`; perform the same Git/GitHub preflight as
  `.claude/skills/factory/SKILL.md` before doing any work.
- Never edit `factory/jobs/<id>/job.json` or `factory/board.json` directly. Only
  `factory/bin/job` may write pipeline state and perform GitHub merge side effects.
- Prompts carry paths and identifiers only. Agents read issue text from
  `factory/jobs/<id>/issue.md`, never from a prompt or shell argument.
- Each worker writes exactly its assigned artifact (`intake.md`, `spec.md`,
  `build.md`, `round-N/review-*.md` or `decision.md`) and replies with its first
  line. Delete stale output before starting a new round.
- No reviewer starts before `factory/bin/gate <id>` passes, and a review round is
  complete only after every routed reviewer file exists with a valid first line.
- Do not run Claude and Codex orchestrators concurrently for the same job. The
  current state files are atomic but intentionally have no cross-process lease.

## Codex worker model

Use native Codex subagents for workers. Prefer the profiles in `.codex/agents/`
(`factory-intake`, `factory-spec-writer`, `factory-builder`,
`factory-review-security`, `factory-review-ux`, `factory-review-ui`,
`factory-review-code`, and `factory-approver`). If a profile is unavailable,
spawn a subagent with the same role instructions and explicitly include the
paths below. The Codex session can provide a validated override, but the
provider mapping in `factory/config.json` is the default source of truth; the
Claude aliases there are not Codex model IDs. For a
Codex job, `factory/config.json` resolves provider-specific model IDs during
intake and persists them in `job.json` under `models`; pass that resolved model
explicitly when spawning each subagent. Do not silently fall back to a Claude
alias.

Every worker must read `factory/project.md`, its matching
`.claude/agents/<role>.md` body (ignore Claude frontmatter such as `tools` and
`model`), and the relevant job files. A worker may use the permissions inherited
from this Codex session, but must preserve the role's read/write boundary.

The builder is the only worker that edits source code. It works inside the
existing `.worktrees/<id>/` worktree, commits, pushes `factory/<id>`, opens or
updates the draft PR, and writes `build.md` in the main checkout. Reviewers and
the approver are read-only. Do not invent a Codex-specific output format.

## Pipeline

```
intake → route/worktree → spec → build → gate → routed reviews → approve
   ↘ needs-info/rejected       ↘ build (gate/review changes) ↘ merging/awaiting-merge
```

Use the scripts for every transition. The stage contract is:

1. **run**: preflight; list open `factory` issues; run
   `factory/bin/job new <n> --provider codex` idempotently; reconcile PRs and resume unfinished jobs up to
   `concurrency` from `factory/config.json`.
2. **intake**: spawn one `factory-intake` per job using `job.models.intake`. On `ACCEPT`, run
   `factory/bin/job <id> to spec`; on `NEEDS-INFO` or `REJECT`, use the matching
   transition. The script routes agents and creates the worktree.
3. **spec**: spawn `factory-spec-writer` using `job.models.spec-writer`; when `spec.md` is valid, run
   `job <id> to build`.
4. **build**: spawn a fresh `factory-builder` using `job.models.builder` for a new Codex session or round;
   pass only the job folder, round folder, branch, worktree, issue number and
   port. On `STATUS: READY`, run `job <id> to gate`. On `STATUS: BLOCKED`, park
   with `needs-human`.
5. **gate**: run `factory/bin/gate <id>`. A failure returns to build with the
   check log; a pass moves to review. Never spawn reviews before this step.
6. **review**: spawn all reviewers in `job.json.agents.reviewers` concurrently, using the corresponding `job.models.reviewers` model,
   then WAIT FOR ALL files. Any `VERDICT: CHANGES` returns to build; all PASS
   moves to approve. Only the reviewers routed for that job participate.
7. **approve**: spawn `factory-approver` using `job.models.approver`. `APPROVE` transitions to merging,
   where `job` syncs, gates and merges according to `auto_merge`; `ESCALATE`
   transitions to `needs-human`. A human merge is observed on the next run.
8. **rework**: for a needs-human job, use `factory/bin/job <id> to build` when
   a PR exists (the script quotes trusted review comments), otherwise resume
   from the recorded parked stage.

After every worker finishes, run `factory/bin/job <id> sync`. At the end run
`factory/bin/job summary` and report each terminal or parked job in one line.

## Worker prompt contract

Use a prompt like this, with values read from `job.json` rather than pasted issue
content:

```
Job folder: factory/jobs/<id>/
Round folder: factory/jobs/<id>/round-<round>/
Branch: factory/<id>
Worktree: <worktree from job.json>
Issue: #<issue>
Port: <port>
```

The role file defines the exact artifact protocol. Do not ask a worker to call
another orchestrator, edit board state, merge a PR, or use Claude-only hooks.
Codex has no required `Stop` hook in this adapter; the deterministic gate remains
the authority. `job sync` may not include Codex usage in the dashboard yet, so
never interpret a displayed `$0.00` as verified Codex cost.

## Command details

- `$factory run`: drain and resume the queue, respecting concurrency.
- `$factory issue <n>`: create/resume the job for one open labelled issue.
- `$factory add <feature>`: create a labelled GitHub issue from a temporary body
  file, then run it through the same flow.
- `$factory rework <n>`: resume a needs-human job using trusted PR feedback.

For the complete preflight, stage refusal handling, first-line protocols and
merge rules, consult `.claude/skills/factory/SKILL.md`; this adapter intentionally
keeps that document as the behavioral reference so Claude and Codex stay in
parity.
