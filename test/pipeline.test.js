import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TOUR_STEP_MS } from '../src/game/tour.js';
import { TOUR_STEPS } from '../src/game/scenarios.js';
import { FLOOR, FLOOR_VIEWBOX, NODES, iso } from '../src/game/scene.js';
import { PIPELINE_CYCLE_MS, packageAt } from '../src/game/pipeline.js';

test('AC-6: packageAt rests at the path ends and rides smoothly inside the floor', () => {
  assert.equal(PIPELINE_CYCLE_MS, TOUR_STEPS.length * TOUR_STEP_MS, 'cycle is one full tour');
  const { x, y, width, height } = FLOOR_VIEWBOX;
  const s = FLOOR.packageSize;
  TOUR_STEPS.forEach((step, i) => {
    const first = NODES[step.path[0]].point;
    const last = NODES[step.path.at(-1)].point;
    assert.deepEqual(packageAt(i, 0).position, first, `step ${i} starts at the first node`);
    assert.deepEqual(packageAt(i, TOUR_STEP_MS - 1).position, last, `step ${i} ends at the last node`);
    assert.equal(packageAt(i, TOUR_STEP_MS - 1).node, step.path.at(-1));
    assert.deepEqual(packageAt(i, NaN), packageAt(i, 0), `step ${i} NaN is 0`);
    let prev = null;
    for (let t = 0; t < TOUR_STEP_MS; t += 1000 / 30) {
      const { position } = packageAt(i, t);
      assert.ok(position.length === 3 && position.every(Number.isFinite), `step ${i} t=${t} finite`);
      for (const c of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const [sx, sy] = iso(position.map((v, k) => v + ((c >> k) & 1) * s));
        assert.ok(sx >= x && sx <= x + width && sy >= y && sy <= y + height, `step ${i} t=${t} box inside the view`);
      }
      if (prev) assert.ok(Math.hypot(...position.map((v, k) => v - prev[k])) < s / 2, `step ${i} t=${t} moves less than half a package`);
      prev = position;
    }
  });
  for (const bad of [-1, TOUR_STEPS.length, 0.5, NaN, '0', undefined]) {
    assert.throws(() => packageAt(bad, 0), RangeError, `packageAt(${String(bad)}) throws`);
  }
});

describe('job 011: moving belts and wires', () => {
  test('AC-3: treadOffset loops seamlessly with the pipeline cycle and the belt never aliases', async () => {
    const { BELT_PITCH, BELT_PERIOD_MS, WIRE_PERIOD_MS, treadOffset } = await import('../src/game/pipeline.js');
    assert.equal(typeof treadOffset, 'function', 'pipeline.js exports treadOffset');
    for (const [name, v] of Object.entries({ BELT_PITCH, BELT_PERIOD_MS, WIRE_PERIOD_MS })) {
      assert.ok(Number.isFinite(v) && v > 0, `${name} is a positive number`);
    }
    assert.equal(PIPELINE_CYCLE_MS % BELT_PERIOD_MS, 0, 'BELT_PERIOD_MS divides the cycle');
    assert.equal(PIPELINE_CYCLE_MS % WIRE_PERIOD_MS, 0, 'WIRE_PERIOD_MS divides the cycle');
    const speed = (BELT_PITCH * 1000) / BELT_PERIOD_MS;
    assert.ok(speed >= 40 && speed <= 110, `belt speed ${speed} units/s is between 40 and 110`);
    assert.ok((BELT_PITCH * (1000 / 30)) / BELT_PERIOD_MS < BELT_PITCH / 2, 'belt moves under half a pitch per 30 fps frame');

    for (const [p, P] of [
      [BELT_PITCH, BELT_PERIOD_MS],
      [6, WIRE_PERIOD_MS],
    ]) {
      for (let t = 0; t < PIPELINE_CYCLE_MS; t += 10) {
        const v = treadOffset(t, p, P);
        assert.ok(v >= 0 && v < p, `treadOffset(${t}, ${p}, ${P}) = ${v} is in [0, ${p})`);
        assert.ok(Math.abs(v - treadOffset(t + PIPELINE_CYCLE_MS, p, P)) <= 1e-9, `treadOffset(${t}) repeats one cycle later`);
      }
      assert.equal(treadOffset(0, p, P), 0, `treadOffset(0, ${p}, ${P}) is 0`);
      assert.ok(Math.abs(treadOffset(P / 4, p, P) - p / 4) <= 1e-9, `a quarter period moves a quarter pitch (${p}, ${P})`);
    }

    for (const bad of [undefined, NaN, Infinity]) {
      assert.equal(treadOffset(bad, 8, 100), 0, `treadOffset(${bad}, 8, 100) is 0`);
    }
    for (const [ms, p, P] of [
      [0, 0, 100],
      [0, 8, 0],
      [0, 8, NaN],
    ]) {
      assert.throws(() => treadOffset(ms, p, P), RangeError, `treadOffset(${ms}, ${p}, ${P}) throws RangeError`);
    }
  });
});
