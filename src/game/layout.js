import { FLOOR, FLOOR_VIEWBOX } from './scene.js';

// Where things go on screen, in composition units. Plain JS so Node tests can
// import it. The constants mirror public/styles.css: the 64rem breakpoint, the two
// columns on wide screens (text on the left, the Player on the right) and the
// bottom dock cap (45dvh) below it.
export const WIDE = 1024; // 64rem
export const HUD_HEIGHT = 56;
export const MARGIN = 16;
export const BOTTOM_PANEL = 0.45; // narrow: bottom dock max-height 45dvh
/** Wide: the text column is this share of the width, at least MIN_TEXT px (20rem). */
export const TEXT_SHARE = 0.34;
export const MIN_TEXT = 320;

/**
 * What any caption shows, as plain data: the dock caption renders it. A tour step
 * has narration, actors and maybe a condition; a stage has agents and no narration.
 * @returns {{ text: string|null, chips: { name: string, model?: string }[], file: string, condition: string|null }}
 */
export function captionContent(item) {
  if (item.actors) {
    return { text: item.text, chips: item.actors, file: item.file, condition: item.condition ?? null };
  }
  return {
    text: null,
    chips: item.agents.map((agent) => ({ name: agent.name, model: agent.routing ?? agent.model })),
    file: item.output,
    condition: null,
  };
}

/** The smallest size, in px, a floor label may render at. */
export const MIN_LABEL_PX = 10;

/**
 * The part of the plant the floor box shows. The whole plant is too long to read in a
 * short box, so the view never shrinks the labels under MIN_LABEL_PX: when the plant
 * does not fit at that scale the view is a window that follows `focus` (iso screen
 * units) and stays inside the plant's frame. When it fits, the plant is centred.
 * @param {{ width: number, height: number }} box floor box in px
 * @param {number[]} focus [sx, sy] the view centres on
 * @returns {{ x: number, y: number, width: number, height: number, scale: number }}
 */
export function floorView(box, focus) {
  const full = FLOOR_VIEWBOX;
  const fit = Math.min(box.width / full.width, box.height / full.height);
  const scale = Math.max(fit, MIN_LABEL_PX / FLOOR.labelSize);
  const place = (centre, start, length, window) =>
    window >= length ? start + length / 2 - window / 2 : Math.min(Math.max(centre - window / 2, start), start + length - window);
  const width = box.width / scale;
  const height = box.height / scale;
  return { x: place(focus[0], full.x, full.width, width), y: place(focus[1], full.y, full.height, height), width, height, scale };
}

/**
 * The two columns of a wide screen: the text column on the left and the Player's
 * column on the right, side by side with no gap, both as tall as the space under the HUD.
 * @param {number} width viewport width in px
 * @returns {{ text: number, scene: number }} column widths; they add up to `width`
 */
export function splitColumns(width) {
  const text = Math.min(width, Math.max(MIN_TEXT, Math.round(TEXT_SHARE * width)));
  return { text, scene: width - text };
}

/**
 * The floor box inside the composition. On wide screens (`split`) the composition is
 * the right column itself, so the box is all of it and the plant is centred in the
 * column. Below 64rem the composition is the viewport: the floor box sits between the
 * HUD and the bottom dock card, which holds the caption.
 * @param {number} width composition width
 * @param {number} height composition height
 * @param {boolean} [split]
 * @returns {{ captionInDock: boolean, scene: { left: number, top: number, width: number, height: number } }}
 */
export function screenLayout(width, height, split = false) {
  if (split) return { captionInDock: true, scene: { left: 0, top: 0, width: Math.max(1, width), height: Math.max(1, height) } };
  const top = HUD_HEIGHT + 8;
  return {
    captionInDock: true,
    scene: {
      left: MARGIN,
      top,
      width: Math.max(1, width - 2 * MARGIN),
      height: Math.max(1, height * (1 - BOTTOM_PANEL) - MARGIN - top),
    },
  };
}
