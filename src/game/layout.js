import { FLOOR, FLOOR_VIEWBOX, iso } from './scene.js';

// Where things go on screen, in composition units. Plain JS so Node tests can
// import it. The constants mirror public/styles.css: the 64rem breakpoint, the
// top dock cap (40dvh) on wide screens and the bottom dock cap (45dvh) below it.
export const WIDE = 1024; // 64rem
export const HUD_HEIGHT = 56;
export const MARGIN = 16;
export const PANEL_GAP = 12; // .game top padding, 0.75rem
export const TOP_PANEL = 0.4; // wide: top dock max-height 40dvh
export const BOTTOM_PANEL = 0.45; // narrow: bottom dock max-height 45dvh

/** Caption body text size in px: 14 scaled with the screen, never under 12. */
export const captionText = (unit) => Math.max(12, 14 * unit);
/** The smallest size, in px, a floor label may render at. */
export const MIN_LABEL_PX = 10;

/**
 * The part of the plant the floor box shows. The whole plant is too long to read in a
 * short box, so the view never shrinks the labels under MIN_LABEL_PX: when the plant
 * does not fit at that scale the view is a window that follows `focus` (iso screen
 * units) and stays inside the plant's frame.
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

// The caption box and the floor drawing. Wide: the card docks at the top, the
// caption sits under it and the floor fills the full width below. Narrow: the
// caption is in the top-left corner and the floor sits above the bottom dock.
// `item` is a stage (quiz) or a tour step: a step has `actors` and a narration
// `text`, a stage has `agents`.
export function screenLayout(item, width, height) {
  const unit = Math.min(1.25, Math.max(0.75, Math.min(width, height) / 720));
  const wide = width >= WIDE;
  const captionTop = wide ? HUD_HEIGHT + PANEL_GAP + TOP_PANEL * height + 8 : HUD_HEIGHT + 8;
  const captionWidth = Math.min(width - 2 * MARGIN, 760 * unit);
  // Rough caption height: padding and the output line, plus one row per two or
  // three chips. The stage number and title live in the panel, not here.
  const chips = (item.actors ?? item.agents).length;
  const perRow = Math.max(1, Math.floor(captionWidth / (260 * unit)));
  const rows = chips === 0 ? 0.6 : Math.ceil(chips / perRow);
  // Narration, and the condition when there is one, wrap at about 0.6 em per
  // character in 14 px text with a 19 px line.
  const perLine = Math.max(1, Math.floor((captionWidth - 32 * unit) / (captionText(unit) * 0.6)));
  const lines = (text) => (text ? Math.ceil(text.length / perLine) : 0);
  const textLines = lines(item.text) + lines(item.condition ? `Condición: ${item.condition}` : '');
  const captionBottom = captionTop + (58 + rows * 42) * unit + textLines * captionText(unit) * 1.35;
  const freeBottom = wide ? height : height * (1 - BOTTOM_PANEL);
  const top = captionBottom + 8;
  return {
    unit,
    captionTop,
    captionWidth,
    scene: {
      left: MARGIN,
      top,
      width: Math.max(1, width - 2 * MARGIN),
      height: Math.max(1, freeBottom - MARGIN - top),
    },
  };
}
