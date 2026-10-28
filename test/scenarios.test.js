import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { STAGES } from '../src/game/engine.js';
import { SCENARIOS, TOUR_STEPS } from '../src/game/scenarios.js';
import { TRACKS } from '../src/game/scene.js';
import { route } from '../factory/lib/route.js';

const config = JSON.parse(await readFile(new URL('../factory/config.json', import.meta.url), 'utf8'));
const trackOf = (from, to) => TRACKS.find((t) => t.from === from && t.to === to);
const pairs = (path) => path.slice(1).map((id, k) => [path[k], id]);
const deepFrozen = (v, where = 'SCENARIOS') => {
  if (v === null || typeof v !== 'object') return;
  assert.ok(Object.isFrozen(v), `${where} is frozen`);
  for (const [k, c] of Object.entries(v)) deepFrozen(c, `${where}.${k}`);
};

const EXPECTED = [
  ['auto-merge-on', ['merge>bay-merged'], 'bay-merged', 'auto_merge: true'],
  ['reject', ['intake>bin-reject'], 'bin-reject', 'REJECT'],
  ['needs-info', ['intake>bin-needs-info', 'bin-needs-info>intake'], 'intake', 'NEEDS-INFO'],
  ['gate-fail', ['gate>build'], 'build', 'FAIL'],
  ['changes', ['review>build'], 'build', 'CHANGES'],
  ['escalate', ['approve>bay-needs-human'], 'bay-needs-human', 'ESCALATE'],
  ['auto-merge-off', ['merge>bay-awaiting-merge'], 'bay-awaiting-merge', 'auto_merge: false'],
  ['human-merge', ['bay-awaiting-merge>bay-merged'], 'bay-merged', 'merge'],
  ['human-rework', ['bay-needs-human>build'], 'build', '/factory rework'],
  ['pr-closed', ['bay-needs-human>bay-rejected'], 'bay-rejected', 'PR cerrado'],
];

test('AC-3: the ten scenarios walk real tracks and end where they should', () => {
  deepFrozen(SCENARIOS);
  assert.deepEqual(SCENARIOS.map((s) => s.id), EXPECTED.map(([id]) => id));
  for (const [id, must, end] of EXPECTED) {
    const scenario = SCENARIOS.find((s) => s.id === id);
    const last = scenario.steps.at(-1).path;
    assert.equal(last.at(-1), end, `${id} ends at ${end}`);
    const used = new Set(scenario.steps.flatMap((s) => pairs(s.path).map(([a, b]) => `${a}>${b}`)));
    for (const t of must) assert.ok(used.has(t), `${id} uses ${t}`);
    scenario.steps.forEach((step, k) => {
      assert.ok(step.path.length >= 1, `${id} step ${k} has a path`);
      for (const [a, b] of pairs(step.path)) assert.ok(trackOf(a, b), `${id} step ${k}: ${a}>${b} is a track`);
      if (k > 0) assert.equal(step.path[0], scenario.steps[k - 1].path.at(-1), `${id} step ${k} starts where the previous ended`);
    });
  }
  const happy = SCENARIOS[0].steps.map((s) => s.path.at(-1)).filter((id) => STAGES.some((st) => st.id === id));
  assert.deepEqual(happy, STAGES.map((s) => s.id), 'auto-merge-on visits every station in order');
  assert.deepEqual(TOUR_STEPS.map(({ path, text }) => [path, text]), SCENARIOS.flatMap((s) => s.steps.map(({ path, text }) => [path, text])));
  TOUR_STEPS.forEach((t, i) => assert.equal(t.scenarioId, SCENARIOS[t.scenarioIndex].id, `step ${i} scenarioId`));
});

test('AC-4: every scenario matches what route() picks and the configured models', async () => {
  let security = false;
  let uxui = false;
  let codeOnly = false;
  for (const scenario of SCENARIOS) {
    assert.deepEqual(route(config, scenario.job), scenario.routed, `${scenario.id} routed`);
    const lenses = Object.keys(scenario.routed.reviewers);
    security ||= lenses.includes('security');
    uxui ||= lenses.includes('ux') && lenses.includes('ui');
    codeOnly ||= lenses.length === 1 && lenses[0] === 'code';

    const actors = scenario.steps.flatMap((s) => s.actors);
    const reviewers = actors.filter((a) => a.name.startsWith('review-'));
    if (reviewers.length > 0) {
      assert.deepEqual([...new Set(reviewers.map((a) => a.name))].sort(), lenses.map((l) => `review-${l}`).sort(), `${scenario.id} reviewers are the routed lenses`);
    }
    for (const a of reviewers) assert.equal(a.model, scenario.routed.reviewers[a.name.slice(7)], `${scenario.id} ${a.name} model`);
    for (const a of actors.filter((x) => x.name === 'builder')) assert.equal(a.model, scenario.routed.builder);
    for (const a of actors.filter((x) => ['intake', 'spec-writer', 'approver'].includes(x.name))) {
      assert.equal(a.model, config.models[a.name], `${scenario.id} ${a.name} model`);
    }
  }
  assert.ok(security && uxui && codeOnly, 'scenarios cover security, ux+ui and code-only routing');

  const files = await readdir(new URL('../src/game/', import.meta.url));
  for (const file of files) {
    const source = await readFile(new URL(`../src/game/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from\s*['"][^'"]*factory\/lib\//, `${file} does not import factory/lib`);
    assert.doesNotMatch(source, /readFile|node:fs|fetch\(|import\s[^;]*config\.json/, `${file} reads no files at runtime`);
  }
});

test('AC-5: every step is narrated, attributed and conditioned', async () => {
  const dir = new URL('../.claude/agents/', import.meta.url);
  const names = new Set();
  for (const f of await readdir(dir)) names.add((await readFile(new URL(f, dir), 'utf8')).match(/^name:\s*(.+)$/m)[1].trim());
  const fileOf = (name) =>
    name.startsWith('review-') ? new RegExp(`^round-\\d+/.*review-${name.slice(7)}\\.md`) : new RegExp(`^${{ intake: 'intake', 'spec-writer': 'spec', builder: 'build', approver: 'decision' }[name]}\\.md$`);
  for (const [i, step] of TOUR_STEPS.entries()) {
    assert.ok(step.text.trim() && step.file.trim() && step.actors.length > 0, `step ${i} text, file, actors`);
    for (const actor of step.actors) {
      if (names.has(actor.name)) assert.ok(actor.model, `${actor.name} has a model`);
      else {
        assert.ok(['script', 'orquestador', 'persona'].includes(actor.name), `step ${i} actor ${actor.name} is known`);
        assert.equal(actor.model, null);
      }
      if (names.has(actor.name)) {
        const files = step.file.split(', ');
        assert.ok(files.some((f) => fileOf(actor.name).test(f)), `step ${i}: ${actor.name} writes ${step.file}`);
      }
    }
    const nonBelt = pairs(step.path).some(([a, b]) => trackOf(a, b).kind !== 'belt');
    if (nonBelt) {
      const needle = EXPECTED.find(([id]) => id === step.scenarioId)[3];
      assert.ok(step.condition?.includes(needle), `step ${i} condition contains ${needle}`);
    } else assert.equal(step.condition, null, `step ${i} has no condition`);
  }
});
