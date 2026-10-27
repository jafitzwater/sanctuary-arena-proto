/**
 * PlayerData.ts - data + pure functions for the PlayerCharacter (Barbarian). No Phaser import (pure, testable).
 *
 * Tags:
 *   [DOC]         original-design-document.md (or the class-kits.md quote of it)
 *   [TECH DESIGN] technical-design-prototype-slice.md
 *   [TEMP]        TEMPORARY - not given by either document; placeholder for an accepted Numbers Refiner /
 *                 Kit Completer output. "[TEMP] Joseph-set" = placeholder rule Joseph approved via Gamebot.
 */

import type { Team } from './MinionWaveData';

// ---------------- Map layout (values come from LaneMapScene; passed in, not duplicated) ----------------

/** Shape of the LaneMapScene layout the player needs. LaneMapScene builds this from its own constants. */
export interface MapLayout {
  tile: number;
  cols: number;
  rows: number;
  baseCols: number; // allied base = cols [0, baseCols), enemy base = cols [cols - baseCols, cols)
  laneRows: readonly number[];
}

type Pt = { x: number; y: number };

/** Same rule as the LaneMapScene tiles: base columns and roadway rows are walkable, ground is not. */
export function isWalkable(L: MapLayout, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= L.cols * L.tile || y >= L.rows * L.tile) return false;
  const c = Math.floor(x / L.tile);
  const r = Math.floor(y / L.tile);
  if (c < L.baseCols || c >= L.cols - L.baseCols) return true;
  return L.laneRows.includes(r);
}

/** True if (x,y) is inside `team`'s own base zone. */
export function inOwnBase(L: MapLayout, team: Team, x: number): boolean {
  return team === 'allied' ? x < L.baseCols * L.tile : x >= (L.cols - L.baseCols) * L.tile;
}

/** [TEMP] Spawn / respawn / teleport-arrival point: allied base, column 2, middle roadway row. */
export function spawnPoint(L: MapLayout): Pt {
  const midRow = L.laneRows[Math.floor(L.laneRows.length / 2)];
  return { x: 2 * L.tile + L.tile / 2, y: midRow * L.tile + L.tile / 2 };
}

/**
 * [TEMP] Tap target -> route. No pathfinding exists in the tech design, so:
 *  - tap clamped to the map; a tap on non-walkable ground snaps to the nearest roadway row (same x);
 *  - if start and end are on different roadways outside the bases, route through the nearer base
 *    (roadways only connect through bases).
 */
export function planRoute(L: MapLayout, from: Pt, to: Pt): Pt[] {
  const half = L.tile / 2;
  let tx = Math.min(Math.max(to.x, half), L.cols * L.tile - half);
  let ty = Math.min(Math.max(to.y, half), L.rows * L.tile - half);
  if (!isWalkable(L, tx, ty)) {
    const r = L.laneRows.reduce((b, row) => (Math.abs(row * L.tile + half - ty) < Math.abs(b * L.tile + half - ty) ? row : b));
    ty = r * L.tile + half;
  }
  const end = { x: tx, y: ty };
  const rowOf = (y: number) => Math.floor(y / L.tile);
  const inBase = (x: number) => x < L.baseCols * L.tile || x >= (L.cols - L.baseCols) * L.tile;
  if (inBase(from.x) || inBase(end.x) || rowOf(from.y) === rowOf(end.y)) return [end];
  const alliedX = (L.baseCols - 1) * L.tile + half;
  const enemyX = (L.cols - L.baseCols) * L.tile + half;
  const viaX = Math.abs(from.x - alliedX) + Math.abs(end.x - alliedX) <= Math.abs(from.x - enemyX) + Math.abs(end.x - enemyX)
    ? alliedX : enemyX;
  return [{ x: viaX, y: from.y }, { x: viaX, y: end.y }, end];
}

// ---------------- Base stats ----------------

/** [TEMP] Level-1 base values before stat-point bonuses. The docs give none of these numbers. */
export const PLAYER_BASE = {
  maxHp: 300, // [TEMP]
  maxMana: 100, // [TEMP]
  attackDamage: 20, // [TEMP] melee attack power
  defense: 10, // [TEMP] defense rating
  attackRange: 80, // [TEMP] pixels (melee)
  attackCooldownS: 0.8, // [TEMP]
  moveSpeed: 200, // [TEMP] pixels per second
} as const;

/** [TEMP] Damage taken = raw * 100 / (100 + defense). Docs say only "2% defense" per dex (League-style armor formula). */
export function damageAfterDefense(raw: number, defense: number): number {
  return (raw * 100) / (100 + defense);
}

// ---------------- Level / stats ----------------

/** [DOC] "The level cap is 15." */
export const LEVEL_CAP = 15;
/** [DOC] "Each level gives 5 points." Barbarian: "2 strength, 2 vitality, 1 dexterity, 0 energy". */
export const STAT_POINTS_PER_LEVEL = { strength: 2, vitality: 2, dexterity: 1, energy: 0 } as const;
/** [DOC] "1 strength adds 5% melee attack power. 1 dexterity adds 5% ranged attack power ... and 2% defense.
 *  1 vitality adds 3% health. 1 energy adds 5% mana." */
export const STAT_EFFECT = {
  strengthMeleePct: 5,
  dexterityRangedPct: 5,
  dexterityDefensePct: 2,
  vitalityHealthPct: 3,
  energyManaPct: 5,
} as const;

export interface Stats { strength: number; vitality: number; dexterity: number; energy: number }

/**
 * [DOC] auto-allocated 2/2/1/0 per level. [TEMP] reading: points are granted for every level reached,
 * including level 1, and stats start at 0 (docs give no starting stats).
 */
export function statsForLevel(level: number): Stats {
  const L = Math.min(Math.max(1, level), LEVEL_CAP);
  return {
    strength: STAT_POINTS_PER_LEVEL.strength * L,
    vitality: STAT_POINTS_PER_LEVEL.vitality * L,
    dexterity: STAT_POINTS_PER_LEVEL.dexterity * L,
    energy: STAT_POINTS_PER_LEVEL.energy * L,
  };
}

/** [DOC] stat effects applied as percent of the [TEMP] base values. Barbarian is melee: ranged bonus unused. */
export function derivedForLevel(level: number) {
  const s = statsForLevel(level);
  return {
    stats: s,
    maxHp: PLAYER_BASE.maxHp * (1 + (STAT_EFFECT.vitalityHealthPct * s.vitality) / 100),
    maxMana: PLAYER_BASE.maxMana * (1 + (STAT_EFFECT.energyManaPct * s.energy) / 100),
    attackDamage: PLAYER_BASE.attackDamage * (1 + (STAT_EFFECT.strengthMeleePct * s.strength) / 100),
    defense: PLAYER_BASE.defense * (1 + (STAT_EFFECT.dexterityDefensePct * s.dexterity) / 100),
  };
}

/** [TEMP] Total XP needed to REACH `level` (level 1 = 0). Docs say only "follow League of Legends". */
export function xpToReach(level: number): number {
  let total = 0;
  for (let l = 2; l <= level; l++) total += 100 + 50 * (l - 2); // [TEMP] 100, 150, 200 ...
  return total;
}

export function levelForXp(xp: number): number {
  let l = 1;
  while (l < LEVEL_CAP && xp >= xpToReach(l + 1)) l++;
  return l;
}

// ---------------- Gold / XP rewards ----------------

/** [TEMP] Gold to the last hit on an enemy minion. [DOC] "Mob gold goes to the last hit." */
export const MINION_GOLD = 20;
/** [TEMP] XP per enemy minion death. [DOC] "Exp is shared by nearby allies." */
export const MINION_XP = 30;
/** [TEMP] "Nearby" radius for XP sharing, pixels. */
export const XP_SHARE_RADIUS = 450;
/** [TEMP] Even split among nearby allied players (only one player exists in the slice). */
export function xpShare(totalXp: number, nearbyAllies: number): number {
  return nearbyAllies > 0 ? totalXp / nearbyAllies : 0;
}

// ---------------- Death / base / teleport / opening ----------------

/** [DOC] "The first death takes 5 seconds. Each death after that adds 5 seconds." deathCount is 1-based. */
export function respawnTimeS(deathCount: number): number {
  return 5 * Math.max(1, deathCount);
}
/** [DOC] "They lose 25% of the gold they have." [TEMP] rounding: floor the remaining gold. */
export function goldAfterDeath(gold: number): number {
  return Math.floor(gold * 0.75);
}
/** [TECH DESIGN] "Standing in own base zone restores health quickly (target ~8 seconds to full)." */
export const BASE_HEAL_FULL_S = 8;
/** [DOC] "The teleport takes 3 seconds." */
export const TELEPORT_CHANNEL_S = 3;
/** [DOC] "There is a 15 second wait to start. Players are blocked in base until those 15 seconds pass." */
export { OPENING_WAIT_S } from './MinionWaveData';

// ---------------- Skills ----------------

/** [DOC] Barbarian: "In order: bash, shout, leap attack, battle orders, whirlwind." */
export const SKILL_ORDER = ['bash', 'shout', 'leap attack', 'battle orders', 'whirlwind'] as const;
export type SkillName = (typeof SKILL_ORDER)[number];
/**
 * [DOC] "Skills unlock at level 1, level 3, level 5, and level 7. More than 4 skills use the remaining points
 * after level 7." [TEMP] reading (class-kits.md "Reading used"): listed order maps to the unlock levels, and
 * whirlwind becomes learnable at level 8 (the first point after level 7).
 */
export const SKILL_UNLOCK_LEVEL: Record<SkillName, number> = {
  bash: 1, shout: 3, 'leap attack': 5, 'battle orders': 7, whirlwind: 8,
};
/** [DOC] "A character gains 1 skill point each level. Skills max at level 5." */
export const SKILL_POINTS_PER_LEVEL = 1;
export const SKILL_MAX_LEVEL = 5;

/**
 * [TEMP] Joseph-set: skill points are auto-spent in listed order. Exact rule used: each new point first learns
 * any unlocked skill still at 0 (listed order), otherwise raises the first skill in listed order below max.
 */
export function skillLevelsForLevel(level: number): Record<SkillName, number> {
  const out = Object.fromEntries(SKILL_ORDER.map((s) => [s, 0])) as Record<SkillName, number>;
  const L = Math.min(Math.max(1, level), LEVEL_CAP);
  for (let l = 1; l <= L; l++) {
    for (let p = 0; p < SKILL_POINTS_PER_LEVEL; p++) {
      const unlocked = SKILL_ORDER.filter((s) => SKILL_UNLOCK_LEVEL[s] <= l);
      const pick = unlocked.find((s) => out[s] === 0) ?? unlocked.find((s) => out[s] < SKILL_MAX_LEVEL);
      if (pick) out[pick]++;
    }
  }
  return out;
}

/** [DOC] mana cost % by skill level: "level 1 is 10%, level 2 is 15%, level 3 is 20%, and so on" (to 30% at 5). */
export function manaCostPct(skillLevel: number): number {
  return 10 + 5 * (Math.min(Math.max(1, skillLevel), SKILL_MAX_LEVEL) - 1);
}
/** [TEMP] Joseph-set: mana cost is a percent of MAXIMUM mana. */
export function manaCost(skillLevel: number, maxMana: number): number {
  return (maxMana * manaCostPct(skillLevel)) / 100;
}
/** [TEMP] Joseph-set: ONE shared cooldown value for all skills (each skill runs its own timer of this length). */
export const SKILL_COOLDOWN_S = 4;
/** [TEMP] Skill reach, pixels: hits the single closest valid target in range. */
export const SKILL_RANGE = 120;
/** [TEMP] Joseph-set: skill effects are basic damage only. One formula for all skills:
 *  attackDamage * (1.5 + 0.25 * (skillLevel - 1)). No buffs, leaps, knockback or AoE. */
export function skillDamage(attackDamage: number, skillLevel: number): number {
  return attackDamage * (1.5 + 0.25 * (Math.max(1, skillLevel) - 1));
}
