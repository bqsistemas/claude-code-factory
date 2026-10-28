// Remotion composition: the factory as an iso-glow production plant. A dark
// isometric hairline drawing (SVG) of the v2 pipeline, laid out as four stacked
// layers: Entrada (the queue dock, intake's sorting gate with its two bins, the
// route switch), Producción (spec, build, the gate checkpoint), Control (the
// reviewers and the approver's fork) and Salida (the four output bays). Belts snake
// through the layers; every conditional branch is its own dashed wire. Only what is
// live glows in the accent colour: the lit node and the tracks of the current step.
// On the guided tour (`pipeline`) one scenario package rides the step's tracks (see
// pipeline.js); in the quiz a single package moves from station to station. The
// composition draws only the plant: the narration lives in the HTML text column.
// Colors come from CSS classes and :root tokens in styles.css (never a style element:
// the CSP blocks it).
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

import { AVATARS } from '../../factory/avatars.js';
import { STAGES } from './engine.js';
import { floorView, screenLayout } from './layout.js';
import { BELT_PERIOD_MS, BELT_PITCH, WIRE_PERIOD_MS, packageAt, treadOffset } from './pipeline.js';
import { SCENARIOS, TOUR_STEPS } from './scenarios.js';
import { TOUR_STEP_MS } from './tour.js';
import {
  FLOOR,
  FLOOR_VIEWBOX,
  LABELS,
  LAYER_PLATES,
  NODES,
  STATIONS,
  TRACKS,
  iso,
  labelBox,
  labelPosition,
  packagePosition,
  stationOutline,
} from './scene.js';

const color = {
  bg: 'var(--color-bg, #0b0d17)',
  text: 'var(--color-text, #e6edff)',
};
const font = 'var(--font-game, ui-monospace, Menlo, Consolas, monospace)';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const ease = Easing.inOut(Easing.cubic);

// Timeline (30 fps): the current station lights up, then the package rides in
// from the previous station with a light pulse running ahead of it on the belt;
// everything holds still from frame 75 to the end.
const LIT_FRAMES = [0, 15];
const PACKAGE_FRAMES = [15, 75];
// The pulse is a 70-unit dash on a path with pathLength 1000 (see .iso-pulse).
const PULSE_OFFSETS = [70, -1000];

// --- Iso kernel (iso-figure, MIT) ----------------------------------------------

const num = (v) => Math.round(v * 1000) / 1000;
const at = (point) => iso(point).map(num);

// A face plane: local x runs along U, local y along V, origin at O. Ordinary
// rects, lines, and text drawn inside land on that plane.
const plane = (origin, u, v) => {
  const [ox, oy] = iso(origin);
  const [ux, uy] = iso(u);
  const [vx, vy] = iso(v);
  return `matrix(${[ux, uy, vx, vy, ox, oy].map(num).join(' ')})`;
};
const TOP = (x, y, z) => plane([x, y, z], [1, 0, 0], [0, 1, 0]);
const FRONT = (x, y, z) => plane([x, y, z], [1, 0, 0], [0, 0, -1]); // y = max face, lower-left
const SIDE = (x, y, z) => plane([x, y, z], [0, -1, 0], [0, 0, -1]); // x = max face, lower-right

const pathOf = (points) => `M${points.map((p) => at(p).join(' ')).join('L')}`;

const cx = (...names) => names.filter(Boolean).join(' ');

// A box is its three visible faces, each an opaque rect on its plane.
function IsoBox({ position: [x, y, z], size: [w, d, h], className }) {
  return (
    <g>
      <rect transform={SIDE(x + w, y + d, z + h)} width={d} height={h} className={cx('iso-face', className)} />
      <rect transform={FRONT(x, y + d, z + h)} width={w} height={h} className={cx('iso-face', className)} />
      <rect transform={TOP(x, y, z + h)} width={w} height={d} className={cx('iso-face iso-face--top', className)} />
    </g>
  );
}

// --- Floor parts -----------------------------------------------------------------

function Filters() {
  // Filters use userSpaceOnUse so perfectly straight lines (zero-height boxes)
  // still glow; the region covers the whole viewBox with room for the blur.
  const region = {
    x: num(FLOOR_VIEWBOX.x - 100),
    y: num(FLOOR_VIEWBOX.y - 100),
    width: num(FLOOR_VIEWBOX.width + 200),
    height: num(FLOOR_VIEWBOX.height + 200),
  };
  return (
    <defs>
      <filter id="iso-glow" filterUnits="userSpaceOnUse" {...region}>
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="iso-soft" filterUnits="userSpaceOnUse" {...region}>
        <feGaussianBlur stdDeviation="2.2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="iso-bloom" filterUnits="userSpaceOnUse" {...region}>
        <feGaussianBlur stdDeviation="9" />
      </filter>
    </defs>
  );
}

// One slab per layer, higher the further back it is, with an inset outline on top.
// The layer that holds the lit node takes the accent.
const SLAB = FLOOR.plateThickness;
function GroundPlate({ litLayer }) {
  const inset = 8;
  return (
    <g>
      {LAYER_PLATES.map(({ id, index, position: [x, y, z], size: [w, d] }) => (
        <g key={id}>
          <IsoBox position={[x, y, z - SLAB]} size={[w, d, SLAB]} />
          <g transform={TOP(x, y, z)}>
            <rect className={cx('iso-layer', index === litLayer && 'iso-hot')} x={inset} y={inset} width={w - 2 * inset} height={d - 2 * inset} rx="6" />
          </g>
        </g>
      ))}
    </g>
  );
}

const ARROW = { back: 8, half: 5 };
// Dotted wires (strokeDasharray "2 4") repeat every 6 units. On the tour the
// dots travel along the wire, one period per melody beat, the way packages ride it.
const DOT_PERIOD = 6;
// Half the side of a decision diamond. It is a square on the deck with its edges
// along x and y: in iso projection that reads as a diamond on screen.
const DIAMOND = 7;
// Wires are drawn through the package's centre; track points are its min corner.
const HALF = FLOOR.packageSize / 2;
const centre = ([x, y, z]) => [x + HALF, y + HALF, z];

// An arrowhead on the last horizontal segment of a wire (a drop into a bin or a bay
// has none), pointing the way the wire runs.
function arrowOf(points) {
  let k = points.length - 1;
  while (k > 0 && points[k][0] === points[k - 1][0] && points[k][1] === points[k - 1][1]) k -= 1;
  const end = points[k];
  const prev = points[k - 1];
  const axis = end[0] !== prev[0] ? 0 : 1;
  const dir = Math.sign(end[axis] - prev[axis]);
  const side = (s) => end.map((v, i) => (i === axis ? v - dir * ARROW.back : i === 1 - axis ? v + s * ARROW.half : v));
  return [side(-1), end, side(1)];
}

const KIND_CLASS = { branch: 'iso-branch', loop: 'iso-loop', human: 'iso-human' };
const trackKey = (t) => `${t.from}>${t.to}`;
const WIRES = TRACKS.filter((t) => t.kind !== 'belt').map((t) => ({ ...t, key: trackKey(t), points: t.points.map(centre) }));
const STATION_ID = new Map(STATIONS.map((st, i) => [st.id, i]));
const trackNamed = (from, to) => TRACKS.find((t) => t.from === from && t.to === to);
// Where a station's exits split: the first corner of its first branch.
const junction = (from, to) => centre(trackNamed(from, to).points[1]);
const GATE_AT = junction('intake', 'bin-reject');
const FORK_AT = junction('approve', 'bay-needs-human');
const LENSES = ['security', 'ux', 'ui', 'code'];
// The layer each node stands on: a station's own, the bins on the first, the bays on the last.
const LAYER_OF = new Map(Object.values(NODES).map(({ id, kind }) => [id, kind === 'station' ? STATIONS[STATION_ID.get(id)].layer : kind === 'bin' ? 0 : LAYER_PLATES.length - 1]));
// The belts: flat strips at deck height along every belt track (the turns between
// layers included), with an edge strip on the visible side and roller hairlines
// across. Each strip is cut where it meets a station, so it only shows between them.
// On the tour (`time`) the rollers run the way the line runs; without it they stand still.
const LIFT = 6;
const STRIP_HALF = (FLOOR.lane[1] - FLOOR.lane[0]) / 2;
const NODE_BOXES = Object.values(NODES).map(({ position, size }) => ({ position, size }));
const BELTS = TRACKS.filter((t) => t.kind === 'belt').flatMap((t) =>
  t.points.slice(1).flatMap((to, k) => {
    const from = t.points[k];
    // A lift between two layers: a slim pillar.
    if (from[0] === to[0] && from[1] === to[1]) {
      return [{ key: `${trackKey(t)}:${k}:lift`, lift: [from[0] + HALF - LIFT / 2, from[1] + HALF - LIFT / 2, Math.min(from[2], to[2]), Math.abs(to[2] - from[2])] }];
    }
    const axis = from[0] === to[0] ? 1 : 0;
    const cross = 1 - axis;
    const dir = Math.sign(to[axis] - from[axis]);
    const z = from[2];
    const across = [from[cross] + HALF - STRIP_HALF, from[cross] + HALF + STRIP_HALF];
    let pieces = [[Math.min(from[axis], to[axis]) + HALF, Math.max(from[axis], to[axis]) + HALF]];
    for (const { position, size } of NODE_BOXES) {
      if (position[cross] >= across[1] || position[cross] + size[cross] <= across[0]) continue;
      const cut = [position[axis], position[axis] + size[axis]];
      pieces = pieces.flatMap(([a, b]) => (cut[1] <= a || cut[0] >= b ? [[a, b]] : [[a, Math.min(b, cut[0])], [Math.max(a, cut[1]), b]].filter(([p, q]) => q - p > 0.5)));
    }
    const len = Math.abs(to[axis] - from[axis]);
    return pieces.map(([a, b]) => ({ key: `${trackKey(t)}:${k}:${a}`, axis, dir, z, a, b, across, origin: from[axis] + HALF, len }));
  }),
);

function Belts({ time }) {
  const shift = treadOffset(time, BELT_PITCH, BELT_PERIOD_MS);
  return (
    <g>
      {BELTS.map(({ key, lift, axis, dir, z, a, b, across, origin, len }) => {
        if (lift) return <IsoBox key={key} position={[lift[0], lift[1], lift[2]]} size={[LIFT, LIFT, lift[3]]} />;
        const length = b - a;
        const width = across[1] - across[0];
        // Rollers sit at fixed distances from the segment start, so they advance along it.
        const rollers = [];
        for (let r = shift; r < len; r += BELT_PITCH) {
          const where = origin + dir * r;
          if (where >= a + 3 && where <= b - 3) rollers.push(num(where - a));
        }
        const top = axis === 0 ? TOP(a, across[0], z) : TOP(across[0], a, z);
        const edge = axis === 0 ? FRONT(a, across[1], z) : SIDE(across[1], b, z);
        return (
          <g key={key}>
            <rect transform={edge} width={length} height={4} className="iso-face" />
            <rect transform={top} width={axis === 0 ? length : width} height={axis === 0 ? width : length} className="iso-face iso-face--top" />
            <g transform={top}>
              {rollers.map((r, i) => (
                <line
                  key={i}
                  className="iso-detail"
                  x1={axis === 0 ? r : 3}
                  y1={axis === 0 ? 3 : r}
                  x2={axis === 0 ? r : width - 3}
                  y2={axis === 0 ? width - 3 : r}
                />
              ))}
            </g>
          </g>
        );
      })}
    </g>
  );
}

// Branch, loop and human tracks: dotted hairlines at deck height with an arrowhead.
// On the tour the dots travel along the wire; in the quiz they stand still.
function Wires({ time }) {
  return (
    <g>
      {WIRES.map(({ key, kind, points }) => (
        <g key={key}>
          <path
            d={pathOf(points)}
            className={cx('iso-wire', KIND_CLASS[kind])}
            strokeDasharray="2 4"
            strokeDashoffset={-treadOffset(time, DOT_PERIOD, WIRE_PERIOD_MS)}
          />
          <path d={pathOf(arrowOf(points))} className={cx('iso-wire', KIND_CLASS[kind])} />
        </g>
      ))}
    </g>
  );
}

// The tracks the current step rides, as lit wires with a glow.
function LitTracks({ keys, lit }) {
  if (keys.length === 0 || lit <= 0) return null;
  return (
    <g opacity={lit} filter="url(#iso-soft)">
      {keys.map((key) => {
        const track = TRACKS.find((t) => trackKey(t) === key);
        return <path key={key} d={pathOf(track.points.map(centre))} className="iso-wire iso-hot" />;
      })}
    </g>
  );
}

// One agent pod: a small box on the back of the deck with an LED on its front.
// Lit, the LED and its glow take the agent's avatar colour. The colour is a
// style (CSSOM, allowed by the CSP) so it wins over the .iso-led.iso-hot fill.
function Pod({ name, position, lit }) {
  const [px, py, pz] = position;
  const [w, d, h] = FLOOR.podSize;
  const led = FRONT(px, py + d, pz + h);
  const glow = AVATARS[name]?.color;
  return (
    <g>
      <IsoBox position={position} size={FLOOR.podSize} />
      <rect transform={led} x={3} y={3} width={w - 6} height={3} className="iso-led" />
      {lit > 0 && (
        <g opacity={lit} filter="url(#iso-glow)">
          <rect
            transform={led}
            x={3}
            y={3}
            width={w - 6}
            height={3}
            className="iso-led iso-hot"
            style={glow ? { fill: glow } : undefined}
          />
        </g>
      )}
    </g>
  );
}

// A flat diamond on a deck: a decision point where the line splits.
function Diamond({ at: [px, py, pz], hot }) {
  const r = DIAMOND;
  const corners = [
    [px - r, py - r, pz],
    [px + r, py - r, pz],
    [px + r, py + r, pz],
    [px - r, py + r, pz],
  ];
  return <path d={`${pathOf(corners)}Z`} className={cx('iso-face iso-face--top iso-fork', hot && 'iso-hot')} />;
}

// The route station is a switch: four lamps, one per review lens, lit for the
// lenses the job routes to.
function Lamps({ station, routed }) {
  const [x, y, z] = station.position;
  const size = 8;
  return (
    <g transform={TOP(x, y, z + station.size[2])}>
      {LENSES.map((lens, k) => {
        const on = routed.includes(lens);
        const glow = AVATARS[`review-${lens}`]?.color;
        const lx = 8 + k * 11;
        return (
          <g key={lens}>
            <rect x={lx} y={10} width={size} height={size} className="iso-detail">
              <title>{`lente ${lens}`}</title>
            </rect>
            {on && (
              <g filter="url(#iso-glow)">
                <rect x={lx} y={10} width={size} height={size} className="iso-led iso-hot" style={glow ? { fill: glow } : undefined}>
                  <title>{`lente ${lens}`}</title>
                </rect>
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

// The gate is a checkpoint: two posts and a bar across the lane past the package.
function Checkpoint({ station }) {
  const [x, y, z] = station.position;
  const top = z + station.size[2];
  const [y0, y1] = FLOOR.lane;
  return (
    <g>
      <IsoBox position={[x + 34, y + y0, top]} size={[4, 4, 10]} />
      <IsoBox position={[x + 34, y + y1 - 4, top]} size={[4, 4, 10]} />
      <IsoBox position={[x + 34, y + y0, top + 10]} size={[4, y1 - y0, 3]} />
    </g>
  );
}

// A station box with its agent pods. The lit one fades to lit: a bloom halo behind
// the deck, an accent deck and front lip, and lit LEDs on its pods. `litPods` is
// the set of agent names whose pods glow; null lights them all.
function Station({ station, stage, lit, litPods, routed }) {
  const { position, size } = station;
  const [x, y, z] = position;
  const [w, d, height] = size;
  const h = z + height;
  const halo = 14;
  return (
    <g>
      {lit > 0 && (
        <g opacity={lit} filter="url(#iso-bloom)">
          <rect
            transform={TOP(x - halo, y - halo, h)}
            width={w + 2 * halo}
            height={d + 2 * halo}
            rx="10"
            className="iso-halo iso-hot"
          />
        </g>
      )}
      <IsoBox position={position} size={size} />
      <g transform={FRONT(x, y + d, h)}>
        <line className="iso-detail" x1={0} y1={5} x2={w} y2={5} />
      </g>
      {lit > 0 && (
        <g opacity={lit}>
          <g filter="url(#iso-soft)">
            <rect transform={TOP(x, y, h)} width={w} height={d} className="iso-face iso-face--top iso-hot" />
          </g>
          <g transform={FRONT(x, y + d, h)} filter="url(#iso-soft)">
            <line className="iso-wire iso-hot" x1={0} y1={5} x2={w} y2={5} />
          </g>
        </g>
      )}
      {stage.id === 'intake' && <Diamond at={GATE_AT} hot={lit > 0} />}
      {stage.id === 'approve' && <Diamond at={FORK_AT} hot={lit > 0} />}
      {stage.id === 'route' && <Lamps station={station} routed={routed} />}
      {stage.id === 'gate' && <Checkpoint station={station} />}
      {stage.agents.map((agent, k) => (
        <Pod
          key={agent.name}
          name={agent.name}
          position={[x + FLOOR.podInset + k * FLOOR.podPitch, y + FLOOR.podInset, h]}
          lit={litPods === null || litPods.has(agent.name) ? lit : 0}
        />
      ))}
    </g>
  );
}

// A bin at intake's sorting gate or an output bay: a low box that lights up when
// the package ends there.
function LowNode({ node, lit }) {
  const [x, y, z] = node.position;
  const [w, d, height] = node.size;
  const h = z + height;
  const halo = 12;
  return (
    <g>
      {lit > 0 && (
        <g opacity={lit} filter="url(#iso-bloom)">
          <rect transform={TOP(x - halo, y - halo, h)} width={w + 2 * halo} height={d + 2 * halo} rx="10" className="iso-halo iso-hot" />
        </g>
      )}
      <IsoBox position={node.position} size={node.size} />
      {lit > 0 && (
        <g opacity={lit} filter="url(#iso-soft)">
          <rect transform={TOP(x, y, h)} width={w} height={d} className="iso-face iso-face--top iso-hot" />
        </g>
      )}
    </g>
  );
}

// The belt into the current station as a lit wire along the package's lane, with
// a light pulse running ahead of the package (quiz only).
function LitBelt({ from, to, lit, pulseOffset }) {
  const d = pathOf(trackNamed(from, to).points.map(centre));
  return (
    <g>
      <g opacity={lit} filter="url(#iso-soft)">
        <path d={d} className="iso-wire iso-hot" />
      </g>
      <g filter="url(#iso-glow)">
        <path d={d} pathLength="1000" strokeDashoffset={pulseOffset} className="iso-pulse" />
      </g>
    </g>
  );
}

// A job package: a small lit box with a tape line across its top, at an absolute
// min-corner position.
function Package({ position: [x, y, z] }) {
  const s = FLOOR.packageSize;
  return (
    <g>
      <IsoBox position={[x, y, z]} size={[s, s, s]} className="iso-hot" />
      <g transform={TOP(x, y, z + s)}>
        <line className="iso-wire" x1={s / 2} y1={0} x2={s / 2} y2={s} />
      </g>
    </g>
  );
}

// Paint order is the only depth sort: back to front, smaller x + y first. Bins and
// bays join the stations here, so the ones behind the line and the ones in front of
// it are each painted in their right place.
const PAINT_ORDER = Object.values(NODES)
  .map((node) => ({ node, order: node.position[0] + node.position[1] }))
  .sort((a, b) => a.order - b.order);

// Flat text at fixed screen positions (see LABELS in scene.js); the one of the lit node is lit.
function Labels({ litId, view }) {
  return (
    <g>
      {LABELS.map((item) => {
        // Where the camera window is narrower than the plant (phones), a label the window
        // would cut in half is left out.
        const box = labelBox(item);
        if (box.x0 < view.x || box.x1 > view.x + view.width || box.y0 < view.y || box.y1 > view.y + view.height) return null;
        const [lx, ly] = labelPosition(item);
        return (
          <text key={item.id} x={num(lx)} y={num(ly)} textAnchor={item.anchor} className={cx('iso-label', item.layer && 'iso-label--layer', item.hot && item.hot === litId && 'iso-hot')}>
            {item.text}
          </text>
        );
      })}
    </g>
  );
}

// `step` is the TOUR_STEPS entry at `stepIndex` on the tour, and undefined in the quiz.
// `stepMs` is the time since the step started; `time` is the same on the tour's
// whole-cycle clock, which keeps belts and wires seamless from one step to the next.
function IsoFloor({ active, frame, box, time, step, view, pkg }) {
  const current = STAGES[Math.max(active, 0)];
  const tour = step !== undefined;
  const scenario = tour ? SCENARIOS[step.scenarioIndex] : null;
  const litId = tour ? step.path[step.path.length - 1] : current.id;
  const lit = interpolate(frame, LIT_FRAMES, [0, 1], clamp);
  const pulseOffset = interpolate(frame, PACKAGE_FRAMES, PULSE_OFFSETS, clamp);
  const litKeys = tour ? step.path.slice(1).map((id, k) => `${step.path[k]}>${id}`) : [];
  const litPods = tour ? new Set(step.actors.map((actor) => actor.name)) : null;
  const routed = scenario ? Object.keys(scenario.routed.reviewers) : [];
  const { x, y, width, height } = view;
  const label = tour
    ? `Planta del factory: ${scenario.title}, paso ${step.stepInScenario + 1} de ${scenario.steps.length}`
    : `Planta del factory: etapa ${active + 1} de ${STAGES.length}, ${current.title}`;
  return (
    <svg
      className="iso-scene"
      role="img"
      aria-label={label}
      viewBox={[x, y, width, height].map(num).join(' ')}
      preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', ...box }}
    >
      <Filters />
      <GroundPlate litLayer={LAYER_OF.get(litId)} />
      <Belts time={time} />
      {PAINT_ORDER.map(({ node }) => {
        const i = STATION_ID.get(node.id);
        if (i === undefined) return <LowNode key={node.id} node={node} lit={node.id === litId ? lit : 0} />;
        return (
          <g key={node.id}>
            <Station
              station={STATIONS[i]}
              stage={STAGES[i]}
              lit={node.id === litId ? lit : 0}
              litPods={litPods}
              routed={routed}
            />
          </g>
        );
      })}
      <Wires time={time} />
      {tour ? (
        <LitTracks keys={litKeys} lit={lit} />
      ) : (
        active > 0 && <LitBelt from={STATIONS[active - 1].id} to={STATIONS[active].id} lit={lit} pulseOffset={pulseOffset} />
      )}
      {/* The package rides at deck height; nothing stands in front of it on a deck, and
          bins and bays are lower than the deck, so it is painted after every node. */}
      <Package position={pkg} />
      <Labels litId={litId} view={view} />
    </svg>
  );
}

// --- Station hit layer (guided tour only) ----------------------------------------

// A transparent copy of the floor's frame with one focusable polygon per
// station, drawn over the drawing so the drawing keeps role="img". Stations are
// drawn in order, so where neighbouring outlines overlap the later (right-hand)
// one wins, as it does in the drawing.
function StationHits({ active, box, view, onSelect }) {
  const { x, y, width, height } = view;
  const onKeyDown = (event, i) => {
    if (event.key === 'Enter' || event.key === ' ') {
      if (event.key === ' ') event.preventDefault();
      onSelect(i);
    }
  };
  return (
    <svg
      className="iso-hits"
      role="group"
      aria-label="Estaciones del factory"
      viewBox={[x, y, width, height].map(num).join(' ')}
      preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', ...box }}
    >
      {STAGES.map((stage, i) => (
        <polygon
          key={stage.id}
          className="iso-hit"
          points={stationOutline(i)
            .map((p) => p.map(num).join(','))
            .join(' ')}
          role="button"
          tabIndex={0}
          aria-label={`Etapa ${i + 1}: ${stage.title}`}
          aria-current={i === active ? 'step' : undefined}
          // A pointer press never moves focus here, so a click draws no focus
          // ring; Tab focus still shows the :focus-visible hairline.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onSelect(i)}
          onKeyDown={(event) => onKeyDown(event, i)}
        />
      ))}
    </svg>
  );
}

// `onSelect` is optional: when it is a function (the guided tour), every station
// becomes a button that calls onSelect(stationIndex). Without it (quiz screens)
// the output is the drawing only. `pipeline` (the guided tour) makes `stepIndex`
// pick the TOUR_STEPS entry the floor shows; otherwise `stageIndex` picks the stage.
// `split` is true on wide screens, where the Player fills the right column and the
// whole composition is the floor box; below 64rem the floor box leaves room for the dock.
export function FactoryLoop({ stageIndex, stepIndex, onSelect, pipeline = false, split = false }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const clampTo = (v, length) => Math.min(Math.max(Number.isFinite(v) ? Math.trunc(v) : 0, 0), length - 1);
  const tour = pipeline === true;
  const stepAt = clampTo(stepIndex, TOUR_STEPS.length);
  const step = tour ? TOUR_STEPS[stepAt] : undefined;
  // On the tour the active station is where the step ends (-1 for a bin or a bay: none).
  const active = tour ? STATION_ID.get(step.path[step.path.length - 1]) ?? -1 : clampTo(stageIndex, STAGES.length);
  const layout = screenLayout(width, height, split);
  const stepMs = (frame * 1000) / fps;
  const progress = interpolate(frame, PACKAGE_FRAMES, [0, 1], { ...clamp, easing: ease });
  const pkg = tour
    ? packageAt(stepAt, stepMs).position
    : packagePosition(active, progress).map((v, k) => v + FLOOR.packageOffset[k]);
  const view = floorView(layout.scene, iso(pkg.map((v) => v + FLOOR.packageSize / 2)));
  const time = tour ? stepAt * TOUR_STEP_MS + stepMs : undefined;
  return (
    <AbsoluteFill style={{ background: color.bg, color: color.text, fontFamily: font }}>
      <IsoFloor active={active} frame={frame} box={layout.scene} time={time} step={step} view={view} pkg={pkg} />
      {typeof onSelect === 'function' && <StationHits active={active} box={layout.scene} view={view} onSelect={onSelect} />}
    </AbsoluteFill>
  );
}
