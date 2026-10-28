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

// --- Job 017: keep the factory floor visible on phones -------------------------
import { chipText, captionContent } from '../src/game/layout.js';
import { SELECT_FRAME, stepForStation } from '../src/game/tour.js';
import { TOUR_STEP_MS } from '../src/game/tour.js';
import { iso, stationOutline } from '../src/game/scene.js';
import { packageAt } from '../src/game/pipeline.js';

const mainSrc = readFileSync(new URL('../src/game/main.jsx', import.meta.url), 'utf8');

test('AC-1: phones get the caption in the dock and a floor box of at least 40% of the height', () => {
  for (const [w, h] of [[375, 667], [320, 568]]) {
    for (const item of ITEMS) {
      const l = screenLayout(item, w, h);
      assert.equal(l.captionInDock, true);
      assert.ok(l.scene.height >= 0.4 * h, `${w}x${h}: ${l.scene.height}`);
      assert.ok(l.scene.top >= HUD_HEIGHT);
      assert.ok(l.scene.top + l.scene.height <= h * (1 - BOTTOM_PANEL) - MARGIN + 1e-9);
    }
  }
});

// The wide formula as it was before job 017.
function wideReference(item, width, height) {
  const unit = Math.min(1.25, Math.max(0.75, Math.min(width, height) / 720));
  const captionTop = HUD_HEIGHT + PANEL_GAP + TOP_PANEL * height + 8;
  const captionWidth = Math.min(width - 2 * MARGIN, 760 * unit);
  const cap = (u) => Math.max(12, 14 * u);
  const chips = (item.actors ?? item.agents).length;
  const perRow = Math.max(1, Math.floor(captionWidth / (260 * unit)));
  const rows = chips === 0 ? 0.6 : Math.ceil(chips / perRow);
  const perLine = Math.max(1, Math.floor((captionWidth - 32 * unit) / (cap(unit) * 0.6)));
  const lines = (text) => (text ? Math.ceil(text.length / perLine) : 0);
  const textLines = lines(item.text) + lines(item.condition ? `Condición: ${item.condition}` : '');
  const top = captionTop + (58 + rows * 42) * unit + textLines * cap(unit) * 1.35 + 8;
  return { unit, captionTop, captionWidth, scene: { left: MARGIN, top, width: Math.max(1, width - 2 * MARGIN), height: Math.max(1, height - MARGIN - top) } };
}

test('AC-2: wide layouts keep the caption on the floor and their numbers', () => {
  for (const [w, h] of [[1024, 640], [1280, 720], [1280, 800], [1440, 900], [1920, 1080]]) {
    for (const item of ITEMS) {
      const l = screenLayout(item, w, h);
      const ref = wideReference(item, w, h);
      assert.equal(l.captionInDock, false);
      assert.equal(l.unit, ref.unit);
      assert.equal(l.captionTop, ref.captionTop);
      assert.equal(l.captionWidth, ref.captionWidth);
      assert.deepEqual(l.scene, ref.scene);
    }
  }
});

test('AC-3: captionContent describes what a caption shows', () => {
  for (const item of ITEMS) {
    const c = captionContent(item);
    if (item.actors) {
      assert.equal(c.text, item.text);
      assert.equal(c.file, item.file);
      assert.equal(c.condition, item.condition ?? null);
      assert.deepEqual(c.chips, item.actors);
    } else {
      assert.equal(c.text, null);
      assert.equal(c.condition, null);
      assert.equal(c.file, item.output);
      assert.deepEqual(c.chips, item.agents.map((a) => ({ name: a.name, model: a.routing ?? a.model })));
    }
  }
});

test('AC-4: the sources wire the dock caption and hide it on wide screens', () => {
  assert.match(loop, /!layout\.captionInDock/);
  assert.match(mainSrc, /function DockCaption/);
  assert.match(mainSrc, /captionContent/);
  assert.match(mainSrc, /game__caption/);
  const tour = mainSrc.slice(mainSrc.indexOf('function TourScreen'));
  const stage = mainSrc.slice(mainSrc.indexOf('function StageScreen'), mainSrc.indexOf('function TourScreen'));
  assert.match(tour, /<DockCaption item=\{step\}/);
  assert.match(stage, /<DockCaption item=\{stage\}/);
  const wide = block(css, css.indexOf('@media (min-width: 64rem)'));
  assert.match(wide, /\.game-page \.game__caption\s*\{[^}]*display:\s*none/);
  assert.ok(bundle.includes('game__caption'));
});

test('AC-5: a selected station is inside the camera window', () => {
  for (const [w, h] of [[375, 667], [320, 568], [1280, 720]]) {
    for (let i = 0; i < STAGES.length; i++) {
      const s = stepForStation(i);
      const layout = screenLayout(TOUR_STEPS[s], w, h);
      for (const ms of [(SELECT_FRAME * 1000) / 30, TOUR_STEP_MS - 1000 / 30]) {
        const pkg = packageAt(s, ms).position;
        const v = floorView(layout.scene, iso(pkg.map((n) => n + FLOOR.packageSize / 2)));
        const pts = stationOutline(i);
        const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        assert.ok(cx >= v.x && cx <= v.x + v.width && cy >= v.y && cy <= v.y + v.height, `station ${i} at ${w}x${h}, ${ms} ms`);
      }
    }
  }
});

test('AC-6: chip text is never under 12 px', () => {
  assert.equal(chipText(0.75), 12);
  for (let u = 0.75; u <= 1.25; u += 0.05) assert.ok(chipText(u) >= 12);
  assert.match(loop, /fontSize: chipText\(unit\)/);
  assert.doesNotMatch(loop, /fontSize: 15 \* unit/);
  const rule = block(css, css.indexOf('.game__caption {'));
  const size = /font-size:\s*([\d.]+)rem/.exec(rule);
  assert.ok(size && Number(size[1]) >= 0.75);
});

test('AC-7: station hits are clipped to the floor box', () => {
  assert.match(block(css, css.indexOf('.iso-hits {')), /overflow:\s*hidden/);
  for (const attr of ['tabIndex={0}', 'role="button"', 'onClick', 'onKeyDown']) assert.ok(loop.includes(attr));
});

test('AC-4: the dock caption avatar renders outside the Remotion Player', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { StaticOctopus } = await import('../src/game/StaticOctopus.js');
  const html = renderToStaticMarkup(createElement(StaticOctopus, { name: 'builder', size: 24 }));
  assert.match(html, /<svg[^>]*class="octo"/);
  assert.equal(renderToStaticMarkup(createElement(StaticOctopus, { name: 'nobody' })), '');
  const dock = mainSrc.slice(mainSrc.indexOf('function DockCaption'));
  const body = dock.slice(0, dock.indexOf('\n}\n'));
  assert.match(body, /StaticOctopus/);
  assert.doesNotMatch(body, /<Octopus/);
});
