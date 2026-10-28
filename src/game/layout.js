// Where things go on screen, in composition units. Plain JS so Node tests can
// import it. The constants mirror public/styles.css: the 64rem breakpoint, the
// top dock cap (40dvh) on wide screens and the bottom dock cap (45dvh) below it.
export const WIDE = 1024; // 64rem
export const HUD_HEIGHT = 56;
export const MARGIN = 16;
export const PANEL_GAP = 12; // .game top padding, 0.75rem
export const TOP_PANEL = 0.4; // wide: top dock max-height 40dvh
export const BOTTOM_PANEL = 0.45; // narrow: bottom dock max-height 45dvh

// The caption box and the floor drawing. Wide: the card docks at the top, the
// caption sits under it and the floor fills the full width below. Narrow: the
// caption is in the top-left corner and the floor sits above the bottom dock.
export function screenLayout(stage, width, height) {
  const unit = Math.min(1.25, Math.max(0.75, Math.min(width, height) / 720));
  const wide = width >= WIDE;
  const captionTop = wide ? HUD_HEIGHT + PANEL_GAP + TOP_PANEL * height + 8 : HUD_HEIGHT + 8;
  const captionWidth = Math.min(width - 2 * MARGIN, 760 * unit);
  // Rough caption height: padding and the output line, plus one row per two or
  // three chips. The stage number and title live in the panel, not here.
  const perRow = Math.max(1, Math.floor(captionWidth / (260 * unit)));
  const rows = stage.agents.length === 0 ? 0.6 : Math.ceil(stage.agents.length / perRow);
  const captionBottom = captionTop + (58 + rows * 42) * unit;
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
