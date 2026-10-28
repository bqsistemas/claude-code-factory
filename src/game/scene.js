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
/** Label font size (viewBox units) and monospace character width. */
const LABEL_SIZE = 12;
const CHAR_WIDTH = 0.62 * LABEL_SIZE;
/** Labels sit this far under the corner or the box they name. */
const LABEL_GAP = 10;

/** Bins at the intake sorting gate and the output bays: sizes. */
const BIN_SIZE = Object.freeze([40, 28, 12]);
const BAY_SIZE = Object.freeze([56, 32, 16]);
/** Where a package turns off the deck lane: the gate loops run this far in front of the row. */
const GATE_LOOP_Y = STATION_DEPTH + 12;

/**
 * The plant is four stacked layers (tiers), each a row of the floor along +x, one
 * behind the other in y. A row's stations are listed by their x; the plant is a
 * serpentine, so the line turns at the end of each layer and runs back the other way.
 */
const ROW_PITCH = 132;
const LAYERS = Object.freeze([
  { id: 'entrada', title: 'Entrada' },
  { id: 'produccion', title: 'Producción' },
  { id: 'control', title: 'Control' },
  { id: 'salida', title: 'Salida' },
]);
/** Station id to [x, layer index]. */
const PLACE = Object.freeze({
  queue: [-30, 0],
  intake: [46, 0],
  route: [122, 0],
  spec: [122, 1],
  build: [46, 1],
  gate: [-30, 1],
  review: [-32, 2],
  approve: [76, 2],
  merge: [172, 3],
});
const rowY = (layer) => layer * ROW_PITCH;
/** Each layer stands this much higher than the one in front of it, so the layers read as terraces. */
const TERRACE = 48;
const tierZ = (layer) => (LAYERS.length - 1 - layer) * TERRACE;
/** The z of a package riding on a layer's deck. */
const deckZ = (layer) => tierZ(layer) + STATION_HEIGHT;
/** The turns of the serpentine belt, as the x of the package's corner. */
const TURN_RIGHT = 190;
const TURN_LEFT = -60;
/** Layer slabs: x range and the margin behind the row, per layer (the lifts stand off the slabs). */
const LAYER_BACK = 24;
const LAYER_FRONT = Object.freeze([124, 100, 90, 130]);
const LAYER_RANGE = Object.freeze([[-42, 184], [-38, 216], [-38, 152], [-30, 320]]);

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
 * One station box per stage, same order as STAGES. `position` is the box's
 * back-top-left floor corner, `size` is [width, depth, height]; a station grows
 * wider with its number of agents. `layer` is the tier it stands on.
 */
export const STATIONS = Object.freeze(
  STAGES.map((stage) => {
    const [x, layer] = PLACE[stage.id];
    const size = Object.freeze([stationWidth(stage.agents.length), STATION_DEPTH, STATION_HEIGHT]);
    return Object.freeze({ id: stage.id, layer, position: Object.freeze([x, rowY(layer), tierZ(layer)]), size });
  }),
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
const topPoint = (position, [w, d, h]) => [position[0] + (w - PACKAGE_SIZE) / 2, position[1] + (d - PACKAGE_SIZE) / 2, position[2] + h];

const stationNode = (st, i) => ({
  id: st.id,
  kind: 'station',
  label: STAGES[i].title,
  position: st.position,
  size: st.size,
  point: deckPoint(st),
});
const lowNode = (id, kind, label, position, size, point = topPoint(position, size)) => ({ id, kind, label, position, size, point });
/** A bay whose package spot is on the deck lane at x = `px` in layer row `y`. */
const bayAt = (id, label, px, y) => lowNode(id, 'bay', label, [px - (BAY_SIZE[0] - PACKAGE_SIZE) / 2, y - (BAY_SIZE[1] - PACKAGE_SIZE) / 2, tierZ(3)], BAY_SIZE);

// Intake's sorting gate has three exits: ACCEPT rides the belt on; NEEDS-INFO goes to
// a bin in front of the row and REJECT to a bin behind it.
const intake = station('intake');
const [ix] = intake.position;
const lane = PACKAGE_OFFSET[1];
const outY = rowY(3) + lane;

/**
 * Everything a package can stand on: one node per station, the two bins at
 * intake's sorting gate and the four output bays (the last layer). `point` is the
 * package's resting min corner there (the corner with the smallest x, y and z).
 */
export const NODES = deepFreeze(
  Object.fromEntries(
    [
      ...STATIONS.map(stationNode),
      lowNode('bin-needs-info', 'bin', 'NEEDS-INFO', [ix + 24, STATION_DEPTH + 20, tierZ(0)], BIN_SIZE),
      lowNode('bin-reject', 'bin', 'REJECT', [ix + 24, -20 - BIN_SIZE[1], tierZ(0)], BIN_SIZE),
      bayAt('bay-merged', 'merged', 267, outY),
      bayAt('bay-awaiting-merge', 'awaiting-merge', 182, outY + 53),
      bayAt('bay-needs-human', 'needs-human', 110, outY),
      bayAt('bay-rejected', 'rejected', 6, outY),
    ].map((node) => [node.id, node]),
  ),
);

const pt = (id) => NODES[id].point;
const copy = (p) => [...p];

// Builds a polyline between two nodes: the start, the corners the route turns at
// and the end. Each corner changes one coordinate of the one before it.
const track = (from, to, kind, ...corners) => ({ from, to, kind, points: [copy(pt(from)), ...corners, copy(pt(to))] });
const belt = (from, to, ...corners) => track(from, to, 'belt', ...corners);

/**
 * Where packages travel. The belts join the stations in order and snake through the
 * four layers: right in Entrada, back left in Producción, right again in Control,
 * with a lift at the end of each layer. Branches leave the line at the sorting gate,
 * the approver's fork and the merge. Loops send a job back (NEEDS-INFO to intake, a
 * failed gate or CHANGES to build). Human tracks are what a person does: merge,
 * rework or close a PR. Every segment changes exactly one coordinate, so each one
 * draws as a straight iso hairline. Points are where a package's min corner passes.
 */
export const TRACKS = (() => {
  const [d0, d1, d2, d3] = LAYERS.map((_, k) => deckZ(k));
  const row = (layer) => rowY(layer) + lane;
  const ip = pt('intake');
  const bin = pt('bin-needs-info');
  const reject = pt('bin-reject');
  const ap = pt('approve');
  const human = pt('bay-needs-human');
  const rejected = pt('bay-rejected');
  const mp = pt('merge');
  const merged = pt('bay-merged');
  const awaiting = pt('bay-awaiting-merge');
  const build = pt('build');
  const gate = pt('gate');
  const review = pt('review');
  return deepFreeze([
    belt('queue', 'intake'),
    belt('intake', 'route'),
    belt('route', 'spec', [TURN_RIGHT, row(0), d0], [TURN_RIGHT, row(0), d1], [TURN_RIGHT, row(1), d1]),
    belt('spec', 'build'),
    belt('build', 'gate'),
    belt('gate', 'review', [TURN_LEFT, row(1), d1], [TURN_LEFT, row(1), d2], [TURN_LEFT, row(2), d2]),
    belt('review', 'approve'),
    belt('approve', 'merge', [mp[0], ap[1], d2], [mp[0], ap[1], d3]),
    track('intake', 'bin-needs-info', 'branch', [ip[0], bin[1], d0], [bin[0], bin[1], d0]),
    track('intake', 'bin-reject', 'branch', [reject[0], ip[1], d0], [reject[0], reject[1], d0]),
    track('approve', 'bay-needs-human', 'branch', [human[0], ap[1], d2], [human[0], human[1], d2]),
    track('merge', 'bay-merged', 'branch', [merged[0], mp[1], d3]),
    track('merge', 'bay-awaiting-merge', 'branch', [mp[0], awaiting[1], d3]),
    track('bin-needs-info', 'intake', 'loop', [bin[0], bin[1], d0], [bin[0], ip[1], d0]),
    track('gate', 'build', 'loop', [gate[0], rowY(1) + GATE_LOOP_Y, d1], [build[0], rowY(1) + GATE_LOOP_Y, d1]),
    track('review', 'build', 'loop', [build[0], review[1], d2], [build[0], review[1], d1]),
    track('bay-awaiting-merge', 'bay-merged', 'human', [awaiting[0], awaiting[1], d3], [merged[0], awaiting[1], d3], [merged[0], merged[1], d3]),
    track('bay-needs-human', 'build', 'human', [human[0], human[1], d3], [build[0], human[1], d3], [build[0], human[1], d1]),
    track('bay-needs-human', 'bay-rejected', 'human', [human[0], human[1], d3], [rejected[0], human[1], d3]),
  ]);
})();

/**
 * The layers' slabs, one per layer: `position` is the slab's back-left top corner
 * (its top face is at the layer's height) and `size` its [width, depth]. The layers
 * stand higher the further back they are, like terraces.
 */
export const LAYER_PLATES = deepFreeze(
  LAYERS.map((layer, k) => {
    const [x0, x1] = LAYER_RANGE[k];
    const y0 = k === 0 ? -20 - BIN_SIZE[1] - LAYER_BACK : rowY(k) - LAYER_BACK;
    const y1 = rowY(k) + LAYER_FRONT[k];
    return { ...layer, index: k, position: [x0, y0, tierZ(k)], size: [x1 - x0, y1 - y0] };
  }),
);

const nodeBoxes = Object.values(NODES).map(({ position, size }) => ({ position, size }));
const trackPoints = TRACKS.flatMap((t) => t.points);

// --- Labels -----------------------------------------------------------------------

/** The names the floor shows for the stations (the full titles live in the text column). */
const SHORT_TITLES = Object.freeze({ review: 'Revisión', gate: 'Gate', approve: 'Aprobación', build: 'Build', spec: 'Spec' });
const stationLabel = (i) => `${i + 1} · ${SHORT_TITLES[STAGES[i].id] ?? STAGES[i].title}`;

// Labels are flat text at fixed screen positions (iso screen units), found by placing
// each one beside the thing it names where no box and no other label is in the way;
// a test keeps them apart. `hot` is the node a label lights up with.
const SPOTS = Object.freeze({
  'queue': ['end', -85.4, -145],
  'intake': ['end', -17.6, -89],
  'route': ['start', 154.7, -75],
  'spec': ['middle', -29.1, 103],
  'build': ['middle', -100.9, 65],
  'gate': ['end', -199.7, -27],
  'review': ['end', -315.8, 86],
  'approve': ['start', -113.8, 130],
  'merge': ['start', -145, 292],
  'bin-needs-info': ['start', 40.3, -11],
  'bin-reject': ['middle', 110.2, -155],
  'bay-merged': ['middle', -144.7, 395.5],
  'bay-awaiting-merge': ['middle', -264.2, 379.5],
  'bay-needs-human': ['middle', -281, 225],
  'bay-rejected': ['middle', -370.7, 265],
  'accept': ['end', 64, -30],
  'apv': ['start', -131.5, 171],
  'esc': ['end', -231.4, 178],
  'gatefail': ['end', -200.5, -2],
  'changes': ['middle', -157.9, 37],
  'rework': ['end', -292.8, 124.4],
  'close': ['middle', -317.6, 205],
  'hmerge': ['middle', -203.3, 354.7],
  'layer-entrada': ['end', -153.8, -109],
  'layer-produccion': ['end', -265.8, -21],
  'layer-control': ['end', -345.5, 112],
  'layer-salida': ['end', -487.5, 250],
});
const label = (id, text, hot = null, layer = false) => {
  const [anchor, x, y] = SPOTS[id];
  return { id, text, anchor, x, y, hot, layer };
};
const NAMES = Object.freeze({
  'accept': 'ACCEPT',
  'apv': 'APPROVE',
  'esc': 'ESCALATE',
  'gatefail': 'GATE: FAIL',
  'changes': 'CHANGES',
  'rework': 'REWORK',
  'close': 'CLOSE',
  'hmerge': 'MERGE',
});

/**
 * Every flat label on the floor: the stations, the bins and bays, the names of the
 * branches and loops, and the layer names.
 * @type {{ id: string, text: string, anchor: 'start'|'middle'|'end', x: number, y: number, hot: string|null, layer: boolean }[]}
 */
export const LABELS = deepFreeze([
  ...STATIONS.map((st, i) => label(st.id, stationLabel(i), st.id)),
  ...Object.values(NODES)
    .filter(({ kind }) => kind !== 'station')
    .map(({ id, label: text }) => label(id, text, id)),
  ...Object.entries(NAMES).map(([id, text]) => label(id, text)),
  ...LAYER_PLATES.map((l) => label(`layer-${l.id}`, `CAPA ${l.index + 1} · ${l.title.toUpperCase()}`, null, true)),
]);

/** The screen position a label is anchored at. */
export const labelPosition = ({ x, y }) => [x, y];

/**
 * The screen box around a label's glyphs (viewBox units): the width is the character
 * count at the monospace advance, the height runs from the cap line to the descender.
 * @returns {{ x0: number, y0: number, x1: number, y1: number }}
 */
export function labelBox(item) {
  const [sx, sy] = labelPosition(item);
  const width = item.text.length * CHAR_WIDTH;
  const x0 = item.anchor === 'start' ? sx : item.anchor === 'end' ? sx - width : sx - width / 2;
  return { x0, y0: sy - 0.8 * LABEL_SIZE, x1: x0 + width, y1: sy + 0.25 * LABEL_SIZE };
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

/**
 * The viewBox that frames the whole plant: every station box up to the tallest
 * deck part, the bins and bays, the ground plate, every label, and a package at
 * every track point.
 */
const labelPoints = LABELS.flatMap((item) => {
  const { x0, y0, x1, y1 } = labelBox(item);
  return [[x0, y0], [x1, y1]];
});
const labelFrame = (() => {
  const xs = labelPoints.map((p) => p[0]);
  const ys = labelPoints.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
})();
const plantFrame = isoFrame(
  [
    ...STATIONS.flatMap(({ position, size }) => boxCorners(position, [size[0], size[1], TALLEST])),
    ...nodeBoxes.flatMap(({ position, size }) => boxCorners(position, size)),
    ...LAYER_PLATES.flatMap(({ position, size }) => boxCorners([position[0], position[1], position[2] - PLATE_THICKNESS], [size[0], size[1], PLATE_THICKNESS])),
    ...[...trackPoints, ...Object.values(NODES).map(({ point }) => point)].flatMap((p) =>
      boxCorners(p, [PACKAGE_SIZE, PACKAGE_SIZE, PACKAGE_SIZE]),
    ),
  ],
  24,
);
export const FLOOR_VIEWBOX = Object.freeze(
  (() => {
    const x = Math.min(plantFrame.x, labelFrame.x0 - 8);
    const y = Math.min(plantFrame.y, labelFrame.y0 - 8);
    const x1 = Math.max(plantFrame.x + plantFrame.width, labelFrame.x1 + 8);
    const y1 = Math.max(plantFrame.y + plantFrame.height, labelFrame.y1 + 8);
    return { x, y, width: x1 - x, height: y1 - y };
  })(),
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
  const [x, y, z] = STATIONS[i].position;
  const [w, d] = STATIONS[i].size;
  const H = z + TALLEST;
  return [
    [x, y, H],
    [x + w, y, H],
    [x + w, y, z],
    [x + w, y + d, z],
    [x, y + d, z],
    [x, y + d, H],
  ].map(iso);
}

/** Clamps a stage index to a valid station index; non-finite values become 0. */
function stationIndex(stageIndex) {
  if (!Number.isFinite(stageIndex)) return 0;
  return clamp(Math.trunc(stageIndex), 0, STATIONS.length - 1);
}

/**
 * Where the job package is on its way from the previous station (progress 0) to
 * the current one (progress 1): it rides the belt between them, turns included. The
 * result is a station position (back-top-left corner), like STATIONS[i].position.
 * @param {number} stageIndex
 * @param {number} progress 0..1, clamped; non-finite means 1 (arrived)
 * @returns {number[]}
 */
export function packagePosition(stageIndex, progress) {
  const i = stationIndex(stageIndex);
  const p = Number.isFinite(progress) ? clamp(progress, 0, 1) : 1;
  if (i === 0) return [...STATIONS[0].position];
  const { points } = TRACKS.find((t) => t.kind === 'belt' && t.from === STATIONS[i - 1].id && t.to === STATIONS[i].id);
  const lengths = points.slice(1).map((q, k) => Math.hypot(...q.map((v, c) => v - points[k][c])));
  let left = p * lengths.reduce((a, b) => a + b, 0);
  let k = 0;
  while (k < lengths.length - 1 && left > lengths[k]) left -= lengths[k++];
  const f = lengths[k] === 0 ? 1 : Math.min(left / lengths[k], 1);
  return points[k].map((v, c) => v + (points[k + 1][c] - v) * f - PACKAGE_OFFSET[c]);
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
