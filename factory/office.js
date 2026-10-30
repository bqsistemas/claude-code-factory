// Pure model for the pixel-art Agent Office on the dashboard: the map, the sprite
// atlas, and the functions that turn board.json jobs into who is where and doing what.
// ES module with no DOM access: runs in the browser (imported by dashboard.html) and
// in Node (imported by the tests). Never throws on malformed input. No board.json
// string reaches a bubble, hit label or description: only validated integers and
// constants. Job ids appear only as `jobId` keys and as token labels for jobs
// that have no issue number (the canvas draws those with fillText).

import { AGENTS, STAGE_COLUMNS, activeAgents, laneTone } from './activity.js';
import { AVATARS } from './avatars.js';

const deepFreeze = (v) => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
};

const rect = (x, y, w, h) => ({ x, y, w, h });

/** Logical size of the office in sprite pixels. */
export const MAP = deepFreeze({ width: 256, height: 160 });

/** The seven areas, in display order. `stages` are the board stages each one hosts. */
export const AREAS = deepFreeze([
  { id: 'research', label: 'Research', stages: ['intake', 'needs-info'], rect: rect(0, 0, 84, 64) },
  { id: 'engineering', label: 'Engineering', stages: ['spec', 'build', 'gate'], rect: rect(84, 0, 88, 64) },
  { id: 'review', label: 'Review', stages: ['review'], rect: rect(172, 0, 84, 64) },
  { id: 'release', label: 'Release', stages: ['approve', 'merging', 'awaiting-merge'], rect: rect(0, 68, 48, 92) },
  { id: 'escalation', label: 'Escalation', stages: ['needs-human'], rect: rect(48, 68, 60, 92) },
  { id: 'archive', label: 'Archive', stages: ['merged', 'rejected'], rect: rect(208, 68, 48, 92) },
  { id: 'lounge', label: 'Lounge', stages: [], rect: rect(108, 68, 100, 92) },
]);

const REVIEWERS = ['review-security', 'review-ux', 'review-ui', 'review-code'];

/**
 * Walkable graph. Corridor runs along y=66; each area has a door node next to it. Rooms with inner nodes (research,
 * engineering, release, lounge) cross their wall or partition through the door gap via `in_<id>`, on the door's x.
 */
export const WAYPOINTS = deepFreeze({
  nodes: {
    cor_a: { x: 42, y: 66 }, cor_b: { x: 78, y: 66 }, cor_c: { x: 128, y: 66 },
    cor_d: { x: 158, y: 66 }, cor_e: { x: 214, y: 66 }, cor_f: { x: 232, y: 66 },
    door_research: { x: 42, y: 60 }, door_engineering: { x: 128, y: 60 }, door_review: { x: 214, y: 60 },
    door_release: { x: 42, y: 72 }, door_escalation: { x: 78, y: 72 }, door_lounge: { x: 158, y: 72 },
    door_archive: { x: 232, y: 72 },
    in_research: { x: 42, y: 56 }, in_engineering: { x: 128, y: 57 },
    seat_intake: { x: 24, y: 38 }, seat_spec: { x: 106, y: 25 }, seat_builder: { x: 132, y: 25 },
    seat_sec: { x: 181, y: 60 }, seat_ux: { x: 205, y: 60 }, seat_ui: { x: 222, y: 60 }, seat_code: { x: 245, y: 60 },
    seat_approver: { x: 14, y: 111 },
    in_release: { x: 42, y: 90 }, in_lounge: { x: 158, y: 90 },
    lounge_1: { x: 142, y: 98 }, lounge_2: { x: 120, y: 108 }, lounge_3: { x: 164, y: 99 }, lounge_4: { x: 159, y: 147 },
    lounge_5: { x: 137, y: 148 }, lounge_6: { x: 187, y: 125 }, lounge_7: { x: 117, y: 135 }, lounge_8: { x: 182, y: 146 },
  },
  edges: [
    ['cor_a', 'cor_b'], ['cor_b', 'cor_c'], ['cor_c', 'cor_d'], ['cor_d', 'cor_e'], ['cor_e', 'cor_f'],
    ['door_research', 'cor_a'], ['door_release', 'cor_a'], ['door_engineering', 'cor_c'],
    ['door_escalation', 'cor_b'], ['door_lounge', 'cor_d'], ['door_review', 'cor_e'], ['door_archive', 'cor_f'],
    ['door_research', 'in_research'], ['door_engineering', 'in_engineering'],
    ['seat_intake', 'in_research'], ['seat_spec', 'in_engineering'], ['seat_builder', 'in_engineering'],
    ['seat_sec', 'door_review'], ['seat_ux', 'door_review'], ['seat_ui', 'door_review'], ['seat_code', 'door_review'],
    ['door_release', 'in_release'], ['seat_approver', 'in_release'], ['door_lounge', 'in_lounge'],
    ['lounge_1', 'in_lounge'], ['lounge_2', 'in_lounge'], ['lounge_3', 'in_lounge'], ['lounge_4', 'in_lounge'],
    ['lounge_5', 'in_lounge'], ['lounge_6', 'in_lounge'], ['lounge_7', 'in_lounge'], ['lounge_8', 'in_lounge'],
  ],
});

/** Work seat per agent, inside the agent's area. */
export const SEATS = deepFreeze({
  intake: 'seat_intake', 'spec-writer': 'seat_spec', builder: 'seat_builder',
  'review-security': 'seat_sec', 'review-ux': 'seat_ux', 'review-ui': 'seat_ui', 'review-code': 'seat_code',
  approver: 'seat_approver',
});

/** Idle spot per agent, inside the Lounge. */
export const LOUNGE_SPOTS = deepFreeze({
  intake: 'lounge_1', 'spec-writer': 'lounge_2', builder: 'lounge_3', 'review-security': 'lounge_4',
  'review-ux': 'lounge_5', 'review-ui': 'lounge_6', 'review-code': 'lounge_7', approver: 'lounge_8',
});

/** Reviewers in a meeting stay at their own pod desk. */
export const MEETING_SEATS = deepFreeze({
  'review-security': 'seat_sec', 'review-ux': 'seat_ux', 'review-ui': 'seat_ui', 'review-code': 'seat_code',
});

/**
 * Atlas rects inside PixelOfficeAssets.png (256x160, CC0 pack by 2dPig).
 * The first rows of the file (y < 38) are sky and clouds; only `sky` uses them. Every rect was measured against
 * the alpha of the PNG.
 */
export const SPRITES = deepFreeze({
  charA: rect(2, 104, 16, 24),    // character: dark hair, grey shirt
  charB: rect(19, 103, 19, 25),   // character: red ponytail, white shirt
  charC: rect(40, 106, 14, 22),   // character: grey hair, glasses
  charD: rect(3, 132, 17, 24),    // character: long red hair, blue top
  charE: rect(22, 131, 17, 24),   // character: black bob, maroon top
  chairOrange: rect(6, 41, 11, 22),
  chairYellow: rect(19, 41, 11, 22),
  chairGreen: rect(32, 41, 11, 22),
  chairBlue: rect(45, 41, 11, 22),
  chairWhite: rect(58, 41, 11, 22),
  chairGrey: rect(71, 41, 11, 22),
  desk: rect(85, 47, 26, 16),     // short orange desk
  deskLong: rect(115, 47, 40, 16), // long orange table: the Lounge table
  sofaGrey: rect(119, 66, 33, 15), // grey sofa
  sofaBlue: rect(120, 83, 33, 16), // blue sofa
  sofaGreen: rect(120, 102, 33, 16), // green sofa
  sofaOrange: rect(120, 121, 33, 16), // orange sofa
  plant: rect(170, 64, 14, 20),   // potted plant
  terminal: rect(59, 96, 28, 28), // dark glass panel, the Gate terminal
  shelf: rect(184, 126, 24, 31),  // red shelf with bottles
  vending: rect(159, 123, 24, 34), // vending machine
  bin: rect(116, 143, 10, 15),    // green waste bin
  binRed: rect(126, 143, 10, 15), // red waste bin
  binBlue: rect(136, 143, 10, 15), // blue waste bin
  cooler: rect(147, 140, 9, 17),  // water cooler
  pc: rect(233, 106, 15, 19),     // white office machine, used as the workstation PC
  printer: rect(200, 107, 9, 9),  // small printer
  wall: rect(84, 70, 26, 20),     // white wall strip, tiled along the top of each area
  sky: rect(0, 8, 64, 20),        // blue sky with clouds, the Lounge's outdoor "wall"
  floor: rect(3, 68, 73, 24),     // blue plank floor, tiled under each area
  partition: rect(175, 49, 24, 10), // flat grey body of the cubicle panel, tiled for dividers between areas
  window: rect(59, 96, 26, 20),   // blue double-pane window (top 20 rows), a wall prop
  clock: rect(159, 108, 19, 6),   // red digital clock "12:00", a wall prop
  calendar: rect(234, 81, 17, 11), // wall calendar grid
  papers: rect(183, 107, 6, 8),   // paper sheet, a wall prop that fits narrow wall segments
  flag: rect(207, 94, 12, 9),     // framed striped flag
  cubicle: rect(171, 44, 79, 17), // grey cubicle back panel with a centre line, the Review pod
  cubicleDeskL: rect(188, 63, 17, 19), // half desk with the border on its left side
  cubicleDeskR: rect(213, 63, 17, 19), // half desk with the border on its right side
  cubicleDivider: rect(207, 63, 4, 27), // thin divider between two half desks
  flagB: rect(179, 94, 12, 9),    // framed flag (union jack)
  flagC: rect(193, 94, 12, 9),    // framed flag (stars and stripes)
  papersB: rect(192, 107, 6, 9),  // second paper sheet
  mug: rect(169, 95, 8, 7),       // coffee mug
  trinket: rect(211, 119, 11, 8), // small desk ornaments
  windowB: rect(88, 96, 26, 21),  // second blue window, with a note on the glass
  coffee: rect(159, 91, 7, 11),   // coffee machine
  dog: rect(59, 146, 24, 11),     // orange dog
  cat: rect(65, 129, 16, 13),     // black cat
});

/** Height of the wall strip at the top of each area, in map pixels. */
export const WALL_H = SPRITES.wall.h;
/** Thickness of a partition, in map pixels. */
export const PARTITION = 4;
/** Width of a door gap, in map pixels. */
export const DOOR_W = 16;

/** Which of the five characters plays each role. The role color comes from AVATARS. */
export const CHARACTER_FOR = deepFreeze({
  intake: 'charC', 'spec-writer': 'charB', builder: 'charA', 'review-security': 'charE',
  'review-ux': 'charD', 'review-ui': 'charB', 'review-code': 'charC', approver: 'charE',
});

/** Fixed verb per role. */
export const VERBS = deepFreeze({
  intake: 'triaging', 'spec-writer': 'writing spec', builder: 'implementing',
  'review-security': 'reviewing', 'review-ux': 'reviewing', 'review-ui': 'reviewing', 'review-code': 'reviewing',
  approver: 'approving',
});

/** Static scenery: [sprite, x, y] of the top-left corner, in base-map pixels. Each room has its own set. */
export const FURNITURE = deepFreeze([
  // Research: a desk, plus the office dog and cat
  { sprite: 'chairOrange', x: 1, y: 34 }, { sprite: 'desk', x: 13, y: 40 }, { sprite: 'calendar', x: 16, y: 43 },
  { sprite: 'papers', x: 33, y: 36 }, { sprite: 'plant', x: 64, y: 22 },
  { sprite: 'cat', x: 46, y: 28 }, { sprite: 'dog', x: 46, y: 46 },
  // Engineering: a software workshop with two workstations and the Gate terminal
  { sprite: 'plant', x: 86, y: 6 }, { sprite: 'cooler', x: 103, y: 7 }, { sprite: 'calendar', x: 146, y: 4 },
  { sprite: 'chairBlue', x: 101, y: 26 }, { sprite: 'chairGreen', x: 127, y: 26 },
  { sprite: 'desk', x: 85, y: 38 }, { sprite: 'desk', x: 112, y: 38 },
  { sprite: 'pc', x: 86, y: 29 }, { sprite: 'pc', x: 112, y: 29 },
  { sprite: 'terminal', x: 139, y: 19 }, { sprite: 'coffee', x: 144, y: 48 },
  // Review: a cubicle pod, four half desks under one back panel
  { sprite: 'windowB', x: 229, y: 0 }, { sprite: 'clock', x: 176, y: 6 }, { sprite: 'cubicle', x: 173, y: 20 },
  { sprite: 'flagB', x: 182, y: 22 }, { sprite: 'flagC', x: 222, y: 22 },
  { sprite: 'cubicleDivider', x: 191, y: 30 }, { sprite: 'cubicleDivider', x: 232, y: 30 },
  { sprite: 'cubicleDeskL', x: 173, y: 36 }, { sprite: 'cubicleDeskR', x: 196, y: 36 },
  { sprite: 'cubicleDeskL', x: 214, y: 36 }, { sprite: 'cubicleDeskR', x: 237, y: 36 },
  { sprite: 'chairYellow', x: 176, y: 36 }, { sprite: 'chairWhite', x: 199, y: 36 },
  { sprite: 'chairYellow', x: 217, y: 36 }, { sprite: 'chairWhite', x: 240, y: 36 },
  { sprite: 'pc', x: 174, y: 29 }, { sprite: 'pc', x: 197, y: 29 }, { sprite: 'pc', x: 215, y: 29 }, { sprite: 'pc', x: 238, y: 29 },
  // Release
  { sprite: 'flag', x: 5, y: 92 }, { sprite: 'desk', x: 4, y: 114 }, { sprite: 'printer', x: 20, y: 106 },
  { sprite: 'chairGreen', x: 31, y: 108 }, { sprite: 'sofaBlue', x: 6, y: 134 },
  // Escalation
  { sprite: 'calendar', x: 66, y: 92 }, { sprite: 'sofaGrey', x: 56, y: 126 }, { sprite: 'binRed', x: 92, y: 138 },
  // Archive
  { sprite: 'shelf', x: 212, y: 82 }, { sprite: 'bin', x: 238, y: 108 }, { sprite: 'cooler', x: 214, y: 130 },
  // Lounge: an outdoor terrace around a central table, one chair beside each idle spot
  { sprite: 'vending', x: 179, y: 74 }, { sprite: 'deskLong', x: 137, y: 113 },
  { sprite: 'chairGrey', x: 147, y: 91 }, { sprite: 'chairGreen', x: 125, y: 98 }, { sprite: 'chairWhite', x: 168, y: 90 },
  { sprite: 'chairYellow', x: 163, y: 138 }, { sprite: 'chairOrange', x: 141, y: 137 }, { sprite: 'chairBlue', x: 191, y: 115 },
  { sprite: 'chairGrey', x: 121, y: 137 }, { sprite: 'chairGreen', x: 186, y: 137 },
]);

const inside = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const positiveInt = (n) => Number.isInteger(n) && n > 0;
const AREA_BY_ID = new Map(AREAS.map((a) => [a.id, a]));
const AREA_OF_STAGE = new Map(AREAS.flatMap((a) => a.stages.map((s) => [s, a.id])));
const KNOWN_STAGES = new Set(STAGE_COLUMNS.map(([s]) => s));
const RUNNING_STAGES = new Set(['intake', 'needs-info', 'spec', 'build', 'gate', 'review', 'approve', 'merging']);
const TOKEN_AREAS = ['research', 'engineering', 'review', 'release'];

const num = (n) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

// Corridor bounds of the base layout: the top row ends where the corridor begins.
const TOP_ROW_END = AREAS[0].rect.y + AREAS[0].rect.h;
const BOTTOM_ROW_START = Math.min(...AREAS.filter((a) => a.rect.y > 0).map((a) => a.rect.y));

/**
 * Derive the office layout for a stage of `width` x `height` CSS px (height <= 0 means free height, used when
 * stacked). Integer scale, map size in map pixels, and the areas, nodes and furniture grown to fill the map.
 * Pure; never throws.
 */
export function layoutOffice(width, height, opts) {
  const w = num(width), h = num(height);
  const ms = opts && Number.isInteger(opts.minScale) && opts.minScale >= 1 ? opts.minScale : 1;
  const scale = Math.max(ms, Math.floor(Math.min(w / MAP.width, h > 0 ? h / MAP.height : Infinity)));
  const mw = Math.max(MAP.width, Math.floor(w / scale));
  const mh = h > 0 ? Math.max(MAP.height, Math.floor(h / scale)) : MAP.height;
  const col = (b) => Math.round((b * mw) / MAP.width);
  const row = (b) => Math.round((b * mh) / MAP.height);
  const areas = AREAS.map((a) => {
    const x0 = col(a.rect.x), x1 = col(a.rect.x + a.rect.w), y0 = row(a.rect.y), y1 = row(a.rect.y + a.rect.h);
    return { id: a.id, label: a.label, stages: [...a.stages], rect: rect(x0, y0, x1 - x0, y1 - y0) };
  });
  const rectOf = (base) => areas[AREAS.indexOf(base)].rect;
  const corridorY = row(TOP_ROW_END) + Math.floor((row(BOTTOM_ROW_START) - row(TOP_ROW_END)) / 2);
  const nodes = {};
  for (const [name, p] of Object.entries(WAYPOINTS.nodes)) {
    const base = AREAS.find((a) => inside(a.rect, p));
    if (!base) { nodes[name] = { x: Math.floor((p.x * mw) / MAP.width), y: corridorY }; continue; }
    const r = rectOf(base);
    nodes[name] = {
      x: r.x + Math.floor(((p.x - base.rect.x) * r.w) / base.rect.w),
      y: r.y + Math.floor(((p.y - base.rect.y) * r.h) / base.rect.h),
    };
  }
  const furniture = FURNITURE.map((f) => {
    const sp = SPRITES[f.sprite];
    const base = AREAS.find((a) => inside(a.rect, { x: f.x + sp.w / 2, y: f.y + sp.h / 2 })) ?? AREAS[0];
    const r = rectOf(base), b = base.rect;
    const place = (v, size, bo, bs, ro, rs) => Math.floor((2 * ro * bs + (2 * v + size - 2 * bo) * rs - size * bs) / (2 * bs));
    const x = place(f.x, sp.w, b.x, b.w, r.x, r.w), y = place(f.y, sp.h, b.y, b.h, r.y, r.h);
    return { sprite: f.sprite, x: Math.min(Math.max(0, x), mw - sp.w), y: Math.min(Math.max(0, y), mh - sp.h) };
  });
  return { scale, map: { width: mw, height: mh }, areas, nodes, furniture };
}

const EMPTY_BACKDROP = { corridor: null, doors: [], floors: [], walls: [], wallProps: [], partitions: [] };

/**
 * Static scenery geometry for a `layoutOffice` result: corridor, door gaps, floors, wall strips (`sky` for the Lounge),
 * wall props and partitions, all integers in map pixels. Pure; never throws; invalid input gives an empty backdrop.
 */
export function officeBackdrop(layout) {
  try {
    const out = () => ({ corridor: null, doors: [], floors: [], walls: [], wallProps: [], partitions: [] });
    if (!isObject(layout) || !Array.isArray(layout.areas) || !layout.areas.length || !isObject(layout.nodes) || !isObject(layout.map)) return out();
    const areas = layout.areas;
    const ok = areas.every((a) => isObject(a) && typeof a.id === 'string' && isObject(a.rect) &&
      [a.rect.x, a.rect.y, a.rect.w, a.rect.h].every(Number.isInteger) && a.rect.w > 0 && a.rect.h > 0);
    if (!ok || !Number.isInteger(layout.map.width)) return out();
    const topY = Math.min(...areas.map((a) => a.rect.y));
    const top = areas.filter((a) => a.rect.y === topY), bottom = areas.filter((a) => a.rect.y !== topY);
    const res = out();
    const topEnd = Math.max(...top.map((a) => a.rect.y + a.rect.h));
    const bottomStart = bottom.length ? Math.min(...bottom.map((a) => a.rect.y)) : topEnd;
    res.corridor = { x: 0, y: topEnd, w: layout.map.width, h: bottomStart - topEnd };
    const isTop = new Set(top.map((a) => a.id));
    for (const a of areas) {
      const { x, y, w, h } = a.rect;
      const node = layout.nodes['door_' + a.id];
      const dx = isObject(node) && Number.isFinite(node.x) ? Math.floor(node.x) : x + Math.floor(w / 2);
      const dw = Math.min(DOOR_W, w);
      const gx = Math.min(Math.max(x, dx - Math.floor(dw / 2)), x + w - dw);
      res.doors.push({ id: a.id, x: gx, w: dw });
      const outdoor = a.id === 'lounge';
      res.floors.push({ id: a.id, x, y, w, h, kind: outdoor ? 'grass' : 'planks' });
      const segs = isTop.has(a.id)
        ? [{ x, w }]
        : [{ x, w: gx - x }, { x: gx + dw, w: x + w - gx - dw }].filter((s) => s.w > 0);
      for (const s of segs) res.walls.push({ id: a.id, x: s.x, y, w: s.w, h: WALL_H, sprite: outdoor ? 'sky' : 'wall' });
      const best = segs.reduce((m, s) => (s.w > m.w ? s : m), segs[0] ?? { x, w: 0 });
      for (const name of outdoor ? [] : ['window', 'clock', 'calendar', 'papers']) {
        const sp = SPRITES[name];
        if (best.w < sp.w + (name === 'calendar' || name === 'papers' ? 0 : 2)) continue;
        res.wallProps.push({ id: a.id, sprite: name, x: best.x + Math.floor((best.w - sp.w) / 2), y: y + Math.floor((WALL_H - sp.h) / 2) });
        break;
      }
      if (isTop.has(a.id)) {
        const py = y + h - PARTITION;
        for (const s of [{ x, w: gx - x }, { x: gx + dw, w: x + w - gx - dw }]) {
          if (s.w > 0) res.partitions.push({ x: s.x, y: py, w: s.w, h: PARTITION });
        }
      }
    }
    for (const row of [top, bottom]) {
      const sorted = [...row].sort((p, q) => p.rect.x - q.rect.x);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1].rect, b = sorted[i].rect;
        res.partitions.push({ x: b.x - PARTITION, y: a.y + WALL_H, w: PARTITION, h: a.h - WALL_H });
      }
    }
    return res;
  } catch {
    return { ...EMPTY_BACKDROP, doors: [], floors: [], walls: [], wallProps: [], partitions: [] };
  }
}

const LANDMARKS = { gate: ['terminal', 'engineering'], meeting: ['cubicle', 'review'], escalation: ['calendar', 'escalation'],
  shelf: ['shelf', 'archive'], bin: ['bin', 'archive'] };

/**
 * The special furniture the dashboard draws on: the Gate terminal (Engineering), the meeting pod (Review), the
 * Escalation calendar, and the Archive shelf and bin. Each is the entry of `layout.furniture` with that sprite whose
 * center is inside that area, or null. Pure; never throws.
 */
export function officeLandmarks(layout) {
  const res = { gate: null, meeting: null, escalation: null, shelf: null, bin: null };
  try {
    if (!isObject(layout) || !Array.isArray(layout.furniture) || !Array.isArray(layout.areas)) return res;
    const rectOf = new Map(layout.areas.filter((a) => isObject(a) && isObject(a.rect)).map((a) => [a.id, a.rect]));
    for (const [key, [sprite, areaId]] of Object.entries(LANDMARKS)) {
      const r = rectOf.get(areaId), sp = Object.hasOwn(SPRITES, sprite) ? SPRITES[sprite] : null;
      if (!r || !sp) continue;
      res[key] = layout.furniture.find((f) => isObject(f) && f.sprite === sprite && Number.isFinite(f.x) && Number.isFinite(f.y) &&
        inside(r, { x: f.x + sp.w / 2, y: f.y + sp.h / 2 })) ?? null;
    }
    return res;
  } catch {
    return { gate: null, meeting: null, escalation: null, shelf: null, bin: null };
  }
}

/**
 * Canvas rect `{ x, y, w, h }` of the short name tag of an idle `agent` standing at `node` (`{ x, y }` in map pixels),
 * given the layout `scale` and the measured `textWidth` of the tag text. The tag sits over the character's torso.
 * Pure; never throws; null when any input is not usable.
 */
export function idleTagBox(node, agent, scale, textWidth) {
  try {
    if (!isObject(node) || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return null;
    if (typeof agent !== 'string' || !Object.hasOwn(CHARACTER_FOR, agent)) return null;
    if (!positiveInt(scale) || typeof textWidth !== 'number' || !Number.isFinite(textWidth) || textWidth < 0) return null;
    const r = SPRITES[CHARACTER_FOR[agent]], w = textWidth + 8;
    return {
      x: Math.round((node.x - r.w / 2) * scale) + (r.w * scale) / 2 - w / 2,
      y: Math.round((node.y - r.h) * scale) + 24,
      w, h: 15,
    };
  } catch {
    return null;
  }
}

/** Position a walker should have after a re-layout: its node when still, a proportional point when walking. */
export function remapWalker(walker, from, to) {
  const node = isObject(walker) && isObject(to?.nodes) && typeof walker.node === 'string' && isObject(to.nodes[walker.node]) ? to.nodes[walker.node] : null;
  const fallback = node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
  if (!isObject(walker) || !isObject(from?.map) || !isObject(to?.map)) return fallback;
  if (!Array.isArray(walker.queue) || !walker.queue.length) return fallback;
  const { x, y } = walker;
  if (![x, y, from.map.width, from.map.height, to.map.width, to.map.height].every(Number.isFinite) || from.map.width <= 0 || from.map.height <= 0) return fallback;
  const clamp = (v, max) => Math.min(Math.max(0, v), max);
  return { x: clamp((x * to.map.width) / from.map.width, to.map.width), y: clamp((y * to.map.height) / from.map.height, to.map.height) };
}

/** Area id for a board stage; unknown or non-string stages go to 'research'. */
export function areaForStage(stage) {
  return typeof stage === 'string' && AREA_OF_STAGE.has(stage) ? AREA_OF_STAGE.get(stage) : 'research';
}

/** Tone of the area's first stage; 'neutral' for the lounge and unknown ids. */
export function areaTone(areaId) {
  const area = typeof areaId === 'string' ? AREA_BY_ID.get(areaId) : undefined;
  return area && area.stages.length ? laneTone(area.stages[0]) : 'neutral';
}

const ADJ = (() => {
  const m = new Map(Object.keys(WAYPOINTS.nodes).map((n) => [n, []]));
  for (const [a, b] of WAYPOINTS.edges) { m.get(a).push(b); m.get(b).push(a); }
  return m;
})();

/** Shortest path in hops (BFS) including both ends; [] when a node is unknown or unreachable. */
export function route(fromNode, toNode) {
  if (typeof fromNode !== 'string' || typeof toNode !== 'string' || !ADJ.has(fromNode) || !ADJ.has(toNode)) return [];
  const prev = new Map([[fromNode, null]]);
  const queue = [fromNode];
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    if (n === toNode) break;
    for (const next of ADJ.get(n)) if (!prev.has(next)) { prev.set(next, n); queue.push(next); }
  }
  if (!prev.has(toNode)) return [];
  const path = [];
  for (let n = toNode; n !== null; n = prev.get(n)) path.unshift(n);
  return path;
}

const finiteCost = (j) => (isObject(j) && typeof j.cost_usd === 'number' && Number.isFinite(j.cost_usd) && j.cost_usd >= 0 ? j.cost_usd : 0);

/** Header tiles: total jobs, running (intake through merging), active agents, total cost. */
export function headerStats(jobs) {
  if (!Array.isArray(jobs)) return { total: 0, running: 0, agents: 0, cost: 0 };
  let running = 0, agents = 0, cost = 0;
  for (const job of jobs) {
    if (isObject(job) && (!KNOWN_STAGES.has(job.stage) || RUNNING_STAGES.has(job.stage))) running++;
    agents += activeAgents(job).length;
    cost += finiteCost(job);
  }
  return { total: jobs.length, running, agents, cost };
}

/** `$X.XX`; anything that is not a finite number is `$0.00`. */
export function formatCost(n) {
  return `$${(typeof n === 'number' && Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

/** Bubble text for an agent given its work items `{ issue, round }`. Unknown agents give ''. */
export function bubbleText(agent, work) {
  if (typeof agent !== 'string' || !Object.hasOwn(AGENTS, agent)) return '';
  const label = AGENTS[agent].label;
  const list = Array.isArray(work) ? work.filter(isObject) : [];
  if (!list.length) return label;
  if (list.length > 1) return `${label} · ×${list.length} · ${VERBS[agent]}`;
  const { issue, round } = list[0];
  const parts = [label];
  if (positiveInt(issue)) parts.push(`#${issue}`);
  if (positiveInt(round)) parts.push(`R${round}`);
  parts.push(VERBS[agent]);
  return parts.join(' · ');
}

const time = (s) => { const t = typeof s === 'string' ? Date.parse(s) : NaN; return Number.isNaN(t) ? Infinity : t; };

// Valid jobs, oldest first (by `started`, then id), with the fields the office needs.
function prepare(jobs) {
  if (!Array.isArray(jobs)) return [];
  return jobs
    .map((job, i) => (isObject(job) ? { job, jobId: typeof job.id === 'string' && job.id ? job.id : `job-${i}`, i } : null))
    .filter(Boolean)
    .map(({ job, jobId, i }) => ({
      job, jobId, i,
      stage: KNOWN_STAGES.has(job.stage) ? job.stage : 'intake',
      issue: positiveInt(job.issue) ? job.issue : null,
      round: positiveInt(job.round) ? job.round : null,
      started: time(job.started),
    }))
    .sort((a, b) => (a.started !== b.started ? (a.started < b.started ? -1 : 1) : a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : a.i - b.i));
}

const tokenOf = (p) => ({ jobId: p.jobId, label: p.issue ? `#${p.issue}` : p.jobId });

/** Full office state from board jobs. See the job spec for the shape. */
export function officeState(jobs) {
  const prepared = prepare(jobs);
  const work = Object.fromEntries(Object.keys(AGENTS).map((a) => [a, []]));
  let meeting = null;
  for (const p of prepared) {
    const active = activeAgents(p.job);
    for (const a of active) work[a].push({ jobId: p.jobId, issue: p.issue, round: p.round });
    if (!meeting && active.length >= 2 && active.every((a) => REVIEWERS.includes(a))) {
      meeting = { jobId: p.jobId, issue: p.issue, members: active };
    }
  }
  const agents = {};
  for (const a of Object.keys(AGENTS)) {
    const w = work[a];
    let place = 'lounge', node = LOUNGE_SPOTS[a], area = 'lounge';
    if (w.length) {
      const inMeeting = meeting && meeting.members.includes(a);
      place = inMeeting ? 'meeting' : 'seat';
      node = inMeeting ? MEETING_SEATS[a] : SEATS[a];
      area = AREAS.find((r) => r.id !== 'lounge' && node in WAYPOINTS.nodes && inside(r.rect, WAYPOINTS.nodes[node])).id;
    }
    agents[a] = { place, node, area, work: w, bubble: bubbleText(a, w) };
  }
  const tokens = Object.fromEntries(TOKEN_AREAS.map((id) => [id, []]));
  const escalation = [];
  const archive = { merged: 0, rejected: 0 };
  for (const p of prepared) {
    if (p.stage === 'merged') archive.merged++;
    else if (p.stage === 'rejected') archive.rejected++;
    else if (p.stage === 'needs-human') escalation.push(tokenOf(p));
    else tokens[areaForStage(p.stage)].push(tokenOf(p));
  }
  return { agents, meeting, tokens, escalation, archive, gate: gateState(prepared) };
}

function gateState(prepared) {
  const lit = prepared.some((p) => p.stage === 'gate');
  let best = null, bestT = -Infinity;
  for (const p of prepared) {
    if (p.stage === 'merged' || p.stage === 'rejected') continue;
    if (p.job.gate !== 'PASS' && p.job.gate !== 'FAIL') continue;
    const t = Date.parse(p.job.updated);
    const tt = Number.isNaN(t) ? -Infinity : t;
    if (best === null || tt > bestT) { best = p.job.gate; bestT = tt; }
  }
  return { lit, result: best };
}

/** One entry per clickable thing: agents with work, tokens, and areas with jobs. Each opens a job. */
export function hitTargets(state, jobs) {
  const out = [];
  const lbl = (n) => (positiveInt(n) ? `#${n}` : 'job');
  if (isObject(state) && isObject(state.agents)) {
    for (const a of Object.keys(AGENTS)) {
      const w = state.agents[a]?.work;
      if (Array.isArray(w) && w.length) {
        out.push({ kind: 'agent', key: a, jobId: w[0].jobId, label: `${AGENTS[a].label}, ${lbl(w[0].issue)}, open job` });
      }
    }
  }
  const prepared = prepare(jobs);
  const byId = new Map(prepared.map((p) => [p.jobId, p]));
  const tokenLists = [...TOKEN_AREAS.map((id) => state?.tokens?.[id]), state?.escalation];
  for (const list of tokenLists) {
    if (!Array.isArray(list)) continue;
    for (const t of list) out.push({ kind: 'token', key: t.jobId, jobId: t.jobId, label: `${lbl(byId.get(t.jobId)?.issue)}, open job` });
  }
  const oldest = new Map();
  for (const p of prepared) {
    const id = areaForStage(p.stage);
    if (!oldest.has(id)) oldest.set(id, p);
  }
  for (const area of AREAS) {
    const p = oldest.get(area.id);
    if (p) out.push({ kind: 'area', key: area.id, jobId: p.jobId, label: `${area.label}, ${lbl(p.issue)}, open oldest job` });
  }
  return out;
}

/** Plain-text lines describing the office, for a screen-reader live region. */
export function describeOffice(state) {
  const lines = [];
  if (!isObject(state) || !isObject(state.agents)) return lines;
  for (const a of Object.keys(AGENTS)) {
    const s = state.agents[a];
    if (!s) continue;
    const area = AREA_BY_ID.get(s.area)?.label ?? 'Lounge';
    const w = Array.isArray(s.work) ? s.work : [];
    const items = w.map((x) => [positiveInt(x.issue) && `#${x.issue}`, positiveInt(x.round) && `R${x.round}`].filter(Boolean).join(' ')).filter(Boolean);
    lines.push(`${AGENTS[a].label} in ${area}: ${w.length ? `${items.join(', ')} ${VERBS[a]}`.trim() : 'idle'}`);
  }
  if (state.meeting) {
    const names = (state.meeting.members || []).filter((m) => Object.hasOwn(AGENTS, m)).map((m) => AGENTS[m].label);
    lines.push(`Review meeting${positiveInt(state.meeting.issue) ? ` for #${state.meeting.issue}` : ''}: ${names.join(', ')}`);
  }
  if (state.escalation?.length) lines.push(`Escalation: ${state.escalation.map((t) => t.label).join(', ')}`);
  if (state.archive && (state.archive.merged || state.archive.rejected)) {
    lines.push(`Archive: ${state.archive.merged} merged, ${state.archive.rejected} rejected`);
  }
  return lines;
}
