// factory/bin/gate <job-id> [--out <file>]: the deterministic gate. Runs the MAIN
// checkout's factory/checks.sh inside the job's worktree (never the worktree's own
// copy), fails if the branch modified, deleted or renamed a protected test or left
// uncommitted changes, and writes round-N/checks.md. Exit 0 on PASS, 1 on FAIL.
import { join, resolve } from 'node:path';

import { Usage, factoryRoot, isMain, jobDir, loadConfig, readText, run, runCli, tail, writeAtomic } from './util.js';

/** Runs <root>/factory/checks.sh with `cwd` as the working folder; stdout and stderr interleaved. */
export function runChecks(root, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // a gate started from a test run must not report into it
  const res = run('sh', ['-c', 'exec sh "$0" 2>&1', join(root, 'factory/checks.sh')], { cwd, env });
  const output = `${res.stdout ?? ''}${res.error ? `\n${res.error.message}` : ''}`;
  return { code: res.status ?? 1, output };
}

/** Protected test paths the branch changed since it left `base`, or an error. */
export function protectedChanges(worktree, base, protectedTests) {
  const mb = run('git', ['merge-base', base, 'HEAD'], { cwd: worktree });
  if (mb.status !== 0) return { error: `git merge-base ${base} HEAD failed: ${(mb.stderr || mb.error?.message || '').trim()}`, paths: [] };
  const diff = run('git', ['diff', '--name-status', mb.stdout.trim(), 'HEAD'], { cwd: worktree });
  if (diff.status !== 0) return { error: `git diff failed: ${(diff.stderr || '').trim()}`, paths: [] };
  const guarded = new Set(protectedTests);
  const paths = [];
  for (const line of diff.stdout.split('\n')) {
    const [status, path] = line.split('\t');
    if (status && /^[MDRT]/.test(status) && guarded.has(path)) paths.push(`${status[0]} ${path}`);
  }
  return { error: null, paths };
}

/** Uncommitted or untracked (not ignored) paths: the checks would test a tree the branch doesn't hold. */
export function uncommitted(worktree) {
  const res = run('git', ['status', '--porcelain'], { cwd: worktree });
  if (res.status !== 0) return [`git status failed: ${(res.stderr || res.error?.message || '').trim()}`];
  return res.stdout.split('\n').filter(Boolean).map((line) => `uncommitted: ${line.slice(3)}`);
}

/**
 * Runs the gate for a job and writes the report.
 * @returns {boolean} true on PASS
 */
export function gate(root, job, outFile) {
  const config = loadConfig(root);
  const dirty = uncommitted(job.worktree); // before the checks, which may write files
  const checks = runChecks(root, job.worktree);
  const guard = protectedChanges(job.worktree, config.base ?? 'origin/main', config.protected_tests ?? []);
  const pass = checks.code === 0 && !guard.error && guard.paths.length === 0 && dirty.length === 0;
  const log = tail(checks.output, 200);
  const longest = Math.max(0, ...(log.match(/`+/g) ?? []).map((m) => m.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  const violations = guard.error ? [guard.error] : guard.paths;
  writeAtomic(outFile, [
    `GATE: ${pass ? 'PASS' : 'FAIL'}`,
    '',
    `Checks exit code: ${checks.code}`,
    `Protected test violations: ${violations.length ? '' : 'none'}`,
    ...violations.map((v) => `- ${v}`),
    `Uncommitted changes: ${dirty.length ? 'commit them; the gate tests only committed work' : 'none'}`,
    ...dirty.slice(0, 20).map((v) => `- ${v}`),
    '',
    '## Log (last 200 lines)',
    '',
    fence,
    log,
    fence,
    '',
  ].join('\n'));
  return pass;
}

function main(args) {
  const [id, ...rest] = args;
  let out = null;
  if (rest.length === 2 && rest[0] === '--out') out = resolve(rest[1]);
  else if (rest.length) throw new Usage('gate <job-id> [--out <file>]');
  if (!id) throw new Usage('gate <job-id> [--out <file>]');
  const root = factoryRoot();
  const dir = jobDir(root, id);
  const text = readText(join(dir, 'job.json'));
  if (text === null) throw new Error(`no job ${id}`);
  const job = JSON.parse(text);
  if (!out) {
    if (!(job.round >= 1)) throw new Usage(`${id} has no build round yet`);
    out = join(dir, `round-${job.round}`, 'checks.md');
  }
  const pass = gate(root, job, out);
  process.stdout.write(`${id} GATE: ${pass ? 'PASS' : 'FAIL'}\n`);
  return pass ? 0 : 1;
}

if (isMain(import.meta.url)) runCli(main);
