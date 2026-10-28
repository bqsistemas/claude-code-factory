// Which factory agents a board.json job implies are working right now, and the
// badge row the dashboard shows for them. Plain ES module: runs in the browser
// (imported by dashboard.html) and in Node (imported by the tests).

// Inline 16x16 line icons. Fixed strings only: they are the one thing emitted unescaped.
const svg = (body) =>
  `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const AGENTS = Object.freeze({
  'spec-writer': Object.freeze({
    label: 'Spec writer',
    icon: svg('<path d="M3 13l1-3.5L10.5 3 13 5.5 6.5 12z"/><path d="M9 4.5L11.5 7"/>'),
  }),
  builder: Object.freeze({
    label: 'Builder',
    icon: svg('<path d="M2.5 13.5l6-6"/><path d="M7 4.5l2-2 4.5 4.5-2 2z"/>'),
  }),
  'review-security': Object.freeze({
    label: 'Security review',
    icon: svg('<path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z"/>'),
  }),
  'review-ux': Object.freeze({
    label: 'UX review',
    icon: svg('<circle cx="8" cy="5" r="2.5"/><path d="M3 14c.5-3 2.5-4.5 5-4.5s4.5 1.5 5 4.5"/>'),
  }),
  'review-ui': Object.freeze({
    label: 'UI review',
    icon: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 6h11M6 6v7.5"/>'),
  }),
  'review-code': Object.freeze({
    label: 'Code review',
    icon: svg('<path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5"/>'),
  }),
  approver: Object.freeze({
    label: 'Approver',
    icon: svg('<circle cx="8" cy="8" r="5.5"/><path d="M5.5 8.2l1.8 1.8 3.2-3.5"/>'),
  }),
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
