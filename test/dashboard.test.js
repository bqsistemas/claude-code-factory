import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

import { AGENTS, activeAgents, agentsHtml } from '../factory/activity.js';

const agentsDir = new URL('../.claude/agents/', import.meta.url);
const dashboardUrl = new URL('../factory/dashboard.html', import.meta.url);

// Reads the frontmatter `name:` of every agent file in .claude/agents/.
async function agentNames() {
  const files = (await readdir(agentsDir)).filter((f) => f.endsWith('.md'));
  const names = [];
  for (const file of files) {
    const text = await readFile(new URL(file, agentsDir), 'utf8');
    const name = text.match(/^---\n[\s\S]*?^name:\s*(.+)$/m)?.[1].trim();
    assert.ok(name, `${file} has a frontmatter name`);
    names.push(name);
  }
  return names;
}

// Counts elements whose class attribute is exactly "agent".
const agentElements = (html) => html.match(/<[a-z]+ class="agent"[^>]*>/g) ?? [];

test('AC-1: spec, build, and approval stages map to one agent each', () => {
  assert.deepEqual(activeAgents({ stage: 'spec' }), ['spec-writer']);
  assert.deepEqual(activeAgents({ stage: 'build' }), ['builder']);
  assert.deepEqual(activeAgents({ stage: 'approval' }), ['approver']);
});

test('AC-2: review stage maps pending lenses to review agents in fixed order', () => {
  const job = {
    stage: 'review',
    reviews: { security: 'PASS', ux: 'pending', ui: 'CHANGES', code: 'pending', human: 'pending' },
  };
  assert.deepEqual(activeAgents(job), ['review-ux', 'review-code']);

  const reordered = { stage: 'review', reviews: { code: 'pending', security: 'pending' } };
  assert.deepEqual(activeAgents(reordered), ['review-security', 'review-code']);
});

test('AC-3: idle, unknown, and malformed jobs have no running agents', () => {
  const jobs = [
    { stage: 'merged' },
    { stage: 'needs-human' },
    { stage: 'shipping-to-mars' },
    {},
    { stage: 'review' },
    { stage: 'review', reviews: null },
    { stage: 'review', reviews: 'pending' },
    { stage: 'review', reviews: ['pending'] },
    { stage: 42 },
    null,
    undefined,
    'build',
  ];
  for (const job of jobs) {
    assert.doesNotThrow(() => activeAgents(job), `activeAgents(${JSON.stringify(job)})`);
    assert.deepEqual(activeAgents(job), [], `activeAgents(${JSON.stringify(job)})`);
    assert.equal(agentsHtml(job), '', `agentsHtml(${JSON.stringify(job)})`);
  }
});

test('AC-4: AGENTS matches .claude/agents/ with distinct, non-empty labels and icons', async () => {
  const fromFiles = (await agentNames()).sort();
  assert.equal(fromFiles.length, 7, 'seven agent files');
  assert.deepEqual(Object.keys(AGENTS).sort(), fromFiles);

  for (const [name, { label, icon }] of Object.entries(AGENTS)) {
    assert.equal(typeof label, 'string', `${name} label is a string`);
    assert.ok(label.trim(), `${name} label is non-empty`);
    assert.equal(typeof icon, 'string', `${name} icon is a string`);
    assert.ok(icon.trim(), `${name} icon is non-empty`);
    assert.doesNotMatch(icon, /https?:|url\(|href|src=/i, `${name} icon has no external reference`);
  }
  const icons = Object.values(AGENTS).map((a) => a.icon);
  assert.equal(new Set(icons).size, 7, 'seven distinct icons');
});

test('AC-5: agentsHtml renders one labelled badge per running agent', () => {
  const job = {
    stage: 'review',
    reviews: { security: 'PASS', ux: 'pending', ui: 'CHANGES', code: 'pending' },
  };
  const html = agentsHtml(job);

  assert.match(html, /class="agents"/);
  assert.match(html, /aria-label="Running agents"/);

  const badges = agentElements(html);
  assert.equal(badges.length, 2, 'exactly two .agent elements');
  assert.match(badges[0], /data-agent="review-ux"/);
  assert.match(badges[1], /data-agent="review-code"/);

  assert.ok(html.includes(AGENTS['review-ux'].label), 'UX label visible');
  assert.ok(html.includes(AGENTS['review-code'].label), 'code label visible');
  assert.equal(html.match(/aria-hidden="true"/g)?.length, 2, 'one hidden icon per agent');

  assert.equal(agentsHtml({ stage: 'merged' }), '');
});

test('AC-6: unknown review keys are ignored and output carries no injected markup', () => {
  const job = {
    stage: 'review',
    reviews: { '<img src=x onerror=alert(1)>': 'pending', ux: 'pending' },
  };
  const html = agentsHtml(job);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /onerror/i);
  assert.equal(agentElements(html).length, 1, 'only the known lens renders');

  const onlyBad = { stage: 'review', reviews: { '<img src=x onerror=alert(1)>': 'pending' } };
  assert.equal(agentsHtml(onlyBad), '');
});

test('AC-7: dashboard loads activity.js as a module and honours reduced motion', async () => {
  const html = await readFile(dashboardUrl, 'utf8');

  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'has a <script type="module">');
  assert.match(script, /import\s*\{[^}]*\bagentsHtml\b[^}]*\}\s*from\s*['"]\.\/activity\.js['"]/);
  assert.match(script, /import\s*\{[^}]*\bactiveAgents\b[^}]*\}\s*from\s*['"]\.\/activity\.js['"]/);

  const cardBody = script.match(/function card\(job\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(cardBody, 'card(job) exists');
  assert.match(cardBody, /agentsHtml\(job\)/, 'card calls agentsHtml(job)');

  const reduced = html.match(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n {2}\}/)?.[1];
  assert.ok(reduced, 'has a prefers-reduced-motion: reduce block');
  assert.match(reduced, /\.agent[^{]*\{[^}]*animation:\s*none/, '.agent animation disabled');
  assert.match(reduced, /\.chip\.pending[^{]*\{[^}]*animation:\s*none/, '.chip.pending animation disabled');
});
