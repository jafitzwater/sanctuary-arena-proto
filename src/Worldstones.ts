/**
 * Worldstones.ts
 *
 * IMPLEMENTS
 *  - [DOC] "The base's main 'heart' is a 'worldstone' style design: a large ruby style gem on a pedestal."
 *    One Worldstone per base, placed at WORLDSTONE_SLOTS (allied = left/red, enemy = right/blue).
 *  - [TECH DESIGN] "Worldstone: Immobile. ... Match ends at 0 HP." Entity Model shared components:
 *    Position, Health, Team, Sprite.
 *  - [DOC] "No friendly fire ever." A Worldstone ignores damage from its own team.
 *  - [DOC] "destroy their world stone" is the object of the match: when a Worldstone reaches 0 HP the match
 *    ends and the OTHER team is the winner (onMatchEnd hook).
 *
 * NO ATTACK GATING (Joseph-confirmed, Oct 26 2026): the Worldstone can be attacked at ANY time, even while
 * that side's towers still stand. Enemy players can run past the guard towers (at higher risk of dying)
 * and still attack it. Towers.towersRemaining(team) is a plain count only; nothing here reads it.
 * (This supersedes the earlier reading of the doc/tech-design line about attacking "while towers remain".)
 *
 * DATA: WorldstoneData.ts. Worldstone hp is a shared [TEMP] constant (docs give no number).
 *
 * [TEMP] Placeholder rectangle (40x40 body, 56x6 hp bar) stands in for the ruby-gem sprite.
 *
 * DELIBERATELY NOT INCLUDED
 *  - Anything attacking the Worldstone yet (minions/player/towers): damageWorldstone is the hook.
 *  - Win/lose screen, restart, gold/XP, sprites/animations, networking. The scene only shows a [TEMP/debug]
 *    text line from onMatchEnd.
 */

import type Phaser from 'phaser';
import { Team } from './MinionWaveData';
import { WORLDSTONE_BASE } from './WorldstoneData';

type Pt = { x: number; y: number };

export interface Worldstone {
  team: Team;
  x: number; // feet position
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  body: Phaser.GameObjects.Rectangle;
  hpBar: Phaser.GameObjects.Rectangle;
}

const COLOR: Record<Team, number> = { allied: 0xff0044, enemy: 0x0066ff }; // red / blue per doc

export default class Worldstones {
  /** Called once, when a Worldstone hits 0 HP. `winner` is the team that did NOT lose its Worldstone. */
  onMatchEnd?: (winner: Team, destroyed: Worldstone) => void;

  private stones: Record<Team, Worldstone>;
  private matchOver = false;

  constructor(
    scene: Phaser.Scene,
    slots: { allied: Pt; enemy: Pt },
  ) {
    const build = (team: Team): Worldstone => {
      const p = slots[team];
      const body = scene.add.rectangle(p.x, p.y, 40, 40, COLOR[team]).setOrigin(0.5, 1);
      const hpBar = scene.add.rectangle(p.x - 28, p.y - 48, 56, 6, 0x33ff66).setOrigin(0, 0.5);
      return { team, x: p.x, y: p.y, hp: WORLDSTONE_BASE.maxHp, maxHp: WORLDSTONE_BASE.maxHp, alive: true, body, hpBar };
    };
    this.stones = { allied: build('allied'), enemy: build('enemy') };
  }

  get(team: Team): Worldstone {
    return this.stones[team];
  }

  isMatchOver(): boolean {
    return this.matchOver;
  }

  /**
   * Hook for later pieces (minions/player). `attackerTeam` is required so friendly fire can be refused.
   * Returns true if this hit destroyed the Worldstone (and ended the match).
   */
  damageWorldstone(ws: Worldstone, amount: number, attackerTeam: Team): boolean {
    if (this.matchOver || !ws.alive) return false;
    if (attackerTeam === ws.team) return false; // no friendly fire
    ws.hp -= amount;
    if (ws.hp > 0) {
      ws.hpBar.setScale(ws.hp / ws.maxHp, 1);
      return false;
    }
    ws.hp = 0;
    ws.alive = false;
    ws.hpBar.setScale(0, 1);
    this.matchOver = true;
    this.onMatchEnd?.(ws.team === 'allied' ? 'enemy' : 'allied', ws);
    return true;
  }
}
