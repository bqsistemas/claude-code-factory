// The living factory pipeline on the guided tour floor: a fixed, repeating
// animation of many job packages moving through the line at once. A new package
// enters station 1 every PACKAGE_INTERVAL_MS and steps station by station along
// the front lane. At the fork, APPROVE packages ride their branch to the APPROVE
// pad and merge into main; ESCALATE packages pile up on the ESCALATE pad until a
// human review releases the pile, then travel HUMAN_ROUTE and merge into main too.
// Plain JS with no React imports, so it runs (and is tested) in Node. Not real
// job data: nothing here reads factory/board.json.
import { STAGES } from './engine.js';
import { FLOOR, FORK, HUMAN_ROUTE, STATIONS } from './scene.js';
import { TOUR_STEP_MS } from './tour.js';

/** A new package enters station 1 this often (4 beats of the tour melody). */
export const PACKAGE_INTERVAL_MS = 2500;
/** The whole animation repeats after one full tour. */
export const PIPELINE_CYCLE_MS = STAGES.length * TOUR_STEP_MS;

const PER_CYCLE = PIPELINE_CYCLE_MS / PACKAGE_INTERVAL_MS;
// The approver's decision for package n is DECISIONS[n mod 7]; 7 divides PER_CYCLE.
const DECISIONS = Object.freeze(['APPROVE', 'ESCALATE', 'APPROVE', 'ESCALATE', 'ESCALATE', 'APPROVE', 'APPROVE']);

// Timing (ms). On the line a package sits on each station, then rides the belt
// to the next one, so every PACKAGE_INTERVAL_MS the whole line steps forward.
const DWELL_MS = 1250;
const TO_FORK_MS = 625;
const BRANCH_MS = 1250;
const STACK_MS = 625;
const MERGE_MS = 625;
// A human review releases the ESCALATE pile every RELEASE_MS (a divisor of the
// cycle), offset so a release never meets a package landing on the pile. One
// review per 7 packages, so the pile grows to the 3 ESCALATEs of the pattern.
const RELEASE_MS = 17500;
const RELEASE_OFFSET_MS = 1875;
// Released packages leave the pile one after another, top layer first.
const DEPART_GAP_MS = 312.5;
const EXIT_MS = 625;
const ROUTE_MS = 1875;

const SIZE = FLOOR.packageSize;
const HALF = SIZE / 2;
// Paths below are package min corners (the position pipelineAt reports). Wires
// and HUMAN_ROUTE give the package's centre, so shift them by half a package.
const corner = ([x, y, z]) => [x - HALF, y - HALF, z];

const LINE_SLOTS = STATIONS.map(({ position }) => position.map((v, k) => v + FLOOR.packageOffset[k]));
const FORK_AT = corner(FORK.point);
const LAST_SLOT = LINE_SLOTS[LINE_SLOTS.length - 1];
const TO_FORK = [LAST_SLOT, [FORK_AT[0], LAST_SLOT[1], LAST_SLOT[2]], FORK_AT];

const [APPROVE_BRANCH, ESCALATE_BRANCH] = FORK.branches;
const APPROVE_PATH = APPROVE_BRANCH.points.map(corner);
const MERGE_AT = APPROVE_PATH[APPROVE_PATH.length - 1];

// The pile on the ESCALATE pad: two columns (right one first) by three layers.
// A package lands flush with the pad's left edge, lifts to its layer, and slides
// right into its slot, so it never passes through a package already there.
const PAD = ESCALATE_BRANCH.pad;
const PAD_TOP = PAD.size[2];
const PILE_Y = PAD.position[1] + PAD.size[1] / 2 - HALF;
const LAND = [PAD.position[0], PILE_Y, PAD_TOP];
const ESCALATE_PATH = [...ESCALATE_BRANCH.points.slice(0, -1).map(corner), LAND];
const RIGHT_COLUMN = PAD.position[0] + PAD.size[0] - 1 - SIZE;
const SLOTS = Array.from({ length: 6 }, (_, j) => [RIGHT_COLUMN - (j % 2) * SIZE, PILE_Y, PAD_TOP + Math.floor(j / 2) * SIZE]);
const layerOf = (j) => Math.floor(j / 2);

const ROUTE = HUMAN_ROUTE.map(corner);
const EXIT_X = ROUTE[1][0];
const ROUTE_END = ROUTE[ROUTE.length - 1];

const mod = (v, m) => ((v % m) + m) % m;
const decisionOf = (n) => DECISIONS[mod(n, DECISIONS.length)];
const enterOf = (n) => n * PACKAGE_INTERVAL_MS;
const FORK_OFFSET_MS = (STATIONS.length - 1) * PACKAGE_INTERVAL_MS + DWELL_MS + TO_FORK_MS;
const forkOf = (n) => enterOf(n) + FORK_OFFSET_MS;
const queuedOf = (n) => forkOf(n) + BRANCH_MS + STACK_MS;
// The first human review after the package lands on the pile.
const releaseOf = (n) => RELEASE_OFFSET_MS + (Math.floor((queuedOf(n) - RELEASE_OFFSET_MS) / RELEASE_MS) + 1) * RELEASE_MS;

// The ESCALATE packages released together with package n, in arrival order.
function pileOf(n) {
  const release = releaseOf(n);
  const reach = RELEASE_MS / PACKAGE_INTERVAL_MS + 1;
  const pile = [];
  for (let m = n - reach; m <= n + reach; m += 1) {
    if (decisionOf(m) === 'ESCALATE' && releaseOf(m) === release) pile.push(m);
  }
  if (pile.length > SLOTS.length) throw new Error(`pile of ${pile.length} does not fit ${SLOTS.length} slots`);
  return { release, pile };
}

// Every leg of package n's trip: { phase, t0, t1, path }, back to back. The
// package moves along `path` at constant speed between t0 and t1.
function legsOf(n) {
  const enter = enterOf(n);
  const legs = [];
  const add = (phase, duration, path) => {
    const t0 = legs.length ? legs[legs.length - 1].t1 : enter;
    legs.push({ phase, t0, t1: t0 + duration, path });
  };
  LINE_SLOTS.forEach((slot, k) => {
    add('line', DWELL_MS, [slot]);
    if (k + 1 < LINE_SLOTS.length) add('line', PACKAGE_INTERVAL_MS - DWELL_MS, [slot, LINE_SLOTS[k + 1]]);
  });
  add('line', TO_FORK_MS, TO_FORK);
  if (decisionOf(n) === 'APPROVE') {
    add('branch', BRANCH_MS, APPROVE_PATH);
    add('merging', MERGE_MS, [MERGE_AT]);
    return legs;
  }
  const { release, pile } = pileOf(n);
  const j = pile.indexOf(n);
  const slot = SLOTS[j];
  const departOrder = pile.map((_, k) => k).sort((a, b) => layerOf(b) - layerOf(a) || a - b);
  const depart = release + departOrder.indexOf(j) * DEPART_GAP_MS;
  add('branch', BRANCH_MS, ESCALATE_PATH);
  add('branch', STACK_MS, [LAND, [LAND[0], LAND[1], slot[2]], slot]);
  add('queued', depart - queuedOf(n), [slot]);
  add('human', EXIT_MS, [slot, [EXIT_X, slot[1], slot[2]], [EXIT_X, slot[1], PAD_TOP]]);
  add('human', ROUTE_MS, ROUTE.slice(1));
  add('merging', MERGE_MS, [ROUTE_END]);
  return legs;
}

/**
 * When package n enters, reaches the fork, and is fully merged into main.
 * @param {number} n integer package number (may be negative)
 * @returns {{ id: number, decision: 'APPROVE' | 'ESCALATE', enterMs: number, forkMs: number, mainMs: number }}
 */
export function packageTimeline(n) {
  const legs = legsOf(n);
  return { id: n, decision: decisionOf(n), enterMs: enterOf(n), forkMs: forkOf(n), mainMs: legs[legs.length - 1].t1 };
}

// The point a fraction f (0..1) of the way along a polyline, by length.
function along(path, f) {
  const lengths = path.slice(1).map((p, k) => Math.hypot(...p.map((v, c) => v - path[k][c])));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total === 0) return [...path[0]];
  let rest = f * total;
  for (let k = 0; k < lengths.length; k += 1) {
    if (rest <= lengths[k] && lengths[k] > 0) {
      const s = rest / lengths[k];
      return path[k].map((v, c) => v + (path[k + 1][c] - v) * s);
    }
    rest -= lengths[k];
  }
  return [...path[path.length - 1]];
}

const MAX_LIFE_MS = Math.max(
  ...Array.from({ length: PER_CYCLE }, (_, n) => {
    const { enterMs, mainMs } = packageTimeline(n);
    return mainMs - enterMs;
  }),
);

/**
 * Every package on the floor at a moment of the cycle. Ids are the package
 * number modulo the packages per cycle, so the result repeats every cycle.
 * @param {number} ms time in ms; any finite value, non-finite means 0
 * @returns {{ packages: Array<{ id: number, decision: 'APPROVE' | 'ESCALATE',
 *   phase: 'line' | 'branch' | 'queued' | 'human' | 'merging',
 *   position: number[], merge: number }>, queued: number }}
 */
export function pipelineAt(ms) {
  const t = Number.isFinite(ms) ? mod(ms, PIPELINE_CYCLE_MS) : 0;
  const packages = [];
  const first = Math.floor((t - MAX_LIFE_MS) / PACKAGE_INTERVAL_MS);
  const last = Math.floor(t / PACKAGE_INTERVAL_MS);
  for (let n = first; n <= last; n += 1) {
    const leg = legsOf(n).find(({ t0, t1 }) => t >= t0 && t < t1);
    if (!leg) continue;
    const f = (t - leg.t0) / (leg.t1 - leg.t0);
    packages.push({
      id: mod(n, PER_CYCLE),
      decision: decisionOf(n),
      phase: leg.phase,
      position: along(leg.path, f),
      merge: leg.phase === 'merging' ? f : 0,
    });
  }
  return { packages, queued: packages.filter((p) => p.phase === 'queued').length };
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
