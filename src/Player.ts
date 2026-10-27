/**
 * Player.ts
 *
 * IMPLEMENTS
 *  - [TECH DESIGN] "PlayerCharacter (Barbarian only in this slice): Mana, Level, Gold, Stats (auto-allocated),
 *    Skill slots." Shared components: Position, Health, Team ('allied'), Sprite (placeholder rectangle).
 *  - [TECH DESIGN] Tap-to-move (pointer input = touch + mouse; pointer -> world via the camera). No collision
 *    with anyone ("Characters and support mobs do not block each other's movement"). Stays on walkable tiles.
 *  - [TECH DESIGN] Basic attack with range + closest-target logic on enemy minions, enemy towers and the enemy
 *    Worldstone (through the existing damage hooks, routed by the caller). No friendly fire.
 *  - Targetable (team, x, y, alive): enemy towers and enemy minions can attack the player (takeDamage).
 *  - [DOC] Last-hit minion gold; XP from enemy minion deaths shared by nearby allies; level cap 15;
 *    stats auto-allocated 2 str / 2 vit / 1 dex / 0 energy per level; health and mana come back after a level.
 *  - [DOC] Death: respawn at own base after 5s, +5s each later death, lose 25% of current gold.
 *  - [TECH DESIGN] Own-base healing (~8s to full). [DOC] Teleport-to-base, 3-second channel.
 *  - [DOC] 15s opening wait: player blocked in own base until 15s of match time (same clock as MinionWaves).
 *  - [DOC] Skills bash, shout, leap attack, battle orders, whirlwind; unlocks 1/3/5/7 then remaining points;
 *    1 point per level, max 5; mana cost 10/15/20/25/30% by skill level.
 *
 * DATA: PlayerData.ts ([DOC]/[TECH DESIGN]/[TEMP] tagged). Map layout is passed in from LaneMapScene.
 *
 * [TEMP] CHOICES (not specified by the docs)
 *  - Player auto-attacks only while standing still (no move order), like minions stopping to fight.
 *  - "Closest valid target" = nearest alive enemy of any kind (minion, tower or Worldstone).
 *  - Teleport channel is cancelled by a move order, a skill cast, or taking damage. Arrival = spawn point.
 *  - Mana refills in own base at the same ~8s rate as health (reading of "a town visit" restoring mana).
 *  - Respawn restores full health and mana (respawn is in town).
 *  - A skill with no valid target in range is not cast (no mana or cooldown spent).
 *  - XP is granted only while alive and within XP_SHARE_RADIUS of the dying enemy minion.
 *  - On-screen buttons (bottom right, fixed to camera) for the 5 skills + Base; keys 1-5 and B on desktop.
 *  - Placeholder rectangles (28x48 body, 32x5 hp bar); HUD text is [TEMP/debug].
 *
 * DELIBERATELY NOT INCLUDED
 *  - Real skill effects (buffs, leap movement, knockback, AoE), potions/shop/gear, character kills/streaks
 *    (no enemy player in the slice), gold/XP for towers, pathfinding, sprites/animations, networking,
 *    other classes.
 */

import type Phaser from 'phaser';
import type { Team } from './MinionWaveData';
import type { Targetable } from './Towers';
import {
  MapLayout, isWalkable, inOwnBase, spawnPoint, planRoute, PLAYER_BASE, damageAfterDefense, LEVEL_CAP,
  derivedForLevel, levelForXp, xpToReach, MINION_GOLD, MINION_XP, XP_SHARE_RADIUS, xpShare, respawnTimeS,
  goldAfterDeath, BASE_HEAL_FULL_S, TELEPORT_CHANNEL_S, OPENING_WAIT_S, SKILL_ORDER, SkillName,
  skillLevelsForLevel, manaCost, SKILL_COOLDOWN_S, SKILL_RANGE, skillDamage, Stats,
} from './PlayerData';

type Pt = { x: number; y: number };

/** Something the player can hit. `hit` routes to the existing damage hook and returns true if it killed it. */
export interface AttackTarget extends Targetable {
  kind: 'minion' | 'tower' | 'worldstone';
  hit: (amount: number) => boolean;
}

export default class Player implements Targetable {
  readonly team: Team = 'allied';
  x: number;
  y: number;
  alive = true;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  attackDamage: number;
  defense: number;
  stats: Stats;
  level = 1;
  xp = 0;
  gold = 0;
  deaths = 0;
  respawnLeftS = 0;
  /** Seconds left on the teleport channel, or null when not channeling. */
  teleportLeftS: number | null = null;
  skillLevels: Record<SkillName, number>;
  skillCooldownLeftS: Record<SkillName, number>;
  attackCooldownLeftS = 0;
  route: Pt[] = [];

  private matchTimeS = 0;
  private queuedSkill: SkillName | null = null;
  private queuedTeleport = false;
  private body: Phaser.GameObjects.Rectangle;
  private hpBar: Phaser.GameObjects.Rectangle;
  private hud?: Phaser.GameObjects.Text;
  private buttonLabels: Phaser.GameObjects.Text[] = [];

  constructor(private scene: Phaser.Scene, private layout: MapLayout) {
    const p = spawnPoint(layout);
    this.x = p.x;
    this.y = p.y;
    const d = derivedForLevel(1);
    this.maxHp = this.hp = d.maxHp;
    this.maxMana = this.mana = d.maxMana;
    this.attackDamage = d.attackDamage;
    this.defense = d.defense;
    this.stats = d.stats;
    this.skillLevels = skillLevelsForLevel(1);
    this.skillCooldownLeftS = Object.fromEntries(SKILL_ORDER.map((s) => [s, 0])) as Record<SkillName, number>;
    this.body = scene.add.rectangle(p.x, p.y, 28, 48, 0xffcc33).setOrigin(0.5, 1).setDepth(10);
    this.hpBar = scene.add.rectangle(p.x - 16, p.y - 54, 32, 5, 0x33ff66).setOrigin(0, 0.5).setDepth(10);
  }

  /** The sprite stand-in, for camera follow. */
  getBody(): Phaser.GameObjects.Rectangle {
    return this.body;
  }

  // ---------------- commands ----------------

  /** Tap-to-move target in WORLD coordinates. */
  moveTo(x: number, y: number): void {
    if (!this.alive) return;
    this.teleportLeftS = null; // [TEMP] moving cancels the channel
    this.route = planRoute(this.layout, { x: this.x, y: this.y }, { x, y });
  }

  startTeleport(): void {
    if (!this.alive || this.teleportLeftS !== null) return;
    this.route = [];
    this.teleportLeftS = TELEPORT_CHANNEL_S;
  }

  /** Casts `name` on the closest valid target in SKILL_RANGE. Returns true if cast. */
  castSkill(name: SkillName, targets: readonly AttackTarget[]): boolean {
    const lvl = this.skillLevels[name];
    if (!this.alive || lvl < 1 || this.skillCooldownLeftS[name] > 0) return false;
    const cost = manaCost(lvl, this.maxMana);
    if (this.mana < cost) return false;
    const t = this.closest(targets, SKILL_RANGE);
    if (!t) return false;
    this.teleportLeftS = null; // [TEMP] casting cancels the channel
    this.mana -= cost;
    this.skillCooldownLeftS[name] = SKILL_COOLDOWN_S;
    this.strike(t, skillDamage(this.attackDamage, lvl));
    return true;
  }

  /** Enemy towers/minions call this. Enemies can damage the player anywhere, including in base [DOC]. */
  takeDamage(raw: number): void {
    if (!this.alive) return;
    this.hp -= damageAfterDefense(raw, this.defense);
    this.teleportLeftS = null; // [TEMP] damage cancels the channel
    if (this.hp <= 0) this.die();
  }

  /** Called for every enemy minion death (any killer). [DOC] XP shared by nearby allies. */
  onEnemyMinionDied(x: number, y: number): void {
    if (!this.alive) return;
    if (Math.hypot(x - this.x, y - this.y) > XP_SHARE_RADIUS) return;
    this.addXp(xpShare(MINION_XP, 1)); // only one allied player exists in the slice
  }

  addXp(amount: number): void {
    this.xp += amount;
    const nl = levelForXp(this.xp);
    if (nl <= this.level) return;
    this.level = nl;
    const d = derivedForLevel(nl);
    this.maxHp = d.maxHp;
    this.maxMana = d.maxMana;
    this.attackDamage = d.attackDamage;
    this.defense = d.defense;
    this.stats = d.stats;
    this.skillLevels = skillLevelsForLevel(nl);
    this.hp = this.maxHp; // [DOC] "Mana and health come back after a level"
    this.mana = this.maxMana;
  }

  // ---------------- simulation ----------------

  update(deltaMs: number, matchTimeS: number, targets: readonly AttackTarget[]): void {
    const dt = Math.min(deltaMs, 100) / 1000; // [TEMP/debug] same 100ms clamp as the other systems
    this.matchTimeS = matchTimeS;

    if (!this.alive) {
      this.respawnLeftS -= dt;
      if (this.respawnLeftS <= 0) this.respawn();
      this.syncViews();
      return;
    }

    if (this.queuedTeleport) { this.queuedTeleport = false; this.startTeleport(); }
    if (this.queuedSkill) { this.castSkill(this.queuedSkill, targets); this.queuedSkill = null; }

    if (this.teleportLeftS !== null) {
      this.teleportLeftS -= dt;
      if (this.teleportLeftS <= 0) {
        const p = spawnPoint(this.layout);
        this.x = p.x;
        this.y = p.y;
        this.teleportLeftS = null;
      }
    } else {
      this.walk(dt);
    }

    // [TECH DESIGN] ~8s to full in own base; [TEMP] mana at the same rate.
    if (inOwnBase(this.layout, this.team, this.x)) {
      this.hp = Math.min(this.maxHp, this.hp + (this.maxHp / BASE_HEAL_FULL_S) * dt);
      this.mana = Math.min(this.maxMana, this.mana + (this.maxMana / BASE_HEAL_FULL_S) * dt);
    }

    this.attackCooldownLeftS = Math.max(0, this.attackCooldownLeftS - dt);
    for (const s of SKILL_ORDER) this.skillCooldownLeftS[s] = Math.max(0, this.skillCooldownLeftS[s] - dt);

    if (this.route.length === 0 && this.teleportLeftS === null && this.attackCooldownLeftS === 0) {
      const t = this.closest(targets, PLAYER_BASE.attackRange);
      if (t) {
        this.strike(t, this.attackDamage);
        this.attackCooldownLeftS = PLAYER_BASE.attackCooldownS;
      }
    }
    this.syncViews();
  }

  // ---------------- input / HUD (Phaser only; not used by tests) ----------------

  /** Pointer tap-to-move, on-screen skill + Base buttons fixed to the camera, keys 1-5 and B. */
  bindInput(): void {
    const s = this.scene;
    s.input.addPointer(2); // multi-touch: tap a button while another finger is down
    s.input.on('pointerdown', (p: Phaser.Input.Pointer, over: unknown[]) => {
      if (over.length) return; // tapped a button
      const wp = s.cameras.main.getWorldPoint(p.x, p.y);
      this.moveTo(wp.x, wp.y);
    });
    const labels = [...SKILL_ORDER, 'base'] as const;
    labels.forEach((name, i) => {
      // [TEMP] button layout: 6 x 100px buttons along the bottom right.
      const bx = 1280 - 6 * 106 + i * 106 + 50;
      const by = 720 - 50;
      s.add.rectangle(bx, by, 100, 80, 0x000000, 0.55).setStrokeStyle(2, 0xffffff, 0.6)
        .setScrollFactor(0).setDepth(900).setInteractive()
        .on('pointerdown', () => (name === 'base' ? (this.queuedTeleport = true) : (this.queuedSkill = name)));
      this.buttonLabels.push(
        s.add.text(bx, by, '', { fontSize: '13px', color: '#ffffff', align: 'center', wordWrap: { width: 94 } })
          .setOrigin(0.5).setScrollFactor(0).setDepth(901),
      );
    });
    SKILL_ORDER.forEach((name, i) => s.input.keyboard?.on(`keydown-${['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'][i]}`, () => (this.queuedSkill = name)));
    s.input.keyboard?.on('keydown-B', () => (this.queuedTeleport = true));
    this.hud = s.add.text(10, 10, '', { fontSize: '18px', color: '#ffffff', backgroundColor: '#00000088' })
      .setScrollFactor(0).setDepth(900);
  }

  // ---------------- internals ----------------

  private closest(targets: readonly AttackTarget[], range: number): AttackTarget | null {
    let best: AttackTarget | null = null;
    let bestD = Infinity;
    for (const t of targets) {
      if (!t.alive || t.team === this.team) continue; // no friendly fire
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d <= range && d < bestD) { best = t; bestD = d; }
    }
    return best;
  }

  private strike(t: AttackTarget, amount: number): void {
    const killed = t.hit(amount);
    if (killed && t.kind === 'minion') this.gold += MINION_GOLD; // [DOC] mob gold goes to the last hit
  }

  private walk(dt: number): void {
    let step = PLAYER_BASE.moveSpeed * dt;
    while (step > 0 && this.route.length) {
      const t = this.route[0];
      const dx = t.x - this.x;
      const dy = t.y - this.y;
      const dist = Math.hypot(dx, dy);
      const nx = dist <= step ? t.x : this.x + (dx / dist) * step;
      const ny = dist <= step ? t.y : this.y + (dy / dist) * step;
      if (!this.tryMove(nx, ny)) { this.route = []; break; } // [TEMP] blocked by ground: stop
      if (dist <= step) { this.route.shift(); step -= dist; } else step = 0;
    }
  }

  /** Moves if walkable (and inside own base during the opening wait); slides along one axis otherwise. */
  private tryMove(nx: number, ny: number): boolean {
    const ok = (x: number, y: number) =>
      isWalkable(this.layout, x, y) &&
      (this.matchTimeS >= OPENING_WAIT_S || inOwnBase(this.layout, this.team, x));
    if (ok(nx, ny)) { this.x = nx; this.y = ny; return true; }
    if (ok(nx, this.y) && nx !== this.x) { this.x = nx; return true; }
    if (ok(this.x, ny) && ny !== this.y) { this.y = ny; return true; }
    return false;
  }

  private die(): void {
    this.hp = 0;
    this.alive = false;
    this.deaths++;
    this.respawnLeftS = respawnTimeS(this.deaths);
    this.gold = goldAfterDeath(this.gold);
    this.route = [];
    this.teleportLeftS = null;
    this.queuedSkill = null;
  }

  private respawn(): void {
    const p = spawnPoint(this.layout);
    this.x = p.x;
    this.y = p.y;
    this.hp = this.maxHp; // [TEMP] respawn is in town: full health and mana
    this.mana = this.maxMana;
    this.alive = true;
    this.respawnLeftS = 0;
  }

  private syncViews(): void {
    this.body.setVisible(this.alive).setPosition(this.x, this.y);
    this.hpBar.setVisible(this.alive).setPosition(this.x - 16, this.y - 54).setScale(Math.max(0, this.hp / this.maxHp), 1);
    if (!this.hud) return;
    const next = this.level < LEVEL_CAP ? `/${xpToReach(this.level + 1)}` : ' (max)';
    const lines = [
      `Lv ${this.level}  XP ${Math.floor(this.xp)}${next}  Gold ${this.gold}`,
      `HP ${Math.ceil(this.hp)}/${Math.round(this.maxHp)}  Mana ${Math.floor(this.mana)}/${Math.round(this.maxMana)}`,
    ];
    if (this.matchTimeS < OPENING_WAIT_S) lines.push(`Opening wait: ${Math.ceil(OPENING_WAIT_S - this.matchTimeS)}s`);
    if (!this.alive) lines.push(`Respawn in ${Math.ceil(this.respawnLeftS)}s`);
    if (this.teleportLeftS !== null) lines.push(`Teleporting... ${this.teleportLeftS.toFixed(1)}s`);
    this.hud.setText(lines.join('\n'));
    SKILL_ORDER.forEach((name, i) => {
      const lvl = this.skillLevels[name];
      const cd = this.skillCooldownLeftS[name];
      this.buttonLabels[i]?.setText(`${i + 1} ${name}\n${lvl ? `L${lvl}` : 'locked'}${cd > 0 ? ` ${cd.toFixed(1)}s` : ''}`);
    });
    this.buttonLabels[5]?.setText(`B base\n${this.teleportLeftS !== null ? this.teleportLeftS.toFixed(1) + 's' : '3s'}`);
  }
}
