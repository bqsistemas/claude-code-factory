// Parses the header of intake.md, written by the intake agent. Shared by
// factory/bin/job (re-exported from job.js) and factory/bin/route.

const DECISIONS = ['ACCEPT', 'NEEDS-INFO', 'REJECT'];
const RISKS = ['low', 'medium', 'high'];
const SURFACES = ['ui', 'security'];

/**
 * Parses the four-line header of intake.md. Throws on any malformed or unknown line.
 * @returns {{ decision: string, risk: string, surfaces: string[], rescoped: boolean }}
 */
export function parseIntake(text) {
  const [d = '', r = '', s = '', x = ''] = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const decision = d.trim();
  if (!DECISIONS.includes(decision)) throw new Error(`intake.md line 1: expected ACCEPT, NEEDS-INFO or REJECT, got ${JSON.stringify(d)}`);
  const risk = r.match(/^RISK:\s*(\S+)\s*$/)?.[1];
  if (!RISKS.includes(risk)) throw new Error(`intake.md line 2: expected RISK: low|medium|high, got ${JSON.stringify(r)}`);
  const list = s.match(/^SURFACES:\s*(.+?)\s*$/)?.[1];
  if (!list) throw new Error(`intake.md line 3: expected SURFACES: ..., got ${JSON.stringify(s)}`);
  const surfaces = list === 'none' ? [] : list.split(',').map((t) => t.trim());
  for (const surface of surfaces) {
    if (!SURFACES.includes(surface)) throw new Error(`intake.md line 3: unknown surface ${JSON.stringify(surface)}`);
  }
  if (new Set(surfaces).size !== surfaces.length) throw new Error('intake.md line 3: repeated surface');
  const rescoped = x.match(/^RESCOPED:\s*(yes|no)\s*$/)?.[1];
  if (!rescoped) throw new Error(`intake.md line 4: expected RESCOPED: yes|no, got ${JSON.stringify(x)}`);
  return { decision, risk, surfaces, rescoped: rescoped === 'yes' };
}
