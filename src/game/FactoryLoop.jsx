// Remotion composition: the factory loop as a row of stage boxes, with the current
// stage highlighted and its agents, models, and output file shown below.
// Styles are React style objects (applied through the CSSOM, allowed by the CSP)
// and reuse the page's :root custom properties, with fallbacks.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

import { STAGES } from './engine.js';
import { Octopus } from './Octopus.jsx';

const color = {
  bg: 'var(--color-bg, #0b0d17)',
  panel: 'var(--color-panel, #151a2e)',
  text: 'var(--color-text, #e6edff)',
  muted: 'var(--color-muted, #a9b4d0)',
  cyan: 'var(--color-cyan, #00e5ff)',
  magenta: 'var(--color-magenta, #ff5ad9)',
  green: 'var(--color-green, #39ff88)',
  track: 'var(--color-track, #2a3150)',
};
const font = 'var(--font-game, ui-monospace, Menlo, Consolas, monospace)';

const BOX_W = 160;
const BOX_H = 110;
const GAP = 22;
const LEFT = (1280 - (STAGES.length * BOX_W + (STAGES.length - 1) * GAP)) / 2;
const TOP = 100;
const boxX = (i) => LEFT + i * (BOX_W + GAP);

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

function StageBox({ stage, index, active, frame, fps }) {
  const appear = interpolate(frame, [index * 3, index * 3 + 12], [0, 1], clamp);
  const pop = active ? spring({ frame: frame - 28, fps, config: { damping: 12 } }) : 0;
  const scale = 1 + pop * 0.12;
  return (
    <div
      style={{
        position: 'absolute',
        left: boxX(index),
        top: TOP,
        width: BOX_W,
        height: BOX_H,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
        padding: 8,
        textAlign: 'center',
        background: color.panel,
        border: `3px solid ${active ? color.cyan : color.track}`,
        borderRadius: 6,
        boxShadow: active ? `0 0 ${24 * pop}px ${color.cyan}` : 'none',
        color: active ? color.cyan : color.muted,
        opacity: appear,
        transform: `translateY(${(1 - appear) * 20}px) scale(${scale})`,
      }}
    >
      <span style={{ fontSize: 16, color: active ? color.magenta : color.muted }}>{index + 1}</span>
      <span style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>{stage.title}</span>
    </div>
  );
}

function Arrow({ index, frame }) {
  const appear = interpolate(frame, [index * 3 + 8, index * 3 + 16], [0, 1], clamp);
  return (
    <div
      style={{
        position: 'absolute',
        left: boxX(index) + BOX_W,
        top: TOP + BOX_H / 2 - 18,
        width: GAP,
        textAlign: 'center',
        fontSize: 28,
        color: color.muted,
        opacity: appear,
      }}
    >
      →
    </div>
  );
}

// U-shaped line under the boxes from "wait-for-all" back to "build".
function ReworkLoop({ frame }) {
  const from = STAGES.findIndex((s) => s.id === 'build');
  const to = STAGES.findIndex((s) => s.id === 'wait-for-all');
  const appear = interpolate(frame, [22, 34], [0, 1], clamp);
  const left = boxX(from) + BOX_W / 2;
  const width = boxX(to) - boxX(from);
  return (
    <div style={{ opacity: appear }}>
      <div
        style={{
          position: 'absolute',
          left,
          top: TOP + BOX_H + 8,
          width,
          height: 28,
          borderLeft: `3px dashed ${color.magenta}`,
          borderRight: `3px dashed ${color.magenta}`,
          borderBottom: `3px dashed ${color.magenta}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: left - 150,
          top: TOP + BOX_H + 42,
          width: width + 300,
          textAlign: 'center',
          fontSize: 17,
          color: color.magenta,
        }}
      >
        CHANGES: vuelve al builder (máx. 2 rondas)
      </div>
    </div>
  );
}

function StageDetail({ stage, index, frame, fps }) {
  const enter = spring({ frame: frame - 36, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        position: 'absolute',
        left: LEFT,
        right: LEFT,
        top: 290,
        bottom: 96,
        padding: '22px 32px',
        background: color.panel,
        border: `3px solid ${color.magenta}`,
        borderRadius: 6,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 40}px)`,
      }}
    >
      <div style={{ fontSize: 20, color: color.muted, textTransform: 'uppercase', letterSpacing: 2 }}>
        Etapa {index + 1} de {STAGES.length}
      </div>
      <div style={{ fontSize: 40, fontWeight: 700, color: color.cyan, margin: '4px 0 12px' }}>
        {stage.title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        {stage.agents.length === 0 ? (
          <span style={{ fontSize: 24, color: color.text }}>Orquestador (sin agentes)</span>
        ) : (
          stage.agents.map((agent, i) => {
            const chip = interpolate(frame, [44 + i * 5, 54 + i * 5], [0, 1], clamp);
            return (
              <span
                key={agent.name}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 22,
                  padding: '0 14px 0 6px',
                  border: `2px solid ${color.green}`,
                  borderRadius: 4,
                  color: color.green,
                  opacity: chip,
                }}
              >
                <Octopus name={agent.name} offset={i} />
                {agent.name} · {agent.model}
              </span>
            );
          })
        )}
      </div>
      <div style={{ fontSize: 26, color: color.text }}>
        Escribe: <span style={{ color: color.magenta }}>{stage.output}</span>
      </div>
    </div>
  );
}

export function FactoryLoop({ stageIndex }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = Math.min(Math.max(stageIndex, 0), STAGES.length - 1);
  return (
    <AbsoluteFill style={{ background: color.bg, color: color.text, fontFamily: font }}>
      <div
        style={{
          position: 'absolute',
          top: 30,
          width: '100%',
          textAlign: 'center',
          fontSize: 30,
          letterSpacing: 4,
          textTransform: 'uppercase',
          color: color.muted,
        }}
      >
        El loop del factory
      </div>
      {STAGES.map((stage, i) => (
        <StageBox key={stage.id} stage={stage} index={i} active={i === active} frame={frame} fps={fps} />
      ))}
      {STAGES.slice(0, -1).map((stage, i) => (
        <Arrow key={stage.id} index={i} frame={frame} />
      ))}
      <ReworkLoop frame={frame} />
      <StageDetail stage={STAGES[active]} index={active} frame={frame} fps={fps} />
    </AbsoluteFill>
  );
}
