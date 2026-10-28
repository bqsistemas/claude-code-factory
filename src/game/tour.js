// Guided loop tour: which scenario step (an index into TOUR_STEPS) the tour shows and
// whether it advances on its own. Pure functions over `{ index, playing, scenario }`; none mutates its input.
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

const indexesOf = (scenarioId) => TOUR_STEPS.flatMap((step, i) => (step.scenarioId === scenarioId ? [i] : []));

/**
 * A new tour, playing. `scenarioId` null ("Ver todos") starts at the first step of
 * all; an id starts at that scenario's first step and stays inside it.
 * @throws {RangeError} for an unknown scenario id
 */
export function createTour(scenarioId = null) {
  if (scenarioId === null) return { index: 0, playing: true, scenario: null };
  const [first] = indexesOf(scenarioId);
  if (first === undefined) throw new RangeError(`unknown scenario: ${String(scenarioId)}`);
  return { index: first, playing: true, scenario: scenarioId };
}

/** The next step; after the last one the tour (or its scenario) wraps to the first. */
export function nextStep(tour) {
  const scenario = tour.scenario ?? null;
  if (scenario === null) return { index: (tour.index + 1) % TOUR_STEPS.length, playing: tour.playing, scenario };
  const own = indexesOf(scenario);
  const at = own.indexOf(tour.index);
  return { index: own[(at + 1) % own.length], playing: tour.playing, scenario };
}

/**
 * Jumps to a step and pauses, so its explanation stays on screen.
 * @throws {RangeError} unless stepIndex is an integer from 0 to TOUR_STEPS.length - 1
 */
export function selectStep(tour, stepIndex) {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= TOUR_STEPS.length) {
    throw new RangeError(`step index must be an integer from 0 to ${TOUR_STEPS.length - 1}, got ${String(stepIndex)}`);
  }
  return { index: stepIndex, playing: false, scenario: tour.scenario ?? null };
}

/** Pauses a playing tour or resumes a paused one, on the same step. */
export function togglePlaying(tour) {
  return { index: tour.index, playing: !tour.playing, scenario: tour.scenario ?? null };
}

/**
 * The step to show when a station is clicked: the first step of the happy path
 * (auto-merge-on), or of `scenarioId`, that ends at that station. -1 when the
 * scenario has none.
 * @throws {RangeError} unless stationIndex is an integer from 0 to STAGES.length - 1
 */
export function stepForStation(stationIndex, scenarioId = null) {
  if (!Number.isInteger(stationIndex) || stationIndex < 0 || stationIndex >= STAGES.length) {
    throw new RangeError(`station index must be an integer from 0 to ${STAGES.length - 1}, got ${String(stationIndex)}`);
  }
  const id = STAGES[stationIndex].id;
  return TOUR_STEPS.findIndex((step) => step.scenarioId === (scenarioId ?? 'auto-merge-on') && step.path[step.path.length - 1] === id);
}
