import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FLOOR, FLOOR_VIEWBOX } from '../src/game/scene.js';
import { STAGES } from '../src/game/engine.js';
import { TOUR_STEPS } from '../src/game/scenarios.js';

const ITEMS = [...STAGES, ...TOUR_STEPS];
import { BOTTOM_PANEL, HUD_HEIGHT, MARGIN, MIN_LABEL_PX, PANEL_GAP, TOP_PANEL, floorView, screenLayout } from '../src/game/layout.js';

const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const loop = readFileSync(new URL('../src/game/FactoryLoop.jsx', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('../public/game.js', import.meta.url), 'utf8');

const WIDE_SIZES = [[1024, 640], [1280, 720], [1920, 1080]];
const NARROW_SIZES = [[800, 600], [375, 667]];
const CARD = '.game-page .game__panel:has(> .game__stage)';

// Body of the first block at or after `start` in `text`, with its nested braces.
function block(text, start) {
  const open = text.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error('unbalanced block');
}

const wideBlock = block(css, css.indexOf('@media (min-width: 64rem)'));
const rule = (body, selector) => block(body, body.indexOf(`${selector} {`));

test('AC-1: the floor box is horizontally centered on wide screens', () => {
  for (const stage of ITEMS) {
    for (const [w, h] of WIDE_SIZES) {
      const { scene } = screenLayout(stage, w, h);
      assert.equal(scene.left, MARGIN);
      assert.equal(scene.left + scene.width, w - MARGIN);
      assert.equal(scene.left + scene.width / 2, w / 2);
    }
  }
});

test('AC-7: on wide screens the caption and floor sit below the top panel and fit on screen', () => {
  for (const stage of ITEMS) {
    for (const [w, h] of WIDE_SIZES) {
      const { captionTop, scene } = screenLayout(stage, w, h);
      assert.ok(captionTop >= HUD_HEIGHT + PANEL_GAP + TOP_PANEL * h, `${w}x${h} caption below panel`);
      assert.ok(scene.top > captionTop);
      assert.ok(scene.height >= 0.15 * h, `${w}x${h} floor is at least 15% tall`);
      assert.ok(scene.top + scene.height <= h - MARGIN);
    }
  }
});

test('AC-3: narrow screens keep the bottom-dock math', () => {
  for (const stage of ITEMS) {
    for (const [w, h] of NARROW_SIZES) {
      const { captionTop, scene } = screenLayout(stage, w, h);
      assert.equal(captionTop, HUD_HEIGHT + 8);
      assert.equal(scene.left, MARGIN);
      assert.equal(scene.width, w - 2 * MARGIN);
      const bottom = scene.top + scene.height;
      const expected = h * (1 - BOTTOM_PANEL) - MARGIN;
      assert.ok(Math.abs(bottom - Math.max(expected, scene.top + 1)) < 1e-9);
    }
  }
});

test('AC-4: the wide block docks the card to the top in two columns', () => {
  const card = rule(wideBlock, CARD);
  assert.match(card, /width:\s*100%/);
  assert.match(card, new RegExp(`max-height:\\s*min\\(100%,\\s*${TOP_PANEL * 100}dvh\\)`));
  assert.match(rule(wideBlock, '.game-page .game__stage'), /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/);
  assert.ok(!css.includes('width: min(32rem, 40vw)'));
  assert.ok(!css.includes('margin: auto 0 auto auto'));
});

test('AC-5: the narrow dock and small-viewport fallback are intact', () => {
  const base = block(css, css.indexOf(`${CARD} {`));
  assert.match(base, new RegExp(`max-height:\\s*min\\(100%,\\s*${BOTTOM_PANEL * 100}dvh\\)`));
  const fallback = block(css, css.indexOf('@media (max-width: 40rem), (max-height: 30rem) {'));
  assert.match(rule(fallback, CARD), /max-height:\s*none/);
});

test('AC-6: FactoryLoop imports screenLayout and the bundle has no right-dock code', () => {
  assert.match(loop, /import \{[^}]*\bscreenLayout\b[^}]*\} from '\.\/layout\.js';/);
  assert.ok(!loop.includes('panelWidth'));
  assert.ok(!bundle.includes('panelWidth'));
  assert.ok(!bundle.includes('.4*e)+16') && !bundle.includes('.4 * width) + 16'));
});

test('AC-7: floorView keeps floor labels at least 10 px and inside the plant frame', () => {
  const full = FLOOR_VIEWBOX;
  for (const [w, h] of [...WIDE_SIZES, [375, 667], [320, 568]]) {
    for (const item of ITEMS) {
      const { scene } = screenLayout(item, w, h);
      for (const focus of [[full.x, full.y], [full.x + full.width / 2, full.y + full.height / 2], [full.x + full.width, full.y + full.height]]) {
        const view = floorView(scene, focus);
        assert.ok(view.scale * FLOOR.labelSize >= MIN_LABEL_PX - 1e-9, `${w}x${h} label ${view.scale * FLOOR.labelSize}px`);
        assert.ok(Math.abs(view.width / view.height - scene.width / scene.height) < 1e-9, 'same aspect as the box');
        if (view.width <= full.width) assert.ok(view.x >= full.x - 1e-9 && view.x + view.width <= full.x + full.width + 1e-9, 'inside in x');
        if (view.height <= full.height) assert.ok(view.y >= full.y - 1e-9 && view.y + view.height <= full.y + full.height + 1e-9, 'inside in y');
      }
    }
  }
});
