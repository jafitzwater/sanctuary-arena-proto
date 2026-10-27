import assert from 'node:assert/strict';
import MinionWaves from '../src/MinionWaves';
import {
  waveSpawnTimeS, mobTypeForWave, strengthMultiplier, scaledStats, WAVE_SIZE, MOB_DATA, MINION_BASE,
} from '../src/MinionWaveData';

// --- pure schedule ---
assert.equal(waveSpawnTimeS(0), 30);
assert.equal(waveSpawnTimeS(1), 90);
assert.equal(waveSpawnTimeS(2), 150);
const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(mobTypeForWave);
assert.deepEqual(order, [
  'rogue', 'rogue', 'valkyrie', 'valkyrie', 'act2Mercenary', 'act2Mercenary',
  'act3Mercenary', 'act3Mercenary', 'rogue', 'rogue',
]);
assert.equal(strengthMultiplier(0), 1);
assert.ok(Math.abs(strengthMultiplier(1) - 1.2) < 1e-9);
assert.ok(Math.abs(strengthMultiplier(2) - 1.44) < 1e-9); // compounding: 1.2 x 1.2
// NOTE: 249 assumes the [TEMP] readings: Joseph-confirmed compounding 1/5 (1.2^5 = 2.48832), applied to maxHp,
// global wave count, and the [TEMP] shared base maxHp of 100. It changes if STRENGTH_MODE or MINION_BASE changes.
assert.equal(scaledStats('rogue', 5).maxHp, 249);
assert.deepEqual(MOB_DATA.valkyrie.skillStubs.map((s) => s.name), ['jab', 'poison strike']);
assert.ok(Object.values(MOB_DATA).every((d) => d.skillStubs.every((s) => s.wired === false)));

// --- simulation with a fake scene (no Phaser needed) ---
const fakeObj: any = new Proxy({}, { get: (_t, k) => (k === 'destroy' ? () => {} : () => fakeObj) });
const fakeScene: any = { add: { rectangle: () => fakeObj } };
const nodes = (y: number) => [0, 1, 2, 3].map((i) => ({ x: 100 + i * 400, y }));
const lanes = { top: nodes(64), middle: nodes(320), bottom: nodes(576) };
const w = new MinionWaves(fakeScene, lanes);
w.start();
const tick = (secs: number) => { for (let i = 0; i < secs * 20; i++) w.update(50); };

tick(29);
assert.equal(w.getMinions().length, 0, 'nothing before 30s');
tick(2); // t=31: first spawn (stagger 0.6s => 2 per lane/team so far)
assert.ok(w.getMinions().length > 0, 'spawning started at 30s');
tick(4); // t=35: all 5 per lane per team = 30
const first = w.getMinions().filter((m) => m.waveIndex === 0);
assert.equal(first.length, WAVE_SIZE * 3 * 2, '5 per roadway x 3 roadways x 2 teams');
// every allied top minion of wave 0 is a rogue with base stats
const t0 = w.getMinions().find((m) => m.waveIndex === 0)!;
assert.equal(t0.type, 'rogue');
assert.equal(t0.maxHp, MINION_BASE.maxHp);
// minions stay on their lane's y (roadways only)
for (const m of w.getMinions()) assert.equal(m.y, lanes[m.lane][0].y);

// waves of the second rogue wave are 20% stronger, spawn at 90s
tick(60);
const second = w.getMinions().filter((m) => m.waveIndex === 1);
assert.ok(second.length > 0);
assert.equal(second[0].maxHp, Math.round(MINION_BASE.maxHp * 1.2));
// wave 2 (t=150) is valkyries
tick(60);
assert.ok(w.getMinions().some((m) => m.waveIndex === 2 && m.type === 'valkyrie'));

console.log('minionWaves tests passed');
