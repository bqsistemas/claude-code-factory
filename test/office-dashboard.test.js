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
