// Which factory agents a board.json job implies are working right now, the badge
// row the dashboard shows for them, and the v2 card helpers (columns, round chips,
// issue/PR links, cost and time). Plain ES module: runs in the browser (imported by
// dashboard.html) and in Node (imported by the tests and factory/lib/job.js).

import { avatarSvg } from './avatars.js';

// Each agent's icon is its animated octopus from avatars.js: a fixed string built
// only from constants, the one thing emitted unescaped.
const agent = (name, label) => Object.freeze({ label, icon: avatarSvg(name) });

export const AGENTS = Object.freeze({
  intake: agent('intake', 'Intake'),
  'spec-writer': agent('spec-writer', 'Spec writer'),
  builder: agent('builder', 'Builder'),
  'review-security': agent('review-security', 'Security review'),
  'review-ux': agent('review-ux', 'UX review'),
  'review-ui': agent('review-ui', 'UI review'),
  'review-code': agent('review-code', 'Code review'),
  approver: agent('approver', 'Approver'),
});

/** Board columns, in pipeline order: [stage, label]. */
export const STAGE_COLUMNS = Object.freeze([
  ['intake', 'Intake'],
  ['needs-info', 'Needs info'],
  ['spec', 'Spec'],
  ['build', 'Build'],
  ['gate', 'Gate'],
  ['review', 'Review'],
  ['approve', 'Approve'],
  ['merging', 'Merging'],
  ['needs-human', 'Needs human'],
  ['merged', 'Merged'],
  ['rejected', 'Rejected'],
].map((column) => Object.freeze(column)));

const SINGLE = Object.freeze({ intake: 'intake', spec: 'spec-writer', build: 'builder', approve: 'approver' });
const LENSES = Object.freeze(['security', 'ux', 'ui', 'code']);
const GATE_STATES = new Set(['PASS', 'FAIL']);
const REVIEW_STATES = new Set(['PASS', 'CHANGES', 'pending']);
const REPO = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/;
const DASH = '—';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Agent names the job's board state implies are running. Never throws; any
 * missing or malformed field yields [].
 * @param {unknown} job a board.json job
 * @returns {string[]}
 */
export function activeAgents(job) {
  if (!isObject(job) || typeof job.stage !== 'string') return [];
  if (Object.hasOwn(SINGLE, job.stage)) return [SINGLE[job.stage]];
  if (job.stage !== 'review' || !isObject(job.reviews)) return [];
  return LENSES
    .filter((lens) => Object.hasOwn(job.reviews, lens) && job.reviews[lens] === 'pending')
    .map((lens) => `review-${lens}`);
}

/**
 * Badge row for the job card, or '' when nothing is running. Only the fixed
 * AGENTS icons are emitted raw; every other interpolated value is escaped.
 * @param {unknown} job a board.json job
 * @returns {string}
 */
export function agentsHtml(job) {
  const names = activeAgents(job);
  if (!names.length) return '';
  const badges = names.map((name) => {
    const { label, icon } = AGENTS[name];
    return `<span class="agent" role="listitem" data-agent="${esc(name)}">` +
      `<span class="avatar" aria-hidden="true">${icon}</span>` +
      `<span class="agent-label">${esc(label)}</span></span>`;
  });
  return `<span class="agents" role="list" aria-label="Running agents">${badges.join('')}</span>`;
}

/**
 * One round's chips: the gate first, then one chip per review key present
 * (known lenses in a fixed order, then any others such as `human`).
 * @param {unknown} round `{ gate, reviews }` from job.history or the current job
 * @returns {string}
 */
export function roundChipsHtml(round) {
  const { gate, reviews } = isObject(round) ? round : {};
  const g = GATE_STATES.has(gate) ? gate : 'pending';
  const chips = [`<span class="chip gate ${g}" role="img" aria-label="gate: ${g}" title="gate: ${g}">gate</span>`];
  if (isObject(reviews)) {
    const keys = [...LENSES.filter((k) => Object.hasOwn(reviews, k)), ...Object.keys(reviews).filter((k) => !LENSES.includes(k))];
    for (const key of keys) {
      const state = REVIEW_STATES.has(reviews[key]) ? reviews[key] : '';
      const label = `${esc(key)}: ${esc(state || 'unknown')}`;
      chips.push(`<span class="chip${state ? ` ${state}` : ''}" role="img" aria-label="${label}" title="${label}">${esc(key)}</span>`);
    }
  }
  return chips.join('');
}

const positiveInt = (n) => Number.isInteger(n) && n > 0;

/**
 * Issue and PR links for a card, or '' when the repo is not a plain GitHub URL.
 * @param {unknown} job a board.json job
 * @param {unknown} repo board.json `repo`, e.g. https://github.com/owner/name
 * @returns {string}
 */
export function linksHtml(job, repo) {
  if (!isObject(job) || typeof repo !== 'string' || !REPO.test(repo)) return '';
  const links = [];
  if (positiveInt(job.issue)) links.push(`<a class="link" href="${esc(`${repo}/issues/${job.issue}`)}" target="_blank" rel="noopener">Issue #${job.issue}</a>`);
  if (positiveInt(job.issue) && positiveInt(job.pr)) links.push(`<a class="link" href="${esc(`${repo}/pull/${job.pr}`)}" target="_blank" rel="noopener">PR #${job.pr}</a>`);
  return links.length ? `<span class="links">${links.join('')}</span>` : '';
}

/**
 * A duration as `<m>m` or `<h>h <m>m`, or '—' when it is not a valid length.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return DASH;
  const minutes = Math.floor(ms / 60000);
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * Cost and elapsed time for a card: `$1.84` and the time from `started` to
 * `finished` (or `now`). Missing or invalid values render as '—'.
 * @param {unknown} job a board.json job
 * @param {number|Date} [now]
 * @returns {string}
 */
export function costTimeHtml(job, now = Date.now()) {
  const j = isObject(job) ? job : {};
  const cost = typeof j.cost_usd === 'number' && Number.isFinite(j.cost_usd) && j.cost_usd >= 0
    ? `$${j.cost_usd.toFixed(2)}` : DASH;
  const start = typeof j.started === 'string' ? Date.parse(j.started) : NaN;
  const end = typeof j.finished === 'string' ? Date.parse(j.finished) : Number(now);
  return `<span class="cost" title="cost">${esc(cost)}</span>` +
    `<span class="time" title="time">${esc(formatDuration(end - start))}</span>`;
}
