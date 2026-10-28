// factory/bin/route <job-id>: intake's risk and surfaces → the builder model and the
// routed reviewers with their models, from the routing table in factory/config.json.
// The CLI only prints; it writes nothing.
import { join } from 'node:path';

import { parseIntake } from './job.js';
import { Refused, Usage, factoryRoot, isMain, jobDir, loadConfig, readText, runCli } from './util.js';

const RISKS = ['low', 'medium', 'high'];

/**
 * @param {object} config factory/config.json
 * @param {{ risk: string, surfaces: string[] }} intake
 * @returns {{ builder: string, reviewers: Record<string, string> }}
 */
export function route(config, { risk, surfaces } = {}) {
  const { builder, reviewers } = config.routing;
  if (!RISKS.includes(risk) || !Object.hasOwn(builder, risk)) throw new Error(`unknown risk: ${risk}`);
  const known = new Set(Object.values(reviewers).map((r) => r.surface).filter(Boolean));
  if (!Array.isArray(surfaces)) throw new Error('surfaces must be a list');
  for (const surface of surfaces) {
    if (!known.has(surface)) throw new Error(`unknown surface: ${surface}`);
  }
  const pick = (model) => (typeof model === 'string' ? model : model[risk]);
  const routed = {};
  for (const [lens, rule] of Object.entries(reviewers)) {
    if (rule.always || surfaces.includes(rule.surface)) routed[lens] = pick(rule.model);
  }
  return { builder: builder[risk], reviewers: routed };
}

function main(args) {
  if (args.length !== 1) throw new Usage('route <job-id>');
  const root = factoryRoot();
  const text = readText(join(jobDir(root, args[0]), 'intake.md'));
  if (text === null) throw new Refused(`${args[0]} has no intake.md`);
  process.stdout.write(`${JSON.stringify(route(loadConfig(root), parseIntake(text)))}\n`);
}

if (isMain(import.meta.url)) runCli(main);
