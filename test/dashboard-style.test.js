import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { STAGE_COLUMNS, laneTone } from '../factory/activity.js';

const html = await readFile(new URL('../factory/dashboard.html', import.meta.url), 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const fnBody = (name) => script.match(new RegExp(`function ${name}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
const rule = (selector) =>
  css.match(new RegExp(`(?:^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1];
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

test('AC-1: laneTone groups every stage into a fixed tone and falls back to pending', () => {
  const expected = {
    intake: 'pending', 'needs-info': 'pending',
    spec: 'active', build: 'active', gate: 'active',
    review: 'review', approve: 'review', merging: 'review', 'awaiting-merge': 'review',
    merged: 'done', 'needs-human': 'parked', rejected: 'muted',
  };
  for (const [stage] of STAGE_COLUMNS) assert.equal(laneTone(stage), expected[stage], stage);
  for (const v of ['shipping-to-mars', '<img src=x onerror=alert(1)>', null, undefined, 42]) {
    assert.equal(laneTone(v), 'pending');
  }
});

test('AC-2: navy theme variables, no prefers-color-scheme, accent per tone', () => {
  const root = rule(':root');
  const bg = root.match(/--bg:\s*(#[0-9a-f]{6})/i)[1];
  const lo = rgb('#0b1220'), hi = rgb('#111a2e'), v = rgb(bg);
  v.forEach((c, i) => assert.ok(c >= lo[i] && c <= hi[i], `--bg channel ${i}`));
  assert.match(root, /--muted:\s*#94a3b8/i);
  assert.doesNotMatch(html, /prefers-color-scheme/);
  const accents = { active: '#1e6bff', review: '#8b5cf6', done: '#22c55e', parked: '#f87171' };
  for (const [tone, color] of Object.entries(accents)) {
    assert.match(rule(`.col.tone-${tone}`) ?? '', new RegExp(`--accent:\\s*${color}`, 'i'), tone);
  }
  for (const tone of ['pending', 'muted']) assert.match(rule(`.col.tone-${tone}`) ?? '', /--accent:/, tone);
});

test('AC-3: column and card shapes plus dot, count and done-check rules', () => {
  const col = rule('.col');
  const radius = Number(col.match(/border-radius:\s*(\d+)px/)[1]);
  assert.ok(radius >= 14 && radius <= 16);
  assert.match(col, /border:\s*1px/);
  assert.match(rule('.card'), /border-radius:\s*12px/);
  for (const s of ['.dot', '.count', '.done-check']) assert.ok(rule(s) || css.includes(`${s}`), s);
  assert.ok(rule('.count'));
  assert.ok(rule('.done-check'));
});

test('AC-4: render() uses laneTone and the new header markup', () => {
  assert.match(script, /import\s*\{[^}]*\blaneTone\b[^}]*\}\s*from\s*['"]\.\/activity\.js['"]/);
  const body = fnBody('render');
  assert.match(body, /tone-\$\{laneTone\(key\)\}/);
  assert.match(body, /class="dot" aria-hidden="true"/);
  assert.match(body, /class="lane-title"/);
  assert.match(body, /class="count">\$\{list\.length\}/);
  assert.match(body, /STAGE_COLUMNS/);
  assert.match(body, /known\.has\(j\.stage\) \? j\.stage : 'intake'/);
});

test('AC-5: card() keeps its content and only checks merged cards', () => {
  const body = fnBody('card');
  for (const s of ['linksHtml(', 'agentsHtml(job)', 'roundChipsHtml(', 'costTimeHtml(job)', 'esc(job.note)', 'ago(job.updated)',
    'T.hintNeedsHumanPr', 'T.hintNeedsHumanNoPr', 'T.hintAwaitingMerge', 'T.hintNeedsInfo', '/factory rework']) {
    assert.ok(body.includes(s), s);
  }
  assert.match(body, /job\.stage === 'merged'[^\n]*done-check[^\n]*aria-hidden="true"/);
  assert.equal(body.match(/done-check/g).length, 1);
});

test('AC-6: no reference sample content leaks into card() or render()', () => {
  for (const name of ['card', 'render']) {
    const body = fnBody(name);
    for (const bad of ['%', 'P1', 'P2', 'P3', 'T-0', '⋯', '<progress']) assert.ok(!body.includes(bad), `${name} has ${bad}`);
    assert.doesNotMatch(body, /class="[^"]*\b(priority|progress)\b/);
    assert.doesNotMatch(body, />\s*\+\s*</);
  }
});

test('AC-7: responsive, scroll, focus and i18n are intact', () => {
  assert.match(css, /@media \(max-width: 640px\)\s*\{[^@]*\.board\s*\{[^}]*flex-direction:\s*column/);
  assert.ok(rule('.col.quiet'));
  assert.match(rule('.board'), /overflow-x:\s*auto/);
  assert.match(rule('.card .open:focus-visible'), /outline/);
  const i18n = JSON.parse(html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)[1]);
  const keys = Object.keys(i18n.en).sort();
  assert.deepEqual(keys, ['columns', 'demoLink', 'emptyBoard', 'hintAwaitingMerge', 'hintNeedsHumanNoPr',
    'hintNeedsHumanPr', 'hintNeedsInfo', 'notWritten', 'parkedHuman', 'parkedInfo']);
  for (const l of ['es', 'pt']) assert.deepEqual(Object.keys(i18n[l]).sort(), keys);
});
