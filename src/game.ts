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
import { mulberry32, tileJitter } from './utils/noise';
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

const CAVE_SIZE = 30; // 洞穴内部边长（格）

interface CaveDef {
  id: number;
  ex: number; // 地表入口
  ey: number;
  ox: number; // 内部原点（地图边界之外的世界坐标）
  oy: number;
  cells: Uint8Array; // 1 = 可行走地面
  exitX: number; // 内部出口（世界坐标）
  exitY: number;
}

interface CaveChest {
  id: number;
  caveId: number;
  x: number;
  y: number;
  opened: boolean;
  g: Graphics;
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

  // 洞穴
  caves: CaveDef[] = [];
  inCave: number | null = null;
  private caveChests: CaveChest[] = [];
  private openedChests = new Set<number>();
  private caveBatSpawns: { x: number; y: number }[] = [];

  // 天气：晴 / 雨（雨天玩家移速降低）
  private weather: 'clear' | 'rain' = 'clear';
  rainIntensity = 0; // 0..1 渐变
  private weatherT = 50 + Math.random() * 70; // 距下次天气变化的秒数
  private rainC = new Container();
  private rainDrops: { g: Graphics; spd: number }[] = [];

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
    this.rainC.visible = false;
    this.app.stage.addChild(this.rainC); // 屏幕空间雨幕，盖在世界之上

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

    // 洞穴（须在存档应用之后：依赖 removedNodes / openedChests）
    if (save) this.openedChests = new Set(save.openedChests ?? []);
    this.buildCaves();

    // 动物
    this.spawnRecords = this.worldData.spawns.map((s) => ({ kind: s.kind, x: s.x, y: s.y, animal: null, deadAt: -999 }));
    for (const b of this.caveBatSpawns) {
      this.spawnRecords.push({ kind: 'bat', x: b.x, y: b.y, animal: null, deadAt: -999 });
    }
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

  // ---------------- 洞穴 ----------------

  /** 生成 3 座洞穴：地表入口（岩地）+ 地图外的内部空间（宝箱/水晶/蝙蝠） */
  private buildCaves(): void {
    const w = this.worldData;
    const crng = mulberry32(this.seed ^ 0xcafe17); // 独立随机流，不影响世界生成确定性
    // 入口候选：优先岩地，不足时退而求其次用岛屿中心附近的山脚（草地/森林）
    const collect = (pred: (t: Tile, x: number, y: number) => boolean): { x: number; y: number }[] => {
      const out: { x: number; y: number }[] = [];
      for (let y = 8; y < MAP - 8; y += 2) {
        for (let x = 8; x < MAP - 8; x += 2) {
          const t = w.tiles[y * MAP + x] as Tile;
          if (!pred(t, x, y)) continue;
          if (Math.hypot(x - w.bossPos.x, y - w.bossPos.y) < 9) continue; // 只避开决斗场本体
          if (w.campfires.some((f) => Math.hypot(f.x - x, f.y - y) < 5)) continue;
          out.push({ x: x + 0.5, y: y + 0.5 });
        }
      }
      return out;
    };
    // 岩地 + 各岛中心附近的山脚（草地/森林），保证不同岛屿都可能有洞穴
    const candidates = collect((t) => t === Tile.Rock).concat(
      collect(
        (t, x, y) =>
          (t === Tile.Grass || t === Tile.Forest) &&
          w.isles.some((isle) => Math.hypot(x - isle.x, y - isle.y) < isle.r * 0.45),
      ),
    );
    const picked: { x: number; y: number }[] = [];
    for (let attempt = 0; attempt < 800 && picked.length < 3 && candidates.length > 0; attempt++) {
      const c = candidates[Math.floor(crng() * candidates.length)];
      if (picked.every((p) => Math.hypot(p.x - c.x, p.y - c.y) > 30)) picked.push(c);
    }

    picked.forEach((pos, i) => {
      const size = CAVE_SIZE;
      const cells = new Uint8Array(size * size);
      // 醉汉游走雕刻洞窟
      let cx = 15;
      let cy = 25;
      const carve = (x: number, y: number) => {
        if (x >= 2 && y >= 2 && x < size - 2 && y < size - 2) cells[y * size + x] = 1;
      };
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) carve(15 + dx, 25 + dy);
      let carved = 9;
      while (carved < 330) {
        const r = crng();
        if (r < 0.34) cy--; // 向上偏置，洞窟向深处延伸
        else if (r < 0.52) cy++;
        else if (r < 0.76) cx--;
        else cx++;
        cx = Math.max(3, Math.min(size - 4, cx));
        cy = Math.max(3, Math.min(size - 4, cy));
        if (!cells[cy * size + cx]) carved++;
        carve(cx, cy);
        if (crng() < 0.4) {
          const nx = cx + (crng() < 0.5 ? 1 : -1);
          if (!cells[cy * size + nx]) carved++;
          carve(nx, cy);
        }
      }

      const ox = 20 + i * 70;
      const oy = MAP + 16;
      const cave: CaveDef = {
        id: i, ex: pos.x, ey: pos.y, ox, oy, cells,
        exitX: ox + 15.5, exitY: oy + 25.5,
      };
      this.caves.push(cave);
      this.buildCaveScene(cave, crng);

      // 地表入口外观
      const e = new Container();
      const eg = new Graphics();
      eg.ellipse(0, 6, 17, 7).fill({ color: 0x000000, alpha: 0.3 });
      eg.ellipse(0, -3, 17, 13).fill(0x6e6e66); // 石丘
      eg.ellipse(0, -3, 17, 13).stroke({ width: 2, color: 0x55554e });
      eg.circle(-13, -8, 4.5).fill(0x7a7a72);
      eg.circle(13, -7, 4).fill(0x7a7a72);
      eg.ellipse(0, 1, 9, 7.5).fill(0x0d0a08); // 黑暗洞口
      eg.ellipse(0, -2, 7, 5).fill(0x080605);
      e.addChild(eg);
      e.position.set(cave.ex * SCALE, cave.ey * SCALE);
      e.zIndex = cave.ey;
      this.objects.addChild(e);
    });
  }

  /** 洞穴内部：地面/岩壁/碰撞体/出口光柱/宝箱/水晶/蝙蝠 */
  private buildCaveScene(cave: CaveDef, crng: () => number): void {
    const size = CAVE_SIZE;
    const g = new Graphics();
    // 大幅外扩的黑色背景板，保证洞内任何视角都看不到外面的海
    g.rect(-30 * SCALE, -30 * SCALE, (size + 60) * SCALE, (size + 60) * SCALE).fill(0x120e0b);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (cells(x, y)) {
          const j = tileJitter(x + cave.id * 97, y, this.seed ^ 0xca7e);
          const base = 0x39322c;
          const c = j < 0.33 ? 0x342e28 : j < 0.66 ? base : 0x3e3630;
          g.rect(x * SCALE, y * SCALE, SCALE, SCALE).fill(c);
          if (j > 0.9) g.circle(x * SCALE + 8 + j * 14, y * SCALE + 10, 2).fill(0x2a2520);
        } else if (nearFloor(x, y)) {
          // 岩壁
          g.rect(x * SCALE, y * SCALE, SCALE, SCALE).fill(0x221d19);
          g.rect(x * SCALE, y * SCALE, SCALE, 6).fill(0x2c2620);
        }
      }
    }
    g.position.set(cave.ox * SCALE, cave.oy * SCALE);
    this.renderer.container.addChild(g);

    function cells(x: number, y: number): boolean {
      return x >= 0 && y >= 0 && x < size && y < size && cave.cells[y * size + x] === 1;
    }
    function nearFloor(x: number, y: number): boolean {
      return cells(x + 1, y) || cells(x - 1, y) || cells(x, y + 1) || cells(x, y - 1) ||
        cells(x + 1, y + 1) || cells(x - 1, y - 1) || cells(x + 1, y - 1) || cells(x - 1, y + 1);
    }

    // 岩壁碰撞体
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!cells(x, y) && (cells(x + 1, y) || cells(x - 1, y) || cells(x, y + 1) || cells(x, y - 1))) {
          this.physWorld.createCollider(
            RAPIER.ColliderDesc.cuboid(0.5, 0.5)
              .setTranslation(cave.ox + x + 0.5, cave.oy + y + 0.5)
              .setCollisionGroups(GROUPS.STATIC),
          );
        }
      }
    }

    // 出口光柱
    const exitG = new Graphics();
    exitG.poly([-14, -46, 14, -46, 22, 6, -22, 6]).fill({ color: 0xfff2c8, alpha: 0.13 });
    exitG.ellipse(0, 4, 20, 8).fill({ color: 0xfff2c8, alpha: 0.22 });
    exitG.position.set(cave.exitX * SCALE, cave.exitY * SCALE);
    exitG.zIndex = cave.exitY - 5;
    this.objects.addChild(exitG);

    // 收集远离入口的地面格
    const farCells: { x: number; y: number; d: number }[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!cells(x, y)) continue;
        const d = Math.hypot(x - 15, y - 25);
        farCells.push({ x, y, d });
      }
    }
    farCells.sort((a, b) => b.d - a.d);

    const used: { x: number; y: number }[] = [];
    const pick = (minD: number, fromTop: number): { x: number; y: number } | null => {
      for (let t = 0; t < 80; t++) {
        const c = farCells[Math.floor(crng() * Math.min(farCells.length, fromTop))];
        if (c.d < minD) continue;
        if (used.every((u) => Math.hypot(u.x - c.x, u.y - c.y) > 4)) {
          used.push(c);
          return c;
        }
      }
      return null;
    };

    // 宝箱 ×3（随机三种货币）
    for (let n = 0; n < 3; n++) {
      const c = pick(n === 0 ? 12 : 7, n === 0 ? 25 : 120);
      if (!c) continue;
      const id = cave.id * 100 + n;
      const chest: CaveChest = {
        id, caveId: cave.id,
        x: cave.ox + c.x + 0.5, y: cave.oy + c.y + 0.5,
        opened: this.openedChests.has(id),
        g: new Graphics(),
      };
      this.drawChest(chest.g, chest.opened);
      chest.g.position.set(chest.x * SCALE, chest.y * SCALE);
      chest.g.zIndex = chest.y;
      this.objects.addChild(chest.g);
      this.caveChests.push(chest);
    }

    // 水晶矿脉 ×2（敲碎掉钻石）
    for (let n = 0; n < 2; n++) {
      const c = pick(6, 150);
      if (!c) continue;
      const id = 1_000_000 + cave.id * 100 + n;
      if (this.removedNodes.has(id)) continue;
      const nx = cave.ox + c.x + 0.5;
      const ny = cave.oy + c.y + 0.5;
      const root = new Container();
      const cg = new Graphics();
      cg.circle(0, -4, 16).fill({ color: 0x6ee0ff, alpha: 0.1 }); // 微光
      cg.poly([-9, 4, -12, -8, -5, -14, -3, 4]).fill(0x7ad8e8);
      cg.poly([-2, 4, 0, -18, 7, -10, 6, 4]).fill(0x9a8af0);
      cg.poly([5, 4, 11, -7, 14, 0, 12, 4]).fill(0x6ec6e0);
      cg.ellipse(0, 5, 13, 4).fill({ color: 0x000000, alpha: 0.3 });
      root.addChild(cg);
      root.position.set(nx * SCALE, ny * SCALE);
      root.zIndex = ny;
      this.objects.addChild(root);
      const collider = this.physWorld.createCollider(
        RAPIER.ColliderDesc.ball(0.35).setTranslation(nx, ny).setCollisionGroups(GROUPS.STATIC),
      );
      this.nodes.push({
        id, kind: 'crystal', x: nx, y: ny, hp: 4, alive: true,
        berries: false, regrowT: 0, wobbleT: 0, root, berriesG: null, collider,
      });
    }

    // 蝙蝠 ×4
    for (let n = 0; n < 4; n++) {
      const c = pick(5, 200);
      if (c) this.caveBatSpawns.push({ x: cave.ox + c.x + 0.5, y: cave.oy + c.y + 0.5 });
    }
  }

  private drawChest(g: Graphics, opened: boolean): void {
    g.clear();
    g.ellipse(0, 7, 14, 5).fill({ color: 0x000000, alpha: 0.3 });
    if (!opened) {
      g.circle(0, -2, 18).fill({ color: 0xffd24a, alpha: 0.08 }); // 微光
      g.roundRect(-12, -10, 24, 18, 3).fill(0x8a5a2a);
      g.roundRect(-12, -10, 24, 7, 3).fill(0xa06a34); // 箱盖
      g.rect(-12, -3.5, 24, 2.5).fill(0xd8b050); // 金箍
      g.rect(-2.5, -5, 5, 7).fill(0xd8b050); // 锁扣
      g.circle(0, -1, 1.6).fill(0x6a4a1a);
    } else {
      g.roundRect(-12, -8, 24, 16, 3).fill(0x6a4520);
      g.roundRect(-13, -16, 26, 9, 3).fill(0x8a5a2a); // 掀开的盖子
      g.rect(-10, -6, 20, 11).fill(0x241a10); // 空箱内部
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
    this.updateWeather(dtRaw);
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
    // 洞穴内：出口 / 宝箱
    if (this.inCave !== null) {
      const cave = this.caves[this.inCave];
      const nearExit = Math.hypot(cave.exitX - p.x, cave.exitY - p.y) < 1.7;
      let nearChest: CaveChest | null = null;
      if (!nearExit) {
        for (const ch of this.caveChests) {
          if (!ch.opened && ch.caveId === cave.id && Math.hypot(ch.x - p.x, ch.y - p.y) < 1.5) {
            nearChest = ch;
            break;
          }
        }
      }
      if (nearExit) hud.showPrompt('<kbd>E</kbd> 离开洞穴');
      else if (nearChest) hud.showPrompt('<kbd>E</kbd> 开启宝箱');
      else hud.showPrompt(null);
      if (this.input.wasPressed('KeyE')) {
        if (nearExit) this.exitCave();
        else if (nearChest) this.openChest(nearChest);
      }
      return;
    }

    let nearCf: Campfire | null = null;
    for (const cf of this.campfires) {
      if (Math.hypot(cf.x - p.x, cf.y - p.y) < 1.8) {
        nearCf = cf;
        break;
      }
    }
    let nearCave: CaveDef | null = null;
    if (!nearCf) {
      for (const c of this.caves) {
        if (Math.hypot(c.ex - p.x, c.ey - p.y) < 1.7) {
          nearCave = c;
          break;
        }
      }
    }
    let nearBush: WNode | null = null;
    if (!nearCf && !nearCave) {
      for (const n of this.nodes) {
        if (n.alive && n.kind === 'bush' && n.berries && Math.hypot(n.x - p.x, n.y - p.y) < 1.4) {
          nearBush = n;
          break;
        }
      }
    }

    if (nearCf) {
      hud.showPrompt('<kbd>E</kbd> 篝火 — 休息 · 保存 · 强化');
    } else if (nearCave) {
      hud.showPrompt('<kbd>E</kbd> 进入洞穴');
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
      } else if (nearCave) {
        this.enterCave(nearCave.id);
      } else if (nearBush) {
        this.harvestBush(nearBush);
      }
    }
  }

  enterCave(id: number): void {
    const cave = this.caves[id];
    if (!cave) return;
    this.inCave = id;
    this.player.teleport(cave.exitX, cave.exitY - 0.6);
    this.camX = this.player.x;
    this.camY = this.player.y;
    hud.setCaveOverlay(true);
    hud.toast('🕳️ 你走进幽暗的洞穴…');
    sfx.cave();
    this.addShake(0.15);
  }

  exitCave(): void {
    if (this.inCave === null) return;
    const cave = this.caves[this.inCave];
    this.inCave = null;
    this.player.teleport(cave.ex, cave.ey + 1.2);
    this.camX = this.player.x;
    this.camY = this.player.y;
    hud.setCaveOverlay(false);
    sfx.cave();
  }

  private openChest(ch: CaveChest): void {
    ch.opened = true;
    this.openedChests.add(ch.id);
    this.drawChest(ch.g, true);
    // 随机三种货币
    const silver = 10 + Math.floor(Math.random() * 15);
    const gold = 3 + Math.floor(Math.random() * 7);
    const diamond = Math.random() < 0.65 ? 1 + Math.floor(Math.random() * 3) : 0;
    this.drops.spawn('silver', ch.x, ch.y - 0.3, silver);
    this.drops.spawn('gold', ch.x, ch.y - 0.3, gold);
    if (diamond > 0) this.drops.spawn('diamond', ch.x, ch.y - 0.3, diamond);
    this.floats.show(ch.x, ch.y - 1, '宝藏!', 0xffd24a, 18);
    this.particles.burst(ch.x, ch.y - 0.4, { color: 0xffd24a, count: 16, speed: 3, life: 0.7, size: 3 });
    sfx.chest();
    this.addShake(0.12);
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
    hud.setClock(
      this.rainIntensity > 0.5 ? '🌧️' : sun > 0.3 ? '☀️' : sun > -0.3 ? (dayT < 0.5 ? '🌅' : '🌄') : '🌙',
    );
  }

  private updateWeather(dt: number): void {
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      if (this.weather === 'clear') {
        this.weather = 'rain';
        this.weatherT = 35 + Math.random() * 45; // 雨持续 35~80 秒
        hud.toast('🌧️ 下雨了——脚步变得沉重');
      } else {
        this.weather = 'clear';
        this.weatherT = 80 + Math.random() * 110; // 晴 80~190 秒
      }
    }
    // 雨强渐变
    const target = this.weather === 'rain' ? 1 : 0;
    const delta = target - this.rainIntensity;
    this.rainIntensity += Math.sign(delta) * Math.min(Math.abs(delta), dt * 0.35);
    // 洞穴内：听得见闷闷的雨声，但看不到雨
    const inCave = this.inCave !== null;
    hud.setWeatherDim(inCave ? 0 : this.rainIntensity * 0.24);
    sfx.setRain(this.rainIntensity * (inCave ? 0.35 : 1));

    // 雨幕粒子（屏幕空间）
    if (this.rainIntensity > 0.02 && !inCave) {
      if (this.rainDrops.length === 0) {
        for (let i = 0; i < 130; i++) {
          const g = new Graphics();
          g.moveTo(0, 0).lineTo(-4, 17).stroke({ width: 1.4, color: 0xa8c8e0, alpha: 0.75 });
          g.position.set(Math.random() * (this.app.screen.width + 240) - 120, Math.random() * this.app.screen.height);
          this.rainC.addChild(g);
          this.rainDrops.push({ g, spd: 680 + Math.random() * 380 });
        }
      }
      this.rainC.visible = true;
      this.rainC.alpha = this.rainIntensity * 0.75;
      const h = this.app.screen.height;
      const w = this.app.screen.width;
      for (const d of this.rainDrops) {
        d.g.y += d.spd * dt;
        d.g.x -= d.spd * 0.24 * dt;
        if (d.g.y > h + 20) {
          d.g.y = -25 - Math.random() * 50;
          d.g.x = Math.random() * (w + 240) - 120;
        }
      }
    } else {
      this.rainC.visible = false;
    }
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
      // 洞穴内不揭迷雾，小地图玩家点固定在洞口
      const mx = this.inCave !== null ? this.caves[this.inCave].ex : this.player.x;
      const my = this.inCave !== null ? this.caves[this.inCave].ey : this.player.y;
      if (this.inCave === null) this.revealAround(this.player.x, this.player.y);
      hud.drawMinimap(this.worldData, mx, my, !this.bossDefeated);
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
    } else if (n.kind === 'crystal') {
      // 水晶矿脉：敲击出石块，有几率掉钻石；敲碎必出钻石
      this.drops.spawn('stone', n.x, n.y, 1);
      if (Math.random() < 0.45) this.drops.spawn('diamond', n.x, n.y - 0.2, 1);
      this.particles.burst(n.x, n.y - 0.4, { color: 0x7ad8e8, count: 7, speed: 2.5, life: 0.5, size: 2.5 });
      sfx.hit();
      n.hp--;
      if (n.hp <= 0) {
        n.alive = false;
        this.removedNodes.add(n.id);
        this.drops.spawn('diamond', n.x, n.y, 1 + (Math.random() < 0.4 ? 1 : 0));
        this.particles.burst(n.x, n.y - 0.4, { color: 0x9a8af0, count: 14, speed: 3.2, life: 0.65, size: 3.5 });
        this.addShake(0.15);
        if (n.collider) {
          this.physWorld.removeCollider(n.collider, true);
          n.collider = null;
        }
      }
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
    this.inCave = null;
    hud.setCaveOverlay(false);
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
      version: 4,
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
      openedChests: [...this.openedChests],
      playTime: this.playTime,
    };
    writeSave(data);
  }
}
