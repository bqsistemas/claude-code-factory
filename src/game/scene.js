// Layout of the 3D factory floor: where each stage's station stands, where the
// camera looks from, where the job package is, and how big the composition is.
// Plain JS with no React or three.js imports, so it runs (and is tested) in Node.
import { STAGES } from './engine.js';

/** Distance between neighboring stations along the x axis (world units). */
const SPACING = 4.5;
/** How much the line of stations bends away from the camera at its ends. */
const BEND = 0.04;
/** Camera offset from the station it looks at: above and in front. */
const CAMERA_OFFSET = Object.freeze([0, 7, 11]);

const MAX_SIDE = 1920;
const FALLBACK_SIZE = Object.freeze({ width: 1280, height: 720 });

// `+ 0` turns -0 into 0, so positions compare equal with Object.is.
const round = (v) => Math.round(v * 100) / 100 + 0;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/**
 * One station per stage, same order as STAGES, on a gentle arc on the floor
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
