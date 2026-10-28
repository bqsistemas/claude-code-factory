// Layout of the 3D factory floor: where each stage's station stands, where the
// camera looks from, where the job package is, and how big the composition is.
// Plain JS with no React or three.js imports, so it runs (and is tested) in Node.
import { STAGES } from './engine.js';

/** Distance between neighboring stations along the x axis (world units). */
const SPACING = 4.5;
/**
 * How much the line of stations bends away from the camera at its ends. Zero
 * keeps them on a straight line, so no neighbor ever comes closer to the camera
 * than the current station (a bend toward the camera made neighbors look huge).
 */
const BEND = 0;
/**
 * Camera offset from the station it looks at: above and in front, at 45 degrees
 * and far enough back that the previous and next stations fit in the view.
 */
const CAMERA_OFFSET = Object.freeze([0, 12, 12]);
/** Vertical field of view (degrees) on landscape screens. */
const LANDSCAPE_FOV = 45;
/** Widest vertical field of view (degrees) on portrait screens. */
const MAX_FOV = 70;

const MAX_SIDE = 1920;
const FALLBACK_SIZE = Object.freeze({ width: 1280, height: 720 });

// `+ 0` turns -0 into 0, so positions compare equal with Object.is.
const round = (v) => Math.round(v * 100) / 100 + 0;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/**
 * One station per stage, same order as STAGES, on a line (or a gentle arc when
 * BEND > 0) on the floor
 * (y = 0) centered on the middle stage.
 */
export const STATIONS = Object.freeze(
  STAGES.map((stage, i) => {
    const x = round((i - (STAGES.length - 1) / 2) * SPACING);
    const z = round(-BEND * x * x);
    return Object.freeze({ id: stage.id, position: Object.freeze([x, 0, z]) });
  }),
);

/** Clamps a stage index to a valid station index; non-finite values become 0. */
function stationIndex(stageIndex) {
  if (!Number.isFinite(stageIndex)) return 0;
  return clamp(Math.trunc(stageIndex), 0, STATIONS.length - 1);
}

/**
 * Camera placement for a stage: looks at the station from above and in front.
 * @param {number} stageIndex
 * @returns {{ position: number[], target: number[] }}
 */
export function cameraFor(stageIndex) {
  const target = [...STATIONS[stationIndex(stageIndex)].position];
  const position = target.map((v, k) => v + CAMERA_OFFSET[k]);
  return { position, target };
}

/**
 * Vertical field of view in degrees for a width / height aspect ratio. Landscape
 * gets 45; portrait gets a wider angle (up to 70) so the scene still fits across.
 * Non-finite or non-positive aspects get 45.
 * @param {number} aspect
 * @returns {number}
 */
export function cameraFov(aspect) {
  if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= 1) return LANDSCAPE_FOV;
  const half = Math.tan(((LANDSCAPE_FOV / 2) * Math.PI) / 180);
  return Math.min(MAX_FOV, (2 * Math.atan(half / aspect) * 180) / Math.PI);
}

const sub = (a, b) => a.map((v, k) => v - b[k]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => {
  const length = Math.hypot(...a);
  return a.map((v) => v / length);
};

/**
 * Projects a world point through a perspective camera, the same way three.js's
 * PerspectiveCamera does after lookAt(target) with up +y and no view offset.
 * @param {{ position: number[], target: number[] }} camera as returned by cameraFor
 * @param {number[]} point world [x, y, z]
 * @param {number} fov vertical field of view in degrees
 * @param {number} aspect width / height
 * @returns {{ x: number, y: number, depth: number }} normalized device coordinates
 *   (-1..1 is on screen, +x right, +y up); depth <= 0 means behind the camera
 */
export function projectPoint(camera, point, fov, aspect) {
  const forward = normalize(sub(camera.target, camera.position));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const v = sub(point, camera.position);
  const depth = dot(v, forward);
  const half = Math.tan(((fov / 2) * Math.PI) / 180);
  return {
    x: dot(v, right) / (depth * half * aspect),
    y: dot(v, up) / (depth * half),
    depth,
  };
}

/**
 * Pixel position in the composition for normalized device coordinates when the
 * view is shifted so NDC (0, 0) lands at (centerX, centerY), as setViewOffset does.
 * @param {{ x: number, y: number }} ndc
 * @param {number} width
 * @param {number} height
 * @param {number} centerX
 * @param {number} centerY
 * @returns {{ x: number, y: number }}
 */
export function toScreen(ndc, width, height, centerX, centerY) {
  return { x: centerX + (ndc.x * width) / 2, y: centerY - (ndc.y * height) / 2 };
}

/**
 * Where the job package is on its way from the previous station (progress 0)
 * to the current one (progress 1).
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
