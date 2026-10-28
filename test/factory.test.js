// Job 012: the factory v2 files (agents, config, skill, checks) stay wired up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENTS } from '../factory/activity.js';
import { AVATARS } from '../factory/avatars.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(repo, rel), 'utf8');
const frontmatter = (text) => text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
const field = (front, name) => front.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1].trim();

test('AC-8: eight agents; intake runs on fable without Bash, Edit or WebFetch; builder declares the nudge hook', () => {
  const dir = join(repo, '.claude/agents');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  assert.equal(files.length, 8, 'eight agent files');

  const intake = frontmatter(read('.claude/agents/intake.md'));
  assert.equal(field(intake, 'name'), 'intake');
  assert.equal(field(intake, 'model'), 'fable');
  const tools = field(intake, 'tools').split(',').map((s) => s.trim());
  for (const banned of ['Bash', 'Edit', 'WebFetch']) assert.ok(!tools.includes(banned), `intake has no ${banned}`);

  const builder = frontmatter(read('.claude/agents/builder.md'));
  assert.match(builder, /factory\/bin\/nudge/, 'builder frontmatter references factory/bin/nudge');
  assert.match(builder, /^hooks:/m, 'builder frontmatter declares hooks');

  assert.equal(Object.keys(AVATARS).length, 8);
  assert.equal(Object.keys(AGENTS).length, 8);
  assert.equal(new Set(Object.values(AVATARS).map((a) => a.color)).size, 8, 'distinct avatar colours');
  assert.equal(new Set(Object.values(AGENTS).map((a) => a.label)).size, 8, 'distinct agent labels');
  assert.equal(AGENTS.intake.label, 'Intake');
});

test('AC-8: config.json runs 3 jobs at a time and protects the spine tests; prices cover every alias', () => {
  const config = JSON.parse(read('factory/config.json'));
  assert.equal(config.concurrency, 3);
  assert.equal(config.max_rounds, 3);
  assert.equal(config.base, 'origin/main');
  assert.match(config.repo, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/);
  for (const file of ['test/route.test.js', 'test/job.test.js', 'test/gate.test.js', 'test/cost.test.js']) {
    assert.ok(config.protected_tests.includes(file), `${file} is protected`);
    assert.ok(existsSync(join(repo, file)), `${file} exists`);
  }
  for (const alias of ['fable', 'opus', 'sonnet', 'haiku']) {
    const price = config.prices[alias];
    assert.ok(price, `price for ${alias}`);
    for (const k of ['input', 'output', 'cache_write', 'cache_read']) {
      assert.ok(Number.isFinite(price[k]) && price[k] >= 0, `${alias}.${k} is a non-negative number`);
    }
  }
  assert.equal(config.models.intake, 'fable');
});

test('AC-8: checks.sh and every factory/bin script are executable; checks.sh runs npm test', () => {
  const exec = (rel) => {
    accessSync(join(repo, rel), constants.X_OK);
    const mode = execFileSync('git', ['ls-files', '-s', rel], { cwd: repo, encoding: 'utf8' }).split(' ')[0];
    if (mode) assert.equal(mode, '100755', `${rel} is committed as executable`);
  };
  exec('factory/checks.sh');
  assert.match(read('factory/checks.sh'), /^npm test\b/m);
  const bins = readdirSync(join(repo, 'factory/bin'));
  assert.deepEqual(bins.sort(), ['gate', 'job', 'nudge', 'route', 'setup']);
  for (const bin of bins) {
    exec(`factory/bin/${bin}`);
    assert.ok(statSync(join(repo, 'factory/bin', bin)).isFile());
    assert.match(read(`factory/bin/${bin}`), /^#!\/bin\/sh\n/, `${bin} is a sh script`);
  }
  for (const name of ['job', 'gate', 'route', 'nudge']) {
    assert.equal(
      read(`factory/bin/${name}`),
      `#!/bin/sh\nexec node "$(dirname "$0")/../lib/${name}.js" "$@"\n`,
      `${name} is the 2-line wrapper`,
    );
  }
  assert.ok(!existsSync(join(repo, 'factory/backlog.md')), 'factory/backlog.md is gone');
});

test('AC-8: SKILL.md documents the v2 commands and keeps the v1 rules', () => {
  const skill = read('.claude/skills/factory/SKILL.md');
  for (const text of ['/factory run', '/factory issue', '/factory rework', 'WAIT FOR ALL', 'run_in_background', 'SendMessage']) {
    assert.ok(skill.includes(text), `SKILL.md contains ${text}`);
  }
  for (const text of ['/factory approve', '/factory next']) {
    assert.ok(!skill.includes(text), `SKILL.md does not contain ${text}`);
  }
});
