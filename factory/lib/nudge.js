// factory/bin/nudge: the builder's Stop (SubagentStop) hook. Runs checks.sh in the
// job's worktree before the builder finishes. On failure it exits 2 with the log
// tail on stderr, so the builder keeps working. Advisory only: the gate decides.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runChecks } from './gate.js';
import { factoryRoot, isMain, readText, runCli, tail } from './util.js';

const JOB_PATH = /factory\/jobs\/(\d{3,}-[a-z0-9]+(?:-[a-z0-9]+)*)\//;

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return 0;
  }
  if (!input || input.stop_hook_active === true) return 0;
  const transcript = input.agent_transcript_path || input.transcript_path;
  const text = typeof transcript === 'string' ? readText(transcript) : null;
  const id = text?.match(JOB_PATH)?.[1];
  if (!id) return 0;

  let root;
  let job;
  try {
    root = factoryRoot();
    job = JSON.parse(readFileSync(join(root, 'factory/jobs', id, 'job.json'), 'utf8'));
  } catch {
    return 0;
  }
  if (typeof job.worktree !== 'string' || !existsSync(job.worktree)) return 0;

  const { code, output } = runChecks(root, job.worktree);
  if (code === 0) return 0;
  process.stderr.write(
    `factory nudge: factory/checks.sh failed (exit ${code}) in ${job.worktree}.\n`
    + 'Fix it before you finish; the gate runs the same checks.\n\n'
    + `${tail(output, 60)}\n`,
  );
  return 2;
}

if (isMain(import.meta.url)) runCli(main);
