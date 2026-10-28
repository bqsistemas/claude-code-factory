import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TOUR_STEPS } from '../src/game/scenarios.js';
import { TOUR_STEP_MS } from '../src/game/tour.js';
import { BEATS_PER_STEP, BEAT_MS, phraseFor } from '../src/game/melody.js';

test('AC-6: one beat-aligned, non-overlapping, in-range phrase per tour step', () => {
  assert.equal(BEATS_PER_STEP, 16);
  assert.equal(BEAT_MS * BEATS_PER_STEP, TOUR_STEP_MS, 'beats fill one tour step');

  for (let i = 0; i < TOUR_STEPS.length; i += 1) {
    const notes = phraseFor(i);
    assert.ok(Array.isArray(notes) && notes.length > 0, `stage ${i} phrase is non-empty`);
    notes.forEach((note, k) => {
      const label = `stage ${i} note ${k}`;
      assert.ok([note.startMs, note.durationMs, note.frequency].every(Number.isFinite), `${label} is finite`);
      assert.ok(note.durationMs > 0, `${label} has a positive duration`);
      assert.equal(note.startMs % BEAT_MS, 0, `${label} starts on a beat`);
      assert.ok(note.startMs >= 0 && note.startMs + note.durationMs <= TOUR_STEP_MS, `${label} fits in the step`);
      assert.ok(note.frequency >= 110 && note.frequency <= 1760, `${label} frequency ${note.frequency} in range`);
      if (k > 0) {
        const prev = notes[k - 1];
        assert.ok(prev.startMs < note.startMs, `${label} is sorted`);
        assert.ok(prev.startMs + prev.durationMs <= note.startMs, `${label} does not overlap the previous note`);
      }
    });
    assert.deepEqual(phraseFor(i), notes, `stage ${i} phrase is deterministic`);
  }

  for (const bad of [-1, TOUR_STEPS.length, 1.5, NaN, '2', undefined]) {
    assert.throws(() => phraseFor(bad), RangeError, `phraseFor(${String(bad)}) throws RangeError`);
  }
});
