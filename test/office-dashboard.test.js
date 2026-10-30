import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const html = await readFile(new URL('../factory/dashboard.html', import.meta.url), 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const at = (needle) => { const i = html.indexOf(needle); assert.ok(i >= 0, `missing ${needle}`); return i; };

test('AC-7: markup order, CSS, script rules and i18n keys', () => {
  assert.match(script, /from '\.\/office\.js'/);
  const order = ['<header class="top">', 'id="stat-jobs"', 'id="stat-running"', 'id="stat-agents"', 'id="stat-cost"', '</header>',
    'id="office"', '<canvas id="office-canvas" aria-hidden="true">', 'id="office-live"', 'id="pipeline"', '<h2>Pipeline</h2>',
    '<main class="board" id="board">'].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.match(html.match(/id="office-live"[^>]*>/)[0], /aria-live/);
  const pipeline = html.slice(at('id="pipeline"'), at('<main class="board"'));
  assert.ok(!pipeline.includes('<canvas'));
  assert.match(css, /#office-canvas\s*\{[^}]*image-rendering:\s*pixelated/);
  assert.match(css, /@media \(max-width: 900px\)\s*\{[^@]*\.panels\s*\{[^}]*grid-template-columns:\s*1fr\s*;/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /\.hit/);
  assert.match(script, /openDrawer\(btn\.dataset\.id\)/);
  for (const bad of ['Pause', 'Stop', 'api.github.com']) assert.ok(!html.includes(bad), bad);
  assert.doesNotMatch(script, /https?:\/\//);
  assert.ok(!/font-size:\s*(\d|10)px/.test(css));
  const i18n = JSON.parse(html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)[1]);
  for (const l of ['en', 'es', 'pt']) for (const k of ['statJobs', 'statRunning', 'statAgents', 'statCost']) assert.ok(i18n[l][k], `${l}.${k}`);
});

test('AC-8: the CC0 atlas is vendored and referenced by relative path only', async () => {
  for (const f of ['LICENSE.txt', 'README.txt', 'PixelOfficeAssets.png']) {
    await access(new URL(`../factory/assets/pixel-office/${f}`, import.meta.url));
  }
  const readme = await readFile(new URL('../factory/assets/pixel-office/README.txt', import.meta.url), 'utf8');
  assert.match(readme, /CC0/);
  const refs = html.match(/[\w./-]*PixelOfficeAssets\.png/g);
  assert.ok(refs.length >= 1);
  for (const r of refs) assert.equal(r, 'assets/pixel-office/PixelOfficeAssets.png');
});

test('AC-6: the dashboard draws from layoutOffice instead of the fixed map size', () => {
  assert.match(script, /import \{[^}]*\blayoutOffice\b[^}]*\bremapWalker\b[^}]*\} from '\.\/office\.js'|import \{[^}]*\bremapWalker\b[^}]*\blayoutOffice\b[^}]*\} from '\.\/office\.js'/);
  assert.match(script, /new ResizeObserver\(.*\)\.observe\(\$\('office-stage'\)\)/);
  assert.doesNotMatch(script, /MAP\.(width|height)/);
  assert.match(css, /#office-canvas\s*\{[^}]*image-rendering:\s*pixelated/);
});

test('AC-7: static backdrop is painted offscreen once per key', () => {
  assert.match(script, /import\s*\{[^}]*\bofficeBackdrop\b[^}]*\}\s*from '\.\/office\.js'/);
  assert.match(script, /document\.createElement\('canvas'\)/);
  const start = script.indexOf('function paintBackdrop'), end = script.indexOf('function drawOffice');
  assert.ok(start >= 0 && end > start);
  const paint = script.slice(start, end), draw = script.slice(end);
  const outside = script.slice(0, start) + draw;
  assert.ok(!outside.includes('officeBackdrop(') && !outside.includes('areaTone('));
  assert.ok(paint.includes('officeBackdrop(') && paint.includes('areaTone('));
  assert.ok(draw.slice(0, draw.indexOf('\nfunction ') > 0 ? draw.indexOf('\nfunction ') : undefined).includes('drawImage(backdrop'));
  assert.match(paint, /globalAlpha = 0\.14/);
  assert.match(script, /backdropKey[\s\S]{0,200}|const bkey/);
  const keyLine = script.match(/const bkey = .*/)[0];
  assert.ok(keyLine.includes('layoutKey') && keyLine.includes('data-theme') && keyLine.includes('atlasOk'));
  assert.ok(!script.includes("'sign'"));
});

test('AC-8: the dashboard uses officeLandmarks and paints floors, sky and partitions from the backdrop', () => {
  assert.match(script, /import\s*\{[^}]*\bofficeLandmarks\b[^}]*\}\s*from '\.\/office\.js'/);
  const start = script.indexOf('function paintBackdrop'), end = script.indexOf('function drawOffice');
  const paint = script.slice(start, end), draw = script.slice(end);
  assert.ok(draw.includes('officeLandmarks(layout)'));
  for (const old of ["at('deskLong')", "at('flag')", "at('shelf')", "at('bin')", "at('terminal')"]) assert.ok(!draw.includes(old), old);
  assert.match(paint, /tile\(wl\.sprite, wl\)/);
  assert.match(paint, /'grass'/);
  assert.match(paint, /tile\('partition', p\)/);
  assert.ok(!paint.includes('Math.random'));
  assert.match(paint, /globalAlpha = 0\.14/);
});
