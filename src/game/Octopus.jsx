// An agent's octopus character inside the Remotion composition. Same shape and
// colors as the dashboard (shared factory/avatars.js), but animated from the
// Remotion frame instead of CSS time, so it renders the same on every frame.
import { useCurrentFrame } from 'remotion';

import { AVATARS, OCTOPUS } from '../../factory/avatars.js';

const BOB_FRAMES = 54; // one bob cycle (1.8s at 30fps)
const SWAY_FRAMES = 48; // one tentacle sway cycle (1.6s at 30fps)
const BLINK_FRAMES = 144; // blink every 4.8s
const SWAY_DEG = 9;
const TAU = Math.PI * 2;

// Pivot of each tentacle: the point after its leading "M".
const pivots = OCTOPUS.tentacles.map((d) => {
  const [, x, y] = d.match(/^M\s*([\d.]+)[\s,]+([\d.]+)/);
  return [Number(x), Number(y)];
});

export function Octopus({ name, size = 56, offset = 0 }) {
  const frame = useCurrentFrame();
  if (typeof name !== 'string' || !Object.hasOwn(AVATARS, name)) return null;
  const { color, accessory } = AVATARS[name];
  const { viewBox, head, tentacles, eyes, ink, accent, tentacleWidth } = OCTOPUS;

  // Phase-shift each octopus by `offset` so several on screen do not move in lockstep.
  const bob = -0.75 * (1 - Math.cos(TAU * (frame / BOB_FRAMES + offset * 0.27)));
  const blinking = (frame + offset * 37) % BLINK_FRAMES < 4;

  return (
    <svg viewBox={viewBox} width={size} height={size} aria-hidden="true" focusable="false" overflow="visible">
      <g transform={`translate(0 ${bob.toFixed(2)})`}>
        {tentacles.map((d, i) => {
          const angle = SWAY_DEG * Math.sin(TAU * (frame / SWAY_FRAMES + offset * 0.31) + i * Math.PI);
          const [px, py] = pivots[i];
          return (
            <path
              key={d}
              d={d}
              transform={`rotate(${angle.toFixed(2)} ${px} ${py})`}
              fill="none"
              stroke={color}
              strokeWidth={tentacleWidth}
              strokeLinecap="round"
            />
          );
        })}
        <path d={head} fill={color} stroke={ink} strokeWidth={0.8} />
        {eyes.map(({ cx, cy, r }) => (
          <ellipse key={`${cx},${cy}`} cx={cx} cy={cy} rx={r} ry={blinking ? r * 0.15 : r} fill={ink} />
        ))}
        <path d={accessory} fill={accent} stroke={ink} strokeWidth={0.9} strokeLinejoin="round" />
      </g>
    </svg>
  );
}
