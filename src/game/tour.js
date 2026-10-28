// Guided loop tour: which scenario step (an index into TOUR_STEPS) the tour shows and
// whether it advances on its own. Pure functions over `{ index, playing }`; none mutates its input.
// Plain JS with no React imports, so it runs (and is tested) in Node.
import { STAGES } from './engine.js';
import { TOUR_STEPS } from './scenarios.js';

/** How long each step stays on screen, in milliseconds. */
export const TOUR_STEP_MS = 10000;

/**
 * The Player frame (30 fps) a paused tour shows after a station is selected: the
 * station is fully lit (frames 0-15) and the package has arrived on it.
 */
export const SELECT_FRAME = 75;

/** A new tour: first step, playing. */
export function createTour() {
  return { index: 0, playing: true };
}

/** The next step; after the last one the tour wraps to the first. */
export function nextStep(tour) {
  return { index: (tour.index + 1) % TOUR_STEPS.length, playing: tour.playing };
}

/**
 * Jumps to a step and pauses, so its explanation stays on screen.
 * @throws {RangeError} unless stepIndex is an integer from 0 to TOUR_STEPS.length - 1
 */
export function selectStep(tour, stepIndex) {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= TOUR_STEPS.length) {
    throw new RangeError(`step index must be an integer from 0 to ${TOUR_STEPS.length - 1}, got ${String(stepIndex)}`);
  }
  return { index: stepIndex, playing: false };
}

/** Pauses a playing tour or resumes a paused one, on the same step. */
export function togglePlaying(tour) {
  return { index: tour.index, playing: !tour.playing };
}

/**
 * The step to show when a station is clicked: the first step of the happy path
 * (auto-merge-on) that ends at that station.
 * @throws {RangeError} unless stationIndex is an integer from 0 to STAGES.length - 1
 */
export function stepForStation(stationIndex) {
  if (!Number.isInteger(stationIndex) || stationIndex < 0 || stationIndex >= STAGES.length) {
    throw new RangeError(`station index must be an integer from 0 to ${STAGES.length - 1}, got ${String(stationIndex)}`);
  }
  const id = STAGES[stationIndex].id;
  return TOUR_STEPS.findIndex((step) => step.scenarioId === 'auto-merge-on' && step.path[step.path.length - 1] === id);
}
