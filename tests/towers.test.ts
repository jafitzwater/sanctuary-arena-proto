import assert from 'node:assert/strict';
import Towers, { Targetable } from '../src/Towers';
import { TOWER_BASE, TOWERS_PER_SIDE_PER_LANE } from '../src/TowerData';

const fakeObj: any = new Proxy({}, { get: (_t, k) => (k === 'destroy' ? () => {} : () => fakeObj) });
const fakeScene: any = { add: { rectangle: () => fakeObj } };

// Same shape/columns as LaneMapScene TOWER_SLOTS (allied cols 8,14; enemy cols 25,31; rows 1/5/9).
const col = (c: number) => c * 64 + 32;
const row = (r: number) => r * 64 + 32;
const slots: any = {};
for (const [lane, r] of [['top', 1], ['middle', 5], ['bottom', 9]] as const) {
  slots[lane] = {
    allied: [8, 14].map((c) => ({ x: col(c), y: row(r) })),
    enemy: [25, 31].map((c) => ({ x: col(c), y: row(r) })),
  };
}

const towers = new Towers(fakeScene, slots);

// --- layout: 2 per side per roadway, 12 total, gap between sides has no towers ---
assert.equal(towers.getTowers().length, TOWERS_PER_SIDE_PER_LANE * 2 * 3);
assert.equal(towers.towersRemaining('allied'), 6);
assert.equal(towers.towersRemaining('enemy'), 6);
for (const lane of ['top', 'middle', 'bottom'] as const) {
  const a = towers.getTowers().filter((t) => t.lane === lane && t.team === 'allied');
  const e = towers.getTowers().filter((t) => t.lane === lane && t.team === 'enemy');
  assert.equal(a.length, 2);
  assert.equal(e.length, 2);
  assert.ok(Math.abs(a[0].x - a[1].x) > 64, 'spread apart');
  assert.ok(Math.min(...e.map((t) => t.x)) - Math.max(...a.map((t) => t.x)) > 64 * 5, 'neutral gap');
}
// every tower uses the one shared [TEMP] block
assert.ok(towers.getTowers().every((t) =>
  t.maxHp === TOWER_BASE.maxHp && t.damage === TOWER_BASE.damage &&
  t.range === TOWER_BASE.range && t.cooldownS === TOWER_BASE.cooldownS));

// --- targeting ---
const T = towers.getTowers().find((t) => t.lane === 'middle' && t.team === 'allied' && t.x === col(8))!;
const mk = (team: 'allied' | 'enemy', dx: number): Targetable & { hits: number } =>
  ({ team, x: T.x + dx, y: T.y, alive: true, hits: 0 });
const far = mk('enemy', TOWER_BASE.range + 50); // out of range
const near = mk('enemy', 120);
const nearest = mk('enemy', 60);
const friend = mk('allied', 10); // closest of all but same team
const hits: any[] = [];
const apply = (t: any, d: number) => hits.push([t, d]);

// Isolate this tower: put the others on cooldown so only T fires.
towers.getTowers().forEach((t) => { if (t !== T) t.cooldownLeftS = 999; });
towers.update(50, [far, near, nearest, friend], apply);
assert.equal(hits.length, 1, 'one attack');
assert.equal(hits[0][0], nearest, 'closest valid (enemy, in range) target');
assert.equal(hits[0][1], TOWER_BASE.damage);

// cooldown: no second shot until cooldownS has passed
const tick = (ms: number) => { for (let i = 0; i < ms / 50; i++) towers.update(50, [nearest], apply); };
tick(450);
assert.equal(hits.length, 1, 'cooling down');
tick(600);
assert.equal(hits.length, 2, 'fires again after cooldown');

// no friendly fire, nothing in range => no attack
towers.getTowers().forEach((t) => { if (t !== T) t.cooldownLeftS = 999; });
T.cooldownLeftS = 0;
towers.update(50, [friend, far], apply);
assert.equal(hits.length, 2, 'does not shoot allies or out-of-range');

// dead targets are ignored
const dead = { ...nearest, alive: false };
towers.update(50, [dead], apply);
assert.equal(hits.length, 2);

// --- destruction: immobile, stops attacking, towersRemaining drops ---
const x0 = T.x, y0 = T.y;
assert.equal(towers.damageTower(T, TOWER_BASE.maxHp - 1), false);
assert.equal(towers.towersRemaining('allied'), 6);
assert.equal(towers.damageTower(T, 1), true);
assert.equal(towers.towersRemaining('allied'), 5);
assert.equal(towers.towersRemaining('enemy'), 6);
assert.equal(towers.damageTower(T, 100), false, 'already destroyed');
T.cooldownLeftS = 0;
towers.update(50, [nearest], apply);
assert.equal(hits.length, 2, 'destroyed tower does not attack');
assert.equal(T.x, x0); assert.equal(T.y, y0);

console.log('towers tests passed');
