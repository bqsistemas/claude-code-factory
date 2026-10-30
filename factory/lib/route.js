// factory/bin/route <job-id> [--provider <name>]: intake's risk and surfaces → the
// builder model and routed reviewers from the provider routing table in
// factory/config.json. The CLI only prints; it writes nothing.
import { join } from 'node:path';

import { parseIntake } from './intake.js';
import { Refused, Usage, factoryRoot, isMain, jobDir, loadConfig, readText, runCli } from './util.js';

const RISKS = ['low', 'medium', 'high'];
export const DEFAULT_PROVIDER = 'claude';

/**
 * Resolve the provider-specific model/routing section while keeping the
 * original top-level `models`/`routing` fields as the Claude compatibility
 * fallback for old config files.
 */
export function providerConfig(config, provider = config?.default_provider ?? DEFAULT_PROVIDER) {
  if (typeof provider !== 'string' || !provider.trim()) throw new Error('provider must be a non-empty string');
  const configured = config?.providers?.[provider];
  const legacy = provider === DEFAULT_PROVIDER ? config : null;
  const models = configured?.models ?? legacy?.models;
  const routing = configured?.routing ?? legacy?.routing;
  if (!models || !routing) throw new Error(`unknown provider: ${provider}`);
  return { provider, models, routing };
}

/** Return the fixed-stage model assignments for a provider. */
export function stageModels(config, provider = config?.default_provider ?? DEFAULT_PROVIDER) {
  const resolved = providerConfig(config, provider);
  const result = {};
  for (const role of ['intake', 'spec-writer', 'approver']) {
    const model = resolved.models?.[role];
    if (typeof model !== 'string' || !model.trim()) throw new Error(`provider ${provider} has no model for ${role}`);
    result[role] = model;
  }
  return result;
}

/**
 * @param {object} config factory/config.json
 * @param {{ risk: string, surfaces: string[] }} intake
 * @param {string} provider provider name, defaulting to config.default_provider
 * @returns {{ builder: string, reviewers: Record<string, string> }}
 */
export function route(config, { risk, surfaces } = {}, provider = config?.default_provider ?? DEFAULT_PROVIDER) {
  const resolved = providerConfig(config, provider);
  const { builder, reviewers } = resolved.routing;
  if (!RISKS.includes(risk) || !Object.hasOwn(builder, risk)) throw new Error(`unknown risk: ${risk}`);
  const known = new Set(Object.values(reviewers).map((r) => r.surface).filter(Boolean));
  if (!Array.isArray(surfaces)) throw new Error('surfaces must be a list');
  for (const surface of surfaces) {
    if (!known.has(surface)) throw new Error(`unknown surface: ${surface}`);
  }
  const pick = (model, role) => {
    const selected = typeof model === 'string' ? model : model?.[risk];
    if (typeof selected !== 'string' || !selected.trim()) throw new Error(`provider ${provider} has no model for ${role}`);
    return selected;
  };
  const routed = {};
  for (const [lens, rule] of Object.entries(reviewers)) {
    if (rule.always || surfaces.includes(rule.surface)) routed[lens] = pick(rule.model, `review-${lens}`);
  }
  return { builder: pick(builder, 'builder'), reviewers: routed };
}

function main(args) {
  if (![1, 3].includes(args.length) || (args.length === 3 && args[1] !== '--provider')) {
    throw new Usage('route <job-id> [--provider <name>]');
  }
  const root = factoryRoot();
  const text = readText(join(jobDir(root, args[0]), 'intake.md'));
  if (text === null) throw new Refused(`${args[0]} has no intake.md`);
  const provider = args.length === 3 ? args[2] : undefined;
  const config = loadConfig(root);
  const result = route(config, parseIntake(text), provider);
  process.stdout.write(`${JSON.stringify(provider ? { provider, ...result } : result)}\n`);
}

if (isMain(import.meta.url)) runCli(main);
