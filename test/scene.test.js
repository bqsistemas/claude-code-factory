import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { STAGES } from '../src/game/engine.js';
import { STATIONS, cameraFor, cameraFov, compositionSize, packagePosition, projectPoint, toScreen } from '../src/game/scene.js';

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

test('AC-3: cameraFor targets the station from above and in front, clamping the index', () => {
  STATIONS.forEach((station, i) => {
    const { position, target } = cameraFor(i);
    assert.deepEqual(target, station.position, `stage ${i} target`);
    assert.ok(isFiniteTriple(position), `stage ${i} position is finite`);
    assert.ok(position[1] > target[1], `stage ${i} camera above`);
    assert.ok(position[2] > target[2], `stage ${i} camera in front`);
  });
  assert.deepEqual(cameraFor(-1), cameraFor(0));
  assert.deepEqual(cameraFor(99), cameraFor(STATIONS.length - 1));
  assert.deepEqual(cameraFor(NaN), cameraFor(0));
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

describe('job 006: camera framing and flow labels', () => {
  const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 1e-9, `${label}: ${actual} vs ${expected}`);

  test('AC-1: projectPoint projects through the camera like three.js lookAt with up +y', () => {
    const camera = { position: [0, 0, 10], target: [0, 0, 0] };
    const p = projectPoint(camera, [2, 1, 0], 90, 2);
    near(p.x, 0.1, 'x');
    near(p.y, 0.1, 'y');
    near(p.depth, 10, 'depth');
    assert.ok(projectPoint(camera, [0, 0, 20], 90, 2).depth <= 0, 'point behind the camera has depth <= 0');

    STATIONS.forEach((_, i) => {
      const cam = cameraFor(i);
      const center = projectPoint(cam, cam.target, 45, 16 / 9);
      near(center.x, 0, `stage ${i} target x`);
      near(center.y, 0, `stage ${i} target y`);
      assert.ok(center.depth > 0, `stage ${i} target in front of the camera`);
      const right = projectPoint(cam, cam.target.map((v, k) => v + [1, 0, 0][k]), 45, 16 / 9);
      assert.ok(right.x > 0, `stage ${i} +x projects to the right`);
    });
  });

  test('AC-2: cameraFov is 45 for landscape and invalid input, wider (at most 70) for portrait', () => {
    assert.equal(cameraFov(16 / 9), 45);
    assert.equal(cameraFov(1), 45);
    const portrait = cameraFov(390 / 844);
    assert.ok(portrait > 45 && portrait <= 70, `portrait fov ${portrait}`);
    for (const aspect of [0, -1, NaN]) assert.equal(cameraFov(aspect), 45, `aspect ${aspect}`);
  });

  test('AC-3: each stage shows its station and both neighbors inside the middle of the view', () => {
    for (const [w, h] of [[1920, 962], [1280, 720], [1024, 640]]) {
      const aspect = w / h;
      const fov = cameraFov(aspect);
      STATIONS.forEach((_, i) => {
        const cam = cameraFor(i);
        for (const j of [i - 1, i, i + 1]) {
          if (j < 0 || j >= STATIONS.length) continue;
          const label = `${w}x${h} stage ${i} station ${j}`;
          const p = projectPoint(cam, STATIONS[j].position, fov, aspect);
          assert.ok(p.depth > 0, `${label}: depth ${p.depth}`);
          assert.ok(Math.abs(p.x) <= 0.5, `${label}: x ${p.x}`);
          assert.ok(Math.abs(p.y) <= 0.5, `${label}: y ${p.y}`);
          if (j !== i) assert.ok(Math.abs(p.x) >= 0.2, `${label}: neighbor x ${p.x} is apart from the current station`);
        }
      });
    }
  });

  test('AC-4: toScreen maps NDC to composition pixels around the shifted view center', () => {
    assert.deepEqual(toScreen({ x: 0, y: 0 }, 1920, 962, 700, 600), { x: 700, y: 600 });
    assert.deepEqual(toScreen({ x: 1, y: 1 }, 1920, 962, 700, 600), { x: 1660, y: 119 });
    assert.deepEqual(toScreen({ x: -0.5, y: -0.5 }, 1920, 962, 700, 600), { x: 220, y: 840.5 });
  });
});
