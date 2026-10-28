// The guided tour's melody: one 16-beat phrase per tour step, at 96 BPM, so a
// phrase lasts exactly TOUR_STEP_MS and a new pipeline package enters every 4
// beats. Plain data, no audio code: sound.js plays it.
import { STAGES } from './engine.js';
import { TOUR_STEP_MS } from './tour.js';

export const BEATS_PER_STEP = 16;
export const BEAT_MS = TOUR_STEP_MS / BEATS_PER_STEP;

// One chord per stage, as [MIDI root, minor?]: Am F C G Am Em C.
const CHORDS = Object.freeze([
  [57, true],
  [53, false],
  [60, false],
  [55, false],
  [57, true],
  [52, true],
  [60, false],
]);
// An arpeggio over chord tones (0 root, 1 third, 2 fifth, 3 octave, 4 octave third),
// one per beat; null is a rest. Beats 6 and 14 hold over the rest that follows.
const ARPEGGIO = Object.freeze([0, 2, 1, 2, 3, 2, 4, null, 0, 2, 1, 2, 3, 4, 3, null]);
const HELD = new Set([6, 14]);
const NOTE_MS = 500;
const HELD_MS = 1150;

const frequencyOf = (midi) => 440 * 2 ** ((midi - 69) / 12);

/**
 * The phrase for a tour step: notes sorted by start, never overlapping, each
 * starting on a beat and ending inside the step.
 * @param {number} stageIndex
 * @returns {Array<{ startMs: number, durationMs: number, frequency: number }>}
 * @throws {RangeError} unless stageIndex is an integer from 0 to STAGES.length - 1
 */
export function phraseFor(stageIndex) {
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= STAGES.length) {
    throw new RangeError(`stage index must be an integer from 0 to ${STAGES.length - 1}, got ${String(stageIndex)}`);
  }
  const [root, minor] = CHORDS[stageIndex];
  const third = minor ? 3 : 4;
  const tones = [0, third, 7, 12, 12 + third];
  return ARPEGGIO.flatMap((tone, beat) =>
    tone === null
      ? []
      : [{ startMs: beat * BEAT_MS, durationMs: HELD.has(beat) ? HELD_MS : NOTE_MS, frequency: frequencyOf(root + tones[tone]) }],
  );
}
