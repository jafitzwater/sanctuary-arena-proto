/**
 * WorldstoneData.ts - data for the Worldstone. No Phaser import (pure, testable).
 *
 * [DOC]  from original-design-document.md or the tech design.
 * [TEMP] TEMPORARY - the docs give no Worldstone hp. One shared block, used by both Worldstones.
 */

/** [TEMP] One shared placeholder block for BOTH Worldstones. */
export const WORLDSTONE_BASE = {
  maxHp: 2000, // [TEMP]
} as const;
