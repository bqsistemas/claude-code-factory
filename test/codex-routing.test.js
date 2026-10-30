// Provider routing contract: Claude remains the default and Codex receives real model IDs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { providerConfig, route, stageModels } from '../factory/lib/route.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(join(repo, 'factory/config.json'), 'utf8'));

test('Codex routing resolves provider-specific models without changing Claude defaults', () => {
  assert.deepEqual(route(config, { risk: 'low', surfaces: [] }), {
    builder: 'sonnet', reviewers: { code: 'haiku' },
  });
  assert.deepEqual(route(config, { risk: 'medium', surfaces: ['ui'] }, 'codex'), {
    builder: 'gpt-6-luna',
    reviewers: { code: 'gpt-6-luna', ux: 'gpt-6-luna', ui: 'gpt-6-luna' },
  });
  assert.deepEqual(route(config, { risk: 'high', surfaces: ['security', 'ui'] }, 'codex'), {
    builder: 'gpt-6.1-sol',
    reviewers: {
      code: 'gpt-6.1-sol', ux: 'gpt-6-luna', ui: 'gpt-6-luna', security: 'gpt-6.1-sol',
    },
  });
  assert.deepEqual(stageModels(config, 'codex'), {
    intake: 'gpt-6-luna', 'spec-writer': 'gpt-6-luna', approver: 'gpt-6.1-sol',
  });
  assert.equal(providerConfig(config, 'claude').provider, 'claude');
  assert.throws(() => route(config, { risk: 'low', surfaces: [] }, 'missing'), /unknown provider/);
});

test('job new persists the selected provider for Codex before intake routing', () => {
  const root = mkdtempSync(join(tmpdir(), 'factory-codex-provider-'));
  mkdirSync(join(root, 'factory/jobs'), { recursive: true });
  writeFileSync(join(root, 'factory/config.json'), JSON.stringify(config));
  const gh = join(root, 'fake-gh');
  writeFileSync(gh, '#!/bin/sh\nprintf \'%s\\n\' \'{"number":7,"title":"Codex job","body":"Build it","state":"OPEN","author":{"login":"owner"},"labels":[{"name":"factory"}],"comments":[]}\'\n');
  chmodSync(gh, 0o755);

  const result = spawnSync(join(repo, 'factory/bin/job'), ['new', '7', '--provider', 'codex'], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, FACTORY_ROOT: root, FACTORY_GH: gh },
  });
  assert.equal(result.status, 0, result.stderr);
  const id = result.stdout.trim();
  const job = JSON.parse(readFileSync(join(root, 'factory/jobs', id, 'job.json'), 'utf8'));
  assert.equal(job.provider, 'codex');
  assert.deepEqual(job.models, {
    intake: 'gpt-6-luna', 'spec-writer': 'gpt-6-luna', approver: 'gpt-6.1-sol',
  });
});
