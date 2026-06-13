// @author: zhjj
// 游戏主控：Rapier 物理世界 + 场景图 + 战斗结算 + 篝火存档 + 昼夜循环 + 镜头

import RAPIER from '@dimforge/rapier2d-compat';
import { Application, Container, Graphics } from 'pixi.js';
import {
  ARTIFACTS, DAY_LENGTH, GROUPS, MAP, SCALE, Tile, UPGRADES,
  GEAR_BY_ID, SKIN_BY_ID, TALENT_BY_ID, WEAPON_BY_ID, WEAPON_UPG,
  type ArtifactDef, type ResKind, type WeaponDef,
} from './defs';
import { Input } from './core/input';
import { sfx } from './core/audio';
import { packExplored, unpackExplored, writeSave, type SaveData } from './core/save';
import { generateWorld, type NodeKind, type WorldData } from './world/worldgen';
import { WorldRenderer } from './world/worldrender';
import { Particles, FloatTexts } from './fx';
import { Player } from './entities/player';
import { Animal } from './entities/animals';
import { Monkey } from './entities/monkey';
import { hasHiddenMonkey, pickStolenItem, stolenItemLabel } from './entities/monkey-logic';
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
  monkeyHidden: boolean;
  monkeyTriggered: boolean;
  monkeyTail: Graphics | null;
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
  treasure: boolean; // 宝藏洞穴：无动物、宝箱更多更肥（低概率）
  carved: number; // 洞窟实际大小（决定宝箱数量）
}

interface CaveChest {
  id: number;
  caveId: number;
  x: number;
  y: number;
  opened: boolean;
  g: Graphics;
}

/** 神器祝福降临点：天降白色光柱，按 E 接受祝福 */
interface BlessingSite {
  x: number;
  y: number;
  root: Container;
  beam: Graphics;
  orb: Graphics;
  pulse: Graphics;
  t: number;
}

/** 冥火（阿比努斯的权杖）：聚集 → 爆发灼烧 → 余焰 */
interface NetherFire {
  x: number;
  y: number;
  t: number;
  aoeR: number;
  dmg: number;
  knock: number;
  exploded: boolean;
  g: Graphics;
}

/** 天降闪电（宙斯的雷霆神矛）：劈在落点，雨天为大型闪电 */
interface Lightning {
  x: number;
  y: number;
  t: number;
  life: number;
  big: boolean;
  pts: number[]; // 折线点（武器/世界本地像素坐标，y 向上为负）
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
  monkeys: Monkey[] = [];
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
  private caveAnimalSpawns: { kind: string; x: number; y: number }[] = [];

  // 神器祝福
  private blessing: BlessingSite | null = null;
  private blessingCd = 45 + Math.random() * 45; // 距下一道神光降临的秒数
  private pendingArtifact: ArtifactDef | null = null;
  private blessingGuardians: Animal[] = []; // 神器守卫：环绕光柱的狂暴野兽
  private netherFires: NetherFire[] = [];
  private lightnings: Lightning[] = []; // 天降闪电特效

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
  private menuKind: 'campfire' | 'shop' | 'blessing' | null = null;
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
      this.player.relics = new Set(p.relics ?? []);
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
    for (const b of this.caveAnimalSpawns) {
      this.spawnRecords.push({ kind: b.kind, x: b.x, y: b.y, animal: null, deadAt: -999 });
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
        RAPIER.ColliderDesc.cuboid(hx, hy).setTranslation(cx, cy).setCollisionGroups(GROUPS.WALL),
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
      const monkeyHidden = nd.kind === 'tree' && hasHiddenMonkey(this.worldData.seed, nd.id);
      const monkeyTail = monkeyHidden ? this.drawMonkeyTail(root, scale, nd.id) : null;
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
        monkeyHidden,
        monkeyTriggered: false,
        monkeyTail,
      });
    }
  }

  private drawMonkeyTail(root: Container, scale: number, nodeId: number): Graphics {
    const tail = new Graphics();
    const side = nodeId % 2 === 0 ? 1 : -1;
    tail.moveTo(side * 8, -18)
      .bezierCurveTo(side * 20, -17, side * 21, -3, side * 13, 0)
      .stroke({ color: 0x754526, width: 5, cap: 'round' });
    tail.circle(side * 13, 0, 2.5).fill(0x8b5832);
    tail.scale.set(scale);
    tail.pivot.set(side * 8, -18);
    tail.position.set(side * 8 * scale, -18 * scale);
    root.addChild(tail);
    return tail;
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
      // 宝藏洞穴（低概率）：小而无兽，宝箱密集
      const treasure = crng() < 0.18;
      // 洞窟大小带随机性，决定宝箱数量
      const target = treasure ? 220 : 250 + Math.floor(crng() * 160);
      // 醉汉游走雕刻洞窟
      let cx = 15;
      let cy = 25;
      const carve = (x: number, y: number) => {
        if (x >= 2 && y >= 2 && x < size - 2 && y < size - 2) cells[y * size + x] = 1;
      };
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) carve(15 + dx, 25 + dy);
      let carved = 9;
      while (carved < target) {
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
      // 洞穴背景向上外扩 30 格，内部至少下移 32 格以免覆盖主地图底边。
      const oy = MAP + 32;
      const cave: CaveDef = {
        id: i, ex: pos.x, ey: pos.y, ox, oy, cells,
        exitX: ox + 15.5, exitY: oy + 25.5,
        treasure, carved,
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
          // 宝藏洞穴：地面散落金砂微光
          if (cave.treasure && j > 0.78 && j <= 0.9) {
            g.circle(x * SCALE + 6 + j * 20, y * SCALE + 14, 1.5).fill({ color: 0xffd24a, alpha: 0.7 });
          }
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
              .setCollisionGroups(GROUPS.WALL),
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

    // 宝箱数量：宝藏洞穴 5~6 个；普通洞穴按洞窟大小 1~3 个（带随机性）
    let chestCount: number;
    if (cave.treasure) {
      chestCount = 5 + Math.floor(crng() * 2);
    } else {
      chestCount = Math.round(cave.carved / 170) + (crng() < 0.3 ? 1 : 0) - (crng() < 0.3 ? 1 : 0);
      chestCount = Math.max(1, Math.min(3, chestCount));
    }
    for (let n = 0; n < chestCount; n++) {
      const c = pick(n === 0 ? 12 : 6, n === 0 ? 25 : 140);
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

    // 水晶矿脉（敲碎掉钻石）：宝藏洞穴 3 处，普通 2 处
    for (let n = 0; n < (cave.treasure ? 3 : 2); n++) {
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
        monkeyHidden: false, monkeyTriggered: false, monkeyTail: null,
      });
    }

    // 守卫（宝藏洞穴没有动物）：吸血蝙蝠 ×3 + 妖狐 ×2
    if (!cave.treasure) {
      for (let n = 0; n < 3; n++) {
        const c = pick(5, 200);
        if (c) this.caveAnimalSpawns.push({ kind: 'bat', x: cave.ox + c.x + 0.5, y: cave.oy + c.y + 0.5 });
      }
      for (let n = 0; n < 2; n++) {
        const c = pick(7, 160);
        if (c) this.caveAnimalSpawns.push({ kind: 'fox', x: cave.ox + c.x + 0.5, y: cave.oy + c.y + 0.5 });
      }
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

  /** 随游戏时长的成长系数：每分钟 +2%，上限 +150%（动物出生时快照） */
  get growthFactor(): number {
    return 1 + Math.min((this.playTime / 60) * 0.02, 1.5);
  }

  private spawnAnimal(idx: number): void {
    const r = this.spawnRecords[idx];
    const a = new Animal(this.physWorld, r.kind as never, r.x, r.y, idx, G_ANIMAL, this.growthFactor);
    this.objects.addChild(a.root);
    this.animals.push(a);
    r.animal = a;
  }

  private regenerateAnimals(): void {
    for (const a of this.animals) a.destroy(this);
    for (const monkey of this.monkeys) monkey.destroy(this);
    this.animals = [];
    this.monkeys = [];
    this.blessingGuardians = [];
    for (const r of this.spawnRecords) {
      r.animal = null;
      r.deadAt = -999;
    }
    this.spawnAllAnimals();
    // 若光柱仍在，重新布下守卫（避免死亡后白嫖神器）
    if (this.blessing) this.spawnBlessingGuardians(this.blessing.x, this.blessing.y);
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
      if (this.menuKind === 'blessing') return; // 祝福仪式不可中断
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
      this.updateTreeMonkeys();
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
    for (const monkey of this.monkeys) monkey.update(dt, this);
    this.monkeys = this.monkeys.filter((monkey) => !monkey.removed);

    // 物理步进
    this.physWorld.timestep = Math.max(dt, 1 / 240);
    this.physWorld.step();

    this.projectiles.update(dt, this);
    this.drops.update(dt, this);
    this.particles.update(dt);
    this.floats.update(dt);
    this.updateNetherFires(dt);
    this.updateLightnings(dt);
    this.updateBlessing(dt);
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
      if (n.monkeyTail?.visible) {
        n.monkeyTail.rotation = Math.sin(this.time * 3 + n.id) * 0.12;
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

  private updateTreeMonkeys(): void {
    for (const n of this.nodes) {
      if (!n.alive || !n.monkeyHidden || n.monkeyTriggered) continue;
      if (Math.hypot(n.x - this.player.x, n.y - this.player.y) > 0.78) continue;
      n.monkeyTriggered = true;
      if (n.monkeyTail) n.monkeyTail.visible = false;

      const stolen = pickStolenItem(this.player.monkeyInventory());
      if (stolen) {
        this.player.changeMonkeyItem(stolen, -1);
        this.floats.show(
          this.player.x,
          this.player.y - 0.9,
          `猴子偷走了 ${stolenItemLabel(stolen.kind)} x${stolen.amount}!`,
          0xff9b52,
          15,
        );
      } else {
        this.floats.show(this.player.x, this.player.y - 0.9, '猴子什么也没偷到!', 0xffcf80, 14);
      }

      let dx = n.x - this.player.x;
      let dy = n.y - this.player.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const monkey = new Monkey(
        this.physWorld,
        n.x + dx * 0.85,
        n.y + dy * 0.85,
        this.player.x,
        this.player.y,
        stolen,
      );
      this.objects.addChild(monkey.root);
      this.monkeys.push(monkey);
      this.particles.burst(n.x, n.y - 0.6, { color: 0x7a4a28, count: 8, speed: 2.5, life: 0.45, size: 2.5 });
    }
  }

  combatTargets(): Array<Animal | Monkey> {
    return [...this.animals, ...this.monkeys];
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
    // 神器祝福光柱
    const nearBless =
      !nearCf && !nearCave && this.blessing !== null &&
      Math.hypot(this.blessing.x - p.x, this.blessing.y - p.y) < 2.0;
    let nearBush: WNode | null = null;
    if (!nearCf && !nearCave && !nearBless) {
      for (const n of this.nodes) {
        if (n.alive && n.kind === 'bush' && n.berries && Math.hypot(n.x - p.x, n.y - p.y) < 1.4) {
          nearBush = n;
          break;
        }
      }
    }

    if (nearCf) {
      hud.showPrompt('<kbd>E</kbd> 篝火 — 保存 · 强化 · 商店');
    } else if (nearCave) {
      hud.showPrompt('<kbd>E</kbd> 进入洞穴');
    } else if (nearBless) {
      hud.showPrompt('<kbd>E</kbd> 沐浴圣光 — 接受神器祝福');
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
      } else if (nearBless) {
        this.startBlessing();
      } else if (nearBush) {
        this.harvestBush(nearBush);
      }
    }
  }

  // ---------------- 神器祝福 ----------------

  /** 尚未拥有的神器 */
  private remainingArtifacts(): ArtifactDef[] {
    return ARTIFACTS.filter((a) =>
      a.slot === 'weapon' ? !this.player.weapons.includes(a.id) : !this.player.relics.has(a.id),
    );
  }

  private updateBlessing(dt: number): void {
    if (!this.blessing) {
      if (this.remainingArtifacts().length === 0) return; // 神器集齐，神光不再降临
      this.blessingCd -= dt;
      if (this.blessingCd <= 0) this.spawnBlessing();
      return;
    }
    const b = this.blessing;
    b.t += dt;
    // 光柱呼吸 + 圣辉光珠浮动
    b.beam.alpha = 0.8 + Math.sin(b.t * 2.1) * 0.2;
    b.orb.y = -38 + Math.sin(b.t * 1.7) * 5;
    b.orb.rotation = b.t * 0.8;
    // 地面扩散光环
    const pt = (b.t % 1.5) / 1.5;
    b.pulse.scale.set(0.3 + pt * 1.1);
    b.pulse.alpha = (1 - pt) * 0.5;
    // 升腾的光尘（仅玩家附近时发射）
    if (Math.abs(b.x - this.player.x) + Math.abs(b.y - this.player.y) < 45 && Math.random() < dt * 7) {
      this.particles.burst(b.x + (Math.random() - 0.5) * 1.6, b.y - Math.random() * 0.8, {
        color: Math.random() < 0.6 ? 0xfffbe8 : 0xffe9a0, count: 1, speed: 0.7, life: 1.0, size: 2.2, alpha: 0.9,
      });
    }
  }

  /** 在随机岛屿陆地上降下神光 */
  private spawnBlessing(): void {
    const w = this.worldData;
    let pos: { x: number; y: number } | null = null;
    for (let attempt = 0; attempt < 80 && !pos; attempt++) {
      const isle = w.isles[Math.floor(Math.random() * w.isles.length)];
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * isle.r * 0.7;
      const x = isle.x + Math.cos(a) * r;
      const y = isle.y + Math.sin(a) * r;
      if (!w.isWalkable(x, y)) continue;
      if (Math.hypot(x - w.bossPos.x, y - w.bossPos.y) < 14) continue;
      if (w.campfires.some((f) => Math.hypot(f.x - x, f.y - y) < 5)) continue;
      if (this.caves.some((c) => Math.hypot(c.ex - x, c.ey - y) < 5)) continue;
      if (Math.hypot(x - this.player.x, y - this.player.y) < 18) continue;
      pos = { x, y };
    }
    if (!pos) {
      this.blessingCd = 20; // 没找到落点，稍后再试
      return;
    }

    const root = new Container();
    root.position.set(pos.x * SCALE, pos.y * SCALE);
    root.zIndex = pos.y;

    // 斜上方天空洒下的白色光柱（多层加色混合）
    const beam = new Graphics();
    beam.poly([-15, 0, 15, 0, 175, -660, 95, -680]).fill({ color: 0xfff6dc, alpha: 0.1 });
    beam.poly([-10, 0, 10, 0, 160, -645, 110, -660]).fill({ color: 0xfffbe8, alpha: 0.14 });
    beam.poly([-4.5, 0, 4.5, 0, 142, -630, 122, -636]).fill({ color: 0xffffff, alpha: 0.3 });
    beam.blendMode = 'add';
    root.addChild(beam);

    // 地面光晕与扩散光环
    const glow = new Graphics();
    glow.ellipse(0, 2, 30, 12).fill({ color: 0xfff6dc, alpha: 0.3 });
    glow.ellipse(0, 2, 16, 6.5).fill({ color: 0xffffff, alpha: 0.4 });
    glow.blendMode = 'add';
    root.addChild(glow);
    const pulse = new Graphics();
    pulse.ellipse(0, 2, 30, 12).stroke({ width: 2.5, color: 0xfffbe8 });
    root.addChild(pulse);

    // 悬浮的圣辉光珠
    const orb = new Graphics();
    orb.circle(0, 0, 13).fill({ color: 0xfff6dc, alpha: 0.25 });
    orb.circle(0, 0, 7).fill({ color: 0xffffff, alpha: 0.9 });
    orb.moveTo(-17, 0).lineTo(17, 0).stroke({ width: 1.5, color: 0xfffbe8, alpha: 0.7 });
    orb.moveTo(0, -17).lineTo(0, 17).stroke({ width: 1.5, color: 0xfffbe8, alpha: 0.7 });
    orb.blendMode = 'add';
    orb.y = -38;
    root.addChild(orb);

    this.objects.addChild(root);
    this.blessing = { x: pos.x, y: pos.y, root, beam, orb, pulse, t: 0 };
    this.spawnBlessingGuardians(pos.x, pos.y);
    hud.toast('✨ 一道圣光自天而降，却有狂暴的野兽在守护它…（小地图已标记）', 3600);
    sfx.reveal();
  }

  /** 在光柱四周生成一圈狂暴守卫（身体发红、攻击与移动更快） */
  private spawnBlessingGuardians(cx: number, cy: number): void {
    const w = this.worldData;
    const pool = ['wolf', 'boar', 'tiger', 'snake', 'goat'] as const;
    const count = 6 + Math.floor(Math.random() * 4); // 6~9 只
    for (let n = 0; n < count; n++) {
      const ang = (n / count) * Math.PI * 2 + Math.random() * 0.6;
      const r = 2.6 + Math.random() * 3.6;
      let x = cx + Math.cos(ang) * r;
      let y = cy + Math.sin(ang) * r;
      if (!w.isWalkable(x, y)) {
        x = cx + Math.cos(ang) * 2;
        y = cy + Math.sin(ang) * 2;
        if (!w.isWalkable(x, y)) continue;
      }
      const kind = pool[Math.floor(Math.random() * pool.length)];
      const a = new Animal(this.physWorld, kind as never, x, y, -1, G_ANIMAL, this.growthFactor, true);
      this.objects.addChild(a.root);
      this.animals.push(a);
      this.blessingGuardians.push(a);
    }
  }

  /** 按 E：开始祝福仪式（世界冻结，播放抽取动画） */
  private startBlessing(): void {
    const rem = this.remainingArtifacts();
    if (rem.length === 0) return;
    this.pendingArtifact = rem[Math.floor(Math.random() * rem.length)];
    this.menuOpen = true;
    this.menuKind = 'blessing';
    sfx.blessing();
    hud.showBlessingCeremony(this.pendingArtifact, () => sfx.reveal());
  }

  /** 祝福仪式「接受」按钮：发放神器 */
  acceptBlessing(): void {
    const art = this.pendingArtifact;
    if (!art) return;
    this.pendingArtifact = null;
    const p = this.player;
    if (art.slot === 'weapon') {
      if (!p.weapons.includes(art.id)) p.weapons.push(art.id);
      p.weaponIdx = p.weapons.indexOf(art.id); // 立即装备
      p.drawWeapon();
      hud.buildHotbar(p.weapons, p.weaponIdx);
    } else {
      p.relics.add(art.id);
    }
    if (this.blessing) {
      this.objects.removeChild(this.blessing.root);
      this.blessing.root.destroy({ children: true });
      this.blessing = null;
    }
    // 圣光驱散残余守卫
    for (const a of this.blessingGuardians) {
      if (!a.dead) {
        this.particles.burst(a.x, a.y - 0.3, { color: 0xfff0c0, count: 8, speed: 2.2, life: 0.5, size: 2.5, alpha: 0.9 });
        a.destroy(this);
      }
    }
    this.blessingGuardians = [];
    this.blessingCd = 150 + Math.random() * 120; // 下一道神光
    this.menuOpen = false;
    this.menuKind = null;
    hud.hideBlessing();
    hud.toast(`${art.icon} 获得神器「${art.name}」！`);
    this.particles.burst(p.x, p.y - 0.4, { color: 0xfff0c0, count: 18, speed: 3, life: 0.8, size: 3 });
    sfx.upgrade();
  }

  // ---------------- 冥火（阿比努斯的权杖） ----------------

  /** 在目标点召唤冥火：短暂聚集后爆发，灼烧范围内的动物 */
  castNetherFire(x: number, y: number, dmg: number, aoeR: number, knock: number): void {
    const g = new Graphics();
    g.position.set(x * SCALE, y * SCALE);
    g.zIndex = y;
    this.objects.addChild(g);
    this.netherFires.push({ x, y, t: 0, aoeR, dmg, knock, exploded: false, g });
  }

  private updateNetherFires(dt: number): void {
    const DELAY = 0.22; // 法阵聚集时间
    const DUR = 0.95; // 总时长
    for (let i = this.netherFires.length - 1; i >= 0; i--) {
      const f = this.netherFires[i];
      f.t += dt;
      if (f.t >= DUR) {
        this.objects.removeChild(f.g);
        f.g.destroy();
        this.netherFires.splice(i, 1);
        continue;
      }
      if (!f.exploded && f.t >= DELAY) {
        f.exploded = true;
        // 爆发：动物保留高飞/吸附过滤，猴子只承受即时伤害
        for (const target of this.combatTargets()) {
          if (target.dead) continue;
          if (target.targetType === 'animal' && (target.latched || target.def.meleeImmune)) continue;
          if (Math.hypot(target.x - f.x, target.y - f.y) > f.aoeR + target.radius) continue;
          const kd = Math.atan2(target.y - f.y, target.x - f.x);
          target.damage(
            f.dmg * (0.9 + Math.random() * 0.2),
            Math.cos(kd) * f.knock,
            Math.sin(kd) * f.knock,
            this,
          );
          if (target.targetType === 'animal' && !target.dead) target.burnT = Math.max(target.burnT, 3);
        }
        this.particles.burst(f.x, f.y - 0.2, { color: 0x4ae0a0, count: 14, speed: 3.2, life: 0.6, size: 3 });
        this.particles.burst(f.x, f.y - 0.3, { color: 0x7af0c8, count: 8, speed: 2.2, life: 0.5, size: 2.5 });
        this.addShake(0.16);
        sfx.hit();
      }
      // 绘制：聚集阶段的冥界法阵 → 爆发后的冥火火柱
      const g = f.g;
      g.clear();
      const R = f.aoeR * SCALE;
      if (f.t < DELAY) {
        const k = f.t / DELAY;
        g.ellipse(0, 0, R * k, R * k * 0.5).stroke({ width: 2.5, color: 0x8a5aff, alpha: 0.8 });
        g.ellipse(0, 0, R * k * 0.55, R * k * 0.28).stroke({ width: 1.5, color: 0x7af0c8, alpha: 0.9 });
        g.circle(0, 0, 3 + k * 4).fill({ color: 0x4ae0a0, alpha: 0.8 });
      } else {
        const k = (f.t - DELAY) / (DUR - DELAY); // 0..1 爆发进度
        const fade = 1 - k;
        // 焦土法阵
        g.ellipse(0, 0, R, R * 0.5).fill({ color: 0x1a3a2e, alpha: 0.35 * fade });
        g.ellipse(0, 0, R, R * 0.5).stroke({ width: 2, color: 0x4ae0a0, alpha: 0.6 * fade });
        // 三簇跳动的冥火
        for (let n = 0; n < 3; n++) {
          const ox = (n - 1) * R * 0.5;
          const oy = (n % 2 === 0 ? 1 : -1) * R * 0.14;
          const h = (26 + Math.sin(this.time * 16 + n * 2.4) * 6) * (0.55 + 0.45 * fade) * (n === 1 ? 1.5 : 1);
          const w2 = 7 * (n === 1 ? 1.4 : 1);
          g.poly([ox - w2, oy, ox - w2 * 0.3, oy - h * 0.55, ox, oy - h, ox + w2 * 0.3, oy - h * 0.5, ox + w2, oy])
            .fill({ color: 0x2a8a6a, alpha: 0.85 * fade });
          g.poly([ox - w2 * 0.55, oy, ox, oy - h * 0.62, ox + w2 * 0.55, oy])
            .fill({ color: 0x4ae0a0, alpha: 0.9 * fade });
          g.poly([ox - w2 * 0.26, oy, ox, oy - h * 0.34, ox + w2 * 0.26, oy])
            .fill({ color: 0xb8ffe0, alpha: 0.9 * fade });
        }
      }
    }
  }

  // ---------------- 天降闪电（宙斯的雷霆神矛） ----------------

  /** 在落点劈下闪电：小型（晴）/ 大型（雨）；立即结算范围伤害 + 视觉 */
  castLightning(x: number, y: number, big: boolean): void {
    const dmg = big ? 38 : 18;
    const radius = big ? 1.9 : 0.55; // 大型闪电带链式溅射
    for (const target of this.combatTargets()) {
      if (target.dead) continue;
      if (target.targetType === 'animal' && (target.latched || target.def.meleeImmune)) continue;
      if (Math.hypot(target.x - x, target.y - y) > radius + target.radius) continue;
      target.damage(dmg * (0.9 + Math.random() * 0.2), 0, 0, this); // 垂直雷击无水平击退
    }
    // 生成自天而降的锯齿闪电折线（世界本地像素坐标，y 向上为负）
    const h = big ? 18 : 12; // 向上延伸的世界高度
    const segs = big ? 7 : 5;
    const jitter = (big ? 1.8 : 0.55) * SCALE; // 大型闪电摆幅更大、更张扬
    const pts: number[] = [0, 0];
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      pts.push((Math.random() - 0.5) * jitter * (1 - f * 0.5), -h * SCALE * f);
    }
    const g = new Graphics();
    g.position.set(x * SCALE, y * SCALE);
    g.zIndex = y + 4; // 画在被击动物之上
    this.objects.addChild(g);
    this.lightnings.push({ x, y, t: 0, life: big ? 0.5 : 0.28, big, pts, g });
    this.particles.burst(x, y - 0.2, {
      color: big ? 0xfff3a0 : 0xffe24a, count: big ? 28 : 9, speed: big ? 5 : 2.6, life: big ? 0.6 : 0.5, size: big ? 4 : 3,
    });
    this.addShake(big ? 0.4 : 0.18);
    this.hitstop(big ? 0.05 : 0.025);
    sfx.thunder(big);
  }

  private updateLightnings(dt: number): void {
    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      const L = this.lightnings[i];
      L.t += dt;
      if (L.t >= L.life) {
        this.objects.removeChild(L.g);
        L.g.destroy();
        this.lightnings.splice(i, 1);
        continue;
      }
      const k = 1 - L.t / L.life; // 1→0 渐隐
      const flick = 0.55 + Math.random() * 0.45; // 电光闪烁
      const g = L.g;
      g.clear();
      // 落地辉光（大型闪电更大更亮）
      const fr = L.big ? 40 : 15;
      g.ellipse(0, 0, fr, fr * 0.45).fill({ color: 0xfff3a0, alpha: (L.big ? 0.5 : 0.4) * k });
      g.ellipse(0, 0, fr * 0.5, fr * 0.22).fill({ color: 0xffffff, alpha: 0.5 * k });
      // 折线：超宽外辉（仅大型）→ 金色辉光 → 炽白电芯
      const p = L.pts;
      const drawBolt = (width: number, color: number, alpha: number): void => {
        g.moveTo(p[0], p[1]);
        for (let j = 2; j < p.length; j += 2) g.lineTo(p[j], p[j + 1]);
        g.stroke({ width, color, alpha });
      };
      if (L.big) drawBolt(28, 0xffd24a, 0.22 * k * flick); // 大型：弥散的雷霆光晕
      drawBolt(L.big ? 16 : 5, 0xffe24a, 0.42 * k * flick);
      drawBolt(L.big ? 9 : 2.4, 0xfff3a0, 0.85 * k * flick);
      drawBolt(L.big ? 4.5 : 1.1, 0xfffdf0, 0.98 * k * flick);
    }
  }

  enterCave(id: number): void {
    const cave = this.caves[id];
    if (!cave) return;
    for (const a of this.animals) if (!a.dead) a.unlatch(this);
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
    for (const a of this.animals) if (!a.dead) a.unlatch(this);
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
    // 随机三种货币（宝藏洞穴更肥，钻石必出）
    const treasure = this.caves[ch.caveId]?.treasure ?? false;
    const silver = (treasure ? 16 : 10) + Math.floor(Math.random() * (treasure ? 16 : 15));
    const gold = (treasure ? 6 : 3) + Math.floor(Math.random() * (treasure ? 8 : 7));
    const diamond = treasure
      ? 2 + Math.floor(Math.random() * 3)
      : Math.random() < 0.65
        ? 1 + Math.floor(Math.random() * 3)
        : 0;
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
      hud.drawMinimap(this.worldData, mx, my, !this.bossDefeated, this.blessing);
    }

    // Boss 血条
    const bear = this.animals.find((a) => a.def.boss && !a.dead);
    if (bear && (bear.aggro || Math.hypot(bear.x - this.player.x, bear.y - this.player.y) < 15)) {
      hud.setBossBar(bear.hp / bear.maxHp);
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

  /** 该世界坐标是否为实心体（洞穴岩壁）——箭矢等投射物不可穿透 */
  isSolidAt(x: number, y: number): boolean {
    for (const c of this.caves) {
      const lx = Math.floor(x - c.ox);
      const ly = Math.floor(y - c.oy);
      if (lx >= 0 && ly >= 0 && lx < CAVE_SIZE && ly < CAVE_SIZE) {
        return c.cells[ly * CAVE_SIZE + lx] === 0; // 0 = 岩壁
      }
    }
    return false;
  }

  meleeStrike(player: Player, wd: WeaponDef): void {
    const dir = player.aim;
    let hitTarget = false;
    for (const target of this.combatTargets()) {
      if (target.dead) continue;
      if (target.targetType === 'animal' && (target.def.meleeImmune || target.latched)) continue;
      const dx = target.x - player.x;
      const dy = target.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > wd.range + target.radius) continue;
      let ang = Math.atan2(dy, dx) - dir;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      if (Math.abs(ang) > wd.arc / 2 + 0.3) continue;

      const crit = Math.random() < 0.1;
      const dmg = player.weaponDmg(wd) * (0.9 + Math.random() * 0.25) * (crit ? 1.7 : 1);
      const kdir = Math.atan2(dy, dx);
      target.damage(dmg, Math.cos(kdir) * wd.knock, Math.sin(kdir) * wd.knock, this);
      if (crit) this.floats.show(target.x, target.y - 1, '暴击!', 0xffd24a, 14);
      if (wd.flame && target.targetType === 'animal' && !target.dead) {
        target.burnT = Math.max(target.burnT, 3);
      }
      // 雷霆神矛：命中召唤天降闪电（洞外雨天升级为大型闪电）
      if (wd.thunder) {
        const big = this.inCave === null && this.rainIntensity > 0.5;
        this.castLightning(target.x, target.y, big);
      }
      hitTarget = true;
      this.hitstop(target.dead ? 0.09 : 0.035);
      if (target.dead) {
        this.addShake(0.22);
        if (player.hasTalent('vampire')) player.heal(4, this); // 嗜血：击杀回血
      }
    }
    if (hitTarget) sfx.hit();

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
    this.player.clearStatuses();
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
      // 只保存进度，不再恢复生命/耐力（回血靠进食、嗜血天赋与升级）
      if (this.activeCampfire) this.campfireId = this.activeCampfire.id;
      this.saveNow();
      sfx.save();
      hud.toast('💾 进度已保存 — 复活点设在这处篝火');
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
        relics: [...p.relics],
      },
      explored: packExplored(this.explored),
      openedChests: [...this.openedChests],
      playTime: this.playTime,
    };
    writeSave(data);
  }
}
