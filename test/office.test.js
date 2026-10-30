import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, STAGE_COLUMNS, activeAgents, laneTone } from '../factory/activity.js';
import { AVATARS } from '../factory/avatars.js';
import {
  AREAS, CHARACTER_FOR, FURNITURE, LOUNGE_SPOTS, MAP, MEETING_SEATS, SEATS, SPRITES, WAYPOINTS, WALL_H, PARTITION, DOOR_W, officeBackdrop,
  areaForStage, areaTone, bubbleText, describeOffice, formatCost, headerStats, hitTargets, layoutOffice, officeState, remapWalker, route,
} from '../factory/office.js';

const job = (id, stage, extra = {}) => ({ id, stage, issue: Number(id.replace(/\D/g, '')) || undefined, started: '2026-01-01T00:00:00Z', ...extra });

test('AC-1: headerStats counts jobs, running, agents and valid costs', () => {
  const jobs = [
    job('j1', 'intake', { cost_usd: 1.5 }), job('j2', 'needs-info', { cost_usd: -3 }), job('j3', 'build', { cost_usd: '9' }),
    job('j4', 'review', { reviews: { ux: 'pending', code: 'pending', ui: 'PASS' }, cost_usd: 0.5 }),
    job('j5', 'merging'), job('j6', 'awaiting-merge'), job('j7', 'merged', { cost_usd: 1 }), job('j8', 'bogus'),
  ];
  const s = headerStats(jobs);
  assert.equal(s.total, 8);
  assert.equal(s.running, 6);
  assert.equal(s.agents, jobs.reduce((n, j) => n + activeAgents(j).length, 0));
  assert.equal(s.cost, 3);
  assert.deepEqual(headerStats(null), { total: 0, running: 0, agents: 0, cost: 0 });
  assert.equal(formatCost(3.149), '$3.15');
});

test('AC-2: officeState places agents and builds bubbles', () => {
  const jobs = [job('j23', 'build', { round: 2 }), job('j1', 'intake'), job('j2', 'intake')];
  const st = officeState(jobs);
  assert.deepEqual(Object.keys(st.agents).sort(), Object.keys(AGENTS).sort());
  const b = st.agents.builder;
  assert.equal(b.place, 'seat');
  assert.equal(b.node, SEATS.builder);
  assert.equal(b.area, 'engineering');
  assert.equal(b.bubble, 'Builder · #23 · R2 · implementing');
  assert.equal(st.agents.intake.bubble, 'Intake · ×2 · triaging');
  for (const a of Object.keys(AGENTS)) {
    if (a === 'builder' || a === 'intake') continue;
    assert.equal(st.agents[a].place, 'lounge');
    assert.equal(st.agents[a].node, LOUNGE_SPOTS[a]);
    assert.equal(st.agents[a].bubble, AGENTS[a].label);
  }
  assert.doesNotThrow(() => officeState(null));
  assert.doesNotThrow(() => officeState([null, 5, { stage: 7 }]));
  const evil = officeState([{ id: '<img>', stage: 'build', issue: '<b>', round: '<i>' }, { id: 'x', stage: '<script>' }]);
  for (const a of Object.values(evil.agents)) assert.ok(!a.bubble.includes('<'));
});

test('AC-3: review meeting for two or more pending reviewers', () => {
  const st = officeState([job('j5', 'review', { reviews: { security: 'PASS', ux: 'pending', code: 'pending' } })]);
  assert.deepEqual(st.meeting, { jobId: 'j5', issue: 5, members: ['review-ux', 'review-code'] });
  for (const m of st.meeting.members) {
    assert.equal(st.agents[m].place, 'meeting');
    assert.equal(st.agents[m].node, MEETING_SEATS[m]);
  }
  const one = officeState([job('j5', 'review', { reviews: { ux: 'pending' } })]);
  assert.equal(one.meeting, null);
  assert.equal(one.agents['review-ux'].place, 'seat');
  const two = officeState([
    job('j9', 'review', { started: '2026-03-01T00:00:00Z', reviews: { ux: 'pending', ui: 'pending' } }),
    job('j8', 'review', { started: '2026-02-01T00:00:00Z', reviews: { code: 'pending', security: 'pending' } }),
  ]);
  assert.equal(two.meeting.jobId, 'j8');
  assert.equal(two.agents['review-ux'].place, 'seat');
});

test('AC-4: areas, tones, tokens, archive and gate', () => {
  const expected = { intake: 'research', 'needs-info': 'research', spec: 'engineering', build: 'engineering', gate: 'engineering',
    review: 'review', approve: 'release', merging: 'release', 'awaiting-merge': 'release', 'needs-human': 'escalation',
    merged: 'archive', rejected: 'archive' };
  for (const [stage] of STAGE_COLUMNS) assert.equal(areaForStage(stage), expected[stage], stage);
  for (const bad of ['bogus', null, 42]) assert.equal(areaForStage(bad), 'research');
  for (const a of AREAS) assert.equal(areaTone(a.id), a.stages.length ? laneTone(a.stages[0]) : 'neutral');
  assert.equal(areaTone('nope'), 'neutral');
  const st = officeState([job('j1', 'spec'), job('j2', 'gate'), job('j13', 'needs-human'), job('j4', 'merged'), job('j5', 'merged'), job('j6', 'rejected')]);
  assert.deepEqual(st.tokens.engineering.map((t) => t.label), ['#1', '#2']);
  assert.deepEqual(st.escalation.map((t) => t.label), ['#13']);
  assert.deepEqual(st.archive, { merged: 2, rejected: 1 });
  assert.equal(st.gate.lit, true);
  assert.equal(st.gate.result, null);
  const off = officeState([job('j7', 'review', { gate: 'FAIL' })]);
  assert.deepEqual(off.gate, { lit: false, result: 'FAIL' });
});

test('AC-5: map data is consistent and routable', () => {
  const r = AREAS.map((a) => a.rect);
  for (const { x, y, w, h } of r) {
    assert.ok([x, y, w, h].every(Number.isInteger));
    assert.ok(x >= 0 && y >= 0 && x + w <= MAP.width && y + h <= MAP.height);
  }
  r.forEach((a, i) => r.slice(i + 1).forEach((b) => assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)));
  const area = (id) => AREAS.find((a) => a.id === id).rect;
  const inside = (id, node) => {
    const p = WAYPOINTS.nodes[node], q = area(id);
    return p.x >= q.x && p.x < q.x + q.w && p.y >= q.y && p.y < q.y + q.h;
  };
  const home = { intake: 'research', 'spec-writer': 'engineering', builder: 'engineering', approver: 'release' };
  for (const a of Object.keys(AGENTS)) {
    assert.ok(inside(home[a] || 'review', SEATS[a]), `seat ${a}`);
    assert.ok(inside('lounge', LOUNGE_SPOTS[a]), `lounge ${a}`);
    assert.ok(AVATARS[a].color);
    assert.ok(Object.hasOwn(SPRITES, CHARACTER_FOR[a]));
  }
  for (const n of Object.values(MEETING_SEATS)) assert.ok(inside('review', n));
  const ids = Object.keys(WAYPOINTS.nodes);
  const edges = new Set(WAYPOINTS.edges.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  for (const [a, b] of WAYPOINTS.edges) assert.ok(ids.includes(a) && ids.includes(b));
  for (const from of ids) for (const to of ids) {
    const p = route(from, to);
    assert.equal(p[0], from);
    assert.equal(p.at(-1), to);
    for (let i = 1; i < p.length; i++) assert.ok(edges.has(`${p[i - 1]}|${p[i]}`));
  }
  assert.deepEqual(route('x', 'nope'), []);
  for (const { x, y, w, h } of Object.values(SPRITES)) {
    assert.ok([x, y, w, h].every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 256 && y + h <= 160);
  }
});

test('AC-6: hit targets and the accessible description', () => {
  const jobs = [job('j23', 'build', { round: 2, started: '2026-01-02T00:00:00Z' }), job('j20', 'build'), job('j13', 'needs-human'),
    job('j4', 'merged'), job('j5', 'rejected'), job('j7', 'review', { reviews: { ux: 'pending' } })];
  const st = officeState(jobs);
  const hits = hitTargets(st, jobs);
  const builder = hits.find((h) => h.kind === 'agent' && h.key === 'builder');
  assert.equal(builder.jobId, 'j20');
  assert.match(builder.label, /Builder/);
  const tokenCount = Object.values(st.tokens).flat().length + st.escalation.length;
  assert.equal(hits.filter((h) => h.kind === 'token').length, tokenCount);
  const areas = hits.filter((h) => h.kind === 'area').map((h) => h.key).sort();
  assert.deepEqual(areas, ['archive', 'engineering', 'escalation', 'review']);
  assert.equal(hits.find((h) => h.kind === 'area' && h.key === 'engineering').jobId, 'j20');
  assert.ok(!hits.some((h) => h.kind === 'agent' && h.key === 'intake'));
  assert.ok(!hits.some((h) => h.key === 'lounge'));
  const lines = describeOffice(st);
  for (const a of Object.keys(AGENTS)) assert.ok(lines.some((l) => l.startsWith(`${AGENTS[a].label} in `)), a);
  assert.ok(lines.some((l) => /^Builder in Engineering: .*#20/.test(l)));
  assert.ok(lines.includes('Intake in Lounge: idle'));
  assert.equal(bubbleText('nobody', []), '');
  assert.deepEqual(hitTargets(null, null), []);
  assert.deepEqual(describeOffice(null), []);
});

// ---- Layout (job 025) ----
const SIZES = [[256, 160], [602, 370], [940, 480], [1400, 500], [300, 900]];
const inRect = (r, p) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
const areaOfBase = (p) => AREAS.find((a) => inRect(a.rect, p));

test('AC-1: layoutOffice picks the largest integer scale and fills each axis within one scale step', () => {
  for (let w = 256; w <= 2000; w += 37) {
    for (let h = 160; h <= 1200; h += 29) {
      const l = layoutOffice(w, h);
      assert.equal(l.scale, Math.floor(Math.min(w / 256, h / 160)));
      assert.ok(l.map.width * l.scale <= w && w - l.map.width * l.scale < l.scale, `${w}x${h} width`);
      assert.ok(l.map.height * l.scale <= h && h - l.map.height * l.scale < l.scale, `${w}x${h} height`);
    }
  }
  for (const bad of [NaN, 'a', -5, undefined, 100]) {
    const l = layoutOffice(bad, bad);
    assert.equal(l.scale, 1);
    assert.deepEqual(l.map, { width: 256, height: 160 });
  }
  assert.equal(layoutOffice('x', -1, { minScale: 3 }).scale, 3);
  assert.equal(layoutOffice(10, 10, { minScale: 1.5 }).scale, 1);
});

test('AC-2: areas tile the map, keep order and never shrink', () => {
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h);
    assert.equal(l.areas.length, 7);
    l.areas.forEach((a, i) => {
      const b = AREAS[i];
      assert.equal(a.id, b.id); assert.equal(a.label, b.label); assert.deepEqual(a.stages, b.stages);
      for (const v of Object.values(a.rect)) assert.ok(Number.isInteger(v));
      assert.ok(a.rect.w >= b.rect.w && a.rect.h >= b.rect.h);
      assert.ok(a.rect.x >= 0 && a.rect.y >= 0 && a.rect.x + a.rect.w <= l.map.width && a.rect.y + a.rect.h <= l.map.height);
      l.areas.slice(i + 1).forEach((o) => {
        const hit = !(a.rect.x + a.rect.w <= o.rect.x || o.rect.x + o.rect.w <= a.rect.x || a.rect.y + a.rect.h <= o.rect.y || o.rect.y + o.rect.h <= a.rect.y);
        assert.ok(!hit, `${a.id}/${o.id} overlap at ${w}x${h}`);
      });
    });
    const r = (id) => l.areas.find((a) => a.id === id).rect;
    const order = (ids, key) => ids.every((id, i) => i === 0 || r(ids[i - 1])[key] < r(id)[key]);
    assert.ok(order(['research', 'engineering', 'review'], 'x') && order(['release', 'escalation', 'lounge', 'archive'], 'x'));
    assert.ok(r('research').y === 0 && r('release').y > r('research').y);
    assert.equal(Math.min(...l.areas.map((a) => a.rect.x)), 0);
    assert.equal(Math.min(...l.areas.map((a) => a.rect.y)), 0);
    assert.equal(Math.max(...l.areas.map((a) => a.rect.x + a.rect.w)), l.map.width);
    assert.equal(Math.max(...l.areas.map((a) => a.rect.y + a.rect.h)), l.map.height);
  }
});

test('AC-3: nodes and furniture stay in their base area and routes stay on the graph', () => {
  const edges = new Set(WAYPOINTS.edges.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h);
    const rectOf = (id) => l.areas.find((a) => a.id === id).rect;
    assert.deepEqual(Object.keys(l.nodes), Object.keys(WAYPOINTS.nodes));
    for (const [name, p] of Object.entries(WAYPOINTS.nodes)) {
      assert.ok(Number.isInteger(l.nodes[name].x) && Number.isInteger(l.nodes[name].y));
      const base = areaOfBase(p);
      if (base) assert.ok(inRect(rectOf(base.id), l.nodes[name]), `${name} at ${w}x${h}`);
    }
    assert.equal(l.furniture.length, FURNITURE.length);
    l.furniture.forEach((f, i) => {
      const spr = SPRITES[f.sprite], b = FURNITURE[i];
      assert.equal(f.sprite, b.sprite);
      assert.ok(Number.isInteger(f.x) && Number.isInteger(f.y));
      assert.ok(f.x >= 0 && f.y >= 0 && f.x + spr.w <= l.map.width && f.y + spr.h <= l.map.height);
      const base = areaOfBase({ x: b.x + spr.w / 2, y: b.y + spr.h / 2 });
      assert.ok(inRect(rectOf(base.id), { x: f.x + spr.w / 2, y: f.y + spr.h / 2 }), `${f.sprite} ${i} at ${w}x${h}`);
    });
    const names = Object.keys(l.nodes);
    for (const a of names) for (const b of names) {
      const path = route(a, b);
      assert.ok(path.length >= 1);
      for (let i = 1; i < path.length; i++) assert.ok(edges.has(`${path[i - 1]}|${path[i]}`));
    }
  }
});

test('AC-4: lounge spots never get closer than in the base layout', () => {
  const spots = Object.values(LOUNGE_SPOTS);
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h);
    for (const a of spots) for (const b of spots) {
      assert.ok(Math.abs(l.nodes[a].x - l.nodes[b].x) >= Math.abs(WAYPOINTS.nodes[a].x - WAYPOINTS.nodes[b].x));
      assert.ok(Math.abs(l.nodes[a].y - l.nodes[b].y) >= Math.abs(WAYPOINTS.nodes[a].y - WAYPOINTS.nodes[b].y));
    }
  }
});

test('AC-5: the base layout is identical to the constants and remapWalker follows the layout', () => {
  for (const [l, scale] of [[layoutOffice(256, 160), 1], [layoutOffice(327, 0, { minScale: 2 }), 2]]) {
    assert.equal(l.scale, scale);
    assert.deepEqual(l.map, { width: MAP.width, height: MAP.height });
    assert.deepEqual(l.areas, AREAS);
    assert.deepEqual(l.nodes, WAYPOINTS.nodes);
    assert.deepEqual(l.furniture, FURNITURE);
  }
  const from = layoutOffice(256, 160), to = layoutOffice(940, 480);
  assert.deepEqual(remapWalker({ x: 1, y: 1, node: 'seat_ui', queue: [] }, from, to), to.nodes.seat_ui);
  const p = remapWalker({ x: 128, y: 80, node: 'cor_c', queue: ['cor_d'] }, from, to);
  assert.equal(p.x, 128 * to.map.width / from.map.width);
  assert.equal(p.y, 80 * to.map.height / from.map.height);
  const q = remapWalker({ x: 9999, y: -4, node: 'cor_c', queue: ['cor_d'] }, from, to);
  assert.ok(q.x <= to.map.width && q.y >= 0);
  assert.deepEqual(remapWalker(null, from, to), { x: 0, y: 0 });
});

const within = (o, r) => o.x >= r.x && o.y >= r.y && o.x + o.w <= r.x + r.w && o.y + o.h <= r.y + r.h;

test('AC-1: atlas rects for wall, floor, partition and wall props', () => {
  assert.deepEqual(SPRITES.wall, { x: 84, y: 70, w: 26, h: 20 });
  assert.deepEqual(SPRITES.floor, { x: 3, y: 68, w: 73, h: 24 });
  assert.deepEqual(SPRITES.partition, { x: 171, y: 44, w: 79, h: 17 });
  assert.ok(!Object.hasOwn(SPRITES, 'sign'));
  assert.ok(['window', 'clock', 'calendar'].some((k) => Object.hasOwn(SPRITES, k)));
  for (const { x, y, w, h } of Object.values(SPRITES)) assert.ok(x >= 0 && y >= 0 && x + w <= 256 && y + h <= 160);
  assert.equal(WALL_H, SPRITES.wall.h);
});

test('AC-2: Escalation prop is a calendar or flag below the wall strip', () => {
  const esc = AREAS.find((a) => a.id === 'escalation').rect;
  const f = FURNITURE.find((e) => inside2(esc, e.x + SPRITES[e.sprite].w / 2, e.y + SPRITES[e.sprite].h / 2) && ['calendar', 'flag'].includes(e.sprite));
  assert.ok(f && Object.hasOwn(SPRITES, f.sprite));
  assert.ok(f.y >= 68 + WALL_H);
  for (const e of FURNITURE) assert.ok(!['sign', 'wall', 'floor', 'partition'].includes(e.sprite));
});
function inside2(r, x, y) { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

test('AC-3: corridor and one door per area', () => {
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h), bd = officeBackdrop(l);
    const top = l.areas.filter((a) => a.rect.y === 0), bot = l.areas.filter((a) => a.rect.y > 0);
    const y0 = Math.max(...top.map((a) => a.rect.y + a.rect.h)), y1 = Math.min(...bot.map((a) => a.rect.y));
    assert.deepEqual(bd.corridor, { x: 0, y: y0, w: l.map.width, h: y1 - y0 });
    assert.ok(bd.corridor.h > 0);
    assert.equal(bd.doors.length, l.areas.length);
    for (const a of l.areas) {
      const d = bd.doors.find((x) => x.id === a.id), nx = l.nodes['door_' + a.id].x;
      assert.equal(d.w, DOOR_W);
      assert.ok(d.x >= a.rect.x && d.x + d.w <= a.rect.x + a.rect.w && nx >= d.x && nx < d.x + d.w);
    }
  }
});

test('AC-4: wall strips cover each area except the bottom-row door, with a wall prop', () => {
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h), bd = officeBackdrop(l);
    for (const a of l.areas) {
      const segs = bd.walls.filter((s) => s.id === a.id).sort((p, q) => p.x - q.x);
      assert.ok(segs.length);
      for (const s of segs) assert.ok(s.y === a.rect.y && s.h === WALL_H && within(s, a.rect));
      const door = bd.doors.find((d) => d.id === a.id);
      const covered = new Set();
      for (const s of segs) for (let x = s.x; x < s.x + s.w; x++) covered.add(x);
      for (let x = a.rect.x; x < a.rect.x + a.rect.w; x++) {
        const inDoor = x >= door.x && x < door.x + door.w;
        assert.equal(covered.has(x), a.rect.y === 0 || !inDoor);
      }
      const props = bd.wallProps.filter((p) => p.id === a.id);
      assert.ok(props.length);
      for (const p of props) {
        const sp = SPRITES[p.sprite];
        assert.ok(['window', 'clock', 'calendar'].includes(p.sprite));
        assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y));
        assert.ok(segs.some((s) => within({ x: p.x, y: p.y, w: sp.w, h: sp.h }, s)));
      }
    }
  }
});

test('AC-5: partitions at the shared borders and doors stay reachable', () => {
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h), bd = officeBackdrop(l);
    const sameRow = (a, b) => a.rect.y === b.rect.y;
    let borders = 0;
    for (const a of l.areas) for (const b of l.areas) {
      if (a !== b && sameRow(a, b) && a.rect.x + a.rect.w === b.rect.x) {
        borders++;
        assert.ok(bd.partitions.some((p) => p.x === b.rect.x - PARTITION && p.y === a.rect.y + WALL_H && p.w === PARTITION && p.h === a.rect.h - WALL_H));
      }
    }
    assert.equal(borders, 5);
    for (const p of bd.partitions) assert.ok(within(p, { x: 0, y: 0, w: l.map.width, h: l.map.height }));
    for (const a of l.areas) {
      const n = l.nodes['door_' + a.id], cy = bd.corridor.y + Math.floor(bd.corridor.h / 2);
      const y0 = Math.min(n.y, cy), y1 = Math.max(n.y, cy);
      for (const o of [...bd.partitions, ...bd.walls]) {
        const hit = n.x >= o.x && n.x < o.x + o.w && y1 > o.y && y0 < o.y + o.h;
        assert.ok(!hit, `${a.id} door blocked`);
      }
    }
  }
});

test('AC-6: officeBackdrop never throws on invalid input', () => {
  const empty = { corridor: null, doors: [], walls: [], wallProps: [], partitions: [] };
  for (const v of [null, undefined, {}, 'x', 5, [], { areas: 'x' }, { nodes: {} }]) assert.deepEqual(officeBackdrop(v), empty);
});
