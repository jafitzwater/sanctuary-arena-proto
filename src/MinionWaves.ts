/**
 * MinionWaves.ts
 *
 * IMPLEMENTS
 *  - Tech design "Entity Model": Minion = basic attack only, waves of 5, travel via roadway path nodes.
 *  - Original doc "Support waves": waves of 5 per roadway, first wave 15s after the 15s opening wait,
 *    then every 60s, each wave 1/5th stronger, mob type in series (two waves each, then loop).
 *  - Both bases spawn on all three roadways (doc: "Bases spawn waves ... Each roadway gets each mob type").
 *  - Tech design "Movement & Combat": range + closest-target basic attacks; no friendly fire;
 *    minions never block each other (no collision); minions stay on roadway path nodes only.
 *
 * DATA: all numbers/timings live in MinionWaveData.ts, tagged [DOC] or [TEMP]. All four mob types share
 * one placeholder stat set (docs give no hp/damage/range/cooldown/speed).
 *
 * [TEMP] BEHAVIOR CHOICES (not specified by the docs): minions stop to fight when an enemy is in range;
 * all three roadways spawn the same mob type at the same moment; 0.6s spawn stagger.
 *
 * DELIBERATELY NOT INCLUDED
 *  - Mob skills (jab, poison strike, defense aura, fireball, sword strike): data stubs only, not wired.
 *  - Targeting towers or the Worldstone: minions fight enemy minions (and the player, see below), and stop
 *    at the end node of their lane.
 *
 * PLAYER HOOKUP: update() takes optional extra targets (the player) + a damage callback, so enemy minions
 * can attack the player with the same range + closest-target rule. [TEMP] minimal wiring; with no extras
 * passed, behavior is unchanged.
 *  - Gold, XP, last-hit rewards, sprites/animations (placeholder rectangles), networking.
 */

import type Phaser from 'phaser';
import type { Targetable } from './Towers';
import {
  LaneId, Team, MobType, MINION_BASE, WAVE_SIZE, SPAWN_STAGGER_S,
  waveSpawnTimeS, mobTypeForWave, scaledStats,
} from './MinionWaveData';

type Pt = { x: number; y: number };

export interface Minion {
  id: number;
  team: Team;
  lane: LaneId;
  type: MobType;
  waveIndex: number;
  x: number; // feet position (sprite anchor is at feet per Asset Contract)
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
  cooldownS: number;
  cooldownLeftS: number;
  moveSpeed: number;
  nodes: Pt[]; // this minion's walk order (reversed for the enemy team)
  nextNode: number;
  alive: boolean;
  body: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
}

interface PendingSpawn {
  atS: number;
  team: Team;
  lane: LaneId;
  type: MobType;
  waveIndex: number;
}

const LANES: LaneId[] = ['top', 'middle', 'bottom'];
const TEAMS: Team[] = ['allied', 'enemy'];
const TEAM_COLOR: Record<Team, number> = { allied: 0xff5555, enemy: 0x5588ff }; // red / blue per doc

export default class MinionWaves {
  private elapsedS = 0;
  private nextWaveIndex = 0;
  private nextId = 1;
  private pending: PendingSpawn[] = [];
  private minions: Minion[] = [];

  constructor(
    private scene: Phaser.Scene,
    private laneNodes: Record<LaneId, Pt[]>,
  ) {}

  /** Match clock starts at 0 (opening wait begins). */
  start(): void {
    this.elapsedS = 0;
    this.nextWaveIndex = 0;
    this.pending = [];
    this.minions.forEach((m) => this.destroyViews(m));
    this.minions = [];
  }

  getMinions(): readonly Minion[] {
    return this.minions;
  }

  /** Hook for the next pieces (player/tower damage). Returns true if this killed the minion. */
  damageMinion(m: Minion, amount: number): boolean {
    if (!m.alive) return false;
    m.hp -= amount;
    if (m.hp <= 0) {
      m.alive = false;
      this.destroyViews(m);
      return true;
    }
    return false;
  }

  /** Match clock in seconds (same clock the player uses for the opening wait). */
  getElapsedS(): number {
    return this.elapsedS;
  }

  update<T extends Targetable>(
    deltaMs: number,
    extraTargets: readonly T[] = [],
    hitExtra?: (target: T, amount: number) => void,
  ): void {
    const dt = Math.min(deltaMs, 100) / 1000; // [TEMP/debug] 100ms clamp: clamp so a tab stall doesn't teleport minions
    this.elapsedS += dt;

    // 1) Queue waves whose time has come (all lanes, both teams).
    // [TEMP] All three roadways spawn the SAME mob type at the same moment. The docs say "each roadway gets
    // each mob type" and "in series" but do not say whether lanes are in lockstep or offset.
    while (this.elapsedS >= waveSpawnTimeS(this.nextWaveIndex)) {
      const w = this.nextWaveIndex;
      const base = waveSpawnTimeS(w);
      const type = mobTypeForWave(w);
      for (const team of TEAMS) {
        for (const lane of LANES) {
          for (let i = 0; i < WAVE_SIZE; i++) {
            this.pending.push({ atS: base + i * SPAWN_STAGGER_S, team, lane, type, waveIndex: w });
          }
        }
      }
      this.nextWaveIndex++;
    }

    // 2) Spawn due minions.
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.atS <= this.elapsedS);
      this.pending = this.pending.filter((p) => p.atS > this.elapsedS);
      due.forEach((p) => this.spawn(p));
    }

    // 3) Act: basic attack on closest enemy minion in range, otherwise walk the path nodes.
    // [TEMP] Minions STOP walking to fight while an enemy is in range. The docs and tech design say only
    // "range + closest-target logic"; stopping vs attacking on the move is not specified.
    for (const m of this.minions) {
      if (!m.alive) continue;
      m.cooldownLeftS = Math.max(0, m.cooldownLeftS - dt);
      const target = this.closestEnemyInRange(m);
      const extra = this.closestExtraInRange(m, extraTargets, target);
      if (extra || target) {
        if (m.cooldownLeftS === 0) {
          if (extra) hitExtra?.(extra, m.damage);
          else this.damageMinion(target!, m.damage);
          m.cooldownLeftS = m.cooldownS;
        }
      } else {
        this.walk(m, dt);
      }
    }

    // 4) Drop dead, refresh views.
    this.minions = this.minions.filter((m) => m.alive);
    for (const m of this.minions) this.syncViews(m);
  }

  // ---- internals ----

  private spawn(p: PendingSpawn): void {
    const nodes = this.laneNodes[p.lane];
    const path = p.team === 'allied' ? nodes.slice() : nodes.slice().reverse();
    const s = scaledStats(p.type, p.waveIndex);
    const color = TEAM_COLOR[p.team];
    // [TEMP] placeholder rectangles (20x36 body, 24x4 hp bar) stand in for 64x64 sprites; no gameplay meaning.
    const body = this.scene.add.rectangle(path[0].x, path[0].y, 20, 36, color).setOrigin(0.5, 1);
    const hpBar = this.scene.add.rectangle(path[0].x - 12, path[0].y - 42, 24, 4, 0x33ff66).setOrigin(0, 0.5);
    this.minions.push({
      id: this.nextId++,
      team: p.team,
      lane: p.lane,
      type: p.type,
      waveIndex: p.waveIndex,
      x: path[0].x,
      y: path[0].y,
      hp: s.maxHp,
      maxHp: s.maxHp,
      damage: s.damage,
      range: MINION_BASE.range, // [TEMP]
      cooldownS: MINION_BASE.cooldownS, // [TEMP]
      cooldownLeftS: 0,
      moveSpeed: MINION_BASE.moveSpeed, // [TEMP]
      nodes: path,
      nextNode: 1,
      alive: true,
      body,
      hpBar,
    });
  }

  private closestEnemyInRange(m: Minion): Minion | null {
    let best: Minion | null = null;
    let bestD = Infinity;
    for (const o of this.minions) {
      if (!o.alive || o.team === m.team) continue; // no friendly fire
      const dist = Math.hypot(o.x - m.x, o.y - m.y);
      if (dist <= m.range && dist < bestD) {
        best = o;
        bestD = dist;
      }
    }
    return best;
  }

  /** Closest alive enemy extra target (the player) in range, if it is closer than `than`. */
  private closestExtraInRange<T extends Targetable>(m: Minion, extras: readonly T[], than: Minion | null): T | null {
    let best: T | null = null;
    let bestD = than ? Math.hypot(than.x - m.x, than.y - m.y) : Infinity;
    for (const o of extras) {
      if (!o.alive || o.team === m.team) continue; // no friendly fire
      const d = Math.hypot(o.x - m.x, o.y - m.y);
      if (d <= m.range && d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  private walk(m: Minion, dt: number): void {
    if (m.nextNode >= m.nodes.length) return; // at end of lane; later pieces take over
    const t = m.nodes[m.nextNode];
    const dx = t.x - m.x;
    const dy = t.y - m.y;
    const dist = Math.hypot(dx, dy);
    const step = m.moveSpeed * dt;
    if (step >= dist) {
      m.x = t.x;
      m.y = t.y;
      m.nextNode++;
    } else {
      m.x += (dx / dist) * step;
      m.y += (dy / dist) * step;
    }
  }

  private syncViews(m: Minion): void {
    m.body.setPosition(m.x, m.y);
    m.hpBar.setPosition(m.x - 12, m.y - 42);
    m.hpBar.setScale(Math.max(0, m.hp / m.maxHp), 1);
  }

  private destroyViews(m: Minion): void {
    m.body.destroy();
    m.hpBar.destroy();
  }
}
