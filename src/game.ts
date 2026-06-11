// @author: zhjj
// 游戏主控：Rapier 物理世界 + 场景图 + 战斗结算 + 篝火存档 + 昼夜循环 + 镜头

import RAPIER from '@dimforge/rapier2d-compat';
import { Application, Container, Graphics } from 'pixi.js';
import {
  DAY_LENGTH, GROUPS, MAP, SCALE, Tile, UPGRADES,
  GEAR_BY_ID, SKIN_BY_ID, TALENT_BY_ID, WEAPON_BY_ID, WEAPON_UPG,
  type ResKind, type WeaponDef,
} from './defs';
import { Input } from './core/input';
import { sfx } from './core/audio';
import { packExplored, unpackExplored, writeSave, type SaveData } from './core/save';
import { generateWorld, type NodeKind, type WorldData } from './world/worldgen';
import { WorldRenderer } from './world/worldrender';
import { Particles, FloatTexts } from './fx';
import { Player } from './entities/player';
import { Animal } from './entities/animals';
import { Drops } from './entities/drops';
import { Projectiles } from './entities/projectiles';
import { tileJitter } from './utils/noise';
import * as hud from './ui/hud';

// 碰撞分组定义见 defs.ts GROUPS
const G_STATIC = GROUPS.STATIC;
const G_PLAYER = GROUPS.PLAYER;
const G_ANIMAL = GROUPS.ANIMAL;

export interface WNode {
  id: number;
  kind: NodeKind;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
  berries: boolean;
  regrowT: number;
  wobbleT: number;
  root: Container;
  berriesG: Graphics | null;
  collider: RAPIER.Collider | null;
}

interface Campfire {
  id: number;
  x: number;
  y: number;
  root: Container;
  flame: Graphics;
  glow: Graphics;
  emberT: number;
}

interface SpawnRecord {
  kind: string;
  x: number;
  y: number;
  animal: Animal | null;
  deadAt: number;
}

export class Game {
  app!: Application;
  input = new Input();
  physWorld!: RAPIER.World;
  worldData!: WorldData;
  renderer = new WorldRenderer();
  particles = new Particles();
  floats = new FloatTexts();
  drops = new Drops();
  projectiles = new Projectiles();

  private worldC = new Container();
  private objects = new Container();

  player!: Player;
  animals: Animal[] = [];
  nodes: WNode[] = [];
  private campfires: Campfire[] = [];
  removedNodes = new Set<number>();
  explored: Uint8Array = new Uint8Array(MAP * MAP); // 战争迷雾
  private spawnRecords: SpawnRecord[] = [];

  private camX = 0;
  private camY = 0;
  private shakeAmp = 0;
  private hitstopT = 0;
  time = 0;
  private playTime = 0;
  private respawnT = 0;
  private minimapT = 0;
  private nightT = 0;
  private deathT = -1;

  paused = false;
  menuOpen = false;
  private menuKind: 'campfire' | 'shop' | null = null;
  private shopTab: hud.ShopTab = 'weapons';
  private activeCampfire: Campfire | null = null;
  private state: 'playing' | 'dead' = 'playing';
  campfireId = 0;
  bossDefeated = false;
  isNight = false;
  private bossWarned = false;
  seed: number;

  private constructor(seed: number) {
    this.seed = seed;
  }

  static async create(save: SaveData | null): Promise<Game> {
    const seed = save ? save.seed : (Math.random() * 0x7fffffff) | 0;
    const game = new Game(seed);
    await game.init(save);
    return game;
  }

  private async init(save: SaveData | null): Promise<void> {
    await RAPIER.init();
    this.app = new Application();
    await this.app.init({ resizeTo: window, antialias: true, background: 0x14506b });
    document.getElementById('app')!.appendChild(this.app.canvas);

    this.physWorld = new RAPIER.World({ x: 0, y: 0 });
    this.worldData = generateWorld(this.seed);

    // 场景层级
    this.objects.sortableChildren = true;
    this.renderer.build(this.worldData);
    this.worldC.addChild(this.renderer.container);
    this.worldC.addChild(this.objects);
    this.objects.addChild(this.drops.container);
    this.objects.addChild(this.projectiles.container);
    const fxC = new Container();
    fxC.addChild(this.particles.container);
    fxC.addChild(this.floats.container);
    this.worldC.addChild(fxC);
    this.app.stage.addChild(this.worldC);

    this.buildWaterColliders();
    this.buildNodes(save ? new Set(save.removedNodes) : new Set());
    this.buildCampfires();

    // 玩家
    const startCf = this.worldData.campfires[save ? save.campfireId : 0] ?? { x: MAP / 2, y: MAP / 2 + 30 };
    const px = save ? save.player.x : startCf.x + 1.2;
    const py = save ? save.player.y : startCf.y + 1.2;
    this.player = new Player(this.physWorld, px, py, G_PLAYER);
    this.objects.addChild(this.player.root);
    this.camX = px;
    this.camY = py;

    if (save) {
      this.campfireId = save.campfireId;
      this.bossDefeated = save.bossDefeated;
      this.playTime = save.playTime;
      const p = save.player;
      this.player.hp = p.hp;
      this.player.maxHp = p.maxHp;
      this.player.maxStam = p.maxStam;
      this.player.stam = p.maxStam;
      this.player.res = { ...p.res };
      this.player.upgrades = { ...p.upgrades };
      this.player.coins = { ...p.coins };
      this.player.weapons = [...p.weapons];
      this.player.weaponLvls = { ...p.weaponLvls };
      this.player.skins = [...p.skins];
      this.player.activeSkin = p.activeSkin;
      this.player.talents = new Set(p.talents);
      this.player.gear = new Set(p.gear);
      this.player.weaponIdx = Math.min(p.weapon, this.player.weapons.length - 1);
      this.player.drawWeapon();
      this.removedNodes = new Set(save.removedNodes);
      this.explored = unpackExplored(save.explored, MAP * MAP);
    }

    // 动物
    this.spawnRecords = this.worldData.spawns.map((s) => ({ kind: s.kind, x: s.x, y: s.y, animal: null, deadAt: -999 }));
    this.spawnAllAnimals();

    // HUD
    hud.initMinimap(this.worldData, this.explored);
    hud.buildHotbar(this.player.weapons, this.player.weaponIdx);
    hud.setRes(this.player.res);
    hud.updateCoins(this.player.coins);
    hud.setHp(this.player.hp, this.player.maxHp);
    this.revealAround(this.player.x, this.player.y);
    hud.drawMinimap(this.worldData, this.player.x, this.player.y, !this.bossDefeated);

    this.app.ticker.add((tk) => this.tick(Math.min(tk.deltaMS / 1000, 0.05)));

    if (!save) {
      hud.toast('🏝️ 你漂流到了一座孤岛… 在篝火旁可以保存进度');
    }
  }

  // ---------------- 构建 ----------------

  /** 深水边界碰撞体（WATER 组，乘船可穿越）+ 地图四周外墙（乘船也不可驶出） */
  private buildWaterColliders(): void {
    const w = this.worldData;
    for (let y = 1; y < MAP - 1; y++) {
      for (let x = 1; x < MAP - 1; x++) {
        const t = w.tiles[y * MAP + x] as Tile;
        if (t !== Tile.DeepWater) continue;
        const near =
          (w.tiles[y * MAP + x - 1] as Tile) > Tile.DeepWater ||
          (w.tiles[y * MAP + x + 1] as Tile) > Tile.DeepWater ||
          (w.tiles[(y - 1) * MAP + x] as Tile) > Tile.DeepWater ||
          (w.tiles[(y + 1) * MAP + x] as Tile) > Tile.DeepWater;
        if (near) {
          this.physWorld.createCollider(
            RAPIER.ColliderDesc.cuboid(0.5, 0.5).setTranslation(x + 0.5, y + 0.5).setCollisionGroups(GROUPS.WATER),
          );
        }
      }
    }
    // 世界边界墙
    const half = MAP / 2;
    const walls: [number, number, number, number][] = [
      [half, -1, half + 2, 1],
      [half, MAP + 1, half + 2, 1],
      [-1, half, 1, half + 2],
      [MAP + 1, half, 1, half + 2],
    ];
    for (const [cx, cy, hx, hy] of walls) {
      this.physWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy).setTranslation(cx, cy).setCollisionGroups(G_STATIC),
      );
    }
  }

  private buildNodes(removed: Set<number>): void {
    for (const nd of this.worldData.nodes) {
      if (removed.has(nd.id)) continue;
      const j = tileJitter(nd.id, 7, this.seed);
      const root = new Container();
      root.position.set(nd.x * SCALE, nd.y * SCALE);
      root.zIndex = nd.y;
      const scale = 0.85 + j * 0.35;
      let berriesG: Graphics | null = null;
      let colR = 0;
      let hp = 3;

      const g = new Graphics();
      if (nd.kind === 'tree') {
        g.ellipse(0, 4, 13, 6).fill({ color: 0x000000, alpha: 0.22 });
        g.rect(-3, -10, 6, 14).fill(0x6b4a2c);
        g.circle(-9, -16, 11).fill(0x3f7a36);
        g.circle(9, -15, 10).fill(0x447f3a);
        g.circle(0, -24, 12).fill(0x4a8a40);
        g.circle(-3, -22, 7).fill(0x5a9c4c);
        colR = 0.3;
        hp = 3;
      } else if (nd.kind === 'palm') {
        g.ellipse(0, 4, 12, 5).fill({ color: 0x000000, alpha: 0.22 });
        g.moveTo(0, 2).quadraticCurveTo(6, -14, 12, -26).stroke({ width: 5, color: 0x9a7448 });
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          g.moveTo(12, -26)
            .quadraticCurveTo(12 + Math.cos(a) * 10, -26 + Math.sin(a) * 6 - 6, 12 + Math.cos(a) * 19, -26 + Math.sin(a) * 11)
            .stroke({ width: 4, color: i % 2 ? 0x4e9a44 : 0x5fae50 });
        }
        g.circle(9, -24, 3).fill(0x6b4a2c);
        g.circle(14, -22, 3).fill(0x5e3d26);
        colR = 0.28;
        hp = 3;
      } else if (nd.kind === 'rock') {
        g.ellipse(0, 5, 13, 5).fill({ color: 0x000000, alpha: 0.22 });
        g.poly([-12, 4, -9, -7, -2, -12, 7, -10, 12, -1, 9, 5, -6, 6]).fill(0x9a9a92);
        g.poly([-9, -7, -2, -12, 7, -10, 2, -4, -5, -3]).fill(0xb0b0a8);
        colR = 0.42;
        hp = 4;
      } else {
        // bush
        g.ellipse(0, 4, 11, 4).fill({ color: 0x000000, alpha: 0.2 });
        g.circle(-6, -3, 7).fill(0x4a8a40);
        g.circle(6, -3, 7).fill(0x447f3a);
        g.circle(0, -7, 8).fill(0x529447);
        berriesG = new Graphics();
        berriesG.circle(-5, -6, 2.2).fill(0x7a4fd0);
        berriesG.circle(3, -9, 2.2).fill(0x8a5fe0);
        berriesG.circle(6, -3, 2.2).fill(0x7a4fd0);
        berriesG.circle(-1, -2, 2.2).fill(0x8a5fe0);
        hp = 999;
      }
      g.scale.set(scale);
      root.addChild(g);
      if (berriesG) {
        berriesG.scale.set(scale);
        root.addChild(berriesG);
      }
      this.objects.addChild(root);

      let collider: RAPIER.Collider | null = null;
      if (colR > 0) {
        collider = this.physWorld.createCollider(
          RAPIER.ColliderDesc.ball(colR * scale).setTranslation(nd.x, nd.y).setCollisionGroups(G_STATIC),
        );
      }

      this.nodes.push({
        id: nd.id,
        kind: nd.kind,
        x: nd.x,
        y: nd.y,
        hp,
        alive: true,
        berries: nd.kind === 'bush',
        regrowT: 0,
        wobbleT: 0,
        root,
        berriesG,
        collider,
      });
    }
  }

  private buildCampfires(): void {
    for (const cf of this.worldData.campfires) {
      const root = new Container();
      root.position.set(cf.x * SCALE, cf.y * SCALE);
      root.zIndex = cf.y;

      const glow = new Graphics();
      glow.circle(0, -4, 44).fill({ color: 0xff9a30, alpha: 0.14 });
      glow.circle(0, -4, 26).fill({ color: 0xffb050, alpha: 0.12 });
      root.addChild(glow);

      const base = new Graphics();
      base.ellipse(0, 4, 16, 7).fill({ color: 0x000000, alpha: 0.25 });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        base.circle(Math.cos(a) * 13, 3 + Math.sin(a) * 6, 3.4).fill(i % 2 ? 0x8d8d85 : 0x7a7a72);
      }
      base.rect(-9, -2, 18, 4).fill(0x6b4a2c);
      base.rect(-2, -9, 4, 18).fill(0x5e3d26);
      root.addChild(base);

      const flame = new Graphics();
      flame.poly([0, -22, -7, -4, 7, -4]).fill({ color: 0xff8a2a, alpha: 0.95 });
      flame.poly([0, -14, -4, -3, 4, -3]).fill(0xffd24a);
      root.addChild(flame);

      this.objects.addChild(root);
      this.campfires.push({ id: cf.id, x: cf.x, y: cf.y, root, flame, glow, emberT: Math.random() });
    }
  }

  private spawnAllAnimals(): void {
    for (let i = 0; i < this.spawnRecords.length; i++) {
      const r = this.spawnRecords[i];
      if (r.kind === 'bear' && this.bossDefeated) continue;
      this.spawnAnimal(i);
    }
  }

  private spawnAnimal(idx: number): void {
    const r = this.spawnRecords[idx];
    const a = new Animal(this.physWorld, r.kind as never, r.x, r.y, idx, G_ANIMAL);
    this.objects.addChild(a.root);
    this.animals.push(a);
    r.animal = a;
  }

  private regenerateAnimals(): void {
    for (const a of this.animals) a.destroy(this);
    this.animals = [];
    for (const r of this.spawnRecords) {
      r.animal = null;
      r.deadAt = -999;
    }
    this.spawnAllAnimals();
  }

  // ---------------- 主循环 ----------------

  private tick(dtRaw: number): void {
    const input = this.input;
    if (input.wasPressed('Escape')) this.handleEsc();
    if (input.wasPressed('KeyM')) {
      hud.toast(sfx.toggleMute() ? '🔇 已静音' : '🔊 已开启声音');
    }

    if (!this.paused && !this.menuOpen) {
      this.updateWorld(dtRaw);
    }
    input.endFrame();
  }

  private handleEsc(): void {
    if (this.menuOpen) {
      if (this.menuKind === 'shop') this.closeShop();
      else this.campfireAction('close');
    } else if (this.paused) {
      this.setPaused(false);
    } else if (this.state === 'playing') {
      this.setPaused(true);
    }
  }

  private updateWorld(dtRaw: number): void {
    let dt = dtRaw;
    if (this.hitstopT > 0) {
      this.hitstopT -= dtRaw;
      dt *= 0.1;
    }
    this.time += dt;
    this.playTime += dtRaw;

    if (this.state === 'playing') {
      this.player.update(dt, this);
    } else if (this.deathT > 0) {
      this.deathT -= dtRaw;
      if (this.deathT <= 0) hud.showScreen('death');
    }

    // 动物（仅更新玩家附近的）
    for (const a of this.animals) {
      const d = Math.abs(a.x - this.player.x) + Math.abs(a.y - this.player.y);
      if (d < 55 || a.dead) a.update(dt, this);
    }
    // 清理已淡出的尸体
    if (this.animals.length > 0 && Math.random() < 0.02) {
      this.animals = this.animals.filter((a) => !a.dead || a.root.parent !== null);
    }

    // 物理步进
    this.physWorld.timestep = Math.max(dt, 1 / 240);
    this.physWorld.step();

    this.projectiles.update(dt, this);
    this.drops.update(dt, this);
    this.particles.update(dt);
    this.floats.update(dt);
    this.updateNodes(dt);
    this.updateCampfires(dt);
    this.updateInteraction();
    this.updateCamera(dt);
    this.updateDayNight(dtRaw);
    this.updateRespawns(dtRaw);
    this.updateHud(dtRaw);
    this.renderer.animate(this.time);
    this.renderer.cull(this.camX, this.camY, this.app.screen.width, this.app.screen.height);
  }

  private updateNodes(dt: number): void {
    for (const n of this.nodes) {
      if (!n.alive) {
        if (n.root.parent) {
          n.root.alpha -= dt * 2.5;
          n.root.y += dt * 10;
          if (n.root.alpha <= 0) n.root.parent.removeChild(n.root);
        }
        continue;
      }
      if (n.wobbleT > 0) {
        n.wobbleT -= dt;
        n.root.rotation = Math.sin(n.wobbleT * 28) * 0.07 * (n.wobbleT / 0.35);
      }
      if (n.kind === 'bush' && !n.berries) {
        n.regrowT -= dt;
        if (n.regrowT <= 0) {
          n.berries = true;
          if (n.berriesG) n.berriesG.visible = true;
        }
      }
    }
  }

  private updateCampfires(dt: number): void {
    for (const cf of this.campfires) {
      const f = 1 + Math.sin(this.time * 13 + cf.id * 5) * 0.1 + Math.sin(this.time * 29 + cf.id) * 0.06;
      cf.flame.scale.set(1, f);
      cf.glow.alpha = 0.75 + Math.sin(this.time * 9 + cf.id * 3) * 0.18;
      cf.emberT -= dt;
      if (cf.emberT <= 0 && Math.abs(cf.x - this.player.x) + Math.abs(cf.y - this.player.y) < 30) {
        cf.emberT = 0.25 + Math.random() * 0.3;
        this.particles.burst(cf.x + (Math.random() - 0.5) * 0.2, cf.y - 0.3, {
          color: Math.random() < 0.5 ? 0xffb050 : 0xff7a30,
          count: 1,
          speed: 0.8,
          life: 0.8,
          size: 2,
          alpha: 0.8,
        });
      }
    }
  }

  private updateInteraction(): void {
    if (this.state !== 'playing') {
      hud.showPrompt(null);
      return;
    }
    const p = this.player;
    let nearCf: Campfire | null = null;
    for (const cf of this.campfires) {
      if (Math.hypot(cf.x - p.x, cf.y - p.y) < 1.8) {
        nearCf = cf;
        break;
      }
    }
    let nearBush: WNode | null = null;
    if (!nearCf) {
      for (const n of this.nodes) {
        if (n.alive && n.kind === 'bush' && n.berries && Math.hypot(n.x - p.x, n.y - p.y) < 1.4) {
          nearBush = n;
          break;
        }
      }
    }

    if (nearCf) {
      hud.showPrompt('<kbd>E</kbd> 篝火 — 休息 · 保存 · 强化');
    } else if (nearBush) {
      hud.showPrompt('<kbd>E</kbd> 采摘浆果');
    } else {
      hud.showPrompt(null);
    }

    if (this.input.wasPressed('KeyE')) {
      if (nearCf) {
        this.activeCampfire = nearCf;
        this.menuOpen = true;
        this.menuKind = 'campfire';
        hud.updateCampfireMenu(this.player);
        hud.showScreen('campfire');
        sfx.ui();
      } else if (nearBush) {
        this.harvestBush(nearBush);
      }
    }
  }

  private updateCamera(dt: number): void {
    const p = this.player;
    // 镜头微微偏向鼠标方向（Hades 手感）
    const leanX = (this.input.mouseX - this.app.screen.width / 2) * 0.1 / SCALE;
    const leanY = (this.input.mouseY - this.app.screen.height / 2) * 0.1 / SCALE;
    const tx = p.x + Math.max(-2.5, Math.min(2.5, leanX));
    const ty = p.y + Math.max(-2.5, Math.min(2.5, leanY));
    const k = Math.min(1, dt * 6);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    this.shakeAmp *= Math.exp(-8 * dt);
    const sx = (Math.random() - 0.5) * 2 * this.shakeAmp * SCALE;
    const sy = (Math.random() - 0.5) * 2 * this.shakeAmp * SCALE;
    this.worldC.position.set(
      this.app.screen.width / 2 - this.camX * SCALE + sx,
      this.app.screen.height / 2 - this.camY * SCALE + sy,
    );
  }

  private updateDayNight(dt: number): void {
    this.nightT -= dt;
    if (this.nightT > 0) return;
    this.nightT = 0.4;
    const dayT = (this.time % DAY_LENGTH) / DAY_LENGTH;
    const sun = Math.cos(dayT * Math.PI * 2);
    const nightness = Math.max(0, Math.min(1, (0.15 - sun) / 1.3));
    hud.setNight(nightness * 0.52);
    this.isNight = sun < -0.25;
    hud.setClock(sun > 0.3 ? '☀️' : sun > -0.3 ? (dayT < 0.5 ? '🌅' : '🌄') : '🌙');
  }

  private updateRespawns(dt: number): void {
    this.respawnT -= dt;
    if (this.respawnT > 0) return;
    this.respawnT = 6;
    for (let i = 0; i < this.spawnRecords.length; i++) {
      const r = this.spawnRecords[i];
      if (r.kind === 'bear') continue;
      if (r.animal && !r.animal.dead) continue;
      if (r.deadAt < 0 || this.time - r.deadAt < 25) continue;
      if (Math.hypot(r.x - this.player.x, r.y - this.player.y) < 16) continue;
      this.spawnAnimal(i);
      r.deadAt = -999;
    }
  }

  private updateHud(dt: number): void {
    hud.setHp(this.player.hp, this.player.maxHp);
    hud.setStam(this.player.stam, this.player.maxStam);

    this.minimapT -= dt;
    if (this.minimapT <= 0) {
      this.minimapT = 0.35;
      this.revealAround(this.player.x, this.player.y);
      hud.drawMinimap(this.worldData, this.player.x, this.player.y, !this.bossDefeated);
    }

    // Boss 血条
    const bear = this.animals.find((a) => a.def.boss && !a.dead);
    if (bear && (bear.aggro || Math.hypot(bear.x - this.player.x, bear.y - this.player.y) < 15)) {
      hud.setBossBar(bear.hp / bear.def.hp);
      if (bear.aggro && !this.bossWarned) {
        this.bossWarned = true;
        hud.toast('⚠️ 岛屿之王苏醒了！');
      }
    } else {
      hud.setBossBar(null);
    }
  }

  /** 揭开玩家周围的战争迷雾 */
  private revealAround(x: number, y: number, r = 14): void {
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(MAP - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r));
    const y1 = Math.min(MAP - 1, Math.ceil(y + r));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if ((tx - x) ** 2 + (ty - y) ** 2 <= r * r) this.explored[ty * MAP + tx] = 1;
      }
    }
    hud.revealFog(x, y, r);
  }

  // ---------------- 战斗与采集 ----------------

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.worldC.x) / SCALE, y: (sy - this.worldC.y) / SCALE };
  }

  meleeStrike(player: Player, wd: WeaponDef): void {
    const dir = player.aim;
    let hitAnimal = false;
    for (const a of this.animals) {
      if (a.dead) continue;
      const dx = a.x - player.x;
      const dy = a.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > wd.range + a.def.radius) continue;
      let ang = Math.atan2(dy, dx) - dir;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      if (Math.abs(ang) > wd.arc / 2 + 0.3) continue;

      const crit = Math.random() < 0.1;
      const dmg = player.weaponDmg(wd) * (0.9 + Math.random() * 0.25) * (crit ? 1.7 : 1);
      const kdir = Math.atan2(dy, dx);
      a.damage(dmg, Math.cos(kdir) * wd.knock, Math.sin(kdir) * wd.knock, this);
      if (crit) this.floats.show(a.x, a.y - 1, '暴击!', 0xffd24a, 14);
      if (wd.flame && !a.dead) a.burnT = Math.max(a.burnT, 3); // 点燃
      hitAnimal = true;
      this.hitstop(a.dead ? 0.09 : 0.035);
      if (a.dead) {
        this.addShake(0.22);
        if (player.hasTalent('vampire')) player.heal(4, this); // 嗜血：击杀回血
      }
    }
    if (hitAnimal) sfx.hit();

    // 采集：每次挥击只命中最近的一个资源节点
    let best: WNode | null = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      if (!n.alive) continue;
      const dx = n.x - player.x;
      const dy = n.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > wd.range * 0.85 + 0.45) continue;
      let ang = Math.atan2(dy, dx) - dir;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      if (Math.abs(ang) > Math.max(wd.arc / 2, 0.5) + 0.3) continue;
      if (dist < bestD) {
        bestD = dist;
        best = n;
      }
    }
    if (best) this.harvestHit(best, wd);
  }

  private harvestHit(n: WNode, wd?: WeaponDef): void {
    n.wobbleT = 0.35;
    // 战斧加成 + 拾荒者天赋
    let bonus = wd?.chopBonus ?? 0;
    if (this.player.hasTalent('scavenger') && Math.random() < 0.3) bonus += 1;
    if (n.kind === 'tree' || n.kind === 'palm') {
      this.drops.spawn('wood', n.x, n.y - 0.3, 1 + bonus);
      this.particles.burst(n.x, n.y - 0.7, { color: 0x4e9a44, count: 7, speed: 2.5, life: 0.55, size: 3 });
      sfx.chop();
      n.hp--;
      if (n.hp <= 0) this.destroyNode(n, 'wood', 2 + bonus);
    } else if (n.kind === 'rock') {
      this.drops.spawn('stone', n.x, n.y - 0.2, 1 + bonus);
      this.particles.burst(n.x, n.y - 0.3, { color: 0xb0b0a8, count: 6, speed: 2.5, life: 0.45, size: 2.5 });
      sfx.hit();
      n.hp--;
      if (n.hp <= 0) this.destroyNode(n, 'stone', 2 + bonus);
    } else if (n.kind === 'bush') {
      this.harvestBush(n);
    }
  }

  private harvestBush(n: WNode): void {
    if (!n.berries) return;
    n.berries = false;
    n.regrowT = 75;
    if (n.berriesG) n.berriesG.visible = false;
    n.wobbleT = 0.35;
    this.drops.spawn('berry', n.x, n.y, 2);
    this.particles.burst(n.x, n.y - 0.3, { color: 0x8a5fe0, count: 6, speed: 2, life: 0.5, size: 2.5 });
    sfx.chop();
  }

  private destroyNode(n: WNode, bonus: ResKind, count: number): void {
    n.alive = false;
    this.removedNodes.add(n.id);
    this.drops.spawn(bonus, n.x, n.y, count);
    this.particles.burst(n.x, n.y - 0.5, {
      color: n.kind === 'rock' ? 0x9a9a92 : 0x6b4a2c,
      count: 12,
      speed: 3,
      life: 0.6,
      size: 3.5,
    });
    this.addShake(0.12);
    if (n.collider) {
      this.physWorld.removeCollider(n.collider, true);
      n.collider = null;
    }
  }

  onArrowHit(x: number, y: number): void {
    this.particles.burst(x, y, { color: 0xffe0a0, count: 5, speed: 2, life: 0.3, size: 2 });
    sfx.hit();
    this.hitstop(0.03);
  }

  onAnimalKilled(a: Animal): void {
    const r = this.spawnRecords[a.spawnIdx];
    if (r) {
      r.deadAt = this.time;
      r.animal = null;
    }
    if (a.def.boss) {
      this.bossDefeated = true;
      hud.setBossBar(null);
      this.addShake(0.9);
      sfx.win();
      this.saveNow();
      window.setTimeout(() => {
        hud.showScreen('win');
        this.paused = true;
      }, 1400);
    }
  }

  onPlayerDeath(): void {
    this.state = 'dead';
    this.deathT = 1.2;
    this.addShake(0.7);
    sfx.death();
  }

  // ---------------- 流程控制 ----------------

  addShake(a: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, a);
  }

  hitstop(t: number): void {
    this.hitstopT = Math.max(this.hitstopT, t);
  }

  get menuOrPaused(): boolean {
    return this.menuOpen || this.paused;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    hud.showScreen(p ? 'pause' : null);
    sfx.ui();
  }

  respawn(): void {
    const cf = this.worldData.campfires[this.campfireId] ?? this.worldData.campfires[0];
    this.player.teleport(cf.x + 1.2, cf.y + 1.2);
    this.player.hp = this.player.maxHp;
    this.player.stam = this.player.maxStam;
    this.player.curePoison(this);
    this.player.dead = false;
    this.state = 'playing';
    this.deathT = -1;
    this.bossWarned = false;
    this.regenerateAnimals();
    this.drops.clear();
    this.projectiles.clear();
    hud.showScreen(null);
    hud.toast('🔥 你在篝火旁醒来，岛上的野兽也恢复了生机');
  }

  closeWin(): void {
    this.paused = false;
    hud.showScreen(null);
  }

  campfireAction(action: 'rest' | 'atk' | 'hp' | 'stam' | 'close'): void {
    if (action === 'close') {
      this.menuOpen = false;
      this.menuKind = null;
      this.activeCampfire = null;
      hud.showScreen(null);
      return;
    }
    const p = this.player;
    if (action === 'rest') {
      if (this.activeCampfire) this.campfireId = this.activeCampfire.id;
      p.hp = p.maxHp;
      p.stam = p.maxStam;
      this.regenerateAnimals();
      this.bossWarned = false;
      this.saveNow();
      sfx.save();
      hud.toast('💾 已保存 — 篝火旁很安全，但野兽们回来了');
      hud.setHp(p.hp, p.maxHp);
      hud.updateCampfireMenu(p);
      return;
    }
    // 升级购买
    const upDef = UPGRADES.find((u) => u.id === action);
    if (!upDef) return;
    const lvl = p.upgrades[action];
    if (lvl >= upDef.maxLvl) return;
    const cost = upDef.cost(lvl);
    const afford = Object.entries(cost).every(([k, n]) => p.res[k as ResKind] >= (n as number));
    if (!afford) {
      hud.toast('材料不足…');
      return;
    }
    for (const [k, n] of Object.entries(cost)) {
      p.res[k as ResKind] -= n as number;
    }
    p.upgrades[action]++;
    if (action === 'hp') {
      p.maxHp += 20;
      p.hp = Math.min(p.maxHp, p.hp + 20);
    } else if (action === 'stam') {
      p.maxStam += 20;
    }
    sfx.upgrade();
    this.particles.burst(p.x, p.y - 0.4, { color: 0xffd24a, count: 12, speed: 2.5, life: 0.6, size: 3 });
    hud.setRes(p.res);
    hud.setHp(p.hp, p.maxHp);
    hud.updateCampfireMenu(p);
  }

  // ---------------- 商店 ----------------

  openShop(): void {
    this.menuOpen = true;
    this.menuKind = 'shop';
    hud.showScreen('shop');
    hud.renderShop(this.player, this.shopTab);
    sfx.ui();
  }

  closeShop(): void {
    this.menuOpen = false;
    this.menuKind = null;
    hud.showScreen(null);
    sfx.ui();
  }

  setShopTab(tab: hud.ShopTab): void {
    this.shopTab = tab;
    hud.renderShop(this.player, this.shopTab);
    sfx.ui();
  }

  shopAction(act: string, id: string): void {
    const p = this.player;
    if (act === 'buy-weapon') {
      const wd = WEAPON_BY_ID[id];
      if (!wd?.price || p.weapons.includes(id)) return;
      if (!p.canAfford(wd.price)) {
        hud.toast('💰 钱币不足…');
        return;
      }
      p.pay(wd.price);
      p.weapons.push(id);
      hud.buildHotbar(p.weapons, p.weaponIdx);
      hud.toast(`🛒 购入 ${wd.icon} ${wd.name}！按 ${p.weapons.length} 键装备`);
      sfx.upgrade();
    } else if (act === 'upg-weapon') {
      if (!p.weapons.includes(id)) return;
      const lvl = p.weaponLvls[id] ?? 0;
      if (lvl >= WEAPON_UPG.maxLvl) return;
      const cost = WEAPON_UPG.cost(lvl);
      if (!p.canAfford(cost)) {
        hud.toast('💰 钱币不足…');
        return;
      }
      p.pay(cost);
      p.weaponLvls[id] = lvl + 1;
      hud.toast(`⚒️ ${WEAPON_BY_ID[id].name} 强化至 Lv.${lvl + 1}`);
      sfx.upgrade();
    } else if (act === 'buy-talent') {
      const t = TALENT_BY_ID[id];
      if (!t || p.talents.has(id)) return;
      if (!p.canAfford(t.price)) {
        hud.toast('💰 钱币不足…');
        return;
      }
      p.pay(t.price);
      p.talents.add(id);
      hud.toast(`${t.icon} 习得天赋「${t.name}」`);
      sfx.upgrade();
    } else if (act === 'buy-skin') {
      const s = SKIN_BY_ID[id];
      if (!s?.price || p.skins.includes(id)) return;
      if (!p.canAfford(s.price)) {
        hud.toast('💰 钱币不足…');
        return;
      }
      p.pay(s.price);
      p.skins.push(id);
      p.activeSkin = id;
      p.drawWeapon();
      hud.toast(`✨ 武器换上「${s.name}」皮肤`);
      sfx.upgrade();
    } else if (act === 'buy-gear') {
      const g = GEAR_BY_ID[id];
      if (!g || p.gear.has(id)) return;
      if (!p.canAfford(g.price)) {
        hud.toast('💰 钱币不足…');
        return;
      }
      p.pay(g.price);
      p.gear.add(id);
      hud.toast(`${g.icon} 购入${g.name}！靠近水面即可自动乘船`);
      sfx.upgrade();
    } else if (act === 'equip-skin') {
      if (!p.skins.includes(id)) return;
      p.activeSkin = id;
      p.drawWeapon();
      sfx.ui();
    } else {
      return;
    }
    hud.updateCoins(p.coins);
    hud.renderShop(p, this.shopTab);
  }

  private saveNow(): void {
    const p = this.player;
    const data: SaveData = {
      version: 3,
      seed: this.seed,
      campfireId: this.campfireId,
      removedNodes: [...this.removedNodes],
      bossDefeated: this.bossDefeated,
      player: {
        x: p.x,
        y: p.y,
        hp: p.hp,
        maxHp: p.maxHp,
        maxStam: p.maxStam,
        weapon: p.weaponIdx,
        res: { ...p.res },
        upgrades: { ...p.upgrades },
        coins: { ...p.coins },
        weapons: [...p.weapons],
        weaponLvls: { ...p.weaponLvls },
        skins: [...p.skins],
        activeSkin: p.activeSkin,
        talents: [...p.talents],
        gear: [...p.gear],
      },
      explored: packExplored(this.explored),
      playTime: this.playTime,
    };
    writeSave(data);
  }
}
