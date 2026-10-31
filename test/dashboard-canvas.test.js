import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { artifactFiles, bindPipelineControls, branchLink, derivePipeline, githubLinks, isSafeJobId, stageDetails } from '../factory/pipeline-canvas.js';

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
  const intakeRejected = derivePipeline({ stage: 'rejected', intake: { decision: 'REJECT' }, round: 0, history: [] });
  assert.deepEqual(intakeRejected.map(({ state }) => state), ['blocked', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending']);
  const prClosedBeforeApproval = derivePipeline({
    stage: 'rejected', pr: 42, round: 1, gate: 'PASS',
    reviews: { code: 'PASS', ux: 'PASS', ui: 'PASS', security: 'PASS' }, decision: null,
    agents: { reviewers: { code: 'gpt', ux: 'gpt', ui: 'gpt', security: 'gpt' } },
  });
  assert.deepEqual(prClosedBeforeApproval.map(({ state }) => state), ['complete', 'complete', 'complete', 'complete', 'complete', 'blocked', 'pending']);
  assert.equal(stageDetails({ stage: 'rejected', pr: 42, gate: 'PASS', reviews: { code: 'PASS', ux: 'PASS' }, agents: { reviewers: { code: 'x', ux: 'x' } } }, 'approve').progress, '5/7 stages');
  assert.equal(stageDetails({ stage: 'rejected', intake: { decision: 'REJECT' } }, 'intake').progress, '0/7 stages');
});

test('AC-2: accessible job and stage controls update the pipeline selection', () => {
  assert.match(html, /id="pipeline-job"[^>]*aria-label="Select job"/);
  assert.match(html, /id="pipeline-stage"[^>]*aria-label="Select pipeline stage"/);
  assert.match(html, /id="pipeline-canvas"[^>]*aria-label="Pipeline stages"/);
  assert.match(html, /bindPipelineControls\(/);
  const selected = stageDetails({ id: 'job-a', stage: 'build' }, 'review');
  assert.equal(selected.key, 'review');
  assert.equal(selected.status, 'Pending');
});

test('AC-2: keyboard job and stage changes render matching context and focus the selected stage', () => {
  const listeners = new Map();
  const jobSelect = { addEventListener: (name, fn) => listeners.set(`job:${name}`, fn) };
  const stageSelect = { addEventListener: (name, fn) => listeners.set(`stage:${name}`, fn) };
  const focusByStage = new Map();
  const canvas = {
    addEventListener: (name, fn) => listeners.set(`canvas:${name}`, fn),
    querySelector: (selector) => {
      const stage = selector.match(/data-stage="([^"]+)"/)?.[1];
      return stage ? { focus: () => focusByStage.set(stage, true) } : null;
    },
  };
  const jobs = [
    { id: 'job-a', title: 'Alpha job', issue: 41, stage: 'build' },
    { id: 'job-b', title: 'Beta job', issue: 42, stage: 'review' },
  ];
  let selection = { jobId: 'job-a', stage: 'build' };
  let rendered;
  const render = () => {
    const job = jobs.find(({ id }) => id === selection.jobId);
    rendered = { title: job.title, ...stageDetails(job, selection.stage), stages: derivePipeline(job) };
  };
  bindPipelineControls({
    jobSelect, stageSelect, canvas,
    getSelection: () => selection,
    setSelection: (next) => { selection = next; },
    render,
  });

  // Native select controls emit change for both keyboard and pointer selection.
  listeners.get('job:change')({ target: { value: 'job-b' } });
  assert.equal(rendered.title, 'Beta job');
  assert.equal(rendered.issue, '#42');
  assert.equal(rendered.key, 'build');
  assert.equal(rendered.status, 'Complete');
  assert.equal(focusByStage.get('build'), true);

  listeners.get('stage:change')({ target: { value: 'approve' } });
  assert.equal(rendered.title, 'Beta job');
  assert.equal(rendered.key, 'approve');
  assert.equal(rendered.status, 'Pending');
  assert.equal(rendered.stages.find(({ key }) => key === 'review').state, 'active');
  assert.equal(focusByStage.get('approve'), true);
});

test('AC-3: inspector fields expose available context and explicit missing values', () => {
  const job = { issue: 41, title: 'Task Alpha', stage: 'build', provider: 'codex', models: { builder: 'gpt' }, round: 2, cost_usd: 1.25, cost_status: 'available', branch: 'factory/job-a', agents: { builder: 'gpt' }, reviewers: ['code'], note: 'working', started: '2026-01-01T00:00:00Z', finished: '2026-01-01T00:05:00Z' };
  const details = stageDetails(job, 'build');
  assert.equal(details.issue, '#41');
  assert.equal(details.provider, 'codex');
  assert.equal(details.title, 'Task Alpha');
  assert.equal(details.round, '2');
  assert.equal(details.cost, '$1.25');
  assert.equal(details.branch, 'factory/job-a');
  assert.equal(details.duration, '5m');
  const missing = stageDetails({}, 'intake');
  for (const key of ['issue', 'provider', 'duration', 'round', 'branch', 'pr', 'note']) assert.equal(missing[key], 'Not available', key);
  assert.equal(missing.cost, 'Cost unavailable');
  assert.equal(stageDetails({ started: '2026-01-01T00:00:00Z' }, 'build', Date.parse('2026-01-01T00:10:00Z')).duration, 'Not available');
});

test('AC-3: canvas renders selected task identity, provider and seven-stage progress', () => {
  assert.match(html, /pipeline-task-header/);
  assert.match(html, /pipeline-progress/);
  assert.match(html, /pipelineProvider/);
  assert.match(html, /pipelineTitle/);
  assert.match(html, /Cost unavailable/);
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
