import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, STAGE_COLUMNS, activeAgents, laneTone } from '../factory/activity.js';
import { AVATARS } from '../factory/avatars.js';
import {
  AREAS, CHARACTER_FOR, FURNITURE, LOUNGE_SPOTS, MAP, MEETING_SEATS, SEATS, SPRITES, WAYPOINTS, WALL_H, PARTITION, DOOR_W, officeBackdrop, officeLandmarks, idleTagBox,
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
  assert.notDeepEqual(SPRITES.partition, SPRITES.wall);
  assert.ok(!Object.hasOwn(SPRITES, 'sign'));
  assert.ok(['window', 'clock', 'calendar'].some((k) => Object.hasOwn(SPRITES, k)));
  for (const { x, y, w, h } of Object.values(SPRITES)) assert.ok(x >= 0 && y >= 0 && x + w <= 256 && y + h <= 160);
  assert.equal(WALL_H, SPRITES.wall.h);
});

test('AC-2: Escalation calendar sits below the wall strip', () => {
  const esc = AREAS.find((a) => a.id === 'escalation').rect;
  const f = FURNITURE.find((e) => inside2(esc, e.x + SPRITES[e.sprite].w / 2, e.y + SPRITES[e.sprite].h / 2) && e.sprite === 'calendar');
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
      assert.equal(props.length > 0, a.id !== 'lounge');
      for (const p of props) {
        const sp = SPRITES[p.sprite];
        assert.ok(['window', 'clock', 'calendar', 'papers'].includes(p.sprite));
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
  const empty = { corridor: null, doors: [], floors: [], walls: [], wallProps: [], partitions: [] };
  for (const v of [null, undefined, {}, 'x', 5, [], { areas: 'x' }, { nodes: {} }]) assert.deepEqual(officeBackdrop(v), empty);
});

// ---- Outdoor Lounge, doors on the walk graph, per-room furniture (job 028) ----
const rectDist = (a, b) => Math.hypot(Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0), Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0));
const sprRect = (f) => ({ x: f.x, y: f.y, w: SPRITES[f.sprite].w, h: SPRITES[f.sprite].h });
const centerIn = (f) => areaOfBase({ x: f.x + SPRITES[f.sprite].w / 2, y: f.y + SPRITES[f.sprite].h / 2 })?.id;
const strictlyIn = (r, p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

test('AC-1: new atlas rects, sky band, partition body and every furniture sprite exist', () => {
  ['Orange', 'Yellow', 'Green', 'Blue', 'White', 'Grey'].forEach((c, i) => {
    assert.deepEqual(SPRITES['chair' + c], { x: 6 + 13 * i, y: 41, w: 11, h: 22 });
  });
  assert.ok(SPRITES.sky.y + SPRITES.sky.h <= 38);
  for (const k of ['calendar', 'papers', 'printer', 'pc', 'vending', 'cooler']) assert.ok(Object.hasOwn(SPRITES, k), k);
  assert.notDeepEqual(SPRITES.partition, SPRITES.wall);
  for (const { x, y, w, h } of Object.values(SPRITES)) assert.ok([x, y, w, h].every(Number.isInteger) && x + w <= 256 && y + h <= 160);
  for (const f of FURNITURE) assert.ok(Object.hasOwn(SPRITES, f.sprite), f.sprite);
});

test('AC-2: officeBackdrop has a floor per area, a sky wall for the lounge and no lounge wall props', () => {
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h), bd = officeBackdrop(l);
    assert.equal(bd.floors.length, l.areas.length);
    for (const a of l.areas) {
      const fl = bd.floors.find((f) => f.id === a.id);
      assert.deepEqual({ x: fl.x, y: fl.y, w: fl.w, h: fl.h }, a.rect);
      assert.equal(fl.kind, a.id === 'lounge' ? 'grass' : 'planks');
    }
    assert.ok(bd.walls.length);
    for (const wl of bd.walls) assert.equal(wl.sprite, wl.id === 'lounge' ? 'sky' : 'wall');
    assert.ok(!bd.wallProps.some((p) => p.id === 'lounge'));
  }
  assert.deepEqual(officeBackdrop(null).floors, []);
});

test('AC-3: every room has its own furniture set and every desk has a chair', () => {
  const byArea = new Map(AREAS.map((a) => [a.id, []]));
  for (const f of FURNITURE) byArea.get(centerIn(f)).push(f.sprite);
  const has = (id, ...names) => names.forEach((n) => assert.ok(byArea.get(id).includes(n), `${id} needs ${n}`));
  const anyChair = (id) => assert.ok(byArea.get(id).some((n) => n.startsWith('chair')), `${id} needs a chair`);
  has('research', 'desk', 'papers', 'calendar'); anyChair('research');
  has('engineering', 'terminal', 'pc', 'desk'); anyChair('engineering');
  has('review', 'cubicle', 'cubicleDeskL', 'cubicleDeskR'); anyChair('review');
  has('release', 'printer', 'flag'); assert.ok(byArea.get('release').some((n) => n.startsWith('sofa')));
  has('escalation', 'calendar');
  has('archive', 'shelf', 'bin'); assert.ok(byArea.get('archive').some((n) => ['cooler', 'binRed', 'binBlue'].includes(n)));
  has('lounge', 'deskLong', 'vending');
  assert.ok(byArea.get('lounge').filter((n) => n.startsWith('chair')).length >= 4);
  const bd = officeBackdrop(layoutOffice(256, 160));
  assert.ok(bd.wallProps.some((p) => p.id === 'escalation' && p.sprite === 'clock'));
  const sets = [...byArea.values()].map((n) => [...new Set(n)].sort().join());
  assert.equal(new Set(sets).size, sets.length);
  const chairs = FURNITURE.filter((f) => f.sprite.startsWith('chair')).map(sprRect);
  for (const f of FURNITURE.filter((e) => e.sprite === 'desk' || e.sprite === 'deskLong')) {
    assert.ok(chairs.some((c) => rectDist(c, sprRect(f)) <= 4), `${f.sprite} at ${f.x},${f.y} needs a chair`);
  }
});

test('AC-4: no walk edge crosses a wall or partition, and the door nodes line up', () => {
  const crosses = (a, b, o) => {
    for (let t = 0; t <= 1; t += 0.002) {
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) return true;
    }
    return false;
  };
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h), bd = officeBackdrop(l);
    for (const [a, b] of WAYPOINTS.edges) {
      for (const o of [...bd.walls, ...bd.partitions]) assert.ok(!crosses(l.nodes[a], l.nodes[b], o), `${a}-${b} at ${w}x${h}`);
    }
    for (const d of bd.doors) {
      const n = l.nodes['door_' + d.id];
      assert.ok(n.x >= d.x && n.x < d.x + d.w);
    }
    for (const id of ['release', 'lounge']) {
      const inn = l.nodes['in_' + id], door = l.nodes['door_' + id], area = l.areas.find((a) => a.id === id).rect;
      assert.equal(inn.x, door.x);
      assert.ok(inn.y > area.y + WALL_H);
      assert.ok(WAYPOINTS.edges.some(([a, b]) => [a, b].sort().join() === [`door_${id}`, `in_${id}`].sort().join()));
    }
  }
});

test('AC-5: no node sits strictly inside a piece of furniture', () => {
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h);
    for (const [name, p] of Object.entries(l.nodes)) {
      for (const f of l.furniture) assert.ok(!strictlyIn(sprRect(f), p), `${name} inside ${f.sprite} at ${w}x${h}`);
    }
  }
});

test('AC-6: lounge spots are on the terrace, next to a chair and 16px apart', () => {
  const lounge = AREAS.find((a) => a.id === 'lounge').rect;
  const chairs = FURNITURE.filter((f) => f.sprite.startsWith('chair') && centerIn(f) === 'lounge').map(sprRect);
  const spots = Object.values(LOUNGE_SPOTS).map((n) => WAYPOINTS.nodes[n]);
  assert.equal(new Set(Object.values(LOUNGE_SPOTS)).size, 8);
  for (const p of spots) {
    assert.ok(inRect(lounge, p) && p.y >= lounge.y + WALL_H);
    assert.ok(chairs.some((c) => rectDist(c, { x: p.x, y: p.y, w: 0, h: 0 }) <= 8));
  }
  for (const a of spots) for (const b of spots) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 16);
});

test('AC-7: officeLandmarks finds the special furniture in its room', () => {
  const want = { gate: ['terminal', 'engineering'], meeting: ['cubicle', 'review'], escalation: ['calendar', 'escalation'],
    shelf: ['shelf', 'archive'], bin: ['bin', 'archive'] };
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h), marks = officeLandmarks(l);
    for (const [key, [sprite, area]] of Object.entries(want)) {
      assert.ok(l.furniture.includes(marks[key]), key);
      assert.equal(marks[key].sprite, sprite);
      const r = l.areas.find((a) => a.id === area).rect, s = SPRITES[sprite];
      assert.ok(inRect(r, { x: marks[key].x + s.w / 2, y: marks[key].y + s.h / 2 }), `${key} in ${area}`);
    }
  }
  for (const bad of [null, {}, 'x']) {
    assert.deepEqual(officeLandmarks(bad), { gate: null, meeting: null, escalation: null, shelf: null, bin: null });
  }
});

// ---- Lounge placement, narrower Release, cubicle Review, workshop Engineering, pets (job 029) ----
const area = (id) => AREAS.find((a) => a.id === id).rect;
const baseLayout = layoutOffice(256, 160);
const furnOf = (id) => FURNITURE.filter((f) => centerIn(f) === id);
const overlaps = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
const agentOf = (spot) => Object.keys(LOUNGE_SPOTS).find((a) => LOUNGE_SPOTS[a] === spot);

test('AC-1: bottom row keeps archive, narrows Release and every furniture piece fits its room', () => {
  const top = ['research', 'engineering', 'review'].map((id) => area(id));
  assert.deepEqual(top, [{ x: 0, y: 0, w: 84, h: 64 }, { x: 84, y: 0, w: 88, h: 64 }, { x: 172, y: 0, w: 84, h: 64 }]);
  assert.deepEqual(area('archive'), { x: 208, y: 68, w: 48, h: 92 });
  const rel = area('release'), esc = area('escalation'), lou = area('lounge');
  assert.ok(rel.w >= 40 && rel.w <= 56);
  assert.equal(esc.w, 60);
  assert.equal(lou.w, 64 + (84 - rel.w));
  assert.equal(rel.x, 0);
  assert.equal(esc.x, rel.x + rel.w);
  assert.equal(lou.x, esc.x + esc.w);
  assert.equal(lou.x + lou.w, area('archive').x);
  assert.ok(rel.x + rel.w <= esc.x && esc.x + esc.w <= lou.x);
  const bd = officeBackdrop(baseLayout);
  for (const f of FURNITURE) {
    const r = sprRect(f), a = area(centerIn(f));
    assert.ok(r.x >= a.x && r.y >= a.y && r.x + r.w <= a.x + a.w && r.y + r.h <= a.y + a.h, `${f.sprite} at ${f.x},${f.y} inside its room`);
    for (const p of bd.partitions) assert.ok(!overlaps(r, p), `${f.sprite} at ${f.x},${f.y} cuts a partition`);
  }
});

test('AC-2: the Lounge has a table, a vending machine and a chair beside each idle spot', () => {
  const lounge = furnOf('lounge');
  const table = lounge.find((f) => f.sprite === 'deskLong'), chairs = lounge.filter((f) => f.sprite.startsWith('chair')).map(sprRect);
  assert.ok(table && lounge.some((f) => f.sprite === 'vending') && chairs.length >= 8);
  const spots = Object.values(LOUNGE_SPOTS).map((n) => WAYPOINTS.nodes[n]);
  assert.equal(spots.length, 8);
  const near = spots.map((p) => {
    const d = chairs.map((c) => rectDist(c, { x: p.x, y: p.y, w: 0, h: 0 }));
    return d.indexOf(Math.min(...d));
  });
  assert.equal(new Set(near).size, 8);
  const lounge0 = area('lounge');
  spots.forEach((p, i) => {
    const c = chairs[near[i]];
    assert.ok(rectDist(c, { x: p.x, y: p.y, w: 0, h: 0 }) <= 8, `spot ${i} within 8px of its chair`);
    assert.ok(p.x <= c.x - 4 || p.x >= c.x + c.w + 4, `spot ${i} beside its chair`);
    assert.ok(p.y >= lounge0.y + WALL_H);
  });
  for (const a of spots) for (const b of spots) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 16);
  const cx = table.x + SPRITES.deskLong.w / 2, cy = table.y + SPRITES.deskLong.h / 2;
  assert.ok(Math.abs(spots.reduce((s, p) => s + p.x, 0) / 8 - cx) <= 8);
  for (const side of [(p) => p.x < cx, (p) => p.x > cx, (p) => p.y < cy, (p) => p.y > cy]) assert.ok(spots.filter(side).length >= 2);
});

test('AC-3: idle tags do not overlap each other or the Lounge furniture, and idleTagBox rejects bad input', () => {
  const lounge = furnOf('lounge');
  const tags = (l, scale) => Object.entries(LOUNGE_SPOTS).map(([agent, n]) => idleTagBox(l.nodes[n], agent, scale, 36));
  for (const [w, h, scale, furniture] of [[768, 480, 3, true], [512, 320, 2, false]]) {
    const l = layoutOffice(w, h);
    assert.equal(l.scale, scale);
    const t = tags(l, scale);
    t.forEach((a, i) => {
      assert.ok(a && a.w === 44 && a.h === 15);
      t.slice(i + 1).forEach((b) => assert.ok(!overlaps(a, b), `tags ${i} overlap at scale ${scale}`));
      if (furniture) {
        for (const f of lounge) {
          const r = sprRect(f);
          assert.ok(!overlaps(a, { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale }), `tag ${i} covers ${f.sprite}`);
        }
      }
    });
  }
  const ok = { x: 10, y: 20 };
  assert.deepEqual(idleTagBox(ok, 'intake', 3, 36), { x: Math.round((10 - SPRITES.charC.w / 2) * 3) + (SPRITES.charC.w * 3) / 2 - 22, y: Math.round((20 - SPRITES.charC.h) * 3) + 24, w: 44, h: 15 });
  for (const args of [[null, 'intake', 3, 36], [ok, 'nobody', 3, 36], [ok, 'intake', 0, 36], [ok, 'intake', 1.5, 36], [ok, 'intake', 3, NaN],
    [ok, 'intake', 3, -1], [{ x: NaN, y: 1 }, 'intake', 3, 36], [ok, null, 3, 36], [ok, 'intake']]) {
    assert.equal(idleTagBox(...args), null);
  }
});

test('AC-4: Review is a cubicle pod and the reviewers stay at their desks', () => {
  const names = furnOf('review').map((f) => f.sprite), count = (n) => names.filter((x) => x === n).length;
  assert.ok(count('cubicle') >= 1 && count('cubicleDivider') >= 1 && count('pc') >= 4);
  assert.ok(count('cubicleDeskL') >= 1 && count('cubicleDeskR') >= 1 && count('cubicleDeskL') + count('cubicleDeskR') >= 4);
  assert.ok(names.filter((n) => n.startsWith('chair')).length >= 4);
  assert.ok(names.some((n) => ['flag', 'flagB', 'flagC', 'papers', 'papersB', 'mug', 'trinket'].includes(n)));
  assert.ok(!names.includes('deskLong'));
  assert.ok(names.some((n) => ['window', 'windowB'].includes(n)) || officeBackdrop(baseLayout).wallProps.some((p) => p.id === 'review' && p.sprite === 'window'));
  assert.ok(names.includes('clock') || officeBackdrop(baseLayout).wallProps.some((p) => p.id === 'review' && p.sprite === 'clock'));
  const chairs = furnOf('review').filter((f) => f.sprite.startsWith('chair')).map(sprRect);
  const halves = furnOf('review').filter((f) => f.sprite.startsWith('cubicleDesk')).map(sprRect);
  const used = new Set();
  for (const r of Object.keys(MEETING_SEATS)) {
    const p = WAYPOINTS.nodes[SEATS[r]];
    assert.equal(MEETING_SEATS[r], SEATS[r]);
    const i = chairs.findIndex((c, k) => !used.has(k) && rectDist(c, { x: p.x, y: p.y, w: 0, h: 0 }) <= 6);
    assert.ok(i >= 0, `${r} next to its own chair`);
    used.add(i);
    assert.ok(halves.some((d) => rectDist(d, chairs[i]) <= 4), `${r} chair touches a half desk`);
  }
  assert.ok(!Object.keys(WAYPOINTS.nodes).some((n) => n.startsWith('meet_')));
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h), m = officeLandmarks(l).meeting, r = l.areas.find((a) => a.id === 'review').rect;
    assert.equal(m.sprite, 'cubicle');
    assert.ok(inRect(r, { x: m.x + SPRITES.cubicle.w / 2, y: m.y + SPRITES.cubicle.h / 2 }));
  }
});

test('AC-5: Engineering is a workshop with several workstations and a clear terminal', () => {
  const eng = furnOf('engineering'), names = eng.map((f) => f.sprite);
  for (const n of ['terminal', 'calendar', 'plant', 'coffee', 'cooler']) assert.ok(names.includes(n), n);
  const desks = eng.filter((f) => f.sprite === 'desk').map(sprRect), pcs = eng.filter((f) => f.sprite === 'pc').map(sprRect);
  const chairs = eng.filter((f) => f.sprite.startsWith('chair'));
  assert.ok(desks.length >= 2);
  for (const d of desks) {
    assert.ok(pcs.some((p) => rectDist(p, d) <= 4), 'desk with a pc');
    assert.ok(chairs.some((c) => rectDist(sprRect(c), d) <= 4), 'desk with a chair');
  }
  assert.ok(new Set(chairs.map((c) => c.sprite)).size >= 2);
  const term = FURNITURE.find((f) => f.sprite === 'terminal');
  for (const f of FURNITURE) if (f !== term) assert.ok(!overlaps(sprRect(f), sprRect(term)), `${f.sprite} cuts the terminal`);
});

test('AC-6: one dog and one cat live in Research and the new atlas rects exist', () => {
  for (const n of ['dog', 'cat']) {
    const all = FURNITURE.filter((f) => f.sprite === n);
    assert.equal(all.length, 1, n);
    assert.equal(centerIn(all[0]), 'research');
  }
  const want = ['cubicle', 'cubicleDeskL', 'cubicleDeskR', 'cubicleDivider', 'flagB', 'flagC', 'papersB', 'mug', 'trinket', 'windowB', 'coffee', 'dog', 'cat'];
  for (const n of want) {
    const { x, y, w, h } = SPRITES[n];
    assert.ok([x, y, w, h].every(Number.isInteger) && x >= 0 && y >= 0 && x + w <= 256 && y + h <= 160, n);
  }
});

test('AC-7: Research and Engineering are entered through their door on the walk graph', () => {
  const has = (a, b) => WAYPOINTS.edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
  for (const [w, h] of SIZES) {
    const l = layoutOffice(w, h);
    for (const id of ['research', 'engineering']) {
      const inn = l.nodes['in_' + id], door = l.nodes['door_' + id], r = l.areas.find((a) => a.id === id).rect;
      assert.ok(inn && inn.x === door.x, `${id} in_ shares the door x at ${w}x${h}`);
      assert.ok(inn.y > r.y + WALL_H && inn.y < r.y + r.h - PARTITION);
      assert.ok(has('door_' + id, 'in_' + id));
      for (const [a, b] of WAYPOINTS.edges) {
        if (a === 'door_' + id || b === 'door_' + id) assert.ok([a, b].some((n) => n === 'in_' + id || n.startsWith('cor_')), `${id} door edge ${a}-${b}`);
      }
    }
  }
});
