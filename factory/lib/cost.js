// Per-job cost from Claude Code subagent transcripts (JSONL). A transcript belongs
// to a job when its first user prompt names the job folder, factory/jobs/<id>/.
// The transcript format is a Claude Code internal detail; unknown lines are skipped.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

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
