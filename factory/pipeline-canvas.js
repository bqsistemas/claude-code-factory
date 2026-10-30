import { roundsOf, costLabel } from './activity.js';

export const CANVAS_STAGES = Object.freeze([
  ['intake', 'Intake'], ['spec', 'Spec'], ['build', 'Build'], ['gate', 'Gate'],
  ['review', 'Review'], ['approve', 'Approve'], ['merge', 'Merge'],
].map(([key, label]) => Object.freeze({ key, label })));

const SOURCE_STAGE = Object.freeze({
  'needs-info': 'intake', 'awaiting-merge': 'merge', 'merging': 'merge',
  'needs-human': 'needs-human', merged: 'merge',
});
const STAGE_AGENTS = Object.freeze({ intake: 'intake', spec: 'spec-writer', build: 'builder', gate: 'builder', review: 'reviewers', approve: 'approver', merge: 'approver' });
const REVIEWERS = Object.freeze(['security', 'ux', 'ui', 'code']);
const DASH = 'Not available';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value) => Number.isFinite(value) && value >= 0;
const display = (value) => typeof value === 'string' && value.trim() ? value : DASH;

function mappedStage(job) {
  const stage = typeof job?.stage === 'string' ? job.stage : '';
  if (stage === 'rejected') {
    if (job.intake?.decision === 'REJECT') return 'intake';
    const rounds = Array.isArray(job.history) ? job.history : [];
    const reviewEvidence = [...rounds.map((round) => round?.reviews), job.reviews]
      .filter((reviews) => isObject(reviews) && Object.keys(reviews).length > 0);
    if (reviewEvidence.length) {
      const latestReviews = reviewEvidence.at(-1);
      const routedReviewers = isObject(job.agents?.reviewers) ? Object.keys(job.agents.reviewers) : [];
      return routedReviewers.length > 0 && routedReviewers.every((name) => latestReviews[name] === 'PASS')
        ? 'approve'
        : 'review';
    }
    if (job.gate || rounds.some((round) => round?.gate)) return 'gate';
    if (job.pr || (number(job.round) && job.round > 0)) return 'build';
    if (job.intake?.decision === 'ACCEPT') return 'spec';
    return 'intake';
  }
  if (stage === 'needs-human') {
    const from = typeof job.parked_from === 'string' ? job.parked_from : '';
    const parkedStage = SOURCE_STAGE[from] || from;
    return CANVAS_STAGES.some((item) => item.key === parkedStage) ? parkedStage : 'needs-human';
  }
  const candidate = SOURCE_STAGE[stage] || stage;
  return CANVAS_STAGES.some((item) => item.key === candidate) ? candidate : 'intake';
}

export function derivePipeline(job) {
  const source = isObject(job) ? job : {};
  const actual = typeof source.stage === 'string' ? source.stage : '';
  if (actual === 'merged') return CANVAS_STAGES.map((item) => ({ ...item, state: 'complete' }));
  const key = mappedStage(source);
  const current = Math.max(0, CANVAS_STAGES.findIndex((item) => item.key === key));
  return CANVAS_STAGES.map((item, index) => ({
    ...item,
    state: index < current ? 'complete' : index > current ? 'pending' :
      (actual === 'needs-human' || actual === 'needs-info' || actual === 'rejected' ? 'blocked' : 'active'),
  }));
}

export function stageDetails(job, stageKey, now = Date.now(), text) {
  const source = isObject(job) ? job : {};
  const selected = CANVAS_STAGES.find((item) => item.key === stageKey) || CANVAS_STAGES[0];
  const pipeline = derivePipeline(source);
  const current = pipeline.find((item) => item.key === selected.key);
  const completed = pipeline.filter((item) => item.state === 'complete').length;
  const start = typeof source.started === 'string' ? Date.parse(source.started) : NaN;
  const end = typeof source.finished === 'string' ? Date.parse(source.finished) : Number(now);
  const elapsed = Number.isFinite(start) && Number.isFinite(end) && end >= start ? `${Math.floor((end - start) / 60000)}m` : DASH;
  const label = costLabel(source, text);
  const cost = label === '—' ? DASH : label;
  const issue = Number.isInteger(source.issue) && source.issue > 0 ? `#${source.issue}` : DASH;
  const pr = Number.isInteger(source.pr) && source.pr > 0 ? `#${source.pr}` : DASH;
  const agentKey = STAGE_AGENTS[selected.key];
  const agents = isObject(source.agents) ? source.agents : {};
  const models = isObject(source.models) ? source.models : {};
  const agent = agentKey === 'reviewers'
    ? REVIEWERS.filter((name) => Object.hasOwn(agents.reviewers || {}, name)).map((name) => `${name}: ${agents.reviewers[name]}`).join(', ')
    : display(models[agentKey] || agents[agentKey]);
  const reviewers = isObject(agents.reviewers)
    ? REVIEWERS.filter((name) => Object.hasOwn(agents.reviewers, name)).map((name) => `${name}: ${agents.reviewers[name]}`).join(', ') || DASH
    : DASH;
  return {
    key: selected.key, label: selected.label, status: current.state[0].toUpperCase() + current.state.slice(1),
    issue, stage: display(source.stage), progress: `${completed}/${CANVAS_STAGES.length} stages`,
    duration: elapsed, cost, agent, round: number(source.round) && source.round > 0 ? String(source.round) : DASH,
    reviewers, branch: display(source.branch), pr, note: display(source.note),
  };
}

export function bindPipelineControls({ jobSelect, stageSelect, canvas, getSelection, setSelection, render }) {
  const focusStage = (stage) => canvas.querySelector(`.pipeline-node[data-stage="${stage}"]`)?.focus();
  jobSelect.addEventListener('change', (event) => {
    const selection = getSelection();
    setSelection({ ...selection, jobId: event.target.value || null });
    render();
    focusStage(getSelection().stage);
  });
  stageSelect.addEventListener('change', (event) => {
    setSelection({ ...getSelection(), stage: event.target.value });
    render();
    focusStage(getSelection().stage);
  });
  canvas.addEventListener('click', (event) => {
    const node = event.target.closest('.pipeline-node');
    if (!node) return;
    setSelection({ ...getSelection(), stage: node.dataset.stage });
    render();
    focusStage(getSelection().stage);
  });
}

export function artifactFiles(job) {
  const files = ['issue.md', 'intake.md', 'spec.md', 'build.md'];
  const rows = roundsOf(isObject(job) ? job : {}).slice(0, 50);
  rows.forEach((row, index) => {
    const round = index + 1;
    files.push(`round-${round}/checks.md`);
    const reviews = isObject(row.reviews) ? row.reviews : {};
    REVIEWERS.filter((name) => Object.hasOwn(reviews, name)).forEach((name) => files.push(`round-${round}/review-${name}.md`));
  });
  return [...files, 'decision.md', 'merge-checks.md'];
}

export function isSafeJobId(id) {
  return typeof id === 'string' && /^\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

export function githubLinks(job, repo) {
  if (!isObject(job) || typeof repo !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo)) return [];
  const links = [];
  if (Number.isInteger(job.issue) && job.issue > 0) links.push({ label: `Issue #${job.issue}`, href: `${repo}/issues/${job.issue}` });
  if (Number.isInteger(job.pr) && job.pr > 0) links.push({ label: `PR #${job.pr}`, href: `${repo}/pull/${job.pr}` });
  return links;
}

export function branchLink(job, repo) {
  if (!isObject(job) || typeof job.branch !== 'string' || !/^factory\/[a-zA-Z0-9][\w.-]{0,99}$/.test(job.branch) ||
      typeof repo !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { label: job.branch, href: `${repo}/tree/${encodeURIComponent(job.branch)}` };
}
