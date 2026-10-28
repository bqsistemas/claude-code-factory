// Remotion composition: the factory floor as an iso-glow figure. A dark
// isometric hairline drawing (SVG) of every station in the loop, where only what
// is live glows in the accent color: the current station, its agents, and the
// belt the job package rides in on. An HTML caption in the top-left corner keeps
// the stage, agents, models, and output file readable as text.
// Colors come from CSS classes and :root tokens in styles.css (never a style element:
// the CSP blocks it). Caption styles are React style objects (applied through the
// CSSOM, allowed by the CSP) and reuse the page's :root custom properties.
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

import { STAGES } from './engine.js';
import { Octopus } from './Octopus.jsx';
import {
  FLOOR,
  FLOOR_VIEWBOX,
  FORK,
  PLATE,
  REWORK_POINTS,
  STATIONS,
  iso,
  labelAnchor,
  packagePosition,
  stationOutline,
} from './scene.js';

const color = {
  bg: 'var(--color-bg, #0b0d17)',
  panel: 'rgba(21, 26, 46, 0.9)', // --color-panel, near-solid for text contrast
  text: 'var(--color-text, #e6edff)',
  muted: 'var(--color-muted, #a9b4d0)',
  cyan: 'var(--color-cyan, #00e5ff)',
  magenta: 'var(--color-magenta, #ff5ad9)',
  green: 'var(--color-green, #39ff88)',
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

// Layout breakpoint and docked panel size, mirrored from styles.css
// (min-width: 64rem; width: min(32rem, 40vw); bottom dock up to 45dvh).
const WIDE = 1024;
const panelWidth = (width) => Math.min(512, 0.4 * width) + 16;
const BOTTOM_PANEL = 0.45;
const HUD_HEIGHT = 56;
const MARGIN = 16;

// Where things go on screen: the caption box in the top-left corner and the
// floor drawing in the free area below it, left of a right-docked panel or above
// a bottom-docked one.
function screenLayout(stage, width, height) {
  const unit = Math.min(1.25, Math.max(0.75, Math.min(width, height) / 720));
  const wide = width >= WIDE;
  const captionTop = HUD_HEIGHT + 8;
  const freeRight = wide ? width - panelWidth(width) : width;
  const captionWidth = Math.min(freeRight - 2 * MARGIN, 760 * unit);
  // Rough caption height: heading lines plus one row per two or three chips.
  const perRow = Math.max(1, Math.floor(captionWidth / (260 * unit)));
  const rows = stage.agents.length === 0 ? 0.6 : Math.ceil(stage.agents.length / perRow);
  const captionBottom = captionTop + (115 + rows * 42) * unit;
  const freeBottom = wide ? height : height * (1 - BOTTOM_PANEL);
  const top = captionBottom + 8;
  return {
    unit,
    captionTop,
    captionWidth,
    scene: {
      left: MARGIN,
      top,
      width: Math.max(1, freeRight - 2 * MARGIN),
      height: Math.max(1, freeBottom - MARGIN - top),
    },
  };
}

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

function GroundPlate() {
  const [x, y, z] = PLATE.position;
  const [w, d, h] = PLATE.size;
  const inset = 8;
  return (
    <g>
      <IsoBox position={PLATE.position} size={PLATE.size} />
      <g transform={TOP(x, y, z + h)}>
        <rect className="iso-detail" x={inset} y={inset} width={w - 2 * inset} height={d - 2 * inset} rx="6" />
      </g>
    </g>
  );
}

// Dashed hairline behind the stations, from "wait-for-all" back to "build": the
// rework loop when a reviewer asks for changes. The arrowhead points into "build".
function ReworkLoop() {
  const end = REWORK_POINTS[REWORK_POINTS.length - 1];
  const arrow = [
    [end[0] - 5, end[1] - 8, 0],
    end,
    [end[0] + 5, end[1] - 8, 0],
  ];
  // The label stands on the FRONT plane of the loop's back segment, riding just
  // above the dashed line, so the line never crosses it.
  const [, back] = REWORK_POINTS;
  const mid = (REWORK_POINTS[1][0] + REWORK_POINTS[2][0]) / 2;
  return (
    <g>
      <path d={pathOf(REWORK_POINTS)} className="iso-wire" strokeDasharray="6 5" />
      <path d={pathOf(arrow)} className="iso-wire" />
      <g transform={FRONT(mid, back[1], 0)}>
        <text x={0} y={-4} textAnchor="middle" className="iso-label">
          Retrabajo: cambios pedidos
        </text>
      </g>
    </g>
  );
}

// The approval fork after "Resultado": a decision diamond on the outcome deck
// and two dotted branch wires, APPROVE to a pad behind the line (merge to main)
// and ESCALATE to a pad in front of it (needs-human). The pads are drawn with the
// stations, in depth order; this part rides at deck height on top of them. The
// tour does not know the real decision, so neither branch is chosen; when the
// current stage is "outcome" the diamond and both wires light up together.
// Half the side of the decision diamond. It is a square on the deck with its
// edges along x and y: in iso projection that reads as a diamond on screen (a
// square turned 45 degrees on the deck would project to a flat rectangle).
const FORK_DIAMOND = 14;
const ARROW = { back: 8, half: 5 };

function forkArrow(points) {
  const end = points[points.length - 1];
  const prev = points[points.length - 2];
  const axis = end[0] !== prev[0] ? 0 : 1;
  const dir = Math.sign(end[axis] - prev[axis]);
  const side = (s) => end.map((v, k) => (k === axis ? v - dir * ARROW.back : k === 1 - axis ? v + s * ARROW.half : v));
  return [side(-1), end, side(1)];
}

function ApprovalFork({ hot }) {
  const [px, py, pz] = FORK.point;
  const r = FORK_DIAMOND;
  const diamond = [
    [px - r, py - r, pz],
    [px + r, py - r, pz],
    [px + r, py + r, pz],
    [px - r, py + r, pz],
  ];
  return (
    <g>
      {FORK.branches.map((branch) => (
        <g key={branch.id}>
          <path d={pathOf(branch.points)} className={cx('iso-wire iso-branch', hot && 'iso-hot')} strokeDasharray="2 4" />
          <path d={pathOf(forkArrow(branch.points))} className={cx('iso-wire iso-branch', hot && 'iso-hot')} />
        </g>
      ))}
      <path d={`${pathOf(diamond)}Z`} className={cx('iso-face iso-face--top iso-fork', hot && 'iso-hot')} />
    </g>
  );
}

function ForkLabels() {
  return FORK.branches.map((branch) => {
    const [lx, ly] = at(branch.labelAnchor);
    return (
      <text key={branch.id} x={lx} y={ly} textAnchor="middle" className="iso-label">
        {branch.label}
      </text>
    );
  });
}

// The belt from a station to the next one: a flat strip at deck height, with an
// edge strip on its front and roller hairlines across it.
function Belt({ from, to }) {
  const x = from.position[0] + from.size[0];
  const length = to.position[0] - x;
  const [y0, y1] = FLOOR.lane;
  const z = from.size[2];
  return (
    <g>
      <rect transform={FRONT(x, y1, z)} width={length} height={4} className="iso-face" />
      <rect transform={TOP(x, y0, z)} width={length} height={y1 - y0} className="iso-face iso-face--top" />
      <g transform={TOP(x, y0, z)}>
        {Array.from({ length: Math.floor(length / 8) - 1 }, (_, k) => (
          <line key={k} className="iso-detail" x1={(k + 1) * 8} y1={3} x2={(k + 1) * 8} y2={y1 - y0 - 3} />
        ))}
      </g>
    </g>
  );
}

// One agent pod: a small box on the back of the deck with an LED on its front.
function Pod({ position, lit }) {
  const [px, py, pz] = position;
  const [w, d, h] = FLOOR.podSize;
  const led = FRONT(px, py + d, pz + h);
  return (
    <g>
      <IsoBox position={position} size={FLOOR.podSize} />
      <rect transform={led} x={3} y={3} width={w - 6} height={3} className="iso-led" />
      {lit > 0 && (
        <g opacity={lit} filter="url(#iso-glow)">
          <rect transform={led} x={3} y={3} width={w - 6} height={3} className="iso-led iso-hot" />
        </g>
      )}
    </g>
  );
}

// A station box with its agent pods. The current one fades to lit: a bloom halo
// behind the deck, an accent deck and front lip, and lit LEDs on its pods.
function Station({ station, stage, lit }) {
  const { position, size } = station;
  const [x, y] = position;
  const [w, d, h] = size;
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
      {stage.agents.map((agent, k) => (
        <Pod
          key={agent.name}
          position={[x + FLOOR.podInset + k * FLOOR.podPitch, y + FLOOR.podInset, h]}
          lit={lit}
        />
      ))}
    </g>
  );
}

// The belt into the current station as a lit wire along the package's lane, with
// a light pulse running ahead of the package.
function LitBelt({ from, to, lit, pulseOffset }) {
  const [ox, oy, oz] = FLOOR.packageOffset;
  const lane = oy + FLOOR.packageSize / 2;
  const mid = FLOOR.packageSize / 2;
  const d = pathOf([
    [from.position[0] + ox + mid, lane, oz],
    [to.position[0] + ox + mid, lane, oz],
  ]);
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

// The job package: a small lit box with a tape line across its top.
function JobPackage({ position }) {
  const s = FLOOR.packageSize;
  const [x, y, z] = position.map((v, k) => v + FLOOR.packageOffset[k]);
  return (
    <g>
      <IsoBox position={[x, y, z]} size={[s, s, s]} className="iso-hot" />
      <g transform={TOP(x, y, z + s)}>
        <line className="iso-wire" x1={s / 2} y1={0} x2={s / 2} y2={s} />
      </g>
    </g>
  );
}

// Paint order is the only depth sort: back to front, smaller x + y first. The
// fork pads join the stations here, so the APPROVE pad behind the line and the
// ESCALATE pad in front of it are each painted in their right place.
const PAINT_ORDER = [
  ...STATIONS.map((station, i) => ({ key: station.id, position: station.position, station: i })),
  ...FORK.branches.map((branch) => ({ key: `pad-${branch.id}`, position: branch.pad.position, pad: branch.pad })),
].sort((a, b) => a.position[0] + a.position[1] - (b.position[0] + b.position[1]));
const OUTCOME = STATIONS.findIndex((station) => station.id === 'outcome');

function IsoFloor({ active, frame, box }) {
  const current = STAGES[active];
  const lit = interpolate(frame, LIT_FRAMES, [0, 1], clamp);
  const progress = interpolate(frame, PACKAGE_FRAMES, [0, 1], { ...clamp, easing: ease });
  const pulseOffset = interpolate(frame, PACKAGE_FRAMES, PULSE_OFFSETS, clamp);
  const { x, y, width, height } = FLOOR_VIEWBOX;
  return (
    <svg
      className="iso-scene"
      role="img"
      aria-label={`Planta del factory: etapa ${active + 1} de ${STAGES.length}, ${current.title}`}
      viewBox={[x, y, width, height].map(num).join(' ')}
      preserveAspectRatio="xMidYMid meet"
      style={{ position: 'absolute', ...box }}
    >
      <Filters />
      <GroundPlate />
      <ReworkLoop />
      {PAINT_ORDER.map(({ key, station: i, pad }) =>
        pad ? (
          <IsoBox key={key} position={pad.position} size={pad.size} />
        ) : (
          <g key={key}>
            <Station station={STATIONS[i]} stage={STAGES[i]} lit={i === active ? lit : 0} />
            {i + 1 < STATIONS.length && <Belt from={STATIONS[i]} to={STATIONS[i + 1]} />}
          </g>
        ),
      )}
      <ApprovalFork hot={active === OUTCOME} />
      {active > 0 && <LitBelt from={STATIONS[active - 1]} to={STATIONS[active]} lit={lit} pulseOffset={pulseOffset} />}
      {/* The package rides at deck height in the front lane. Stations are no taller
          than their decks, and pods stand at the back of a deck, so nothing is ever
          in front of it: it is painted after every station. */}
      <JobPackage position={packagePosition(active, progress)} />
      {STAGES.map((stage, i) => {
        const [lx, ly] = at(labelAnchor(i));
        return (
          <text key={stage.id} x={lx} y={ly} textAnchor="end" className={cx('iso-label', i === active && 'iso-hot')}>
            {`${i + 1} · ${stage.title}`}
          </text>
        );
      })}
      <ForkLabels />
    </svg>
  );
}

// --- Station hit layer (guided tour only) ----------------------------------------

// A transparent copy of the floor's frame with one focusable polygon per
// station, drawn over the drawing so the drawing keeps role="img". Stations are
// drawn in order, so where neighbouring outlines overlap the later (right-hand)
// one wins, as it does in the drawing.
function StationHits({ active, box, onSelect }) {
  const { x, y, width, height } = FLOOR_VIEWBOX;
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
          onClick={() => onSelect(i)}
          onKeyDown={(event) => onKeyDown(event, i)}
        />
      ))}
    </svg>
  );
}

// --- Caption -------------------------------------------------------------------

function Caption({ stage, index, frame, layout }) {
  const { unit, captionTop, captionWidth } = layout;
  const enter = interpolate(frame, [0, 15], [0, 1], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        top: captionTop,
        left: 16,
        maxWidth: captionWidth,
        padding: `${12 * unit}px ${16 * unit}px`,
        background: color.panel,
        border: `2px solid ${color.magenta}`,
        borderRadius: 4,
        color: color.text,
        fontFamily: font,
        opacity: enter,
        transform: `translateY(${(1 - enter) * -12}px)`,
      }}
    >
      <div style={{ fontSize: 13 * unit, color: color.muted, textTransform: 'uppercase', letterSpacing: 2 }}>
        Etapa {index + 1} de {STAGES.length}
      </div>
      <div style={{ fontSize: 26 * unit, fontWeight: 700, lineHeight: 1.2, color: color.cyan, margin: `${2 * unit}px 0 ${8 * unit}px` }}>
        {stage.title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 * unit, marginBottom: 8 * unit }}>
        {stage.agents.length === 0 ? (
          <span style={{ fontSize: 16 * unit }}>Orquestador (sin agentes)</span>
        ) : (
          stage.agents.map((agent, i) => (
            <span
              key={agent.name}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6 * unit,
                fontSize: 15 * unit,
                padding: `0 ${10 * unit}px 0 ${4 * unit}px`,
                border: `2px solid ${color.green}`,
                borderRadius: 4,
                color: color.green,
              }}
            >
              <Octopus name={agent.name} size={30 * unit} offset={i} />
              {agent.name} · {agent.model}
            </span>
          ))
        )}
      </div>
      <div style={{ fontSize: 16 * unit }}>
        Escribe: <span style={{ color: color.magenta }}>{stage.output}</span>
      </div>
    </div>
  );
}

// `onSelect` is optional: when it is a function (the guided tour), every station
// becomes a button that calls onSelect(stationIndex). Without it (quiz screens)
// the output is the drawing and the caption only.
export function FactoryLoop({ stageIndex, onSelect }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const active = Math.min(Math.max(Number.isFinite(stageIndex) ? Math.trunc(stageIndex) : 0, 0), STAGES.length - 1);
  const layout = screenLayout(STAGES[active], width, height);
  return (
    <AbsoluteFill style={{ background: color.bg, color: color.text, fontFamily: font }}>
      <IsoFloor active={active} frame={frame} box={layout.scene} />
      {typeof onSelect === 'function' && <StationHits active={active} box={layout.scene} onSelect={onSelect} />}
      <Caption stage={STAGES[active]} index={active} frame={frame} layout={layout} />
    </AbsoluteFill>
  );
}
