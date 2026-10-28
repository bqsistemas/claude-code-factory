// Layout of the isometric factory floor: where each stage's station stands, how
// big it is, where the job package is, and how big the composition is.
// Plain JS with no React imports, so it runs (and is tested) in Node.
//
// The projection kernel comes from iso-figure by Tolga Cohce (MIT License,
// github.com/MrBongoC/ai-iso-skill), via the iso-glow skill. Coordinates are
// iso-figure units: +x runs down-right on screen, +y down-left, +z up, and the
// floor is z = 0.
import { STAGES } from './engine.js';

const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);

/** Depth (y) and height (z) of every station box. */
const STATION_DEPTH = 64;
const STATION_HEIGHT = 22;
/** Narrowest station; wide enough for the job package and one agent pod. */
const MIN_STATION_WIDTH = 52;
/** Belt length between neighboring stations. */
const BELT_LENGTH = 24;
/** Agent pods: size, distance between pod corners, inset from the station corner. */
const POD_SIZE = Object.freeze([14, 14, 12]);
const POD_PITCH = 18;
const POD_INSET = 8;
/** Job package: size and offset from the station corner (front lane of the deck). */
const PACKAGE_SIZE = 18;
const PACKAGE_OFFSET = Object.freeze([10, 38, STATION_HEIGHT]);
/** The belt lane the package rides on (y range). */
const LANE = Object.freeze([34, 60]);
/** Ground plate margin around the plant, and its thickness. */
const PLATE_MARGIN = 24;
const PLATE_THICKNESS = 6;
/** Station label font size (viewBox units) and monospace character width. */
const LABEL_SIZE = 12;
const CHAR_WIDTH = 0.62 * LABEL_SIZE;
/** Station labels sit just in front of (down-left of) each station's front-left corner. */
const LABEL_GAP = 10;

/** Bins at the intake sorting gate: size, and the gap between the station row and the bin. */
const BIN_SIZE = Object.freeze([40, 28, 12]);
const BIN_GAP = 20;
/** Output bays: the two kinds of size, and the gap between the station row and a bay. */
const BAY_SIZE = Object.freeze([56, 32, 16]);
const END_BAY_SIZE = Object.freeze([56, STATION_DEPTH, 16]);
const BAY_GAP = 20;
/** How far past the last station the end bay stands, and how far past the approver the REJECT bay stands. */
const END_BAY_GAP = 30;
/** The labels float this high above their bin or bay. */
const NODE_LABEL_LIFT = 16;
/** Where a package turns off the deck lane: this far in from the package's own corner. */
const JOG = 24;
/** Gate loops run in front of the station row at these y values (gate to build, review to build). */
const GATE_LOOP_Y = STATION_DEPTH + 12;
const REVIEW_LOOP_Y = STATION_DEPTH + 28;

const MAX_SIDE = 1920;
const FALLBACK_SIZE = Object.freeze({ width: 1280, height: 720 });

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/**
 * The iso-figure projection kernel without offset.
 * @param {number[]} point [x, y, z]
 * @returns {number[]} [sx, sy] in viewBox units
 */
export function iso([x, y, z]) {
  return [(x - y) * COS, (x + y) * SIN - z];
}

const stationWidth = (agents) => Math.max(MIN_STATION_WIDTH, POD_INSET * 2 + agents * POD_PITCH - (POD_PITCH - POD_SIZE[0]));

/**
 * One station box per stage, same order as STAGES, in a line along +x so the
 * flow reads left to right (and top to bottom) on screen. `position` is the
 * box's back-top-left floor corner, `size` is [width, depth, height]; a station
 * grows wider with its number of agents.
 */
export const STATIONS = Object.freeze(
  STAGES.reduce((list, stage) => {
    const prev = list[list.length - 1];
    const x = prev ? prev.position[0] + prev.size[0] + BELT_LENGTH : 0;
    const size = Object.freeze([stationWidth(stage.agents.length), STATION_DEPTH, STATION_HEIGHT]);
    list.push(Object.freeze({ id: stage.id, position: Object.freeze([x, 0, 0]), size }));
    return list;
  }, []),
);

/** Floor geometry the composition draws with, in iso-figure units. */
export const FLOOR = Object.freeze({
  podSize: POD_SIZE,
  podPitch: POD_PITCH,
  podInset: POD_INSET,
  packageSize: PACKAGE_SIZE,
  packageOffset: PACKAGE_OFFSET,
  lane: LANE,
  plateThickness: PLATE_THICKNESS,
  labelSize: LABEL_SIZE,
  labelGap: LABEL_GAP,
});

const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const station = (id) => STATIONS.find((st) => st.id === id);
const sum = (a, b) => a.map((v, k) => v + b[k]);
/** The package's resting min corner on a station deck. */
const deckPoint = ({ position }) => sum(position, PACKAGE_OFFSET);
/** A package centred on a node of size [w, d], standing on its top face of height h. */
const topPoint = (position, [w, d, h]) => [position[0] + (w - PACKAGE_SIZE) / 2, position[1] + (d - PACKAGE_SIZE) / 2, h];

const stationNode = (st, i) => ({
  id: st.id,
  kind: 'station',
  label: STAGES[i].title,
  position: st.position,
  size: st.size,
  point: deckPoint(st),
});
const lowNode = (id, kind, label, position, size, point = topPoint(position, size)) => ({ id, kind, label, position, size, point });

// Intake's sorting gate has three exits: ACCEPT rides the belt on; NEEDS-INFO goes to
// a bin in front of the row and REJECT to a bin behind it.
const intake = station('intake');
const [ix] = intake.position;
// The approver's fork: ESCALATE goes to a bay behind the row, and the REJECT-ed
// jobs of a closed PR end in a bay next to it.
const approve = station('approve');
const [ax] = approve.position;
const last = STATIONS[STATIONS.length - 1];
const [mx] = last.position;

/**
 * Everything a package can stand on: one node per station, the two bins at
 * intake's sorting gate and the four output bays. `point` is the package's resting
 * min corner there (the corner with the smallest x, y and z).
 */
export const NODES = deepFreeze(
  Object.fromEntries(
    [
      ...STATIONS.map(stationNode),
      lowNode('bin-needs-info', 'bin', 'NEEDS-INFO', [ix + 24, STATION_DEPTH + BIN_GAP, 0], BIN_SIZE),
      lowNode('bin-reject', 'bin', 'REJECT', [ix + 24, -BIN_GAP - BIN_SIZE[1], 0], BIN_SIZE),
      lowNode('bay-merged', 'bay', 'merged', [mx + last.size[0] + END_BAY_GAP, 0, 0], END_BAY_SIZE, [
        mx + last.size[0] + END_BAY_GAP + (END_BAY_SIZE[0] - PACKAGE_SIZE) / 2,
        PACKAGE_OFFSET[1],
        END_BAY_SIZE[2],
      ]),
      lowNode('bay-awaiting-merge', 'bay', 'awaiting-merge', [mx + 15, STATION_DEPTH + BAY_GAP, 0], BAY_SIZE),
      lowNode('bay-needs-human', 'bay', 'needs-human', [ax + 15, -BAY_GAP - BAY_SIZE[1], 0], BAY_SIZE),
      lowNode('bay-rejected', 'bay', 'rejected', [ax + 15 + BAY_SIZE[0] + 24, -BAY_GAP - BAY_SIZE[1], 0], BAY_SIZE),
    ].map((node) => [node.id, node]),
  ),
);

const pt = (id) => NODES[id].point;
const at3 = ([x, y, z], { x: nx = x, y: ny = y, z: nz = z }) => [nx, ny, nz];
const copy = (p) => [...p];

// Builds a polyline between two nodes: the start, the corners the route turns at
// and the end. Each corner changes one coordinate of the one before it.
const track = (from, to, kind, ...corners) => ({ from, to, kind, points: [copy(pt(from)), ...corners, copy(pt(to))] });
const belt = (from, to) => track(from, to, 'belt');

/**
 * Where packages travel. Belts join the stations in order. Branches leave the
 * line at the sorting gate, the approver's fork and the merge. Loops send a job
 * back (NEEDS-INFO to intake, a failed gate or CHANGES to build). Human tracks are
 * what a person does: merge, rework or close a PR. Every segment changes exactly
 * one coordinate, so each one draws as a straight iso hairline. Points are where a
 * package's min corner passes.
 */
export const TRACKS = (() => {
  const z = STATION_HEIGHT;
  const ip = pt('intake');
  const bin = pt('bin-needs-info');
  const reject = pt('bin-reject');
  const ap = pt('approve');
  const human = pt('bay-needs-human');
  const mp = pt('merge');
  const merged = pt('bay-merged');
  const awaiting = pt('bay-awaiting-merge');
  const build = pt('build');
  const behindY = human[1];
  return deepFreeze([
    ...STATIONS.slice(1).map((st, i) => belt(STATIONS[i].id, st.id)),
    track('intake', 'bin-needs-info', 'branch', [ip[0], bin[1], z], [bin[0], bin[1], z]),
    track('intake', 'bin-reject', 'branch', [reject[0], ip[1], z], [reject[0], reject[1], z]),
    track('approve', 'bay-needs-human', 'branch', [human[0], ap[1], z], [human[0], behindY, z]),
    track('merge', 'bay-merged', 'branch', [merged[0], mp[1], z]),
    track('merge', 'bay-awaiting-merge', 'branch', [mp[0], awaiting[1], z], [awaiting[0], awaiting[1], z]),
    track('bin-needs-info', 'intake', 'loop', [bin[0], bin[1], z], [bin[0], ip[1], z]),
    track('gate', 'build', 'loop', at3(pt('gate'), { y: GATE_LOOP_Y }), at3(build, { y: GATE_LOOP_Y })),
    track('review', 'build', 'loop', at3(pt('review'), { y: REVIEW_LOOP_Y }), at3(build, { y: REVIEW_LOOP_Y })),
    track('bay-awaiting-merge', 'bay-merged', 'human', [merged[0], awaiting[1], awaiting[2]]),
    track('bay-needs-human', 'build', 'human', [human[0], human[1], z], [build[0] + JOG, human[1], z], [build[0] + JOG, build[1], z]),
    track('bay-needs-human', 'bay-rejected', 'human'),
  ]);
})();

/** The plant's ground plate and the "ACCEPT" label, in iso-figure units. */
const nodeBoxes = Object.values(NODES).map(({ position, size }) => ({ position, size }));
const trackPoints = TRACKS.flatMap((t) => t.points);
const reach = PACKAGE_SIZE;
const plateX1 = Math.max(...nodeBoxes.map(({ position, size }) => position[0] + size[0]), ...trackPoints.map((p) => p[0] + reach)) + PLATE_MARGIN;
const plateY0 = Math.min(...nodeBoxes.map(({ position }) => position[1]), ...trackPoints.map((p) => p[1])) - PLATE_MARGIN;
const plateY1 = Math.max(...nodeBoxes.map(({ position, size }) => position[1] + size[1]), ...trackPoints.map((p) => p[1] + reach)) + PLATE_MARGIN;
/** The ground plate under the whole plant (stations, bins, bays and tracks): [x, y, z] corner and [w, d, h] size. */
export const PLATE = Object.freeze({
  position: Object.freeze([-PLATE_MARGIN, plateY0, -PLATE_THICKNESS]),
  size: Object.freeze([plateX1 + PLATE_MARGIN, plateY1 - plateY0, PLATE_THICKNESS]),
});

/**
 * Where a station's label is anchored: just in front of its front-left floor
 * corner. The label is drawn flat on screen, ending at this point.
 * @param {number} i station index
 * @returns {number[]}
 */
export function labelAnchor(i) {
  const [x, y] = STATIONS[i].position;
  return [x - LABEL_GAP, y + STATION_DEPTH + LABEL_GAP, 0];
}

/**
 * Where a bin's or a bay's label floats: centred over its top face. The label is
 * drawn flat on screen, centred on this point.
 * @param {string} id a bin or bay id from NODES
 * @returns {number[]}
 */
export function nodeLabelAnchor(id) {
  const { position, size } = NODES[id];
  return [position[0] + size[0] / 2, position[1] + size[1] / 2, size[2] + NODE_LABEL_LIFT];
}

const ACCEPT_AT = (() => {
  const next = STATIONS[STATIONS.findIndex((st) => st.id === 'intake') + 1];
  return [(intake.position[0] + intake.size[0] + next.position[0]) / 2, LANE[0], STATION_HEIGHT + NODE_LABEL_LIFT];
})();
/** The ACCEPT exit of intake's sorting gate: its label floats over the belt that leaves the gate. */
export const ACCEPT_LABEL = Object.freeze({ text: 'ACCEPT', anchor: Object.freeze(ACCEPT_AT) });

const boxCorners = (position, size) =>
  [0, 1, 2, 3, 4, 5, 6, 7].map((c) => position.map((v, k) => v + ((c >> k) & 1) * size[k]));

/**
 * The tightest screen box around the projection of every point, grown by `pad`
 * on each side.
 * @param {number[][]} points [x, y, z] points
 * @param {number} [pad]
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function isoFrame(points, pad = 24) {
  const projected = points.map(iso);
  const xs = projected.map((p) => p[0]);
  const ys = projected.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return {
    x: x0 - pad,
    y: y0 - pad,
    width: Math.max(...xs) - x0 + 2 * pad,
    height: Math.max(...ys) - y0 + 2 * pad,
  };
}

// The tallest part on a deck: an agent pod or the job package.
const TALLEST = STATION_HEIGHT + Math.max(POD_SIZE[2], PACKAGE_SIZE);

// A label `${n} · ${title}` drawn flat on screen and ending at its anchor: moving
// by [-a, +a, 0] in iso units moves 2a·cos(30°) left on screen and not up or down.
function labelPoints(i) {
  const anchor = labelAnchor(i);
  const width = (String(i + 1).length + 3 + STAGES[i].title.length) * CHAR_WIDTH;
  const a = width / (2 * COS);
  return [anchor, [anchor[0] - a, anchor[1] + a, 0], [anchor[0], anchor[1], LABEL_SIZE]];
}

// A label drawn flat on screen and centred on its anchor (textAnchor middle).
function centredLabelPoints(text, [x, y, z]) {
  const a = (text.length * CHAR_WIDTH) / 2 / (2 * COS);
  return [
    [x - a, y + a, z],
    [x + a, y - a, z],
    [x, y, z + LABEL_SIZE],
  ];
}

/**
 * The viewBox that frames the whole plant: every station box up to the tallest
 * deck part, the bins and bays, the ground plate, every label, and a package at
 * every track point.
 */
export const FLOOR_VIEWBOX = Object.freeze(
  isoFrame([
    ...STATIONS.flatMap(({ position, size }) => boxCorners(position, [size[0], size[1], TALLEST])),
    ...nodeBoxes.flatMap(({ position, size }) => boxCorners(position, size)),
    ...boxCorners(PLATE.position, PLATE.size),
    ...STATIONS.flatMap((_, i) => labelPoints(i)),
    ...Object.values(NODES)
      .filter(({ kind }) => kind !== 'station')
      .flatMap(({ id, label }) => centredLabelPoints(label, nodeLabelAnchor(id))),
    ...centredLabelPoints(ACCEPT_LABEL.text, ACCEPT_LABEL.anchor),
    ...[...trackPoints, ...Object.values(NODES).map(({ point }) => point)].flatMap((p) =>
      boxCorners(p, [PACKAGE_SIZE, PACKAGE_SIZE, PACKAGE_SIZE]),
    ),
  ]),
);

/**
 * The screen silhouette of station `i`'s box, raised to the tallest deck part
 * (the height FLOOR_VIEWBOX frames): 6 [sx, sy] points, clockwise from the
 * back-top-left corner. Used as the station's click and focus target.
 * @param {number} i station index
 * @returns {number[][]}
 * @throws {RangeError} unless i is an integer from 0 to STATIONS.length - 1
 */
export function stationOutline(i) {
  if (!Number.isInteger(i) || i < 0 || i >= STATIONS.length) {
    throw new RangeError(`station index must be an integer from 0 to ${STATIONS.length - 1}, got ${String(i)}`);
  }
  const [x, y] = STATIONS[i].position;
  const [w, d] = STATIONS[i].size;
  const H = TALLEST;
  return [
    [x, y, H],
    [x + w, y, H],
    [x + w, y, 0],
    [x + w, y + d, 0],
    [x, y + d, 0],
    [x, y + d, H],
  ].map(iso);
}

/** Clamps a stage index to a valid station index; non-finite values become 0. */
function stationIndex(stageIndex) {
  if (!Number.isFinite(stageIndex)) return 0;
  return clamp(Math.trunc(stageIndex), 0, STATIONS.length - 1);
}

/**
 * Where the job package is on its way from the previous station (progress 0)
 * to the current one (progress 1), as a station position (back-top-left corner).
 * @param {number} stageIndex
 * @param {number} progress 0..1, clamped; non-finite means 1 (arrived)
 * @returns {number[]}
 */
export function packagePosition(stageIndex, progress) {
  const i = stationIndex(stageIndex);
  const p = Number.isFinite(progress) ? clamp(progress, 0, 1) : 1;
  const from = STATIONS[Math.max(i - 1, 0)].position;
  const to = STATIONS[i].position;
  return from.map((v, k) => v + (to[k] - v) * p);
}

/**
 * Composition size for a viewport: same aspect ratio, long side at most 1920,
 * never scaled up. Invalid input gets 1280x720.
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @returns {{ width: number, height: number }}
 */
export function compositionSize(viewportWidth, viewportHeight) {
  const valid = (v) => Number.isFinite(v) && v > 0;
  if (!valid(viewportWidth) || !valid(viewportHeight)) return { ...FALLBACK_SIZE };
  const scale = Math.min(1, MAX_SIDE / Math.max(viewportWidth, viewportHeight));
  return {
    width: Math.max(1, Math.round(viewportWidth * scale)),
    height: Math.max(1, Math.round(viewportHeight * scale)),
  };
}
