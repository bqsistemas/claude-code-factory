import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../factory/dashboard.html', import.meta.url), 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const i18n = JSON.parse(html.match(/<script type="application\/json" id="i18n">([\s\S]*?)<\/script>/)[1]);
const header = html.match(/<header class="top">([\s\S]*?)<\/header>/)[1];

const media = [];
const top = css.replace(/@media[^{]*\{((?:[^{}]*\{[^}]*\})*[^{}]*)\}/g, (m, inner) => { media.push({ head: m.slice(0, m.indexOf('{')), inner }); return ''; });
const mobile = media.find((m) => /max-width:\s*640px/.test(m.head)).inner;
const decls = (src, selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...src.matchAll(new RegExp(`(?:^|[}\\s,])${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';');
};
const rule = (s) => decls(top, s);
const mrule = (s) => decls(mobile, s);
const px = (decl, prop) => { const m = decl.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([\\d.]+)px`)); return m ? Number(m[1]) : null; };
const radius = (s) => px(rule(s), 'border-radius');
const sumPadV = (decl) => {
  const m = decl.match(/(?:^|[;\s])padding:\s*([^;]+)/);
  const p = m[1].trim().split(/\s+/).map((v) => parseFloat(v));
  return p.length === 1 ? p[0] * 2 : p[0] + (p.length === 3 ? p[2] : p[2] ?? p[0]);
};

test('AC-1: brand block follows the h1 with an inline icon and a fixed subtitle', () => {
  assert.ok(header.trimStart().startsWith('<h1>AI Software Factory</h1>'));
  assert.match(header, /<h1>AI Software Factory<\/h1>\s*<span class="brand-icon" aria-hidden="true"><svg[\s\S]*?<\/svg><\/span>/);
  assert.match(header, /<p class="brand-sub">AI Agents · GitHub Issues → Production Ready PRs<\/p>/);
  for (const bad of [/<img/, /<link/, /\sstyle=/, /\ssrc=/, /http/]) assert.doesNotMatch(header, bad);
});

test('AC-2: stat cards have icons, text order and card styling', () => {
  const stats = header.match(/<span class="stats">([\s\S]*?)<\/span>\s*<span class="top-end">/)[1];
  let last = -1;
  for (const k of ['jobs', 'running', 'agents', 'cost']) {
    assert.equal(stats.split(`id="stat-${k}"`).length, 2, k);
    const re = new RegExp(`id="stat-${k}"[^>]*><span class="ico ico-${k}" aria-hidden="true"><svg[\\s\\S]*?</svg></span><span class="txt"><span class="v">[^<]*</span><span class="l"></span></span>`);
    assert.match(stats, re, k);
    const at = stats.indexOf(`id="stat-${k}"`);
    assert.ok(at > last); last = at;
  }
  const stat = rule('.stat');
  assert.match(stat, /background:\s*var\(--panel\)/);
  assert.match(stat, /border:\s*1px solid var\(--line\)/);
  assert.ok(radius('.stat') >= 8 && radius('.stat') <= 12);
  assert.match(rule('.stat .txt'), /flex-direction:\s*column/);
  const colors = { jobs: '--ink', running: '--pass', agents: '--active', cost: '--changes' };
  for (const [k, v] of Object.entries(colors)) assert.match(rule(`.ico-${k}`), new RegExp(`color:\\s*var\\(${v}\\)`), k);
});

test('AC-3: top-end group order and matching styles', () => {
  const end = header.match(/<span class="top-end">([\s\S]*?)<\/span>\s*<\/header>|<span class="top-end">([\s\S]*)$/);
  const body = end[1] ?? end[2];
  const order = ['id="status"', 'id="theme-toggle"', 'id="theme-icon"', 'id="demo"', 'id="parked"'].map((s) => body.indexOf(s));
  assert.ok(order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), String(order));
  assert.match(body, /id="demo" hidden/);
  assert.match(body, /id="parked" href="#col-needs-human" hidden/);
  const r = radius('.stat');
  for (const s of ['.theme-toggle', '.tag', '.parked']) {
    const d = rule(s);
    assert.equal(radius(s), r, s);
    assert.match(d, /background:\s*var\(--panel\)/, s);
    assert.match(d, /border:\s*1px solid/, s);
    assert.ok(px(d, 'height') <= 32, s);
  }
});

test('AC-4: statLive i18n and status dot colors', () => {
  const keys = Object.keys(i18n.en).sort();
  for (const l of ['en', 'es', 'pt']) {
    assert.match(i18n[l].statusLive, /\{ago\}/, l);
    assert.deepEqual(Object.keys(i18n[l]).sort(), keys, l);
  }
  assert.equal(i18n.es.statusLive, 'En vivo · actualizado {ago}');
  assert.match(script, /T\.statusLive\.replace\('\{ago\}'/);
  assert.doesNotMatch(script, /live · updated/);
  assert.match(decls(top, '.status::before'), /background:\s*var\(--pass\)/);
  assert.match(decls(top, '.status.off::before'), /background:\s*var\(--alert\)/);
});

test('AC-5: desktop height budget', () => {
  const t = rule('.top');
  assert.match(t, /display:\s*grid/);
  const rows = t.match(/grid-template-rows:\s*([^;]+)/)[1].trim().split(/\s+/).map((v) => parseFloat(v));
  assert.ok(rows.every(Number.isFinite));
  assert.ok(rows.reduce((a, b) => a + b, 0) <= 32);
  assert.ok(sumPadV(t) <= 8);
  for (const s of ['.stat', '.theme-toggle', '.tag', '.parked', '.brand-icon']) assert.ok(px(rule(s), 'height') <= 32, s);
  assert.ok(px(rule('.top h1'), 'line-height') + px(rule('.brand-sub'), 'line-height') <= 32);
  assert.match(rule('.stats'), /flex-wrap:\s*nowrap/);
});

test('AC-6: mobile header stays compact', () => {
  const t = mrule('.top');
  assert.match(t, /display:\s*flex/);
  assert.match(t, /flex-wrap:\s*wrap/);
  assert.ok((px(t, 'row-gap') ?? px(t, 'gap')) <= 12);
  assert.ok(sumPadV(t) <= 12);
  assert.match(mrule('.brand-sub'), /display:\s*none/);
  assert.match(mrule('.stat .ico'), /display:\s*none/);
  assert.ok(px(mrule('.stat'), 'height') <= 24);
  assert.match(mrule('.stats'), /flex-wrap:\s*wrap/);
});

test('AC-7: header rules use no literal hex colors', () => {
  const sel = /^\s*(\.top\b|\.brand-|\.stat|\.ico|\.top-end|\.status|\.theme-toggle|\.tag|\.parked)[^{]*\{([^}]*)\}/gm;
  let n = 0;
  for (const src of [top, mobile]) for (const m of src.matchAll(sel)) { n++; assert.doesNotMatch(m[2], /#[0-9a-fA-F]{3,8}\b/, m[1]); }
  assert.ok(n > 10);
});
