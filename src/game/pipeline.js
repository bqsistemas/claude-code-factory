// The scenario package on the guided tour floor: one package per tour step that
// rides the step's tracks, in path order, at a steady speed. It rests at the start
// of the path first (the node lights up) and at its end afterwards. Belts and
// wires keep moving with the frame (treadOffset). Plain JS with no React imports,
// so it runs (and is tested) in Node. Not real job data: nothing here reads
// factory/board.json.
import { NODES, TRACKS } from './scene.js';
import { TOUR_STEPS } from './scenarios.js';
import { TOUR_STEP_MS } from './tour.js';

/** The whole animation repeats after one full tour. */
export const PIPELINE_CYCLE_MS = TOUR_STEPS.length * TOUR_STEP_MS;

/** The package waits this long on the start node before it moves (the node lights up first). */
const REST_MS = 1000;
/** The package rides at this speed, in iso units per second: the belt rollers' speed. */
const SPEED = 80;

const mod = (v, m) => ((v % m) + m) % m;
const trackOf = new Map(TRACKS.map((t) => [`${t.from}>${t.to}`, t]));

// Every step's ride, precomputed: the polyline of its tracks in order and the
// distance at each point.
const RIDES = TOUR_STEPS.map(({ path }) => {
  const points = [[...NODES[path[0]].point]];
  for (let k = 1; k < path.length; k += 1) {
    const found = trackOf.get(`${path[k - 1]}>${path[k]}`);
    if (!found) throw new Error(`no track from ${path[k - 1]} to ${path[k]}`);
    points.push(...found.points.slice(1).map((p) => [...p]));
  }
  const distances = [0];
  for (let k = 1; k < points.length; k += 1) {
    distances.push(distances[k - 1] + Math.hypot(...points[k].map((v, c) => v - points[k - 1][c])));
  }
  return { points, distances, length: distances[distances.length - 1], first: path[0], node: path[path.length - 1] };
});

/**
 * Where the scenario package is during a tour step: its min corner, and the node
 * it stands on (the start node before the ride, the end node after it, null while it rides).
 * @param {number} stepIndex index into TOUR_STEPS
 * @param {number} ms time since the step started; non-finite means 0
 * @returns {{ position: number[], node: string | null }}
 * @throws {RangeError} unless stepIndex is an integer from 0 to TOUR_STEPS.length - 1
 */
export function packageAt(stepIndex, ms) {
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= TOUR_STEPS.length) {
    throw new RangeError(`step index must be an integer from 0 to ${TOUR_STEPS.length - 1}, got ${String(stepIndex)}`);
  }
  const { points, distances, length, first, node } = RIDES[stepIndex];
  const t = Number.isFinite(ms) ? ms : 0;
  const travelled = Math.min(Math.max(((t - REST_MS) * SPEED) / 1000, 0), length);
  if (travelled >= length) return { position: [...points[points.length - 1]], node };
  if (travelled <= 0) return { position: [...points[0]], node: first };
  let k = 1;
  while (distances[k] < travelled) k += 1;
  const f = (travelled - distances[k - 1]) / (distances[k] - distances[k - 1]);
  return { position: points[k - 1].map((v, c) => v + (points[k][c] - v) * f), node: null };
}

// --- Moving belts and wires --------------------------------------------------------

/** Roller spacing on the belts between stations, in iso units. */
export const BELT_PITCH = 8;
/** Rollers advance one pitch per period: 80 units/s, under half a pitch per 30 fps frame. */
export const BELT_PERIOD_MS = 100;
/** Dotted wire dashes advance one dash period per melody beat. */
export const WIRE_PERIOD_MS = 625;

/**
 * How far a repeating tread (belt rollers, wire dashes) has moved at a moment:
 * one pitch per period, so it is seamless across the pipeline cycle when the
 * period divides PIPELINE_CYCLE_MS.
 * @param {number} ms time in ms; non-finite (including undefined) means 0
 * @param {number} pitch distance between two treads; finite and > 0
 * @param {number} periodMs time to move one pitch; finite and > 0
 * @returns {number} the offset, in [0, pitch)
 * @throws {RangeError} unless pitch and periodMs are finite and > 0
 */
export function treadOffset(ms, pitch, periodMs) {
  if (!Number.isFinite(pitch) || pitch <= 0) throw new RangeError(`pitch must be a finite number > 0, got ${String(pitch)}`);
  if (!Number.isFinite(periodMs) || periodMs <= 0) {
    throw new RangeError(`periodMs must be a finite number > 0, got ${String(periodMs)}`);
  }
  if (!Number.isFinite(ms)) return 0;
  const offset = pitch * (mod(ms, periodMs) / periodMs);
  // Rounding can land a hair under periodMs on exactly pitch; keep it in [0, pitch).
  return offset < pitch ? offset : 0;
}
