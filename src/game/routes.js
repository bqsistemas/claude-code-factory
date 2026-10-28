// Per-scenario routes for the focus mode of the plant: which nodes and tracks a
// scenario rides, where the package has been at a given step, which exits of each
// fork it took, and which stations it re-enters. Derived from the steps' `path`
// lists, never stored. Plain JS with no React imports, so it runs (and is tested) in Node.
import { SCENARIOS } from './scenarios.js';
import { LABELS, NODES, TRACKS } from './scene.js';

/** Appended to a station's label when the package re-enters it through a return track. */
export const REPEAT_SUFFIX = ' ×2';

const keyOf = (t) => `${t.from}>${t.to}`;
const TRACK_BY_KEY = new Map(TRACKS.map((t) => [keyOf(t), t]));
const NODE_IDS = Object.keys(NODES);
const isStation = (id) => NODES[id]?.kind === 'station';

/** Every node with two or more outgoing tracks, with the keys of those tracks. */
export const FORKS = Object.freeze(
  Object.fromEntries(
    NODE_IDS.map((id) => [id, TRACKS.filter((t) => t.from === id).map(keyOf)]).filter(([, keys]) => keys.length >= 2),
  ),
);

const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const scenarioOf = (id) => {
  const scenario = SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new RangeError(`unknown scenario: ${String(id)}`);
  return scenario;
};

/** The segments of one step's path. */
const segmentsOf = (path, step) =>
  path.slice(1).map((to, k) => {
    const from = path[k];
    const key = `${from}>${to}`;
    const { kind } = TRACK_BY_KEY.get(key) ?? {};
    return { key, from, to, kind, step, returns: (kind === 'loop' || kind === 'human') && isStation(to) };
  });

/**
 * The route a scenario rides.
 * @param {string} scenarioId
 * @returns {{ id: string, nodes: string[], segments: { key: string, from: string, to: string, kind: string, step: number, returns: boolean }[] }}
 * @throws {RangeError} for an unknown id
 */
export function scenarioRoute(scenarioId) {
  const { id, steps } = scenarioOf(scenarioId);
  const segments = steps.flatMap((s, k) => segmentsOf(s.path, k));
  return deepFreeze({ id, nodes: [steps[0].path[0], ...segments.map((s) => s.to)], segments });
}

/** Every scenario's route, by id. */
export const ROUTES = Object.freeze(Object.fromEntries(SCENARIOS.map(({ id }) => [id, scenarioRoute(id)])));

const uniq = (list) => [...new Set(list)];

/**
 * What the plant shows at step `stepInScenario` of a scenario: the current node and
 * tracks, where the package has been (passed), what is still to come (ahead), what the
 * scenario never uses (dimmed), the fork exits taken and not taken, and the stations
 * re-entered through a return track.
 * @param {string} scenarioId
 * @param {number} stepInScenario
 * @throws {RangeError} for an unknown id or an out-of-range step
 */
export function plantFocus(scenarioId, stepInScenario) {
  const route = ROUTES[scenarioId] ?? scenarioRoute(scenarioId);
  const { steps } = scenarioOf(scenarioId);
  const count = steps.length;
  if (!Number.isInteger(stepInScenario) || stepInScenario < 0 || stepInScenario >= count) {
    throw new RangeError(`step must be an integer from 0 to ${count - 1}, got ${String(stepInScenario)}`);
  }
  const k = stepInScenario;
  const { segments } = route;
  const own = segments.filter((s) => s.step === k);
  const upTo = segments.filter((s) => s.step <= k);
  const current = steps[k].path.at(-1);
  const currentTracks = uniq(own.map((s) => s.key));
  const currentSet = new Set(currentTracks);

  const passedTracks = uniq(segments.filter((s) => s.step < k).map((s) => s.key)).filter((key) => !currentSet.has(key));
  const passedNodes = uniq(upTo.flatMap((s) => [s.from, s.to]).concat(route.nodes[0])).filter((n) => n !== current);
  const passedNodeSet = new Set(passedNodes);
  const used = new Set(route.nodes);
  const aheadNodes = uniq(route.nodes).filter((n) => n !== current && !passedNodeSet.has(n));
  const taken = new Set([...currentSet, ...passedTracks]);
  const aheadTracks = uniq(segments.map((s) => s.key)).filter((key) => !taken.has(key));
  const usedTracks = new Set(segments.map((s) => s.key));

  const dimmedNodes = NODE_IDS.filter((n) => !used.has(n));
  const dimmedTracks = TRACKS.map(keyOf).filter((key) => !usedTracks.has(key));
  const dimNodeSet = new Set(dimmedNodes);
  const dimTrackSet = new Set(dimmedTracks);
  const labels = LABELS.filter((l) => !l.layer && ((l.hot && dimNodeSet.has(l.hot)) || (l.track && dimTrackSet.has(l.track)))).map((l) => l.id);

  const travelled = new Set(upTo.map((s) => s.key));
  const forks = uniq(upTo.map((s) => s.from)).filter((n) => FORKS[n]);
  const forkTaken = forks.flatMap((n) => FORKS[n].filter((key) => travelled.has(key)));
  const forkNot = forks.flatMap((n) => FORKS[n].filter((key) => !travelled.has(key)));

  return deepFreeze({
    current,
    currentTracks,
    passed: { nodes: passedNodes, tracks: passedTracks },
    ahead: { nodes: aheadNodes, tracks: aheadTracks },
    dimmed: { nodes: dimmedNodes, tracks: dimmedTracks, labels },
    taken: forkTaken,
    notTaken: forkNot,
    repeats: uniq(upTo.filter((s) => s.returns).map((s) => s.to)),
  });
}
