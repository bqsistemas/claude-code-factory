// Remotion composition: a real-time 3D factory floor. Each stage is a station on
// a conveyor, the job package rides the belt to the current stage, and every
// agent stands at its station as a 3D octopus. An HTML caption in the top-left
// corner keeps the stage, agents, models, and output file readable as text.
// Caption styles are React style objects (applied through the CSSOM, allowed by
// the CSP) and reuse the page's :root custom properties, with fallbacks.
import { Component, useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { ThreeCanvas } from '@remotion/three';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { CatmullRomCurve3, Vector3 } from 'three';

import { STAGES } from './engine.js';
import { Octopus } from './Octopus.jsx';
import { Octopus3D } from './Octopus3D.jsx';
import { STATIONS, cameraFor, packagePosition } from './scene.js';

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

// three.js cannot read CSS custom properties, so the scene uses their values.
const hex = {
  bg: '#0b0d17',
  floor: '#151a2e',
  track: '#2a3150',
  belt: '#3a4466',
  cyan: '#00e5ff',
  magenta: '#ff5ad9',
  box: '#c8955a',
  tape: '#fff7d6',
};

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
const ease = Easing.inOut(Easing.cubic);

// Timeline (30 fps): the camera glides to the current station, then the
// package rides in; everything holds still from frame 75 to the end.
const CAMERA_FRAMES = [0, 45];
const PACKAGE_FRAMES = [15, 75];

// Layout breakpoint and docked panel size, mirrored from styles.css
// (min-width: 64rem; width: min(32rem, 40vw); bottom dock up to 45dvh).
const WIDE = 1024;
const panelWidth = (width) => Math.min(512, 0.4 * width) + 16;
const BOTTOM_PANEL = 0.45;
const HUD_HEIGHT = 56;

// Where things go on screen: the caption box in the top-left corner and the
// current station centered in the free area between the caption and the panel
// (to the left of a right-docked panel, or above a bottom-docked one).
function screenLayout(stage, width, height) {
  const unit = Math.min(1.25, Math.max(0.75, Math.min(width, height) / 720));
  const wide = width >= WIDE;
  const captionTop = HUD_HEIGHT + 8;
  const captionWidth = Math.min((wide ? width - panelWidth(width) : width) - 32, 760 * unit);
  // Rough caption height: heading lines plus one row per two or three chips.
  const perRow = Math.max(1, Math.floor(captionWidth / (260 * unit)));
  const rows = stage.agents.length === 0 ? 0.6 : Math.ceil(stage.agents.length / perRow);
  const captionBottom = captionTop + (115 + rows * 42) * unit;
  const freeBottom = wide ? height : height * (1 - BOTTOM_PANEL);
  return {
    unit,
    captionTop,
    captionWidth,
    centerX: wide ? (width - panelWidth(width)) / 2 : width / 2,
    centerY: captionBottom + (freeBottom - captionBottom) * 0.5,
  };
}

const PLATFORM_DEPTH = 2.2;
const AGENT_GAP = 1.1;
const platformWidth = (stage) => Math.max(2.2, stage.agents.length * AGENT_GAP + 0.4);

// --- WebGL detection -------------------------------------------------------

let webglSupport;
/** True when the browser can create a WebGL context; checked once. */
function hasWebGL() {
  if (webglSupport === undefined) {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      webglSupport = Boolean(gl);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}

// If the renderer still fails (lost GPU, blocked context), drop the 3D layer and
// keep the caption and the quiz working.
class SceneBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// --- 3D scene ----------------------------------------------------------------

const lerp3 = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);

// Moves the camera between stations and shifts the view so the station lands
// in the part of the screen the docked quiz panel leaves free.
function CameraRig({ stageIndex, progress, width, height, centerX, centerY }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const from = cameraFor(stageIndex - 1);
    const to = cameraFor(stageIndex);
    camera.position.set(...lerp3(from.position, to.position, progress));
    camera.lookAt(...lerp3(from.target, to.target, progress));

    const aspect = width / height;
    // Portrait screens get a wider vertical angle so the station still fits across.
    camera.fov = aspect < 1 ? Math.min(70, (2 * Math.atan(Math.tan(Math.PI / 8) / aspect) * 180) / Math.PI) : 45;
    camera.setViewOffset(width, height, width / 2 - centerX, height / 2 - centerY, width, height);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, invalidate, stageIndex, progress, width, height, centerX, centerY]);
  return null;
}

function Station({ stage, position, active, pulse }) {
  const w = platformWidth(stage);
  return (
    <group position={position}>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[w, 0.4, PLATFORM_DEPTH]} />
        <meshStandardMaterial
          color={active ? '#1d3b52' : hex.track}
          emissive={active ? hex.cyan : '#000000'}
          emissiveIntensity={active ? 0.12 + 0.08 * pulse : 0}
          roughness={0.7}
        />
      </mesh>
      <mesh position={[0, 0.41, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w + 0.3, PLATFORM_DEPTH + 0.3]} />
        <meshBasicMaterial color={active ? hex.cyan : hex.belt} transparent opacity={active ? 0.25 : 0.2} />
      </mesh>
    </group>
  );
}

// A conveyor segment between two stations, laid just under the platforms.
function Belt({ from, to }) {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dz);
  return (
    <mesh position={[(from[0] + to[0]) / 2, 0.12, (from[2] + to[2]) / 2]} rotation={[0, -Math.atan2(dz, dx), 0]}>
      <boxGeometry args={[length, 0.16, 0.9]} />
      <meshStandardMaterial color={hex.belt} roughness={0.9} />
    </mesh>
  );
}

// Dashed magenta return belt behind the stations, from "wait-for-all" back to
// "build": the rework loop when a reviewer asks for changes.
function ReworkBelt() {
  const from = STATIONS.find((s) => s.id === 'wait-for-all').position;
  const to = STATIONS.find((s) => s.id === 'build').position;
  const back = Math.min(from[2], to[2], 0) - 3.2;
  const edge = PLATFORM_DEPTH / 2 + 0.1;
  const curve = new CatmullRomCurve3([
    new Vector3(from[0], 0.08, from[2] - edge),
    new Vector3(from[0] - 0.3, 0.08, back),
    new Vector3((from[0] + to[0]) / 2, 0.08, back - 0.3),
    new Vector3(to[0] + 0.3, 0.08, back),
    new Vector3(to[0], 0.08, to[2] - edge - 0.5),
  ]);
  const dashes = 18;
  const tip = curve.getPointAt(1);
  return (
    <group>
      {Array.from({ length: dashes }, (_, i) => {
        const t = (i + 0.5) / dashes;
        const p = curve.getPointAt(t);
        const tangent = curve.getTangentAt(t);
        return (
          <mesh key={i} position={[p.x, p.y, p.z]} rotation={[0, -Math.atan2(tangent.z, tangent.x), 0]}>
            <boxGeometry args={[0.45, 0.06, 0.18]} />
            <meshStandardMaterial color={hex.magenta} emissive={hex.magenta} emissiveIntensity={0.6} />
          </mesh>
        );
      })}
      <mesh position={[tip.x, 0.15, tip.z + 0.1]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.25, 0.5, 12]} />
        <meshStandardMaterial color={hex.magenta} emissive={hex.magenta} emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

function JobPackage({ position, hop }) {
  return (
    <group position={[position[0], 0.75 + 0.25 * hop, position[2] + 0.35]}>
      <mesh>
        <boxGeometry args={[0.6, 0.6, 0.6]} />
        <meshStandardMaterial color={hex.box} roughness={0.8} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.62, 0.12, 0.62]} />
        <meshStandardMaterial color={hex.tape} roughness={0.5} />
      </mesh>
    </group>
  );
}

function FactoryFloor({ stageIndex, frame, width, height, layout }) {
  const cameraProgress = interpolate(frame, CAMERA_FRAMES, [0, 1], { ...clamp, easing: ease });
  const packageProgress = interpolate(frame, PACKAGE_FRAMES, [0, 1], { ...clamp, easing: ease });
  // The package hops while it moves and settles when it arrives.
  const hop = packageProgress > 0 && packageProgress < 1 ? Math.abs(Math.sin(packageProgress * Math.PI * 3)) : 0;
  const pulse = 0.5 + 0.5 * Math.sin((frame / 30) * Math.PI);

  return (
    <>
      <color attach="background" args={[hex.bg]} />
      <fog attach="fog" args={[hex.bg, 18, 42]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#b8c6ff', hex.floor, 0.6]} />
      <directionalLight position={[6, 12, 8]} intensity={1.6} />
      <CameraRig
        stageIndex={stageIndex}
        progress={cameraProgress}
        width={width}
        height={height}
        centerX={layout.centerX}
        centerY={layout.centerY}
      />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, -4]}>
        <planeGeometry args={[80, 50]} />
        <meshStandardMaterial color={hex.floor} roughness={1} />
      </mesh>
      <gridHelper args={[80, 40, hex.track, '#1b2140']} position={[0, 0, -4]} />

      {STATIONS.slice(1).map((station, i) => (
        <Belt key={station.id} from={STATIONS[i].position} to={station.position} />
      ))}
      <ReworkBelt />

      {STAGES.map((stage, i) => (
        <Station key={stage.id} stage={stage} position={STATIONS[i].position} active={i === stageIndex} pulse={pulse} />
      ))}

      {STAGES.flatMap((stage, i) => {
        const [x, , z] = STATIONS[i].position;
        const first = -((stage.agents.length - 1) * AGENT_GAP) / 2;
        return stage.agents.map((agent, k) => (
          <Octopus3D
            key={agent.name}
            name={agent.name}
            position={[x + first + k * AGENT_GAP, 0.4, z - 0.35]}
            active={i === stageIndex}
            offset={i * 2 + k}
          />
        ));
      })}

      <JobPackage position={packagePosition(stageIndex, packageProgress)} hop={hop} />
    </>
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

export function FactoryLoop({ stageIndex }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const active = Math.min(Math.max(Number.isFinite(stageIndex) ? stageIndex : 0, 0), STAGES.length - 1);
  const layout = screenLayout(STAGES[active], width, height);
  return (
    <AbsoluteFill style={{ background: color.bg, color: color.text, fontFamily: font }}>
      {hasWebGL() && (
        <SceneBoundary>
          <ThreeCanvas
            width={width}
            height={height}
            dpr={[1, 2]}
            frameloop="demand"
            camera={{ fov: 45, near: 0.1, far: 120 }}
            style={{ pointerEvents: 'none' }}
          >
            <FactoryFloor stageIndex={active} frame={frame} width={width} height={height} layout={layout} />
          </ThreeCanvas>
        </SceneBoundary>
      )}
      <Caption stage={STAGES[active]} index={active} frame={frame} layout={layout} />
    </AbsoluteFill>
  );
}
