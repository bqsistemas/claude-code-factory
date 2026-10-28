import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FLOOR, FLOOR_VIEWBOX, iso, stationOutline } from '../src/game/scene.js';
import { STAGES } from '../src/game/engine.js';
import { TOUR_STEPS } from '../src/game/scenarios.js';
import { packageAt } from '../src/game/pipeline.js';
import { SELECT_FRAME, TOUR_STEP_MS, stepForStation } from '../src/game/tour.js';
import { BOTTOM_PANEL, HUD_HEIGHT, MARGIN, MIN_LABEL_PX, MIN_TEXT, TEXT_SHARE, WIDE, captionContent, floorView, screenLayout, splitColumns } from '../src/game/layout.js';

const ITEMS = [...STAGES, ...TOUR_STEPS];
const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
const loop = readFileSync(new URL('../src/game/FactoryLoop.jsx', import.meta.url), 'utf8');
const mainSrc = readFileSync(new URL('../src/game/main.jsx', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('../public/game.js', import.meta.url), 'utf8');

const WIDE_SIZES = [[1024, 640], [1280, 720], [1280, 800], [1440, 900], [1920, 1080]];
const PHONES = [[375, 667], [320, 568]];
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
// The right column's size in px: the viewport minus the text column and the HUD.
const rightColumn = (w, h) => ({ width: splitColumns(w).scene, height: h - HUD_HEIGHT });

test('job 019: wide screens split into a text column and a scene column with no gap', () => {
  assert.equal(WIDE, 1024);
  for (const [w] of WIDE_SIZES) {
    const { text, scene } = splitColumns(w);
    assert.equal(text + scene, w, `${w}: the columns add up to the viewport, so there is no gap`);
    assert.ok(text >= MIN_TEXT, `${w}: the text column is at least 20rem`);
    assert.ok(Math.abs(text - Math.max(MIN_TEXT, TEXT_SHARE * w)) <= 1, `${w}: the text column is ${TEXT_SHARE * 100}% of the width`);
    assert.ok(scene > text, `${w}: the scene column is the larger one`);
    assert.ok(text / w <= 0.4 && (text / w >= 0.27 || text === MIN_TEXT), `${w}: the text column is roughly 30-38%`);
  }
  assert.equal(splitColumns(1440).text, Math.round(0.34 * 1440));
});

test('job 019: the wide CSS is two columns that fill the height, text left and scene right', () => {
  const panel = rule(wideBlock, CARD);
  assert.match(panel, /display:\s*grid/);
  assert.match(panel, new RegExp(`grid-template-columns:\\s*minmax\\(20rem,\\s*${TEXT_SHARE * 100}%\\)\\s+minmax\\(0,\\s*1fr\\)`));
  assert.match(panel, /max-height:\s*none/);
  assert.doesNotMatch(panel, /gap/, 'no gap between the columns');
  const scene = rule(wideBlock, '.game-page .game__scene');
  assert.match(scene, /position:\s*relative/);
  assert.match(scene, /grid-area:\s*scene/);
  const stage = rule(wideBlock, '.game-page .game__stage');
  assert.match(stage, /grid-area:\s*text/);
  assert.match(css, /\.game-page \.game__stage \{[^}]*overflow-y:\s*auto/, 'the text column scrolls on its own');
  assert.doesNotMatch(wideBlock, /\.game__caption\s*\{[^}]*display:\s*none/, 'the caption shows on wide screens');
  assert.ok(!css.includes('width: min(32rem, 40vw)'));
});

test('job 019: wide, the composition is the whole right column and the plant is centred in it', () => {
  for (const item of ITEMS) {
    for (const [w, h] of WIDE_SIZES) {
      const column = rightColumn(w, h);
      const { scene } = screenLayout(column.width, column.height, true);
      assert.deepEqual(scene, { left: 0, top: 0, width: column.width, height: column.height }, `${w}x${h}: the floor box is the column`);
      const full = FLOOR_VIEWBOX;
      const view = floorView(scene, iso(item.path ? NODES_POINT(item) : [0, 0, 0]));
      if (view.width >= full.width - 1e-9 && view.height >= full.height - 1e-9) {
        assert.ok(Math.abs(view.x + view.width / 2 - (full.x + full.width / 2)) < 1e-9, `${w}x${h}: centred in x`);
        assert.ok(Math.abs(view.y + view.height / 2 - (full.y + full.height / 2)) < 1e-9, `${w}x${h}: centred in y`);
      }
    }
  }
});

function NODES_POINT(step) {
  return packageAt(TOUR_STEPS.indexOf(step), 0).position;
}

test('job 019: the whole plant is visible, labels at least 10 px, on 1280x800 and wider', () => {
  const full = FLOOR_VIEWBOX;
  for (const [w, h] of WIDE_SIZES.filter(([ww]) => ww >= 1280)) {
    const column = rightColumn(w, h);
    const view = floorView({ width: column.width, height: column.height }, [full.x, full.y]);
    assert.ok(view.width >= full.width - 1e-9 && view.height >= full.height - 1e-9, `${w}x${h}: the view holds the whole plant`);
    assert.ok(view.scale * FLOOR.labelSize >= MIN_LABEL_PX, `${w}x${h}: label ${view.scale * FLOOR.labelSize}px`);
  }
});

test('AC-1: phones get the caption in the dock and a floor box of at least 40% of the height', () => {
  for (const [w, h] of PHONES) {
    const l = screenLayout(w, h);
    assert.equal(l.captionInDock, true);
    assert.equal(l.scene.left, MARGIN);
    assert.equal(l.scene.width, w - 2 * MARGIN);
    assert.ok(l.scene.height >= 0.4 * h, `${w}x${h}: ${l.scene.height}`);
    assert.ok(l.scene.top >= HUD_HEIGHT);
    assert.ok(l.scene.top + l.scene.height <= h * (1 - BOTTOM_PANEL) - MARGIN + 1e-9);
  }
});

test('AC-5: the narrow dock and small-viewport fallback are intact', () => {
  const base = block(css, css.indexOf(`${CARD} {`));
  assert.match(base, new RegExp(`max-height:\\s*min\\(100%,\\s*${BOTTOM_PANEL * 100}dvh\\)`));
  const fallback = block(css, css.indexOf('@media (max-width: 40rem), (max-height: 30rem) {'));
  assert.match(rule(fallback, CARD), /max-height:\s*none/);
});

test('AC-6: FactoryLoop imports screenLayout, draws no caption and the bundle has no right-dock code', () => {
  assert.match(loop, /import \{[^}]*\bscreenLayout\b[^}]*\} from '\.\/layout\.js';/);
  assert.match(loop, /split = false/);
  assert.ok(!loop.includes('function Caption') && !loop.includes('captionTop'));
  assert.ok(!loop.includes('panelWidth'));
  assert.ok(!bundle.includes('panelWidth'));
});

test('AC-7: floorView keeps floor labels at least 10 px and inside the plant frame', () => {
  const full = FLOOR_VIEWBOX;
  const boxes = [...WIDE_SIZES.map(([w, h]) => rightColumn(w, h)), ...PHONES.map(([w, h]) => screenLayout(w, h).scene)];
  for (const box of boxes) {
    for (const focus of [[full.x, full.y], [full.x + full.width / 2, full.y + full.height / 2], [full.x + full.width, full.y + full.height]]) {
      const view = floorView(box, focus);
      assert.ok(view.scale * FLOOR.labelSize >= MIN_LABEL_PX - 1e-9, `${box.width}x${box.height} label ${view.scale * FLOOR.labelSize}px`);
      assert.ok(Math.abs(view.width / view.height - box.width / box.height) < 1e-9, 'same aspect as the box');
      if (view.width <= full.width) assert.ok(view.x >= full.x - 1e-9 && view.x + view.width <= full.x + full.width + 1e-9, 'inside in x');
      if (view.height <= full.height) assert.ok(view.y >= full.y - 1e-9 && view.y + view.height <= full.y + full.height + 1e-9, 'inside in y');
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

test('AC-4: the sources wire the one HTML caption into both screens', () => {
  assert.match(mainSrc, /function DockCaption/);
  assert.match(mainSrc, /captionContent/);
  assert.match(mainSrc, /game__caption/);
  const tour = mainSrc.slice(mainSrc.indexOf('function TourScreen'));
  const stage = mainSrc.slice(mainSrc.indexOf('function StageScreen'), mainSrc.indexOf('function TourScreen'));
  assert.match(tour, /<DockCaption item=\{step\}/);
  assert.match(stage, /<DockCaption item=\{stage\}/);
  assert.ok(bundle.includes('game__caption'));
  // The Player's size comes from the measured scene element, not from the viewport alone.
  assert.match(mainSrc, /ResizeObserver/);
  assert.match(mainSrc, /ref=\{sceneRef\}|ref=\{ref\}/);
});

test('AC-5: a selected station is inside the camera window', () => {
  for (const [w, h] of [...PHONES, [1280, 720]]) {
    for (let i = 0; i < STAGES.length; i++) {
      const s = stepForStation(i);
      const box = w >= WIDE ? rightColumn(w, h) : screenLayout(w, h).scene;
      for (const ms of [(SELECT_FRAME * 1000) / 30, TOUR_STEP_MS - 1000 / 30]) {
        const pkg = packageAt(s, ms).position;
        const v = floorView(box, iso(pkg.map((n) => n + FLOOR.packageSize / 2)));
        const pts = stationOutline(i);
        const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        assert.ok(cx >= v.x && cx <= v.x + v.width && cy >= v.y && cy <= v.y + v.height, `station ${i} at ${w}x${h}, ${ms} ms`);
      }
    }
  }
});

test('AC-7: station hits are clipped to the floor box and keyboard operable', () => {
  assert.match(block(css, css.indexOf('.iso-hits {')), /overflow:\s*hidden/);
  for (const attr of ['tabIndex={0}', 'role="button"', 'onClick', 'onKeyDown']) assert.ok(loop.includes(attr));
});

test('job 019: the tour controls are small accessible icon buttons in one row', () => {
  const tour = mainSrc.slice(mainSrc.indexOf('function TourScreen'));
  assert.match(tour, /className="game__controls"/);
  for (const label of ['Pausar', 'Reanudar', 'Silenciar', 'Activar sonido', 'Salir del loop']) assert.ok(tour.includes(label), label);
  const icon = mainSrc.slice(mainSrc.indexOf('function IconButton'));
  assert.match(icon, /aria-label=\{label\}/);
  assert.match(icon, /title=\{label\}/);
  assert.match(icon, /aria-pressed=\{pressed\}/);
  const size = rule(css, '.game__icon-button');
  assert.match(size, /width:\s*2\.25rem/);
  assert.match(size, /height:\s*2\.25rem/);
  assert.match(rule(css, '.game__icon-button:focus-visible'), /outline:\s*3px solid/);
  assert.match(rule(css, '.game__icon-button:hover,\n.game__icon-button[aria-pressed=\'true\']:hover'), /var\(--iso-accent\)/);
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
  assert.ok(body.includes('key={`${chip.name}-${i}`}'));
});
