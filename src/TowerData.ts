/**
 * TowerData.ts - the data for Towers. No Phaser import (pure, testable).
 *
 * [DOC]  from original-design-document.md or the tech design.
 * [TEMP] TEMPORARY - the docs give no tower hp, damage, range or cooldown. ONE shared block below
 *        is used by every tower; to be replaced by an accepted Numbers Refiner output.
 */

/**
 * [DOC] "Each roadway has 2 support towers, spread apart"; [TECH DESIGN] read as 2 per side per roadway.
 * (Positions come from LaneMapScene TOWER_SLOTS.)
 */
export const TOWERS_PER_SIDE_PER_LANE = 2;

/** [TEMP] One shared placeholder block for ALL towers. Every literal is [TEMP]. */
export const TOWER_BASE = {
  maxHp: 500, // [TEMP]
  damage: 15, // [TEMP]
  range: 200, // [TEMP] pixels
  cooldownS: 1.0, // [TEMP]
} as const;
