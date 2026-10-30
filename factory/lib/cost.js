// Per-job cost from Claude Code subagent transcripts (JSONL). A transcript belongs
// to a job when its first user prompt names the job folder, factory/jobs/<id>/.
// The transcript format is a Claude Code internal detail; unknown lines are skipped.
import { readdirSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { readText } from './util.js';

const count = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

function entries(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a partial or foreign line
    }
  }
  return out;
}

function promptText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('\n');
}

/**
 * USD cost of one job.
 * @param {string[]} transcripts contents of JSONL transcript files
 * @param {string} jobId
 * @param {Record<string, {input:number, output:number, cache_write:number, cache_read:number}>} prices USD per million tokens, by model alias
 * @returns {number}
 */
export function jobCost(transcripts, jobId, prices) {
  const needle = `factory/jobs/${jobId}/`;
  const aliases = Object.keys(prices ?? {});
  const seen = new Set();
  let total = 0;
  for (const text of transcripts) {
    if (!String(text).includes(needle)) continue;
    const lines = entries(text);
    const first = lines.find((e) => e?.type === 'user');
    if (!first || !promptText(first.message?.content).includes(needle)) continue;
    for (const e of lines) {
      const message = e?.type === 'assistant' ? e.message : null;
      if (!message?.usage) continue;
      if (message.id) {
        if (seen.has(message.id)) continue; // usage repeats on every content block
        seen.add(message.id);
      }
      const model = typeof message.model === 'string' ? message.model : '';
      const alias = aliases.find((a) => model.includes(a));
      if (!alias) continue;
      const p = prices[alias];
      const u = message.usage;
      total += (count(u.input_tokens) * p.input
        + count(u.output_tokens) * p.output
        + count(u.cache_creation_input_tokens) * p.cache_write
        + count(u.cache_read_input_tokens) * p.cache_read) / 1e6;
    }
  }
  return total;
}

/** Contents of every *.jsonl file inside a `subagents/` folder under `dir`. */
export function readTranscripts(dir) {
  const out = [];
  const walk = (folder, inSubagents) => {
    let items;
    try {
      items = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      const path = join(folder, item.name);
      if (item.isDirectory()) walk(path, inSubagents || item.name === 'subagents');
      else if (inSubagents && item.isFile() && item.name.endsWith('.jsonl')) {
        const text = readText(path);
        if (text !== null) out.push(text);
      }
    }
  };
  walk(dir, false);
  return out;
}

// Codex rollouts are internal JSONL. Project only accounting metadata; never
// return prompts, tool responses, base instructions, credentials or rate limits.
function codexRollout(text) {
  let meta = null, model = null, usageBeforePrompt = false;
  const jobs = new Set(), snapshots = [];
  for (const e of entries(text)) {
    const p = e?.payload;
    if (!p || typeof p !== 'object') continue;
    if (e.type === 'session_meta' && !meta) {
      meta = { id: p.id, cwd: p.cwd };
    } else if (e.type === 'turn_context') {
      model = typeof p.model === 'string' ? p.model : null;
    } else if (e.type === 'response_item' && p.type === 'message' && p.role === 'user') {
      const text = promptText(p.content);
      // Dedicated worker contract only, not arbitrary job mentions in messages
      // or tool output. Boilerplate instructions may precede this prompt.
      for (const match of text.matchAll(/^Job folder: factory\/jobs\/(\d{3,}-[a-z0-9]+(?:-[a-z0-9]+)*)\/\s*$/gm)) jobs.add(match[1]);
    } else if (e.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) {
      const u = p.info.total_token_usage;
      if (!jobs.size && (u.input_tokens > 0 || u.output_tokens > 0)) usageBeforePrompt = true;
      snapshots.push({ model, usage: {
        input_tokens: u.input_tokens, cached_input_tokens: u.cached_input_tokens ?? 0,
        cache_write_input_tokens: u.cache_write_input_tokens ?? 0, output_tokens: u.output_tokens,
      } });
    }
  }
  return { meta, jobs: [...jobs], usageBeforePrompt, snapshots };
}

const within = (path, base) => typeof path === 'string' && isAbsolute(path)
  && (resolve(path) === resolve(base) || resolve(path).startsWith(`${resolve(base)}${sep}`));
const unavailable = (cost_reason) => ({ cost_usd: null, cost_status: 'unavailable', cost_reason });
const validPrice = (p) => p && ['input', 'cache_read', 'cache_write', 'output']
  .every((key) => Number.isFinite(p[key]) && p[key] >= 0);
const tokenKeys = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens'];
const validUsage = (u) => tokenKeys.every((key) => Number.isSafeInteger(u[key]) && u[key] >= 0)
  && u.cached_input_tokens + u.cache_write_input_tokens <= u.input_tokens;
const magnitude = (s) => s.usage.input_tokens + s.usage.output_tokens;

/**
 * Codex cost with explicit availability. Input includes cached tokens (unlike
 * Claude); subtract read/write subsets before pricing ordinary input. Output
 * already includes reasoning. Prices are exact model IDs, USD/million tokens.
 * Cumulative snapshots are merged by session id, not filename, and priced as
 * deltas so a model switch cannot reprice earlier usage. Unknown partial costs
 * make the whole job unavailable rather than presenting an invented total.
 */
export function codexJobCost(rollouts, job, prices, root) {
  const sessions = new Map();
  for (const source of rollouts) {
    const r = typeof source === 'string' ? codexRollout(source) : source;
    if (typeof r?.meta?.id !== 'string' || !r.meta.id || typeof r.meta.cwd !== 'string') continue;
    const copies = sessions.get(r.meta.id) ?? [];
    copies.push(r);
    sessions.set(r.meta.id, copies);
  }
  let total = 0, found = false;
  const worktree = job.worktree || join(root, '.worktrees', job.id);
  for (const copies of sessions.values()) {
    const relevant = copies.some((r) => within(r.meta.cwd, worktree)
      || (within(r.meta.cwd, root) && r.jobs.includes(job.id)));
    if (!relevant) continue;
    // A duplicate/resumed session must retain the same dedicated association.
    for (const r of copies) {
      const worktreeMatch = within(r.meta.cwd, worktree);
      const promptMatch = resolve(r.meta.cwd) === resolve(root) && r.jobs.length === 1 && r.jobs[0] === job.id;
      if ((!worktreeMatch && !promptMatch) || r.jobs.some((id) => id !== job.id)
        || (!worktreeMatch && r.usageBeforePrompt)) return unavailable('ambiguous_session');
    }
    const snapshots = [];
    for (const r of copies) {
      let previous = null;
      for (const snapshot of r.snapshots) {
        if (!validUsage(snapshot.usage) || (previous && tokenKeys.some((k) => snapshot.usage[k] < previous[k]))) {
          return unavailable('invalid_usage');
        }
        previous = snapshot.usage;
        snapshots.push(snapshot);
      }
    }
    // Copies may be truncated prefixes of a resumed rollout. Sorting cumulative
    // counters reconciles them; identical snapshots have a zero delta.
    snapshots.sort((a, b) => magnitude(a) - magnitude(b));
    let previous = Object.fromEntries(tokenKeys.map((k) => [k, 0])), counted = false;
    for (const snapshot of snapshots) {
      const u = Object.fromEntries(tokenKeys.map((k) => [k, snapshot.usage[k] - previous[k]]));
      if (!validUsage(u)) return unavailable('invalid_usage');
      previous = snapshot.usage;
      // A verified zero snapshot is still usage evidence, but needs a known price.
      if (counted && tokenKeys.every((k) => u[k] === 0)) continue;
      if (!snapshot.model) return unavailable('missing_model');
      const p = Object.hasOwn(prices ?? {}, snapshot.model) ? prices[snapshot.model] : null;
      if (!validPrice(p)) return unavailable('missing_price');
      total += ((u.input_tokens - u.cached_input_tokens - u.cache_write_input_tokens) * p.input
        + u.cached_input_tokens * p.cache_read + u.cache_write_input_tokens * p.cache_write
        + u.output_tokens * p.output) / 1e6;
      found = true;
      counted = true;
    }
  }
  if (!found) return unavailable('no_associated_usage');
  return Number.isFinite(total)
    ? { cost_usd: total, cost_status: 'available', cost_reason: null } : unavailable('invalid_usage');
}

/** Read regular JSONL files recursively; do not follow symlinks. No state writes. */
export function readCodexRollouts(dir, root) {
  const out = [];
  const walk = (folder) => {
    let items;
    try { items = readdirSync(folder, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      const path = join(folder, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.isFile() && item.name.endsWith('.jsonl')) {
        const text = readText(path);
        if (text === null) continue;
        const r = codexRollout(text);
        if (r.meta && (!root || within(r.meta.cwd, root))) out.push(r);
      }
    }
  };
  walk(dir);
  return out;
}
