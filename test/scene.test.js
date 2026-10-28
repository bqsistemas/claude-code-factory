import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { STAGES } from '../src/game/engine.js';
import { readFile } from 'node:fs/promises';

import { FLOOR_VIEWBOX, STATIONS, compositionSize, iso, isoFrame, packagePosition } from '../src/game/scene.js';

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
