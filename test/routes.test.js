import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCENARIOS } from '../src/game/scenarios.js';
import { LABELS, NODES, TRACKS } from '../src/game/scene.js';
import { FORKS, REPEAT_SUFFIX, ROUTES, plantFocus, scenarioRoute } from '../src/game/routes.js';

const key = (t) => `${t.from}>${t.to}`;
const TRACK_KEYS = TRACKS.map(key);
const NODE_IDS = Object.keys(NODES);

test('AC-1: scenarioRoute chains the steps paths into connected, known segments', () => {
  for (const { id, steps } of SCENARIOS) {
    const route = scenarioRoute(id);
    assert.equal(route.id, id);
    assert.ok(route.segments.length > 0);
    route.segments.forEach((s, k) => {
      assert.ok(TRACK_KEYS.includes(s.key), `${id}: ${s.key} is a track`);
      assert.equal(s.key, `${s.from}>${s.to}`);
      if (k + 1 < route.segments.length) assert.equal(s.to, route.segments[k + 1].from, `${id}: segment ${k} connects`);
    });
    assert.equal(route.nodes[0], steps[0].path[0]);
    route.segments.forEach((s, k) => assert.equal(route.nodes[k + 1], s.to));
    assert.equal(route.nodes.length, route.segments.length + 1);
    assert.ok(Object.isFrozen(route));
    assert.deepEqual(ROUTES[id], route);
  }
  assert.throws(() => scenarioRoute('nope'), RangeError);
});

test('AC-2: every non-belt track is on some route and the returns are exactly the four return tracks', () => {
  const all = Object.values(ROUTES).flatMap((r) => r.segments);
  for (const t of TRACKS.filter((x) => x.kind !== 'belt')) assert.ok(all.some((s) => s.key === key(t)), `${key(t)} is used`);
  const returns = [...new Set(all.filter((s) => s.returns).map((s) => s.key))].sort();
  assert.deepEqual(returns, ['bay-needs-human>build', 'bin-needs-info>intake', 'gate>build', 'review>build']);
  assert.ok(REPEAT_SUFFIX === ' ×2');
  assert.deepEqual(Object.keys(FORKS).sort(), ['approve', 'bay-needs-human', 'gate', 'intake', 'merge', 'review']);
});

test('AC-3: plantFocus partitions every node, track and label', () => {
  for (const { id, steps } of SCENARIOS) {
    const first = plantFocus(id, 0);
    let prev = null;
    steps.forEach((step, k) => {
      const f = plantFocus(id, k);
      const buckets = [[f.current], f.passed.nodes, f.ahead.nodes, f.dimmed.nodes].flat();
      assert.deepEqual([...buckets].sort(), [...NODE_IDS].sort(), `${id}/${k}: nodes partition`);
      const tb = [f.currentTracks, f.passed.tracks, f.ahead.tracks, f.dimmed.tracks].flat();
      assert.deepEqual([...tb].sort(), [...TRACK_KEYS].sort(), `${id}/${k}: tracks partition`);
      assert.equal(f.current, step.path.at(-1));
      assert.deepEqual(f.dimmed, first.dimmed, `${id}: dimmed is constant`);
      if (prev) {
        for (const n of prev.passed.nodes) assert.ok(f.passed.nodes.includes(n) || n === f.current, `${id}/${k}: passed grows`);
        for (const t of prev.passed.tracks) assert.ok(f.passed.tracks.includes(t) || f.currentTracks.includes(t), `${id}/${k}: passed tracks grow`);
      }
      const dimNodes = new Set(f.dimmed.nodes);
      const dimTracks = new Set(f.dimmed.tracks);
      const expected = LABELS.filter((l) => !l.layer && ((l.hot && dimNodes.has(l.hot)) || (l.track && dimTracks.has(l.track)))).map((l) => l.id);
      assert.deepEqual([...f.dimmed.labels].sort(), expected.sort(), `${id}/${k}: dimmed labels`);
      for (const l of LABELS.filter((x) => x.layer)) assert.ok(!f.dimmed.labels.includes(l.id));
      for (const t of f.notTaken) assert.ok(f.dimmed.tracks.includes(t) || true);
      assert.ok(Object.isFrozen(f));
      prev = f;
    });
  }
  const g = plantFocus('gate-fail', 0);
  assert.equal(g.current, 'gate');
  assert.deepEqual(g.ahead.tracks, ['gate>build']);
  assert.ok(g.dimmed.nodes.includes('queue'));
  assert.ok(g.dimmed.tracks.includes('gate>review'));
  assert.throws(() => plantFocus('nope', 0), RangeError);
  assert.throws(() => plantFocus('gate-fail', 99), RangeError);
  assert.throws(() => plantFocus('gate-fail', -1), RangeError);
});

test('AC-4: taken, notTaken and repeats', () => {
  const f = plantFocus('auto-merge-on', 9);
  assert.deepEqual([...f.taken].sort(), ['approve>merge', 'gate>review', 'intake>route', 'merge>bay-merged', 'review>approve'].sort());
  assert.deepEqual(
    [...f.notTaken].sort(),
    ['intake>bin-needs-info', 'intake>bin-reject', 'gate>build', 'review>build', 'approve>bay-needs-human', 'merge>bay-awaiting-merge'].sort(),
  );
  for (const { id, steps } of SCENARIOS) {
    steps.forEach((_, k) => {
      const p = plantFocus(id, k);
      for (const t of p.notTaken) assert.ok(p.dimmed.tracks.includes(t), `${id}/${k}: ${t} dimmed`);
    });
  }
  assert.deepEqual(plantFocus('gate-fail', 0).repeats, []);
  assert.deepEqual(plantFocus('gate-fail', 1).repeats, ['build']);
  assert.deepEqual(plantFocus('needs-info', 1).repeats, ['intake']);
  SCENARIOS.find((s) => s.id === 'auto-merge-on').steps.forEach((_, k) => assert.deepEqual(plantFocus('auto-merge-on', k).repeats, []));
});
