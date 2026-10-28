// Guided loop tour: which stage the tour shows and whether it advances on its
// own. Pure functions over `{ index, playing }`; none mutates its input.
// Plain JS with no React imports, so it runs (and is tested) in Node.
import { STAGES } from './engine.js';

/** How long each step stays on screen, in milliseconds. */
export const TOUR_STEP_MS = 10000;

/** A new tour: first stage, playing. */
export function createTour() {
  return { index: 0, playing: true };
}

/** The next stage; after the last one the tour wraps to the first. */
export function nextStep(tour) {
  return { index: (tour.index + 1) % STAGES.length, playing: tour.playing };
}

/**
 * Jumps to a stage and pauses, so its explanation stays on screen.
 * @throws {RangeError} unless stageIndex is an integer from 0 to STAGES.length - 1
 */
export function selectStep(tour, stageIndex) {
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= STAGES.length) {
    throw new RangeError(`stage index must be an integer from 0 to ${STAGES.length - 1}, got ${String(stageIndex)}`);
  }
  return { index: stageIndex, playing: false };
}

/** Pauses a playing tour or resumes a paused one, on the same stage. */
export function togglePlaying(tour) {
  return { index: tour.index, playing: !tour.playing };
}
