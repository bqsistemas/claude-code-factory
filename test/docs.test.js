import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const agentsDir = new URL('../.claude/agents/', import.meta.url);

async function readAgentNames() {
  const files = (await readdir(agentsDir)).filter((f) => f.endsWith('.md'));
  const names = [];
  for (const file of files) {
    const text = await readFile(new URL(file, agentsDir), 'utf8');
    const name = text.match(/^---\n[\s\S]*?^name:\s*(.+)$/m)?.[1].trim();
    assert.ok(name, `${file} has a name`);
    names.push(name);
  }
  return names;
}

test('AC-8: docs/juego-factory.md has the required sections, every agent, and run commands', async () => {
  const guide = await readFile(new URL('../docs/juego-factory.md', import.meta.url), 'utf8');
  for (const heading of [
    '## Qué es el juego',
    '## Cómo jugar',
    '## Etapas del factory',
    '## Puntuación',
    '## Cómo ejecutarlo',
  ]) {
    assert.match(guide, new RegExp(`^${heading}\\s*$`, 'm'), `heading ${heading}`);
  }

  const names = await readAgentNames();
  assert.equal(names.length, 7, 'seven agents');
  for (const name of names) {
    assert.ok(guide.includes(name), `guide names agent ${name}`);
  }

  for (const text of ['/game', 'npm start', 'npm run build:game']) {
    assert.ok(guide.includes(text), `guide mentions ${text}`);
  }
});
