// An agent's octopus character on the 3D factory floor: the job 004 identity
// (body color and accessory shape from the shared factory/avatars.js) built from
// three.js primitives and animated from the Remotion frame.
import { useCurrentFrame } from 'remotion';
import { DoubleSide, ExtrudeGeometry } from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

import { AVATARS, OCTOPUS } from '../../factory/avatars.js';

const BOB_FRAMES = 54; // one bob cycle (1.8s at 30fps), same as the 2D octopus
const SWAY_FRAMES = 48; // one tentacle sway cycle (1.6s at 30fps)
const BLINK_FRAMES = 144; // blink every 4.8s
const SWAY_RAD = 0.18;
const TAU = Math.PI * 2;

const HEAD_RADIUS = 0.45;
const HEAD_Y = 0.95;
const TENTACLE_TOP = 0.62;
const TENTACLE_LENGTH = 0.5;
const TENTACLE_TILT = 0.45;
// Four tentacles, one per OCTOPUS.tentacles entry, spread around the body.
const TENTACLE_ANGLES = OCTOPUS.tentacles.map((_, i) => Math.PI / 4 + (i * Math.PI) / 2);

// The accessory comes from the 32x32 SVG viewBox. Map the 2D head (x 6..26,
// center 16,12.5) onto the 3D head, flipping y because SVG y points down.
const SVG_SCALE = (HEAD_RADIUS * 2) / 20;
const SVG_CENTER = [16, 12.5];
const ACCESSORY_DEPTH = 1.2; // in SVG units, before scaling

// One extruded geometry per agent, built once from the fixed constants in
// factory/avatars.js (never from job or user data) and shared by every canvas.
const accessoryCache = new Map();
function accessoryGeometry(name) {
  if (!accessoryCache.has(name)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${OCTOPUS.viewBox}"><path d="${AVATARS[name].accessory}"/></svg>`;
    const { paths } = new SVGLoader().parse(svg);
    const shapes = paths.flatMap((path) => path.toShapes(true));
    accessoryCache.set(name, new ExtrudeGeometry(shapes, { depth: ACCESSORY_DEPTH, bevelEnabled: false }));
  }
  return accessoryCache.get(name);
}

export function Octopus3D({ name, position, active = false, offset = 0 }) {
  const frame = useCurrentFrame();
  if (typeof name !== 'string' || !Object.hasOwn(AVATARS, name)) return null;
  const { color } = AVATARS[name];
  const { ink, accent } = OCTOPUS;

  // Phase-shift each octopus by `offset` so several on screen do not move in lockstep.
  const bob = 0.06 * Math.sin(TAU * (frame / BOB_FRAMES + offset * 0.27));
  const swayPhase = TAU * (frame / SWAY_FRAMES + offset * 0.31);
  const blinking = (frame + offset * 37) % BLINK_FRAMES < 4;
  const glow = active ? 0.35 : 0;

  return (
    <group position={position} scale={active ? 1.25 : 1}>
      <group position={[0, bob, 0]}>
        <mesh position={[0, HEAD_Y, 0]} scale={[1, 1.1, 1]}>
          <sphereGeometry args={[HEAD_RADIUS, 32, 24]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} roughness={0.55} />
        </mesh>

        {TENTACLE_ANGLES.map((angle, i) => (
          <group
            key={angle}
            position={[Math.cos(angle) * 0.24, TENTACLE_TOP, Math.sin(angle) * 0.24]}
            rotation={[0, -angle, 0]}
          >
            <group rotation={[0, 0, TENTACLE_TILT + SWAY_RAD * Math.sin(swayPhase + i * Math.PI)]}>
              <mesh position={[0, -TENTACLE_LENGTH / 2, 0]}>
                <capsuleGeometry args={[0.085, TENTACLE_LENGTH, 4, 10]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={glow} roughness={0.6} />
              </mesh>
            </group>
          </group>
        ))}

        {OCTOPUS.eyes.map(({ cx, cy }) => (
          <group key={cx} position={[(cx - SVG_CENTER[0]) * SVG_SCALE, HEAD_Y + (SVG_CENTER[1] - cy) * SVG_SCALE, HEAD_RADIUS * 0.86]}>
            <mesh scale={[1, blinking ? 0.15 : 1, 1]}>
              <sphereGeometry args={[0.1, 16, 12]} />
              <meshStandardMaterial color="#ffffff" roughness={0.3} />
            </mesh>
            <mesh position={[0, 0, 0.06]} scale={[1, blinking ? 0.15 : 1, 1]}>
              <sphereGeometry args={[0.06, 12, 10]} />
              <meshStandardMaterial color={ink} roughness={0.3} />
            </mesh>
          </group>
        ))}

        <mesh
          geometry={accessoryGeometry(name)}
          position={[-SVG_CENTER[0] * SVG_SCALE, HEAD_Y + SVG_CENTER[1] * SVG_SCALE, HEAD_RADIUS * 0.9]}
          scale={[SVG_SCALE, -SVG_SCALE, SVG_SCALE]}
        >
          <meshStandardMaterial color={accent} side={DoubleSide} roughness={0.4} />
        </mesh>
      </group>

      {active && <pointLight position={[0, 2.2, 0.8]} color={color} intensity={6} distance={4} />}
    </group>
  );
}
