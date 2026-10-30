import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../factory/dashboard.html', import.meta.url), 'utf8');
const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const header = html.match(/<header class="top">([\s\S]*?)<\/header>/)[1];

test('guide is reachable from an accessible header action', () => {
  assert.match(header, /<button[^>]+id="guide-toggle"[^>]+aria-label="[^"]+"[\s\S]*?<svg[\s\S]*?<\/svg>[\s\S]*?<\/button>/);
  assert.match(html, /<aside class="guide" id="guide"[^>]*aria-hidden="true"/);
  assert.match(html, /id="guide-title"/);
  assert.match(html, /id="guide-content"/);
});

test('guide explains pipeline, agent roles, commands and waiting states', () => {
  for (const text of ['guide-pipeline', 'guide-agents', 'guide-commands', 'guide-states']) {
    assert.match(html, new RegExp(`id="${text}"`), text);
  }
  for (const text of ['Intake', 'Spec', 'Build', 'Gate', 'Review', 'Approve', 'Merge', '$factory run', '/factory run']) {
    assert.match(html, new RegExp(text.replace(/[/$]/g, '\\$&')), text);
  }
});

test('guide uses the dashboard theme and opens through the existing drawer controls', () => {
  assert.match(css, /\.guide\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.guide\.open\s*\{[^}]*transform:\s*none/);
  assert.match(script, /function openGuide\(/);
  assert.match(script, /function closeGuide\(/);
  assert.match(script, /\$\('guide-toggle'\)\.addEventListener\('click'/);
  assert.match(script, /document\.addEventListener\('keydown',[\s\S]*e\.key !== 'Escape'/);
});

test('guide creates visual hierarchy instead of a single flat surface', () => {
  assert.match(css, /\.guide-content\s*\{[^}]*background:\s*var\(--bg\)/);
  assert.match(css, /\.guide-section\s*\{[^}]*background:\s*var\(--panel\)/);
  assert.match(css, /\.guide-section p\s*\{[^}]*line-height:\s*1\.5/);
  assert.match(css, /\.guide-step span\s*\{[^}]*color:\s*color-mix/);
  assert.match(css, /\.guide-agent\s*\{[^}]*border-left:\s*3px/);
});

test('guide keeps one restrained accent so colors do not compete with the text', () => {
  assert.doesNotMatch(css, /--step-accent|--agent-accent/);
  assert.match(css, /\.guide-step b\s*\{[^}]*color:\s*var\(--ink\)/);
  assert.match(css, /\.guide-agent b\s*\{[^}]*color:\s*var\(--ink\)/);
});
