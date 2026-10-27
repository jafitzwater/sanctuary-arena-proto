/**
 * Towers.ts
 *
 * IMPLEMENTS
 *  - [DOC] "Each roadway has 2 support towers, spread apart"; [TECH DESIGN] read as 2 per side per
 *    roadway, with a neutral gap between the sides where no towers exist. [DOC] "A support tower attacks
 *    whatever is closest to it."
 *  - Tech design "Entity Model": "Tower: Immobile. Attacks closest target." and "Towers attack the closest
 *    valid target in range." Also "No friendly fire."
 *  - Towers are built from LaneMapScene TOWER_SLOTS: 2 allied + 2 enemy per roadway = 12 towers.
 *  - towersRemaining(team): a plain count of standing towers. NO Worldstone gating exists (Joseph-confirmed,
 *    Oct 26 2026): the Worldstone can be attacked at any time, even while towers still stand.
 *
 * DATA: TowerData.ts. All hp/damage/range/cooldown are ONE shared [TEMP] block.
 *
 * [TEMP] CHOICES (not specified by the docs)
 *  - "Valid target" = any alive enemy-team unit passed in by the caller (enemy minions now, player later).
 *  - "Closest" = smallest straight-line distance from the tower's feet position.
 *  - Placeholder rectangles (28x56 body, 32x4 hp bar) stand in for 64x64 sprites.
 *
 * DELIBERATELY NOT INCLUDED
 *  - Worldstone (separate piece), minions or the player attacking towers (damageTower is the hook for them),
 *    gold/XP for tower kills, animations, projectiles, sprites, networking.
 */

import type Phaser from 'phaser';
import { LaneId, Team } from './MinionWaveData';
import { TOWER_BASE } from './TowerData';

type Pt = { x: number; y: number };

/** Anything a tower may shoot. Minion satisfies this; the Barbarian will later. */
export interface Targetable {
  team: Team;
  x: number;
  y: number;
  alive: boolean;
}

export interface Tower {
  id: number;
  team: Team;
  lane: LaneId;
  x: number; // feet position
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  range: number;
  cooldownS: number;
  cooldownLeftS: number;
  alive: boolean;
  body: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
}

const TEAM_COLOR: Record<Team, number> = { allied: 0xff5555, enemy: 0x5588ff }; // red / blue per doc

export default class Towers {
  private towers: Tower[] = [];
  private nextId = 1;

  constructor(
    private scene: Phaser.Scene,
    slots: Record<LaneId, { allied: Pt[]; enemy: Pt[] }>,
  ) {
    (Object.keys(slots) as LaneId[]).forEach((lane) => {
      slots[lane].allied.forEach((p) => this.build('allied', lane, p));
      slots[lane].enemy.forEach((p) => this.build('enemy', lane, p));
    });
  }

  getTowers(): readonly Tower[] {
    return this.towers;
  }

  /** Plain count of support towers of `team` still standing. Not used for gating (none exists; Joseph-confirmed Oct 26 2026). */
  towersRemaining(team: Team): number {
    return this.towers.filter((t) => t.team === team && t.alive).length;
  }

  /** Hook for later pieces (minions/player attacking towers). Returns true if this destroyed the tower. */
  damageTower(t: Tower, amount: number): boolean {
    if (!t.alive) return false;
    t.hp -= amount;
    if (t.hp > 0) t.hpBar.setScale(t.hp / t.maxHp, 1);
    if (t.hp <= 0) {
      t.hp = 0;
      t.alive = false;
      t.body.destroy();
      t.hpBar.destroy();
      return true;
    }
    return false;
  }

  /**
   * Each standing tower attacks the closest alive enemy-team target in range when its cooldown is ready.
   * `applyDamage` lets the caller route damage to whatever the target is (e.g. MinionWaves.damageMinion).
   */
  update<T extends Targetable>(
    deltaMs: number,
    targets: readonly T[],
    applyDamage: (target: T, amount: number) => void,
  ): void {
    const dt = Math.min(deltaMs, 100) / 1000;
    for (const t of this.towers) {
      if (!t.alive) continue;
      t.cooldownLeftS = Math.max(0, t.cooldownLeftS - dt);
      t.hpBar.setScale(t.hp / t.maxHp, 1);
      if (t.cooldownLeftS > 0) continue;

      let best: T | null = null;
      let bestD = Infinity;
      for (const o of targets) {
        if (!o.alive || o.team === t.team) continue; // no friendly fire
        const d = Math.hypot(o.x - t.x, o.y - t.y);
        if (d <= t.range && d < bestD) {
          best = o;
          bestD = d;
        }
      }
      if (best) {
        applyDamage(best, t.damage);
        t.cooldownLeftS = t.cooldownS;
      }
    }
  }

  private build(team: Team, lane: LaneId, p: Pt): void {
    const body = this.scene.add.rectangle(p.x, p.y, 28, 56, TEAM_COLOR[team]).setOrigin(0.5, 1);
    const hpBar = this.scene.add.rectangle(p.x - 16, p.y - 62, 32, 4, 0x33ff66).setOrigin(0, 0.5);
    this.towers.push({
      id: this.nextId++,
      team,
      lane,
      x: p.x,
      y: p.y,
      hp: TOWER_BASE.maxHp,
      maxHp: TOWER_BASE.maxHp,
      damage: TOWER_BASE.damage,
      range: TOWER_BASE.range,
      cooldownS: TOWER_BASE.cooldownS,
      cooldownLeftS: 0,
      alive: true,
      body,
      hpBar,
    });
  }
}
