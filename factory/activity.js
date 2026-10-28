// Which factory agents a board.json job implies are working right now, and the
// badge row the dashboard shows for them. Plain ES module: runs in the browser
// (imported by dashboard.html) and in Node (imported by the tests).

import { avatarSvg } from './avatars.js';

// Each agent's icon is its animated octopus from avatars.js: a fixed string built
// only from constants, the one thing emitted unescaped.
const agent = (name, label) => Object.freeze({ label, icon: avatarSvg(name) });

export const AGENTS = Object.freeze({
  'spec-writer': agent('spec-writer', 'Spec writer'),
  builder: agent('builder', 'Builder'),
  'review-security': agent('review-security', 'Security review'),
  'review-ux': agent('review-ux', 'UX review'),
  'review-ui': agent('review-ui', 'UI review'),
  'review-code': agent('review-code', 'Code review'),
  approver: agent('approver', 'Approver'),
});

const SINGLE = Object.freeze({ spec: 'spec-writer', build: 'builder', approval: 'approver' });
const LENSES = Object.freeze(['security', 'ux', 'ui', 'code']);

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
