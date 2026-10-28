// A still octopus for UI outside the Remotion Player (no useCurrentFrame, so it
// renders anywhere). Same shape and colors as the dashboard (factory/avatars.js).
import { createElement } from 'react';

import { avatarSvg } from '../../factory/avatars.js';

export function StaticOctopus({ name, size = 24 }) {
  const svg = avatarSvg(name);
  if (!svg) return null;
  // avatarSvg output is built only from fixed constants (see factory/avatars.js).
  return createElement('span', {
    className: 'game__static-octopus',
    'aria-hidden': 'true',
    style: { display: 'inline-flex', width: size, height: size },
    dangerouslySetInnerHTML: { __html: svg.replace(/width="22" height="22"/, 'width="100%" height="100%"') },
  });
}
