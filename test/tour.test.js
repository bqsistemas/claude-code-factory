import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STAGES } from '../src/game/engine.js';
import { TOUR_STEP_MS, createTour, nextStep, selectStep, togglePlaying } from '../src/game/tour.js';

// Calls fn(input) and checks the input is unchanged afterwards.
function pure(fn, input, ...args) {
  const before = structuredClone(input);
  const result = fn(input, ...args);
  assert.deepEqual(input, before, `${fn.name} does not mutate its input`);
  assert.notEqual(result, input, `${fn.name} returns a new object`);
  return result;
}

test('AC-1: createTour, nextStep, and togglePlaying are pure and the tour wraps', () => {
  assert.ok(Number.isInteger(TOUR_STEP_MS) && TOUR_STEP_MS > 0, 'TOUR_STEP_MS is a positive integer');
  assert.deepEqual(createTour(), { index: 0, playing: true });

  for (let i = 0; i < STAGES.length; i += 1) {
    assert.deepEqual(pure(nextStep, { index: i, playing: true }), { index: (i + 1) % STAGES.length, playing: true }, `next of ${i}`);
    assert.deepEqual(pure(nextStep, { index: i, playing: false }), { index: (i + 1) % STAGES.length, playing: false }, `next of ${i} paused`);
  }
  assert.equal(nextStep({ index: STAGES.length - 1, playing: true }).index, 0, 'last stage wraps to 0');

  const tour = { index: 3, playing: true };
  const toggled = pure(togglePlaying, tour);
  assert.deepEqual(toggled, { index: 3, playing: false });
  assert.deepEqual(pure(togglePlaying, toggled), tour, 'toggling twice returns the original values');
});

test('AC-2: selectStep jumps to a valid stage and pauses; invalid indexes throw RangeError', () => {
  for (let i = 0; i < STAGES.length; i += 1) {
    assert.deepEqual(pure(selectStep, { index: 0, playing: true }, i), { index: i, playing: false }, `select ${i}`);
  }
  for (const bad of [-1, STAGES.length, 1.5, NaN, '2', null, undefined]) {
    assert.throws(() => selectStep({ index: 0, playing: true }, bad), RangeError, `selectStep(${String(bad)}) throws`);
  }
});
