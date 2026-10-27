import assert from 'node:assert/strict';
import Worldstones from '../src/Worldstones';
import Towers from '../src/Towers';
import { WORLDSTONE_BASE } from '../src/WorldstoneData';
import { TOWER_BASE } from '../src/TowerData';

const fakeObj: any = new Proxy({}, { get: (_t, k) => (k === 'destroy' ? () => {} : () => fakeObj) });
const fakeScene: any = { add: { rectangle: () => fakeObj } };
const slots = { allied: { x: 96, y: 352 }, enemy: { x: 2464, y: 352 } };

const w = new Worldstones(fakeScene, slots);
const A = w.get('allied');
const E = w.get('enemy');
let ended: any[] = [];
w.onMatchEnd = (winner, d) => ended.push([winner, d]);

// one per base, at the slots, shared [TEMP] hp, alive
assert.deepEqual([A.x, A.y], [96, 352]);
assert.deepEqual([E.x, E.y], [2464, 352]);
assert.equal(A.team, 'allied');
assert.equal(E.team, 'enemy');
assert.ok(A.hp === WORLDSTONE_BASE.maxHp && E.hp === WORLDSTONE_BASE.maxHp);

// no friendly fire
assert.equal(w.damageWorldstone(E, 999, 'enemy'), false);
assert.equal(E.hp, WORLDSTONE_BASE.maxHp, 'own team cannot damage it');

// NO GATING: all 6 enemy towers are standing, and the enemy Worldstone can still be damaged.
const towers = new Towers(fakeScene, {
  top: { allied: [{ x: 1, y: 1 }, { x: 2, y: 1 }], enemy: [{ x: 3, y: 1 }, { x: 4, y: 1 }] },
  middle: { allied: [{ x: 1, y: 2 }, { x: 2, y: 2 }], enemy: [{ x: 3, y: 2 }, { x: 4, y: 2 }] },
  bottom: { allied: [{ x: 1, y: 3 }, { x: 2, y: 3 }], enemy: [{ x: 3, y: 3 }, { x: 4, y: 3 }] },
});
assert.equal(towers.towersRemaining('enemy'), 6);
assert.equal(w.damageWorldstone(E, 100, 'allied'), false);
assert.equal(E.hp, WORLDSTONE_BASE.maxHp - 100, 'attackable while towers still stand');
assert.equal(towers.towersRemaining('enemy'), 6, 'towersRemaining is a plain count, untouched');
void TOWER_BASE;

// immobile
assert.deepEqual([E.x, E.y], [2464, 352]);

// destroying the enemy Worldstone ends the match once, winner = allied
assert.equal(ended.length, 0);
assert.equal(w.damageWorldstone(E, WORLDSTONE_BASE.maxHp, 'allied'), true);
assert.equal(E.hp, 0);
assert.equal(E.alive, false);
assert.equal(w.isMatchOver(), true);
assert.equal(ended.length, 1);
assert.equal(ended[0][0], 'allied');
assert.equal(ended[0][1], E);

// after the match ends, nothing further is accepted and the hook does not fire again
assert.equal(w.damageWorldstone(A, 50, 'enemy'), false);
assert.equal(A.hp, WORLDSTONE_BASE.maxHp);
assert.equal(w.damageWorldstone(E, 50, 'allied'), false);
assert.equal(ended.length, 1);

// the other direction: destroying the allied Worldstone => enemy wins
const w2 = new Worldstones(fakeScene, slots);
let winner2: string | null = null;
w2.onMatchEnd = (win) => (winner2 = win);
assert.equal(w2.damageWorldstone(w2.get('allied'), WORLDSTONE_BASE.maxHp + 1, 'enemy'), true);
assert.equal(winner2, 'enemy');

console.log('worldstones tests passed');
