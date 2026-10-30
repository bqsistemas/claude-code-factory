import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { artifactFiles, branchLink, derivePipeline, githubLinks, isSafeJobId, stageDetails } from '../factory/pipeline-canvas.js';

const html = await readFile(new URL('../factory/dashboard.html', import.meta.url), 'utf8');

test('AC-1: pipeline stages stay ordered and derive progress from the selected job stage', () => {
  const stages = derivePipeline({ stage: 'review', reviews: { code: 'pending' } });
  assert.deepEqual(stages.map(({ key }) => key), ['intake', 'spec', 'build', 'gate', 'review', 'approve', 'merge']);
  assert.deepEqual(stages.map(({ state }) => state), ['complete', 'complete', 'complete', 'complete', 'active', 'pending', 'pending']);
  assert.deepEqual(derivePipeline({ stage: 'merged' }).map(({ state }) => state), Array(7).fill('complete'));
  assert.equal(derivePipeline({ stage: 'needs-human', parked_from: 'build' })[2].state, 'blocked');
  for (const parked_from of ['merging', 'awaiting-merge']) {
    const stages = derivePipeline({ stage: 'needs-human', parked_from });
    assert.deepEqual(stages.map(({ state }) => state), ['complete', 'complete', 'complete', 'complete', 'complete', 'complete', 'blocked']);
  }
});

test('AC-2: accessible job and stage controls update the pipeline selection', () => {
  assert.match(html, /id="pipeline-job"[^>]*aria-label="Select job"/);
  assert.match(html, /id="pipeline-stage"[^>]*aria-label="Select pipeline stage"/);
  assert.match(html, /id="pipeline-canvas"[^>]*aria-label="Pipeline stages"/);
  assert.match(html, /addEventListener\('change'/);
  const selected = stageDetails({ id: 'job-a', stage: 'build' }, 'review');
  assert.equal(selected.key, 'review');
  assert.equal(selected.status, 'Pending');
  assert.ok(html.includes('querySelector(`.pipeline-node[data-stage="${selectedStage}"]`)?.focus()'));
});

test('AC-3: inspector fields expose available context and explicit missing values', () => {
  const job = { issue: 41, stage: 'build', round: 2, cost_usd: 1.25, branch: 'factory/job-a', agents: { builder: 'gpt' }, reviewers: ['code'], note: 'working' };
  const details = stageDetails(job, 'build');
  assert.equal(details.issue, '#41');
  assert.equal(details.round, '2');
  assert.equal(details.cost, '$1.25');
  assert.equal(details.branch, 'factory/job-a');
  const missing = stageDetails({}, 'intake');
  for (const key of ['issue', 'duration', 'cost', 'round', 'branch', 'pr', 'note']) assert.equal(missing[key], 'Not available', key);
});

test('AC-4: artifact allowlist and GitHub links reject arbitrary paths and URLs', () => {
  assert.deepEqual(artifactFiles({ round: 1, reviews: { code: 'PASS', '<img>': 'PASS' } }), [
    'issue.md', 'intake.md', 'spec.md', 'build.md', 'round-1/checks.md', 'round-1/review-code.md', 'decision.md', 'merge-checks.md',
  ]);
  assert.equal(artifactFiles({ round: 999, history: [{}, {}, {}] }).some((name) => name.includes('999')), false);
  assert.match(html, /openDrawer\(selectedJob\.id, button\.dataset\.artifact\)/);
  assert.deepEqual(githubLinks({ issue: 41, pr: 12 }, 'https://github.com/example/repo').map((link) => link.href), [
    'https://github.com/example/repo/issues/41', 'https://github.com/example/repo/pull/12',
  ]);
  assert.deepEqual(githubLinks({ issue: 41 }, 'https://evil.example/path'), []);
  assert.equal(branchLink({ branch: 'factory/job-1' }, 'https://github.com/example/repo').href,
    'https://github.com/example/repo/tree/factory%2Fjob-1');
  assert.equal(branchLink({ branch: 'javascript:alert(1)' }, 'https://github.com/example/repo'), null);
  assert.equal(isSafeJobId('032-gamify-pipeline-canvas-with'), true);
  assert.equal(isSafeJobId('../issue'), false);
  assert.match(html, /data-artifact/);
  assert.match(html, /artifact-status/);
  assert.match(html, /disabled/);
});

test('AC-2: pipeline UI labels and statuses use the dashboard language dictionaries', () => {
  for (const key of ['pipelineJob', 'pipelineStage', 'pipelineStages', 'pipelineNoJobs', 'pipelineAvailable', 'pipelinePending', 'pipelineActive', 'pipelineComplete', 'pipelineBlocked', 'pipelineIssue', 'pipelineStatus', 'pipelineProgress', 'pipelineDuration', 'pipelineCost', 'pipelineAgent', 'pipelineRound', 'pipelineReviewers', 'pipelineBranch', 'pipelinePr', 'pipelineNote', 'pipelineArtifacts']) {
    assert.match(html, new RegExp(`"${key}"\\s*:`), `missing localized string: ${key}`);
  }
  assert.match(html, /T\.pipelineAvailable/);
});

test('AC-5: canvas fits dashboard breakpoints and reduced motion without color-only state', () => {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.pipeline-canvas[^{]*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.pipeline-content/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.pipeline-controls/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.pipeline-node/);
  assert.match(html, /aria-label="[^\"]*state/);
});

test('AC-6: pipeline controls, derived statuses, missing data and secure links are tested', () => {
  assert.match(html, /class="pipeline-inspector"/);
  assert.match(html, /function renderPipeline\(/);
  assert.match(html, /escapeHTML/);
  assert.match(html, /artifactFiles\(/);
});
