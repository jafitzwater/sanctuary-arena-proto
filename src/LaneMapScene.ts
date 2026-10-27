/**
 * LaneMapScene.ts
 *
 * IMPLEMENTS
 *  - The "Map" section of the Sanctuary Arena one-page technical design (prototype slice):
 *    three parallel roadways (top, middle, bottom), straight through, on a 64x64 tilemap.
 *  - Per roadway (allied -> enemy): allied base approach, two allied tower slots (spread apart),
 *    neutral gap (no towers), two enemy tower slots (spread apart), enemy base approach.
 *  - Explicit path nodes per roadway for minion movement (exported as LANE_NODES).
 *  - Base zones at each end, with all three roadways connecting into them.
 *  - Worldstone slot position in each base (WORLDSTONE_SLOTS; the Worldstones piece draws them).
 *  - Hosts the MinionWaves and Towers systems (small hookups in create/update), plus the Worldstones.
 *    Towers and Worldstones now draw themselves, so the old tower/Worldstone debug markers were removed.
 *  - Hosts the Player (Barbarian): camera follows the player, pointer tap-to-move + on-screen buttons
 *    (Player.bindInput), damage routing between player, minions, towers and Worldstones, and minion-death XP.
 *    The old [TEMP/debug] arrow-key camera scroll was removed now that the player piece has landed.
 *  - [TEMP] Simulation stops once the match is over (onMatchEnd fired).
 *
 * TEMPORARY VALUES (temporary - from original document structure; exact sizes not specified)
 *  - Map size 40 x 11 tiles, lanes on rows 1 / 5 / 9, base zones 4 tiles wide,
 *    tower columns 8, 14 (allied) and 25, 31 (enemy). Allied side = left/red (placeholder choice).
 *
 * DELIBERATELY NOT INCLUDED
 *  - Worldstone behavior (Worldstones.ts), player logic (Player.ts), minions attacking towers/Worldstone,
 *    networking, jungle, grass, orbs, shop.
 */

import Phaser from 'phaser';
import MinionWaves from './MinionWaves';
import Towers from './Towers';
import Worldstones from './Worldstones';
import Player, { AttackTarget } from './Player';
import type { Minion } from './MinionWaves';
import type { MapLayout } from './PlayerData';

const TILE = 64;
const COLS = 40;
const ROWS = 11;
const BASE_COLS = 4;

const LANE_ROWS = { top: 1, middle: 5, bottom: 9 } as const;
const ALLIED_TOWER_COLS = [8, 14];
const ENEMY_TOWER_COLS = [25, 31]; // cols 15-24 are the neutral gap

type LaneId = keyof typeof LANE_ROWS;
type Pt = { x: number; y: number };

const T_GROUND = 0;
const T_ROAD = 1;
const T_ALLIED_BASE = 2; // red
const T_ENEMY_BASE = 3; // blue

const cx = (col: number) => col * TILE + TILE / 2;
const cy = (row: number) => row * TILE + TILE / 2;

/** Path nodes per lane, ordered allied base -> enemy base. Enemy minions walk the reverse. */
export const LANE_NODES: Record<LaneId, Pt[]> = (() => {
  const out = {} as Record<LaneId, Pt[]>;
  (Object.keys(LANE_ROWS) as LaneId[]).forEach((id) => {
    const y = cy(LANE_ROWS[id]);
    const cols = [
      BASE_COLS - 1,
      ...ALLIED_TOWER_COLS,
      19,
      ...ENEMY_TOWER_COLS,
      COLS - BASE_COLS,
    ];
    out[id] = cols.map((c) => ({ x: cx(c), y }));
  });
  return out;
})();

/** Tower slot positions (no tower logic here). */
export const TOWER_SLOTS: Record<LaneId, { allied: Pt[]; enemy: Pt[] }> = {
  top: slots('top'),
  middle: slots('middle'),
  bottom: slots('bottom'),
};
function slots(id: LaneId) {
  const y = cy(LANE_ROWS[id]);
  return {
    allied: ALLIED_TOWER_COLS.map((c) => ({ x: cx(c), y })),
    enemy: ENEMY_TOWER_COLS.map((c) => ({ x: cx(c), y })),
  };
}

/** One Worldstone slot per base, on the middle roadway axis. */
export const WORLDSTONE_SLOTS = {
  allied: { x: cx(1), y: cy(LANE_ROWS.middle) },
  enemy: { x: cx(COLS - 2), y: cy(LANE_ROWS.middle) },
};

export default class LaneMapScene extends Phaser.Scene {
  private waves!: MinionWaves;
  private towers!: Towers;
  private worldstones!: Worldstones;
  private player!: Player;

  constructor() {
    super('LaneMapScene');
  }

  create(): void {
    this.makePlaceholderTileset();

    const laneRowSet = new Set<number>(Object.values(LANE_ROWS));
    const data: number[][] = [];
    for (let r = 0; r < ROWS; r++) {
      const row: number[] = [];
      for (let c = 0; c < COLS; c++) {
        if (c < BASE_COLS) row.push(T_ALLIED_BASE);
        else if (c >= COLS - BASE_COLS) row.push(T_ENEMY_BASE);
        else if (laneRowSet.has(r)) row.push(T_ROAD);
        else row.push(T_GROUND);
      }
      data.push(row);
    }

    const map = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    const tiles = map.addTilesetImage('lane-tiles', 'lane-tiles', TILE, TILE, 0, 0)!;
    const layer = map.createLayer(0, tiles, 0, 0)!;
    layer.setCollision([T_GROUND]);

    this.cameras.main.setBounds(0, 0, COLS * TILE, ROWS * TILE);

    // Minion waves hookup.
    this.waves = new MinionWaves(this, LANE_NODES);
    this.waves.start();

    // Towers hookup (built from TOWER_SLOTS).
    this.towers = new Towers(this, TOWER_SLOTS);

    // Worldstones hookup (built from WORLDSTONE_SLOTS). Nothing attacks them yet.
    this.worldstones = new Worldstones(this, WORLDSTONE_SLOTS);
    this.worldstones.onMatchEnd = (winner) => {
      // [TEMP/debug] placeholder match-end notice; a real end screen is a later piece.
      this.add
        .text(640, 360, `Match over: ${winner === 'allied' ? 'Red' : 'Blue'} wins`, { fontSize: '48px', color: '#ffffff' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(1000);
    };

    // Player hookup (Barbarian). Layout values are this file's own constants.
    const layout: MapLayout = { tile: TILE, cols: COLS, rows: ROWS, baseCols: BASE_COLS, laneRows: Object.values(LANE_ROWS) };
    this.player = new Player(this, layout);
    this.player.bindInput();
    this.cameras.main.startFollow(this.player.getBody(), true, 0.15, 0.15);
  }

  update(_time: number, delta: number): void {
    if (this.worldstones.isMatchOver()) return; // [TEMP] freeze after match end
    const p = this.player;
    // Snapshot alive enemy minions so every enemy minion death this frame (any killer) can grant shared XP.
    const enemyAlive = this.waves.getMinions().filter((m) => m.team === 'enemy' && m.alive);

    // Enemy minions may also attack the player.
    this.waves.update(delta, [p], (_t, dmg) => p.takeDamage(dmg));
    // Towers shoot minions and the player (enemy towers only hit the player: no friendly fire).
    const towerTargets: (Minion | Player)[] = [...this.waves.getMinions(), p];
    this.towers.update(delta, towerTargets, (t, dmg) => (t === p ? p.takeDamage(dmg) : this.waves.damageMinion(t as Minion, dmg)));
    // Player attacks enemy minions, towers and the Worldstone through the existing hooks.
    p.update(delta, this.waves.getElapsedS(), this.playerTargets());

    for (const m of enemyAlive) if (!m.alive) p.onEnemyMinionDied(m.x, m.y);
  }

  private playerTargets(): AttackTarget[] {
    const out: AttackTarget[] = [];
    for (const m of this.waves.getMinions()) {
      if (m.team === 'enemy' && m.alive) out.push({ kind: 'minion', team: m.team, x: m.x, y: m.y, alive: true, hit: (a) => this.waves.damageMinion(m, a) });
    }
    for (const t of this.towers.getTowers()) {
      if (t.team === 'enemy' && t.alive) out.push({ kind: 'tower', team: t.team, x: t.x, y: t.y, alive: true, hit: (a) => this.towers.damageTower(t, a) });
    }
    const ws = this.worldstones.get('enemy');
    if (ws.alive) out.push({ kind: 'worldstone', team: ws.team, x: ws.x, y: ws.y, alive: true, hit: (a) => this.worldstones.damageWorldstone(ws, a, 'allied') });
    return out;
  }

  private makePlaceholderTileset(): void {
    if (this.textures.exists('lane-tiles')) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const colors = [0x1d2a1d, 0x8a7a5a, 0x7a2222, 0x22337a];
    colors.forEach((col, i) => {
      g.fillStyle(col, 1).fillRect(i * TILE, 0, TILE, TILE);
      g.lineStyle(1, 0x000000, 0.25).strokeRect(i * TILE, 0, TILE, TILE);
    });
    g.generateTexture('lane-tiles', TILE * colors.length, TILE);
    g.destroy();
  }
}
