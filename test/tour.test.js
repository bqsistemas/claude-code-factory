import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STAGES } from '../src/game/engine.js';
import { TOUR_STEPS } from '../src/game/scenarios.js';
import { TOUR_STEP_MS, createTour, nextStep, selectStep, stepForStation, togglePlaying } from '../src/game/tour.js';

// Calls fn(input) and checks the input is unchanged afterwards.
function pure(fn, input, ...args) {
  const before = structuredClone(input);
  const result = fn(input, ...args);
  assert.deepEqual(input, before, `${fn.name} does not mutate its input`);
  assert.notEqual(result, input, `${fn.name} returns a new object`);
  return result;
}

test('AC-6: createTour, nextStep, and togglePlaying are pure and the tour wraps', () => {
  assert.ok(Number.isInteger(TOUR_STEP_MS) && TOUR_STEP_MS > 0, 'TOUR_STEP_MS is a positive integer');
  assert.deepEqual(createTour(), { index: 0, playing: true });

  for (let i = 0; i < TOUR_STEPS.length; i += 1) {
    assert.deepEqual(pure(nextStep, { index: i, playing: true }), { index: (i + 1) % TOUR_STEPS.length, playing: true }, `next of ${i}`);
    assert.deepEqual(pure(nextStep, { index: i, playing: false }), { index: (i + 1) % TOUR_STEPS.length, playing: false }, `next of ${i} paused`);
  }
  assert.equal(nextStep({ index: TOUR_STEPS.length - 1, playing: true }).index, 0, 'last stage wraps to 0');

  const tour = { index: 3, playing: true };
  const toggled = pure(togglePlaying, tour);
  assert.deepEqual(toggled, { index: 3, playing: false });
  assert.deepEqual(pure(togglePlaying, toggled), tour, 'toggling twice returns the original values');
});

test('AC-6: selectStep jumps to a valid stage and pauses; invalid indexes throw RangeError', () => {
  for (let i = 0; i < TOUR_STEPS.length; i += 1) {
    assert.deepEqual(pure(selectStep, { index: 0, playing: true }, i), { index: i, playing: false }, `select ${i}`);
  }
  for (const bad of [-1, TOUR_STEPS.length, 1.5, NaN, '2', null, undefined]) {
    assert.throws(() => selectStep({ index: 0, playing: true }, bad), RangeError, `selectStep(${String(bad)}) throws`);
  }
});

test('AC-6: stepForStation finds the happy-path step that ends at each station', () => {
  STAGES.forEach((stage, i) => {
    const step = TOUR_STEPS[stepForStation(i)];
    assert.equal(step.scenarioId, 'auto-merge-on');
    assert.equal(step.path.at(-1), stage.id);
  });
  for (const bad of [-1, STAGES.length, 0.5, NaN, '1', undefined]) {
    assert.throws(() => stepForStation(bad), RangeError, `stepForStation(${String(bad)}) throws`);
  }
});
