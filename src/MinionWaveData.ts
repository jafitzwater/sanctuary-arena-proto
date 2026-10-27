/**
 * MinionWaveData.ts  - the ONE data file for minion waves. No Phaser import (pure, testable).
 *
 * Every value is tagged:
 *   [DOC]   taken directly from original-design-document.md ("Support waves") or the tech design.
 *   [TEMP]  TEMPORARY - not given by either document; placeholder to be replaced by an
 *           accepted Numbers Refiner / Kit Completer output.
 *
 * The docs give NO hp, damage, range, cooldown or speed. All four mob types therefore share ONE
 * set of placeholder constants (MINION_BASE below). No per-type variety (including rogues).
 */

export type LaneId = 'top' | 'middle' | 'bottom';
export type Team = 'allied' | 'enemy';
export type MobType = 'rogue' | 'valkyrie' | 'act2Mercenary' | 'act3Mercenary';

// ---- Schedule / composition ----
/** [DOC] "15 second wait to start". */
export const OPENING_WAIT_S = 15;
/** [DOC] "The first wave ... comes 15 seconds after that." */
export const FIRST_WAVE_AFTER_OPENING_S = 15;
/** [DOC] "After the first wave, a new wave spawns every 60 seconds." */
export const WAVE_INTERVAL_S = 60;
/** [DOC] "One wave on one roadway is 5 support mobs." */
export const WAVE_SIZE = 5;
/** [DOC] "Each wave gets 1/5th stronger." -- the 1/5 itself is [DOC]; HOW it is applied is [TEMP], below. */
export const STRENGTH_STEP = 1 / 5;
/**
 * [TEMP] How the 1/5 is applied. JOSEPH-CONFIRMED (relayed via Gamebot, Oct 26 2026): 'compounding',
 * each wave is 1.2x the previous wave. Change this one constant to switch.
 *   'additive'    : wave n = 1 + n/5          (1.0, 1.2, 1.4, 1.6 ...)
 *   'compounding' : wave n = (1 + 1/5) ^ n    (1.0, 1.2, 1.44, 1.728 ...)
 */
export const STRENGTH_MODE: 'additive' | 'compounding' = 'compounding';
/** [TEMP] Which stats the strength multiplier scales (docs only say "stronger"). */
export const STRENGTH_SCALES = { maxHp: true, damage: true } as const;
/**
 * [TEMP] Which wave count drives strength: the GLOBAL wave number (wave 0, 1, 2 ... of the match),
 * not a per-mob-type count. (Per-type would restart at 0 each time a type comes around again.)
 */
export const STRENGTH_WAVE_COUNT: 'global' = 'global';
/** [DOC] "They spawn in series, two waves each, then loop". */
export const WAVES_PER_TYPE = 2;
/** [DOC] "rogues, valkyries, Act 2 mercenaries, Act 3 mercenaries". */
export const TYPE_ORDER: MobType[] = ['rogue', 'valkyrie', 'act2Mercenary', 'act3Mercenary'];
/** [TEMP] gap between the 5 spawns inside a wave (docs give no spawn spacing). */
export const SPAWN_STAGGER_S = 0.6;

// ---- Stats ----
/**
 * [TEMP] ONE shared placeholder set used by ALL four mob types. The docs give no hp, damage, range,
 * cooldown or speed. Every literal below is [TEMP].
 */
export const MINION_BASE = {
  maxHp: 100, // [TEMP]
  damage: 10, // [TEMP]
  range: 60, // [TEMP] pixels, melee-style for every type (no ranged Act 3)
  cooldownS: 1.0, // [TEMP]
  moveSpeed: 90, // [TEMP] pixels per second
} as const;

/** Named skills from the doc, kept as data only. NOT wired: tech design says Minion = basic attack only. */
export interface SkillStub {
  name: string; // [DOC]
  wired: false;
}
export interface MobData {
  label: string; // [DOC] names
  skillStubs: SkillStub[]; // [DOC] names, unwired
}

const stub = (name: string): SkillStub => ({ name, wired: false });

export const MOB_DATA: Record<MobType, MobData> = {
  // [DOC] "rogues of different levels and armor styles"; no skills listed. No variety invented.
  rogue: { label: 'Rogue', skillStubs: [] },
  // [DOC] "Valkyries have jab and poison strike."
  valkyrie: { label: 'Valkyrie', skillStubs: [stub('jab'), stub('poison strike')] },
  // [DOC] "Act 2 mercenaries have jab and a defense aura."
  act2Mercenary: { label: 'Act 2 Mercenary', skillStubs: [stub('jab'), stub('defense aura')] },
  // [DOC] "Act 3 mercenaries have fireball and sword strike." (unwired; not treated as ranged)
  act3Mercenary: { label: 'Act 3 Mercenary', skillStubs: [stub('fireball'), stub('sword strike')] },
};

// ---- Pure schedule functions (waveIndex is 0-based; 0 = first wave) ----

/** Seconds since match start at which wave `waveIndex` spawns: 15 + 15 + 60n. */
export function waveSpawnTimeS(waveIndex: number): number {
  return OPENING_WAIT_S + FIRST_WAVE_AFTER_OPENING_S + waveIndex * WAVE_INTERVAL_S;
}

/** Two waves of each type in series, then loop. */
export function mobTypeForWave(waveIndex: number): MobType {
  return TYPE_ORDER[Math.floor(waveIndex / WAVES_PER_TYPE) % TYPE_ORDER.length];
}

/**
 * Strength multiplier for wave `waveIndex` (global, 0-based). The 1/5 is [DOC]; the application is [TEMP]:
 * see STRENGTH_MODE, STRENGTH_SCALES and STRENGTH_WAVE_COUNT above.
 */
export function strengthMultiplier(waveIndex: number): number {
  return STRENGTH_MODE === 'additive'
    ? 1 + waveIndex * STRENGTH_STEP
    : Math.pow(1 + STRENGTH_STEP, waveIndex);
}

/** [TEMP] base stats (shared by all types) scaled per the [TEMP] strength rules. `type` is kept for the API. */
export function scaledStats(_type: MobType, waveIndex: number) {
  const m = strengthMultiplier(waveIndex);
  return {
    maxHp: STRENGTH_SCALES.maxHp ? Math.round(MINION_BASE.maxHp * m) : MINION_BASE.maxHp,
    damage: STRENGTH_SCALES.damage ? Math.round(MINION_BASE.damage * m * 100) / 100 : MINION_BASE.damage,
  };
}
