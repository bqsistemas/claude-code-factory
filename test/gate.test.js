// Spine test (protected in factory/config.json): the gate and the builder nudge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const configText = readFileSync(join(repo, 'factory/config.json'), 'utf8');
const ID = '001-dark-mode';

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

const PASSING = '#!/bin/sh\necho "checks passed"\nexit 0\n';
const FAILING = '#!/bin/sh\ni=1\nwhile [ $i -le 300 ]; do echo "line $i"; i=$((i+1)); done\necho "boom" >&2\nexit 1\n';

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

// A main checkout with a bare origin, a protected test file, and one job worktree.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'factory-gate-'));
  const origin = join(dir, 'origin.git');
  const root = join(dir, 'root');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  mkdirSync(join(root, 'factory'), { recursive: true });
  mkdirSync(join(root, 'test'), { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), 'factory/jobs/\nfactory/board.json\n.worktrees/\n');
  writeFileSync(join(root, 'factory/config.json'), configText);
  writeFileSync(join(root, 'factory/checks.sh'), PASSING);
  writeFileSync(join(root, 'test/route.test.js'), '// guarded\n');
  writeFileSync(join(root, 'test/job.test.js'), '// guarded\n');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'fetch', '-q', 'origin');

  const worktree = join(root, '.worktrees', ID);
  git(root, 'worktree', 'add', '-q', worktree, '-b', `factory/${ID}`, 'origin/main');
  const jobDir = join(root, 'factory/jobs', ID);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(join(jobDir, 'job.json'), JSON.stringify({
    id: ID, issue: 1, branch: `factory/${ID}`, worktree, stage: 'gate', round: 1, max_rounds: 3,
  }));
  const env = { ...process.env, ...GIT_ENV, FACTORY_ROOT: root };
  return {
    root, worktree, jobDir, env,
    checks: (text) => writeFileSync(join(root, 'factory/checks.sh'), text),
    gate: (...args) => spawnSync(join(repo, 'factory/bin/gate'), [ID, ...args], { cwd: root, env, encoding: 'utf8' }),
    commit(files, remove = []) {
      for (const [path, text] of Object.entries(files)) writeFileSync(join(worktree, path), text);
      for (const path of remove) rmSync(join(worktree, path));
      git(worktree, 'add', '-A');
      git(worktree, 'commit', '-q', '-m', 'change');
    },
    report: (rel = 'round-1/checks.md') => readFileSync(join(jobDir, rel), 'utf8'),
  };
}

test('AC-5: the gate passes when the main checkout checks.sh exits 0', () => {
  const t = setup();
  t.commit({ 'feature.txt': 'new\n', 'test/new.test.js': '// a new test is fine\n' });
  const res = t.gate();
  assert.equal(res.status, 0, res.stderr);
  const report = t.report();
  assert.equal(report.split('\n')[0], 'GATE: PASS');
  assert.ok(report.includes('checks passed'), 'log is included');
});

test('AC-5: the gate fails with the log tail when checks.sh exits 1', () => {
  const t = setup();
  t.checks(FAILING);
  const res = t.gate();
  assert.equal(res.status, 1);
  const report = t.report();
  const lines = report.split('\n');
  assert.equal(lines[0], 'GATE: FAIL');
  assert.ok(lines.some((l) => /exit code:?\s*1\b/i.test(l)), 'reports the exit code');
  assert.ok(lines.includes('boom'), 'stderr is in the log');
  assert.ok(lines.includes('line 300'), 'last lines kept');
  assert.ok(!lines.includes('line 50'), 'only the tail is kept');
  assert.ok(lines.filter((l) => /^line \d+$/.test(l)).length <= 200, 'at most 200 log lines');
});

test('AC-5: the gate fails when the branch modifies or deletes a protected test, even if checks pass', () => {
  const modified = setup();
  modified.commit({ 'test/route.test.js': '// weakened\n' });
  assert.equal(modified.gate().status, 1);
  const report = modified.report();
  assert.equal(report.split('\n')[0], 'GATE: FAIL');
  assert.ok(report.includes('test/route.test.js'), 'names the protected file');

  const deleted = setup();
  deleted.commit({}, ['test/job.test.js']);
  assert.equal(deleted.gate().status, 1);
  assert.equal(deleted.report().split('\n')[0], 'GATE: FAIL');
  assert.ok(deleted.report().includes('test/job.test.js'));
});

test('AC-5: the gate ignores a worktree-local checks.sh and honours --out', () => {
  const t = setup();
  t.checks(FAILING);
  t.commit({ 'factory/checks.sh': '#!/bin/sh\nexit 0\n' });
  assert.equal(t.gate().status, 1);
  assert.equal(t.report().split('\n')[0], 'GATE: FAIL');

  t.checks(PASSING);
  const out = join(t.jobDir, 'merge-checks.md');
  assert.equal(t.gate('--out', out).status, 0);
  assert.equal(t.report('merge-checks.md').split('\n')[0], 'GATE: PASS', '--out file written');
  assert.equal(t.report().split('\n')[0], 'GATE: FAIL', 'round checks.md left alone');
});

test('AC-5: nudge exits 2 with the log on failing checks, 0 when they pass, when stop_hook_active, or with no job', () => {
  const t = setup();
  const transcript = join(t.root, 'agent.jsonl');
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: `Job folder: factory/jobs/${ID}/\nBranch: factory/${ID}\n` } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'see factory/jobs/999-other/' }] } }),
  ].join('\n'));
  const nudge = (input) => spawnSync(join(repo, 'factory/bin/nudge'), [], {
    cwd: t.root, env: t.env, encoding: 'utf8', input: JSON.stringify(input),
  });

  t.checks(FAILING);
  const failing = nudge({ agent_transcript_path: transcript, stop_hook_active: false });
  assert.equal(failing.status, 2);
  assert.ok(failing.stderr.includes('line 300'), 'the log tail is on stderr');

  const fallback = nudge({ transcript_path: transcript });
  assert.equal(fallback.status, 2, 'falls back to transcript_path');

  assert.equal(nudge({ agent_transcript_path: transcript, stop_hook_active: true }).status, 0);

  const noJob = join(t.root, 'other.jsonl');
  writeFileSync(noJob, JSON.stringify({ type: 'user', message: { content: 'hello' } }));
  assert.equal(nudge({ agent_transcript_path: noJob }).status, 0);
  assert.equal(nudge({ agent_transcript_path: join(t.root, 'missing.jsonl') }).status, 0);
  assert.equal(nudge({}).status, 0);

  t.checks(PASSING);
  assert.equal(nudge({ agent_transcript_path: transcript, stop_hook_active: false }).status, 0);
});
