// Shared helpers for the factory scripts: paths, config, files and child processes.
// Node 20 ESM, no dependencies.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A job id: a 3-digit (or longer) number, then a lowercase slug. Never a path. */
export const JOB_ID = /^\d{3,}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A transition or request the rules do not allow. The CLI exits 1. */
export class Refused extends Error {}
/** Bad arguments. The CLI exits 2. */
export class Usage extends Error {}

/** Runs a command without a shell. Never throws; check `.status` and `.error`. */
export function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

/** Runs a command and returns stdout, or throws with its stderr. */
export function mustRun(cmd, args, opts = {}) {
  const res = run(cmd, args, opts);
  if (res.error || res.status !== 0) {
    const why = (res.stderr || res.error?.message || `exit ${res.status}`).trim().split('\n').slice(-3).join(' ');
    throw new Error(`${cmd} ${args.slice(0, 2).join(' ')} failed: ${why}`);
  }
  return res.stdout;
}

/**
 * The main checkout. FACTORY_ROOT wins; otherwise the folder holding git's common
 * directory, which is the main checkout's top level even when run from a worktree.
 */
export function factoryRoot() {
  if (process.env.FACTORY_ROOT) return resolve(process.env.FACTORY_ROOT);
  const res = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (res.status !== 0) throw new Error('not inside a git repository (set FACTORY_ROOT)');
  return dirname(res.stdout.trim());
}

export function loadConfig(root) {
  return JSON.parse(readFileSync(join(root, 'factory/config.json'), 'utf8'));
}

export function jobDir(root, id) {
  if (typeof id !== 'string' || !JOB_ID.test(id)) throw new Usage(`not a job id: ${JSON.stringify(id)}`);
  return join(root, 'factory/jobs', id);
}

/** Claude Code's transcript folder for this checkout. */
export function transcriptsDir(root) {
  return process.env.FACTORY_TRANSCRIPTS || join(homedir(), '.claude/projects', root.replace(/[/.]/g, '-'));
}

export function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** First line of a file without its line ending, or null when the file is missing. */
export function firstLine(file) {
  const text = readText(file);
  return text === null ? null : text.replace(/^﻿/, '').split(/\r?\n/, 1)[0];
}

/** Writes through a temp file and a rename, so readers never see half a file. */
export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function tail(text, n) {
  return String(text).replace(/\n+$/, '').split('\n').slice(-n).join('\n');
}

export const now = () => new Date().toISOString();

/** True when this module is the script node was started with. */
export function isMain(url) {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

/** Runs a CLI main, mapping Refused/Usage/other errors to exit codes 1/2/1. */
export function runCli(main) {
  try {
    process.exitCode = main(process.argv.slice(2)) ?? 0;
  } catch (err) {
    if (err instanceof Usage) {
      process.stderr.write(`usage: ${err.message}\n`);
      process.exitCode = 2;
    } else if (err instanceof Refused) {
      process.stderr.write(`refused: ${err.message}\n`);
      process.exitCode = 1;
    } else {
      process.stderr.write(`error: ${err.message}\n`);
      process.exitCode = 1;
    }
  }
}
