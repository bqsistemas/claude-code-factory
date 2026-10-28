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
const MIN_STATION_WIDTH = 64;
/** Belt length between neighboring stations. */
const BELT_LENGTH = 44;
/** Agent pods: size, distance between pod corners, inset from the station corner. */
const POD_SIZE = Object.freeze([14, 14, 12]);
const POD_PITCH = 22;
const POD_INSET = 8;
/** Job package: size and offset from the station corner (front lane of the deck). */
const PACKAGE_SIZE = 18;
const PACKAGE_OFFSET = Object.freeze([10, 38, STATION_HEIGHT]);
/** The belt lane the package rides on (y range). */
const LANE = Object.freeze([34, 60]);
/** How far behind the stations (negative y) the rework loop runs. */
const REWORK_BACK = 84;
/**
 * Where the rework loop leaves and joins the stations: far enough behind a box
 * (more than its height) that the ends show above its back edge on screen.
 */
const REWORK_END = STATION_HEIGHT + 8;
/** Ground plate margin around the stations, and its thickness. */
const PLATE_MARGIN = 24;
const PLATE_THICKNESS = 6;
/** Station label font size (viewBox units) and monospace character width. */
const LABEL_SIZE = 12;
const CHAR_WIDTH = 0.62 * LABEL_SIZE;
/** Station labels sit just in front of (down-left of) each station's front-left corner. */
const LABEL_GAP = 10;

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

const stationCenterX = (id) => {
  const { position, size } = STATIONS.find((s) => s.id === id);
  return position[0] + size[0] / 2;
};

/**
 * The rework loop on the floor, behind the stations: from behind
 * "wait-for-all", back along the floor, to just behind "build".
 */
export const REWORK_POINTS = Object.freeze(
  [
    [stationCenterX('wait-for-all'), -REWORK_END, 0],
    [stationCenterX('wait-for-all'), -REWORK_BACK, 0],
    [stationCenterX('build'), -REWORK_BACK, 0],
    [stationCenterX('build'), -REWORK_END, 0],
  ].map((p) => Object.freeze(p)),
);

const last = STATIONS[STATIONS.length - 1];
/** The ground plate under the whole floor: [x, y, z] corner and [w, d, h] size. */
export const PLATE = Object.freeze({
  position: Object.freeze([-PLATE_MARGIN, -REWORK_BACK - PLATE_MARGIN, -PLATE_THICKNESS]),
  size: Object.freeze([
    last.position[0] + last.size[0] + 2 * PLATE_MARGIN,
    STATION_DEPTH + REWORK_BACK + 2 * PLATE_MARGIN,
    PLATE_THICKNESS,
  ]),
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

/**
 * The viewBox that frames the whole floor: every station box up to the tallest
 * deck part, the rework loop, the ground plate, and the station labels.
 */
export const FLOOR_VIEWBOX = Object.freeze(
  isoFrame([
    ...STATIONS.flatMap(({ position, size }) => boxCorners(position, [size[0], size[1], TALLEST])),
    ...REWORK_POINTS,
    ...boxCorners(PLATE.position, PLATE.size),
    ...STATIONS.flatMap((_, i) => labelPoints(i)),
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
