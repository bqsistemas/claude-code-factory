import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ScenarioPicker } from '../src/game/ScenarioPicker.js';
import { SCENARIOS } from '../src/game/scenarios.js';
import { LABELS, FLOOR_VIEWBOX, labelBox, NODES } from '../src/game/scene.js';
import { REPEAT_SUFFIX, ROUTES } from '../src/game/routes.js';

const html = (value) => renderToStaticMarkup(createElement(ScenarioPicker, { value, onChange() {} }));
const unescape = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

test('AC-6: ScenarioPicker renders a fieldset of 11 radios', () => {
  const out = html(null);
  assert.equal(out.match(/<fieldset/g).length, 1);
  assert.match(out, /<legend>Escenario<\/legend>/);
  const radios = out.match(/<input[^>]*>/g);
  assert.equal(radios.length, 11);
  assert.equal(new Set(radios.map((r) => r.match(/name="([^"]*)"/)[1])).size, 1);
  assert.equal(radios.filter((r) => /checked/.test(r)).length, 1);
  assert.match(radios[0], /checked/);
  const text = unescape(out);
  let at = text.indexOf('Ver todos');
  assert.ok(at >= 0);
  assert.ok(text.indexOf('Los 10 escenarios, uno tras otro', at) > at);
  for (const s of SCENARIOS) {
    const t = text.indexOf(s.title, at);
    assert.ok(t >= at, s.title);
    const h = text.indexOf(s.hint, t);
    assert.ok(h >= t, s.hint);
    at = h;
  }
  const g = html('gate-fail').match(/<input[^>]*>/g);
  assert.equal(g.filter((r) => /checked/.test(r)).length, 1);
  assert.match(g[1 + SCENARIOS.findIndex((s) => s.id === 'gate-fail')], /checked/);
  for (const s of SCENARIOS) assert.ok(typeof s.hint === 'string' && s.hint.length > 0 && s.hint.length <= 40, s.id);
  assert.equal(SCENARIOS.find((s) => s.id === 'gate-fail').hint, 'GATE: FAIL → vuelve a Build');
});

test('AC-7: styles and the bundle carry the scenario focus', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const dim = css.match(/\.iso-scene \.iso-dim\s*\{[^}]*opacity:\s*([0-9.]+)/);
  assert.ok(dim && +dim[1] >= 0.15 && +dim[1] <= 0.2);
  for (const sel of ['.iso-trail', '.iso-preview', '.game__picker']) assert.ok(css.includes(sel), sel);
  const js = unescape(readFileSync(new URL('../public/game.js', import.meta.url), 'utf8')).replace(/\\(?:u00d7|xd7)/gi, '×');
  for (const s of ['Ver todos', 'Escenario', 'iso-dim', 'iso-trail', 'iso-preview', '×2']) assert.ok(js.includes(s), s);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {});
});

test('AC-8: repeat labels fit without overlapping and stay in the viewBox', () => {
  const repeats = new Set(Object.values(ROUTES).flatMap((r) => r.segments.filter((s) => s.returns).map((s) => s.to)));
  assert.deepEqual([...repeats].sort(), ['build', 'intake']);
  const boxes = LABELS.map((l) => ({ id: l.id, box: labelBox(repeats.has(l.id) ? { ...l, text: l.text + REPEAT_SUFFIX } : l) }));
  for (const { id, box } of boxes) {
    if (!repeats.has(id)) continue;
    assert.ok(box.x0 >= FLOOR_VIEWBOX.x && box.x1 <= FLOOR_VIEWBOX.x + FLOOR_VIEWBOX.width, `${id} x in viewBox`);
    assert.ok(box.y0 >= FLOOR_VIEWBOX.y && box.y1 <= FLOOR_VIEWBOX.y + FLOOR_VIEWBOX.height, `${id} y in viewBox`);
    for (const o of boxes) {
      if (o.id === id) continue;
      const hit = box.x0 < o.box.x1 && o.box.x0 < box.x1 && box.y0 < o.box.y1 && o.box.y0 < box.y1;
      assert.ok(!hit, `${id} overlaps ${o.id}`);
    }
  }
  assert.ok(NODES.build && NODES.intake);
});
