import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STAGES } from '../src/game/engine.js';
import { TOUR_STEP_MS } from '../src/game/tour.js';
import { FLOOR, FLOOR_VIEWBOX, FORK, HUMAN_ROUTE, PLATE, STATIONS, iso } from '../src/game/scene.js';
import { PACKAGE_INTERVAL_MS, PIPELINE_CYCLE_MS, packageTimeline, pipelineAt } from '../src/game/pipeline.js';

const STEP = 100;
const SAMPLES = [];
for (let t = 0; t < PIPELINE_CYCLE_MS; t += STEP) SAMPLES.push({ t, state: pipelineAt(t) });

const PHASES = ['line', 'branch', 'queued', 'human', 'merging'];
const footprint = ({ position: [x, y], size: [w, d] }) => ({ x0: x, x1: x + w, y0: y, y1: y + d });
const insideXY = ([x, y], f) => x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1;
const [approvePad, escalatePad] = FORK.branches.map((b) => b.pad);
const approve = footprint(approvePad);
const escalate = footprint(escalatePad);
const plate = footprint(PLATE);
const PACKAGES_PER_CYCLE = PIPELINE_CYCLE_MS / PACKAGE_INTERVAL_MS;

test('AC-5: pipelineAt repeats every cycle, always shows several packages, and stays on the plate', () => {
  assert.equal(PIPELINE_CYCLE_MS, STAGES.length * TOUR_STEP_MS, 'cycle is one full tour');
  assert.ok(Number.isInteger(PACKAGES_PER_CYCLE), 'a whole number of packages per cycle');

  for (const { t, state } of SAMPLES) {
    assert.deepEqual(pipelineAt(t + PIPELINE_CYCLE_MS), state, `t=${t} repeats one cycle later`);
    assert.ok(state.packages.length >= 2, `t=${t} has at least 2 packages`);
    const ids = state.packages.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `t=${t} ids are unique`);
    assert.equal(state.queued, state.packages.filter((p) => p.phase === 'queued').length, `t=${t} queued count`);
    for (const p of state.packages) {
      const label = `t=${t} package ${p.id}`;
      assert.ok(['APPROVE', 'ESCALATE'].includes(p.decision), `${label} decision`);
      assert.ok(PHASES.includes(p.phase), `${label} phase ${p.phase}`);
      assert.ok(Array.isArray(p.position) && p.position.length === 3 && p.position.every(Number.isFinite), `${label} position finite`);
      assert.ok(insideXY(p.position, plate), `${label} position ${p.position} inside PLATE`);
      assert.ok(p.merge >= 0 && p.merge <= 1, `${label} merge in 0..1`);
      // Risk: every package box, stacked or not, stays inside the drawing's frame.
      const s = FLOOR.packageSize;
      for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const [sx, sy] = iso(p.position.map((v, k) => v + ((corner >> k) & 1) * s));
        const { x, y, width, height } = FLOOR_VIEWBOX;
        assert.ok(sx >= x && sx <= x + width && sy >= y && sy <= y + height, `${label} box corner inside FLOOR_VIEWBOX`);
      }
    }
  }

  assert.ok(
    SAMPLES.some(({ state }) => state.packages.filter((p) => p.phase === 'line').length >= 3),
    'some sample has at least 3 packages on the line',
  );

  // A package that first appears mid-cycle does so at station 1's lane, on the line.
  const station1 = footprint(STATIONS[0]);
  const [laneY0, laneY1] = FLOOR.lane;
  const seen = new Set(SAMPLES[0].state.packages.map((p) => p.id));
  let entered = 0;
  for (const { state } of SAMPLES.slice(1)) {
    for (const p of state.packages) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      if (p.phase === 'line' && p.position[0] >= station1.x0 && p.position[0] <= station1.x1 && p.position[1] >= laneY0 && p.position[1] <= laneY1) {
        entered += 1;
      }
    }
  }
  assert.ok(entered >= 1, 'at least one package first appears at station 1 on the line');

  // A package merges on the APPROVE pad and then disappears.
  const merged = SAMPLES.some(({ state }, i) =>
    state.packages.some(
      (p) =>
        p.phase === 'merging' &&
        insideXY(p.position, approve) &&
        SAMPLES.slice(i + 1, i + 11).some((later) => !later.state.packages.some((q) => q.id === p.id)),
    ),
  );
  assert.ok(merged, 'a package merges into the APPROVE pad and disappears');

  for (const bad of [NaN, Infinity, -Infinity, undefined]) {
    assert.deepEqual(pipelineAt(bad), pipelineAt(0), `pipelineAt(${bad}) is pipelineAt(0)`);
  }
  assert.deepEqual(pipelineAt(-STEP), pipelineAt(PIPELINE_CYCLE_MS - STEP), 'negative time wraps');
});

test('AC-6: escalated packages queue on the ESCALATE pad and reach main later, along HUMAN_ROUTE', () => {
  const timelines = Array.from({ length: PACKAGES_PER_CYCLE }, (_, n) => packageTimeline(n));
  for (const [n, tl] of timelines.entries()) {
    assert.equal(tl.id, n, `package ${n} id`);
    assert.equal(tl.enterMs, n * PACKAGE_INTERVAL_MS, `package ${n} enters on the interval`);
    assert.ok(tl.enterMs < tl.forkMs && tl.forkMs < tl.mainMs, `package ${n}: enter < fork < main`);
  }
  const decisions = new Set(timelines.map((tl) => tl.decision));
  assert.deepEqual([...decisions].sort(), ['APPROVE', 'ESCALATE'], 'each cycle has both decisions');
  const wait = (d) => timelines.filter((tl) => tl.decision === d).map((tl) => tl.mainMs - tl.forkMs);
  assert.ok(Math.min(...wait('ESCALATE')) > Math.max(...wait('APPROVE')), 'every ESCALATE reaches main later than every APPROVE');

  assert.ok(SAMPLES.some(({ state }) => state.queued >= 2), 'some sample has 2 or more queued packages');
  const padHeight = escalatePad.size[2];
  for (const { t, state } of SAMPLES) {
    assert.ok(state.queued <= 6, `t=${t} has at most 6 queued`);
    const queued = state.packages.filter((p) => p.phase === 'queued');
    for (const p of queued) {
      assert.ok(insideXY(p.position, escalate), `t=${t} queued ${p.id} inside the ESCALATE pad`);
      assert.ok(p.position[2] >= padHeight, `t=${t} queued ${p.id} on top of the pad`);
      assert.equal(p.decision, 'ESCALATE', `t=${t} queued ${p.id} is ESCALATE`);
    }
    const keys = queued.map((p) => p.position.join(','));
    assert.equal(new Set(keys).size, keys.length, `t=${t} queued positions are distinct`);
  }

  assert.ok(Object.isFrozen(HUMAN_ROUTE), 'HUMAN_ROUTE is frozen');
  assert.ok(HUMAN_ROUTE.length >= 2, 'HUMAN_ROUTE has at least 2 points');
  for (const p of HUMAN_ROUTE) {
    assert.ok(Array.isArray(p) && p.length === 3 && p.every(Number.isFinite), `route point ${p} is a finite triple`);
  }
  assert.ok(insideXY(HUMAN_ROUTE[0], escalate), 'HUMAN_ROUTE starts over the ESCALATE pad');
  assert.ok(insideXY(HUMAN_ROUTE[HUMAN_ROUTE.length - 1], approve), 'HUMAN_ROUTE ends over the APPROVE pad');
  for (let k = 1; k < HUMAN_ROUTE.length; k += 1) {
    const changed = [0, 1, 2].filter((c) => HUMAN_ROUTE[k][c] !== HUMAN_ROUTE[k - 1][c]).length;
    assert.equal(changed, 1, `route segment ${k} changes exactly one coordinate`);
  }
  const { x, y, width, height } = FLOOR_VIEWBOX;
  for (const p of HUMAN_ROUTE) {
    const [sx, sy] = iso(p);
    assert.ok(sx >= x && sx <= x + width && sy >= y && sy <= y + height, `route point ${p} inside FLOOR_VIEWBOX`);
    assert.ok(insideXY(p, plate), `route point ${p} on the PLATE`);
  }
});
