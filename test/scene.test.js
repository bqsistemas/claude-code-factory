import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { STAGES } from '../src/game/engine.js';
import { readFile } from 'node:fs/promises';

import * as scene from '../src/game/scene.js';
import { FLOOR_VIEWBOX, PLATE, STATIONS, compositionSize, iso, isoFrame, packagePosition, stationOutline } from '../src/game/scene.js';

const isFiniteTriple = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

test('AC-2: STATIONS has one station per stage, in order, at distinct finite positions', () => {
  assert.ok(Object.isFrozen(STATIONS), 'STATIONS is frozen');
  assert.deepEqual(
    STATIONS.map((s) => s.id),
    STAGES.map((s) => s.id),
  );
  for (const { id, position } of STATIONS) {
    assert.ok(isFiniteTriple(position), `${id} position is 3 finite numbers`);
  }
  const keys = STATIONS.map((s) => s.position.join(','));
  assert.equal(new Set(keys).size, keys.length, 'positions are pairwise distinct');
});

test('AC-4: packagePosition interpolates from the previous station to the current one', () => {
  const close = (actual, expected, label) => {
    assert.equal(actual.length, 3, label);
    actual.forEach((v, k) => assert.ok(Math.abs(v - expected[k]) < 1e-9, `${label}[${k}]: ${v} vs ${expected[k]}`));
  };
  for (let i = 1; i < STATIONS.length; i += 1) {
    const from = STATIONS[i - 1].position;
    const to = STATIONS[i].position;
    assert.deepEqual(packagePosition(i, 0), from, `stage ${i} p=0`);
    assert.deepEqual(packagePosition(i, 1), to, `stage ${i} p=1`);
    close(packagePosition(i, 0.5), from.map((v, k) => (v + to[k]) / 2), `stage ${i} p=0.5`);
    assert.deepEqual(packagePosition(i, -1), packagePosition(i, 0), `stage ${i} p=-1`);
    assert.deepEqual(packagePosition(i, 2), packagePosition(i, 1), `stage ${i} p=2`);
  }
  for (const p of [0, 0.25, 0.5, 1, -1, 2, NaN]) {
    assert.deepEqual(packagePosition(0, p), STATIONS[0].position, `stage 0 p=${p}`);
  }
});

test('AC-5: compositionSize keeps the viewport aspect ratio, caps the long side at 1920, never upscales', () => {
  assert.deepEqual(compositionSize(1280, 720), { width: 1280, height: 720 });
  assert.deepEqual(compositionSize(3840, 2160), { width: 1920, height: 1080 });
  assert.deepEqual(compositionSize(390, 844), { width: 390, height: 844 });

  const inputs = [
    [1280, 720], [3840, 2160], [390, 844], [1024, 640], [640, 900], [2560, 1440],
    [1, 1], [3, 7], [5000, 300], [300, 5000], [1919.6, 1080.2], [7680, 4320], [1366, 768],
  ];
  for (const [w, h] of inputs) {
    const { width, height } = compositionSize(w, h);
    const label = `${w}x${h} -> ${width}x${height}`;
    assert.ok(Number.isInteger(width) && width > 0, `${label}: width positive integer`);
    assert.ok(Number.isInteger(height) && height > 0, `${label}: height positive integer`);
    assert.ok(Math.max(width, height) <= 1920, `${label}: long side capped`);
    const ratio = width / height / (w / h);
    assert.ok(Math.abs(ratio - 1) <= 0.01, `${label}: aspect within 1%`);
  }

  for (const [w, h] of [[0, 720], [NaN, 720], [-5, 720], [1280, 0], [1280, Infinity], [undefined, 720]]) {
    assert.deepEqual(compositionSize(w, h), { width: 1280, height: 720 }, `${w}x${h} fallback`);
  }
});


describe('job 007: iso-glow factory floor', () => {
  const EPS = 1e-9;
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= EPS, `${label}: ${actual} vs ${expected}`);
  const nearPoint = (actual, expected, label) => {
    assert.equal(actual.length, 2, `${label} is [sx, sy]`);
    near(actual[0], expected[0], `${label}[0]`);
    near(actual[1], expected[1], `${label}[1]`);
  };

  test('AC-2: iso is the iso-figure projection kernel without offset, and scene.js credits it', async () => {
    const C = Math.cos(Math.PI / 6);
    nearPoint(iso([0, 0, 0]), [0, 0], 'origin');
    nearPoint(iso([1, 0, 0]), [C, 0.5], '+x');
    nearPoint(iso([0, 1, 0]), [-C, 0.5], '+y');
    nearPoint(iso([0, 0, 1]), [0, -1], '+z');
    const [ex, ey, ez] = [iso([1, 0, 0]), iso([0, 1, 0]), iso([0, 0, 1])];
    const expected = [0, 1].map((k) => 3 * ex[k] - 2 * ey[k] + 5 * ez[k]);
    nearPoint(iso([3, -2, 5]), expected, 'linear combination');

    const source = await readFile(new URL('../src/game/scene.js', import.meta.url), 'utf8');
    assert.ok(source.includes('iso-figure'), 'scene.js credits iso-figure');
    assert.ok(source.includes('MIT'), 'scene.js names the MIT license');
  });

  test('AC-3: STATIONS are iso boxes, one per stage, non-overlapping, reading left to right', () => {
    assert.deepEqual(
      STATIONS.map((s) => s.id),
      STAGES.map((s) => s.id),
    );
    for (const { id, position, size } of STATIONS) {
      assert.ok(isFiniteTriple(position), `${id} position is 3 finite numbers`);
      assert.equal(position[2], 0, `${id} stands on the floor`);
      assert.ok(isFiniteTriple(size) && size.every((v) => v > 0), `${id} size is 3 finite positive numbers`);
    }
    const disjoint = (a0, a1, b0, b1) => a1 <= b0 || b1 <= a0;
    for (let i = 0; i < STATIONS.length; i += 1) {
      for (let j = i + 1; j < STATIONS.length; j += 1) {
        const [a, b] = [STATIONS[i], STATIONS[j]];
        const xs = disjoint(a.position[0], a.position[0] + a.size[0], b.position[0], b.position[0] + b.size[0]);
        const ys = disjoint(a.position[1], a.position[1] + a.size[1], b.position[1], b.position[1] + b.size[1]);
        assert.ok(xs || ys, `${a.id} and ${b.id} footprints do not overlap`);
      }
    }
    for (let i = 1; i < STATIONS.length; i += 1) {
      assert.ok(
        iso(STATIONS[i].position)[0] > iso(STATIONS[i - 1].position)[0],
        `${STATIONS[i].id} is right of ${STATIONS[i - 1].id} on screen`,
      );
    }
  });

  test('AC-4: isoFrame pads the tightest projected box, and FLOOR_VIEWBOX holds every station corner', () => {
    assert.deepEqual(isoFrame([[0, 0, 0]], 10), { x: -10, y: -10, width: 20, height: 20 });

    const points = [[0, 0, 0], [120, 0, 0], [0, 80, 0], [40, 30, 55], [-15, 60, -8], [200, -40, 12]];
    const projected = points.map(iso);
    const xs = projected.map((p) => p[0]);
    const ys = projected.map((p) => p[1]);
    for (const pad of [0, 7, 24]) {
      const box = isoFrame(points, pad);
      near(box.x + pad, Math.min(...xs), `pad ${pad} left`);
      near(box.x + box.width - pad, Math.max(...xs), `pad ${pad} right`);
      near(box.y + pad, Math.min(...ys), `pad ${pad} top`);
      near(box.y + box.height - pad, Math.max(...ys), `pad ${pad} bottom`);
    }
    const defaultPad = isoFrame(points);
    near(defaultPad.x + 24, Math.min(...xs), 'default pad is 24');

    assert.ok(Object.isFrozen(FLOOR_VIEWBOX), 'FLOOR_VIEWBOX is frozen');
    const { x, y, width, height } = FLOOR_VIEWBOX;
    assert.ok([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0, 'finite, positive viewBox');
    for (const { id, position, size } of STATIONS) {
      for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
        const p = position.map((v, k) => v + ((corner >> k) & 1) * size[k]);
        const [sx, sy] = iso(p);
        assert.ok(sx >= x && sx <= x + width, `${id} corner ${p} x ${sx} inside`);
        assert.ok(sy >= y && sy <= y + height, `${id} corner ${p} y ${sy} inside`);
      }
    }
  });
});

describe('job 008: guided loop tour', () => {
  const EPS = 1e-9;

  // Ray casting: true when [px, py] is strictly inside the polygon.
  const inside = ([px, py], polygon) => {
    let hit = false;
    for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a, a += 1) {
      const [ax, ay] = polygon[a];
      const [bx, by] = polygon[b];
      if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  };

  test('AC-3: stationOutline is the 6-point iso silhouette of each station, inside FLOOR_VIEWBOX', () => {
    const { x: vx, y: vy, width: vw, height: vh } = FLOOR_VIEWBOX;
    STATIONS.forEach(({ id, position: [x, y], size: [w, d, h] }, i) => {
      const outline = stationOutline(i);
      assert.equal(outline.length, 6, `${id} has 6 points`);
      for (const p of outline) {
        assert.ok(Array.isArray(p) && p.length === 2 && p.every(Number.isFinite), `${id} point ${p} is 2 finite numbers`);
      }

      // Recover H from the first point: iso(x, y, H)[1] = (x + y) / 2 - H.
      const H = (x + y) * Math.sin(Math.PI / 6) - outline[0][1];
      assert.ok(H >= h - EPS, `${id} H ${H} is at least the box height ${h}`);
      const corners = [[x, y, H], [x + w, y, H], [x + w, y, 0], [x + w, y + d, 0], [x, y + d, 0], [x, y + d, H]];
      corners.forEach((corner, k) => {
        const expected = iso(corner);
        assert.ok(Math.abs(outline[k][0] - expected[0]) <= EPS, `${id} point ${k} x`);
        assert.ok(Math.abs(outline[k][1] - expected[1]) <= EPS, `${id} point ${k} y`);
      });

      for (const [sx, sy] of outline) {
        assert.ok(sx >= vx && sx <= vx + vw && sy >= vy && sy <= vy + vh, `${id} point ${sx},${sy} inside FLOOR_VIEWBOX`);
      }
      assert.ok(inside(iso([x + w / 2, y + d / 2, h]), outline), `${id} top-face center is inside its outline`);
    });

    for (const bad of [-1, STATIONS.length, 0.5]) {
      assert.throws(() => stationOutline(bad), RangeError, `stationOutline(${bad}) throws`);
    }
  });
});

describe('job 009: approval fork on the iso floor', () => {
  const { FORK } = scene;
  const outcome = STATIONS.find((s) => s.id === 'outcome');
  const deepFrozen = (value, path = 'FORK') => {
    if (value === null || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value), `${path} is frozen`);
    for (const [key, child] of Object.entries(value)) deepFrozen(child, `${path}.${key}`);
  };
  const within = (v, lo, hi) => v >= lo && v <= hi;
  const footprint = ({ position: [x, y], size: [w, d] }) => ({ x0: x, x1: x + w, y0: y, y1: y + d });
  const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  test('AC-1: FORK is deep-frozen with the approve and escalate branches, split on the outcome deck', () => {
    assert.ok(FORK, 'scene.js exports FORK');
    deepFrozen(FORK);
    assert.equal(FORK.branches.length, 2, 'exactly two branches');
    assert.deepEqual(FORK.branches.map((b) => b.id), ['approve', 'escalate']);
    assert.deepEqual(FORK.branches.map((b) => b.decision), ['APPROVE', 'ESCALATE']);
    assert.deepEqual(FORK.branches.map((b) => b.label), ['APPROVE: merge a main', 'ESCALATE: needs-human']);

    const [px, py, pz] = FORK.point;
    assert.ok(isFiniteTriple(FORK.point), 'FORK.point is a finite triple');
    assert.ok(within(px, outcome.position[0], outcome.position[0] + outcome.size[0]), `x ${px} inside the outcome footprint`);
    assert.ok(within(py, outcome.position[1], outcome.position[1] + outcome.size[1]), `y ${py} inside the outcome footprint`);
    assert.equal(pz, outcome.size[2], 'z is the outcome station height');
  });

  test('AC-2: each branch wire runs from FORK.point to its pad in straight iso segments', () => {
    for (const { id, points, pad } of FORK.branches) {
      assert.ok(Array.isArray(points) && points.length >= 2, `${id} has at least 2 points`);
      for (const p of points) assert.ok(isFiniteTriple(p), `${id} point ${p} is a finite triple`);
      assert.deepEqual(points[0], FORK.point, `${id} starts at FORK.point`);
      const [ex, ey] = points[points.length - 1];
      const f = footprint(pad);
      assert.ok(within(ex, f.x0, f.x1) && within(ey, f.y0, f.y1), `${id} ends over its pad`);
      for (let k = 1; k < points.length; k += 1) {
        const dx = points[k][0] !== points[k - 1][0];
        const dy = points[k][1] !== points[k - 1][1];
        assert.ok(dx !== dy, `${id} segment ${k} changes exactly one of x or y`);
      }
    }
  });

  test('AC-3: the pads stand past the outcome station, approve behind the line and escalate in front, without overlaps', () => {
    for (const { id, pad } of FORK.branches) {
      assert.ok(isFiniteTriple(pad.size) && pad.size.every((v) => v > 0), `${id} pad size is 3 finite positive numbers`);
      assert.ok(isFiniteTriple(pad.position), `${id} pad position is a finite triple`);
      assert.equal(pad.position[2], 0, `${id} pad stands on the floor`);
      assert.ok(pad.position[0] >= outcome.position[0] + outcome.size[0], `${id} pad starts past the outcome station`);
    }
    const [approve, escalate] = FORK.branches.map((b) => b.pad);
    assert.ok(approve.position[1] + approve.size[1] <= 0, 'APPROVE pad is behind the station row');
    assert.ok(escalate.position[1] >= outcome.position[1] + outcome.size[1], 'ESCALATE pad is in front of the station row');

    const boxes = [
      ...FORK.branches.map((b) => ({ id: `${b.id} pad`, ...footprint(b.pad) })),
      ...STATIONS.map((s) => ({ id: s.id, ...footprint(s) })),
    ];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        assert.ok(!overlaps(boxes[i], boxes[j]), `${boxes[i].id} and ${boxes[j].id} do not overlap`);
      }
    }
  });

  test('AC-4: FLOOR_VIEWBOX frames the pads, wires and labels, and PLATE covers both pads', () => {
    const { x, y, width, height } = FLOOR_VIEWBOX;
    const insideView = (p, label) => {
      const [sx, sy] = iso(p);
      assert.ok(sx >= x && sx <= x + width && sy >= y && sy <= y + height, `${label} ${p} projects inside FLOOR_VIEWBOX`);
    };
    const plate = footprint(PLATE);
    for (const { id, pad, points, labelAnchor } of FORK.branches) {
      for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
        insideView(pad.position.map((v, k) => v + ((corner >> k) & 1) * pad.size[k]), `${id} pad corner`);
      }
      points.forEach((p) => insideView(p, `${id} wire point`));
      assert.ok(isFiniteTriple(labelAnchor), `${id} labelAnchor is a finite triple`);
      insideView(labelAnchor, `${id} labelAnchor`);
      const f = footprint(pad);
      assert.ok(f.x0 >= plate.x0 && f.x1 <= plate.x1, `${id} pad inside PLATE in x`);
      assert.ok(f.y0 >= plate.y0 && f.y1 <= plate.y1, `${id} pad inside PLATE in y`);
    }
  });
});
