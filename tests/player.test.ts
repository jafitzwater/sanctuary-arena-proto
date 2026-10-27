import assert from 'node:assert/strict';
import Player, { AttackTarget } from '../src/Player';
import MinionWaves from '../src/MinionWaves';
import Towers from '../src/Towers';
import Worldstones from '../src/Worldstones';
import {
  MapLayout, isWalkable, planRoute, spawnPoint, statsForLevel, derivedForLevel, PLAYER_BASE, LEVEL_CAP,
  xpToReach, levelForXp, skillLevelsForLevel, manaCostPct, manaCost, respawnTimeS, goldAfterDeath,
  MINION_GOLD, MINION_XP, SKILL_COOLDOWN_S, SKILL_ORDER, damageAfterDefense, XP_SHARE_RADIUS,
} from '../src/PlayerData';
import { WORLDSTONE_BASE } from '../src/WorldstoneData';
import { TOWER_BASE } from '../src/TowerData';

const fakeObj: any = new Proxy({}, { get: (_t, k) => (k === 'destroy' ? () => {} : () => fakeObj) });
const fakeScene: any = { add: { rectangle: () => fakeObj } };
// Same values as LaneMapScene (TILE 64, 40x11, base 4 cols, lanes on rows 1/5/9).
const L: MapLayout = { tile: 64, cols: 40, rows: 11, baseCols: 4, laneRows: [1, 5, 9] };
const c = (col: number) => col * 64 + 32;
const r = (row: number) => row * 64 + 32;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ---- pure: map rules ----
assert.ok(isWalkable(L, c(1), r(3)), 'base walkable');
assert.ok(isWalkable(L, c(20), r(5)), 'roadway walkable');
assert.ok(!isWalkable(L, c(20), r(3)), 'ground not walkable');
assert.ok(!isWalkable(L, -1, r(5)), 'outside map');
assert.deepEqual(planRoute(L, { x: c(10), y: r(1) }, { x: c(10), y: r(5) }).map((p) => p.x), [c(3), c(3), c(10)], 'lane change via base');
assert.deepEqual(planRoute(L, { x: c(20), y: r(5) }, { x: c(22), y: r(4) }), [{ x: c(22), y: r(5) }], 'ground tap snaps to roadway');

// ---- pure: stats [DOC] 2/2/1/0 per level, cap 15 ----
assert.deepEqual(statsForLevel(1), { strength: 2, vitality: 2, dexterity: 1, energy: 0 });
assert.deepEqual(statsForLevel(15), { strength: 30, vitality: 30, dexterity: 15, energy: 0 });
assert.deepEqual(statsForLevel(20), statsForLevel(15), 'level cap 15');
const d3 = derivedForLevel(3); // str 6, vit 6, dex 3, energy 0
assert.ok(near(d3.attackDamage, PLAYER_BASE.attackDamage * 1.30), '1 str = +5% melee');
assert.ok(near(d3.maxHp, PLAYER_BASE.maxHp * 1.18), '1 vit = +3% health');
assert.ok(near(d3.defense, PLAYER_BASE.defense * 1.06), '1 dex = +2% defense');
assert.ok(near(d3.maxMana, PLAYER_BASE.maxMana), '0 energy => base mana');
assert.equal(levelForXp(0), 1);
assert.equal(levelForXp(xpToReach(2)), 2);
assert.equal(levelForXp(1e9), LEVEL_CAP);

// ---- pure: skills ----
// Unlocks 1/3/5/7, whirlwind from remaining points after 7 ([TEMP] reading: level 8); auto-spent in listed order [TEMP].
assert.deepEqual(skillLevelsForLevel(1), { bash: 1, shout: 0, 'leap attack': 0, 'battle orders': 0, whirlwind: 0 });
assert.equal(skillLevelsForLevel(2).bash, 2);
assert.equal(skillLevelsForLevel(3).shout, 1);
assert.equal(skillLevelsForLevel(5)['leap attack'], 1);
assert.equal(skillLevelsForLevel(7)['battle orders'], 1);
assert.equal(skillLevelsForLevel(7).whirlwind, 0);
assert.equal(skillLevelsForLevel(8).whirlwind, 1);
const s15 = skillLevelsForLevel(15);
assert.equal(Object.values(s15).reduce((a, b) => a + b, 0), 15, '1 point per level');
assert.ok(Object.values(s15).every((v) => v <= 5), 'skills max at 5');
assert.deepEqual([1, 2, 3, 4, 5].map(manaCostPct), [10, 15, 20, 25, 30]);
assert.equal(manaCost(2, 200), 30, 'percent of MAXIMUM mana');
assert.deepEqual(SKILL_ORDER, ['bash', 'shout', 'leap attack', 'battle orders', 'whirlwind']);

// ---- pure: death ----
assert.deepEqual([1, 2, 3].map(respawnTimeS), [5, 10, 15]);
assert.equal(goldAfterDeath(100), 75);

// ---- Player class ----
const tick = (p: Player, secs: number, matchStart: number, targets: AttackTarget[] = []) => {
  for (let i = 0; i < secs * 20; i++) p.update(50, matchStart + i * 0.05, targets);
};
const sp = spawnPoint(L);

// Opening wait: blocked in base until 15s.
let p = new Player(fakeScene, L);
assert.equal(p.team, 'allied');
p.moveTo(c(20), sp.y);
tick(p, 5, 0);
assert.ok(p.x < 4 * 64, 'blocked in base during opening wait');
p.moveTo(c(20), sp.y);
tick(p, 5, 15);
assert.ok(p.x > 4 * 64, 'free after 15s');
assert.equal(p.y, sp.y, 'stays on roadway');

// Basic attack: closest valid target in range, no friendly fire, last-hit gold.
p = new Player(fakeScene, L);
const hits: string[] = [];
const mkT = (id: string, team: 'allied' | 'enemy', dx: number, hp: number, kind: AttackTarget['kind'] = 'minion') => {
  const t: AttackTarget = { kind, team, x: p.x + dx, y: p.y, alive: true, hit: (a) => { hits.push(id); hp -= a; if (hp <= 0) t.alive = false; return hp <= 0; } };
  return t;
};
const friend = mkT('friend', 'allied', 5, 999);
const far = mkT('far', 'enemy', PLAYER_BASE.attackRange + 20, 999);
const nearT = mkT('near', 'enemy', 40, 1);
const nearer = mkT('nearer', 'enemy', 20, 1);
tick(p, 0.05, 20, [friend, far, nearT, nearer]);
assert.deepEqual(hits, ['nearer']);
assert.equal(p.gold, MINION_GOLD, 'last hit gold');
tick(p, 1, 20, [friend, far, nearT, nearer]);
assert.deepEqual(hits, ['nearer', 'near']);
assert.equal(p.gold, 2 * MINION_GOLD);
// tower kills give no gold (docs only give mob gold)
const tw = mkT('tower', 'enemy', 10, 1, 'tower');
tick(p, 1, 20, [tw]);
assert.equal(p.gold, 2 * MINION_GOLD);

// XP shared when nearby; level up restores health/mana [DOC].
p.onEnemyMinionDied(p.x + XP_SHARE_RADIUS + 1, p.y);
assert.equal(p.xp, 0, 'too far: no xp');
p.hp = 1;
const need = Math.ceil(xpToReach(2) / MINION_XP);
for (let i = 0; i < need; i++) p.onEnemyMinionDied(p.x + 10, p.y);
assert.equal(p.level, 2);
assert.equal(p.hp, p.maxHp);
assert.equal(p.skillLevels.bash, 2);

// Skill: needs a valid target, costs % of max mana, shared cooldown.
const mana0 = p.mana;
const dummy = mkT('dummy', 'enemy', 30, 1e9);
assert.equal(p.castSkill('shout', [dummy]), false, 'locked at level 2');
assert.equal(p.castSkill('bash', []), false, 'no target: not cast');
assert.equal(p.mana, mana0);
assert.equal(p.castSkill('bash', [dummy]), true);
assert.ok(near(p.mana, mana0 - p.maxMana * 0.15), 'bash L2 = 15% of max mana');
assert.equal(p.skillCooldownLeftS.bash, SKILL_COOLDOWN_S);
assert.equal(p.castSkill('bash', [dummy]), false, 'on cooldown');

// Death / respawn / gold loss.
p = new Player(fakeScene, L);
p.gold = 100;
p.x = c(20); p.y = r(5);
p.takeDamage(1e6);
assert.equal(p.alive, false);
assert.equal(p.gold, 75);
tick(p, 4.9, 30);
assert.equal(p.alive, false, 'first death 5s');
tick(p, 0.2, 35);
assert.equal(p.alive, true);
assert.deepEqual([p.x, p.y], [sp.x, sp.y], 'respawn at own base');
p.takeDamage(1e6);
tick(p, 9.9, 40);
assert.equal(p.alive, false, 'second death 10s');
tick(p, 0.2, 50);
assert.equal(p.alive, true);
// defense reduces damage
p.takeDamage(10);
assert.ok(near(p.hp, p.maxHp - damageAfterDefense(10, p.defense)));

// Base healing: ~8s to full in own base.
p = new Player(fakeScene, L);
p.hp = 1;
tick(p, 4, 20);
assert.ok(p.hp < p.maxHp && p.hp > p.maxHp * 0.45, 'about half after 4s');
tick(p, 4.1, 24);
assert.equal(p.hp, p.maxHp, 'full in ~8s');

// Teleport: 3s channel, cancelled by move or damage.
p = new Player(fakeScene, L);
p.x = c(20); p.y = r(5);
p.startTeleport();
tick(p, 2.9, 60);
assert.equal(p.x, c(20), 'still channeling');
tick(p, 0.2, 63);
assert.deepEqual([p.x, p.y], [sp.x, sp.y], 'arrived at base');
p.x = c(20);
p.startTeleport(); tick(p, 1, 70); p.takeDamage(1); tick(p, 3, 71);
assert.equal(p.x, c(20), 'damage cancels teleport');
p.startTeleport(); tick(p, 1, 75); p.moveTo(c(21), r(5)); tick(p, 3, 76);
assert.notEqual(p.x, sp.x, 'move cancels teleport');

// ---- integration with the real systems (fake scene) ----
const nodes = (y: number) => [3, 8, 14, 19, 25, 31, 36].map((col) => ({ x: c(col), y }));
const waves = new MinionWaves(fakeScene, { top: nodes(r(1)), middle: nodes(r(5)), bottom: nodes(r(9)) });
waves.start();
const slots = (row: number) => ({ allied: [8, 14].map((col) => ({ x: c(col), y: r(row) })), enemy: [25, 31].map((col) => ({ x: c(col), y: r(row) })) });
const towers = new Towers(fakeScene, { top: slots(1), middle: slots(5), bottom: slots(9) });
const stones = new Worldstones(fakeScene, { allied: { x: c(1), y: r(5) }, enemy: { x: c(38), y: r(5) } });
let winner: string | null = null;
stones.onMatchEnd = (w) => (winner = w);
const P = new Player(fakeScene, L);

// Enemy tower shoots the player (Targetable), allied towers never do.
P.x = c(25) - 100; P.y = r(5);
const hp0 = P.hp;
towers.update(50, [P], (t, dmg) => t.takeDamage(dmg));
assert.ok(near(P.hp, hp0 - damageAfterDefense(TOWER_BASE.damage, P.defense)), 'enemy tower hits player');
P.hp = hp0; P.x = c(8) + 10;
towers.getTowers().forEach((t) => (t.cooldownLeftS = 0));
towers.update(50, [P], (t, dmg) => t.takeDamage(dmg));
assert.equal(P.hp, hp0, 'no friendly fire from allied towers');

// Player damages an enemy tower and destroys the enemy Worldstone through the existing hooks.
const targets = (): AttackTarget[] => [
  ...towers.getTowers().filter((t) => t.team === 'enemy' && t.alive).map((t) => ({ kind: 'tower' as const, team: t.team, x: t.x, y: t.y, alive: true, hit: (a: number) => towers.damageTower(t, a) })),
  ...[stones.get('enemy')].filter((w) => w.alive).map((w) => ({ kind: 'worldstone' as const, team: w.team, x: w.x, y: w.y, alive: true, hit: (a: number) => stones.damageWorldstone(w, a, 'allied') })),
];
const T = towers.getTowers().find((t) => t.team === 'enemy' && t.lane === 'middle' && t.x === c(25))!;
P.x = T.x - 30; P.y = T.y; P.route = [];
P.update(50, 100, targets());
assert.ok(T.hp < TOWER_BASE.maxHp, 'player damages enemy tower');
P.x = c(38) - 30; P.y = r(5);
for (let i = 0; i < 20 * 600 && !winner; i++) P.update(50, 100, targets());
assert.equal(stones.get('enemy').alive, false);
assert.equal(winner, 'allied', 'match ends on enemy Worldstone death');
assert.equal(stones.get('allied').hp, WORLDSTONE_BASE.maxHp, 'player cannot hurt own Worldstone');

// Enemy minions attack the player via the MinionWaves extra-target hook.
const P2 = new Player(fakeScene, L);
P2.x = c(36); P2.y = r(5);
let minionHits = 0;
for (let i = 0; i < 20 * 32; i++) waves.update(50, [P2], (pl, dmg) => { minionHits++; pl.takeDamage(dmg); });
assert.ok(minionHits > 0, 'enemy minions attack the player');
assert.ok(waves.getElapsedS() > 31);

console.log('player tests passed');
