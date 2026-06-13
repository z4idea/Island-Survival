// @author: zhjj
// 程序化群岛生成：多岛屿高度场 + 生物群系 + 连通域 + 资源 / 篝火 / 动物分布
// Boss 随机出现在某座岛屿的山顶；篝火随机分布在各岛陆地上

import { MAP, MINIBOSSES, Tile, walkable, type AnimalKind } from '../defs';
import { Noise2D, mulberry32 } from '../utils/noise';

export type NodeKind = 'tree' | 'palm' | 'rock' | 'bush' | 'crystal'; // crystal 仅在洞穴内（game.ts 注入）

export interface NodeData {
  id: number;
  kind: NodeKind;
  x: number;
  y: number;
}

export interface CampfirePoint {
  id: number;
  x: number;
  y: number;
}

export interface SpawnPoint {
  kind: AnimalKind;
  x: number;
  y: number;
  miniBoss?: string; // 小 Boss id（精英化 + 专属掉落），见 defs.MINIBOSSES
}

export interface MiniBossSpot {
  id: string;
  x: number;
  y: number;
}

export interface Isle {
  x: number;
  y: number;
  r: number;
}

export class WorldData {
  tiles: Uint8Array = new Uint8Array(MAP * MAP);
  nodes: NodeData[] = [];
  campfires: CampfirePoint[] = [];
  spawns: SpawnPoint[] = [];
  miniBosses: MiniBossSpot[] = [];
  isles: Isle[] = [];
  bossPos = { x: MAP / 2, y: MAP / 2 };
  startCampfireId = 0;

  constructor(public seed: number) {}

  tile(x: number, y: number): Tile {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= MAP || iy >= MAP) return Tile.DeepWater;
    return this.tiles[iy * MAP + ix] as Tile;
  }

  isWalkable(x: number, y: number): boolean {
    return walkable(this.tile(x, y));
  }

  isWater(x: number, y: number): boolean {
    return this.tile(x, y) <= Tile.Water;
  }
}

export function generateWorld(seed: number): WorldData {
  const w = new WorldData(seed);
  const elev = new Noise2D(seed);
  const moist = new Noise2D(seed ^ 0x5f3759df);
  const rng = mulberry32(seed ^ 0x9e3779b9);

  // ---- 岛屿布局：1 座主岛 + 4~6 座小岛，位置随机 ----
  const isles: Isle[] = [];
  const main: Isle = {
    x: MAP / 2 + (rng() - 0.5) * 70,
    y: MAP / 2 + (rng() - 0.5) * 70,
    r: 62 + rng() * 10,
  };
  isles.push(main);
  const extraCount = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < extraCount; i++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const cand: Isle = {
        x: 38 + rng() * (MAP - 76),
        y: 38 + rng() * (MAP - 76),
        r: 22 + rng() * 18,
      };
      const ok = isles.every((o) => Math.hypot(o.x - cand.x, o.y - cand.y) > (o.r + cand.r) * 0.95);
      if (ok) {
        isles.push(cand);
        break;
      }
    }
  }
  w.isles = isles;

  // Boss 随机选一座岛（有小岛时优先小岛，需乘船远征）
  const bossIsle = isles.length > 1 ? isles[1 + Math.floor(rng() * (isles.length - 1))] : main;
  w.bossPos = { x: Math.round(bossIsle.x) + 0.5, y: Math.round(bossIsle.y) + 0.5 };

  // ---- 高度场 → 地形 ----
  for (let y = 0; y < MAP; y++) {
    for (let x = 0; x < MAP; x++) {
      let field = 0;
      for (const isle of isles) {
        const d = Math.hypot(x - isle.x, y - isle.y) / isle.r;
        field = Math.max(field, 1 - d * d);
      }
      const e = elev.fbm(x * 0.045, y * 0.045, 4);
      const dMain = Math.hypot(x - main.x, y - main.y);
      const dBoss = Math.hypot(x - bossIsle.x, y - bossIsle.y);
      const peaks = 0.22 * Math.exp(-((dMain / 12) ** 2)) + 0.3 * Math.exp(-((dBoss / 13) ** 2));
      const v = e * 0.62 + field * 0.46 - 0.3 + peaks;

      let t: Tile;
      if (v < 0.03) t = Tile.DeepWater;
      else if (v < 0.115) t = Tile.Water;
      else if (v < 0.17) t = Tile.Sand;
      else if (v > 0.72) t = Tile.Rock;
      else {
        const m = moist.fbm(x * 0.06 + 100, y * 0.06 + 100, 3);
        t = m > 0.56 ? Tile.Forest : Tile.Grass;
      }
      w.tiles[y * MAP + x] = t;
    }
  }

  // ---- Boss 决斗场：所在岛山顶保证为开阔岩地 ----
  const bx = Math.floor(w.bossPos.x);
  const by = Math.floor(w.bossPos.y);
  for (let y = -7; y <= 7; y++) {
    for (let x = -7; x <= 7; x++) {
      if (Math.hypot(x, y) <= 7) {
        const tx = bx + x;
        const ty = by + y;
        if (tx >= 0 && ty >= 0 && tx < MAP && ty < MAP) w.tiles[ty * MAP + tx] = Tile.Rock;
      }
    }
  }

  // ---- 陆地连通域标记：排除噪声生成的碎礁，保留有效岛屿 ----
  const comp = new Int32Array(MAP * MAP).fill(-1);
  const compSizes: number[] = [];
  for (let i = 0; i < MAP * MAP; i++) {
    if (comp[i] >= 0 || !walkable(w.tiles[i] as Tile)) continue;
    const id = compSizes.length;
    let size = 0;
    const stack = [i];
    comp[i] = id;
    while (stack.length > 0) {
      const c = stack.pop()!;
      size++;
      const cx = c % MAP;
      const cy = (c / MAP) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 1 || ny < 1 || nx >= MAP - 1 || ny >= MAP - 1) continue;
        const ni = ny * MAP + nx;
        if (comp[ni] < 0 && walkable(w.tiles[ni] as Tile)) {
          comp[ni] = id;
          stack.push(ni);
        }
      }
    }
    compSizes.push(size);
  }
  const kept = new Set<number>();
  compSizes.forEach((s, id) => {
    if (s >= 60) kept.add(id);
  });
  const reachable = (x: number, y: number): boolean => {
    const id = comp[Math.floor(y) * MAP + Math.floor(x)];
    return id >= 0 && kept.has(id);
  };
  // 出生连通域 = 主岛中心所在的连通域（主岛中心必为陆地：有山峰加成）
  let startComp = comp[Math.floor(main.y) * MAP + Math.floor(main.x)];
  if (startComp < 0 || !kept.has(startComp)) {
    let best = -1;
    compSizes.forEach((s, id) => {
      if (kept.has(id) && (best < 0 || s > compSizes[best])) best = id;
    });
    startComp = best;
  }

  // ---- 篝火：随机起点 + 最远点采样（仅有效岛屿陆地） ----
  const candidates: { x: number; y: number; comp: number; sand: boolean }[] = [];
  for (let y = 10; y < MAP - 10; y += 2) {
    for (let x = 10; x < MAP - 10; x += 2) {
      const t = w.tiles[y * MAP + x] as Tile;
      if (t !== Tile.Sand && t !== Tile.Grass) continue;
      if (!reachable(x, y)) continue;
      if (Math.hypot(x - w.bossPos.x, y - w.bossPos.y) < 14) continue;
      candidates.push({ x: x + 0.5, y: y + 0.5, comp: comp[y * MAP + x], sand: t === Tile.Sand });
    }
  }
  const fires: { x: number; y: number }[] = [];
  if (candidates.length > 0) {
    // 出生篝火：主岛上随机一处沙滩（没有沙滩就随机陆地）
    const startPool = candidates.filter((c) => c.comp === startComp && c.sand);
    const pool = startPool.length > 0 ? startPool : candidates.filter((c) => c.comp === startComp);
    const first = (pool.length > 0 ? pool : candidates)[Math.floor(rng() * Math.max(1, (pool.length > 0 ? pool : candidates).length))];
    fires.push(first);
    while (fires.length < 10) {
      let best = candidates[0];
      let bestD = -1;
      for (const c of candidates) {
        let minD = Infinity;
        for (const f of fires) minD = Math.min(minD, Math.hypot(c.x - f.x, c.y - f.y));
        if (minD > bestD) {
          bestD = minD;
          best = c;
        }
      }
      if (bestD < 24) break;
      fires.push(best);
    }
  }
  w.campfires = fires.map((f, i) => ({ id: i, x: f.x, y: f.y }));
  w.startCampfireId = 0;

  const nearCampfire = (x: number, y: number, r: number): boolean =>
    w.campfires.some((f) => Math.hypot(f.x - x, f.y - y) < r);
  const nearBoss = (x: number, y: number, r: number): boolean =>
    Math.hypot(w.bossPos.x - x, w.bossPos.y - y) < r;

  // ---- 资源节点（确定性 id，便于存档记录采集状态）----
  let nodeId = 0;
  for (let y = 1; y < MAP - 1; y++) {
    for (let x = 1; x < MAP - 1; x++) {
      const t = w.tiles[y * MAP + x] as Tile;
      const r = rng();
      let kind: NodeKind | null = null;
      if (t === Tile.Forest && r < 0.15) kind = 'tree';
      else if (t === Tile.Grass && r < 0.022) kind = 'tree';
      else if (t === Tile.Grass && r >= 0.022 && r < 0.052) kind = 'bush';
      else if (t === Tile.Sand && r < 0.02) kind = 'palm';
      else if (t === Tile.Sand && r >= 0.02 && r < 0.028) kind = 'rock';
      else if (t === Tile.Rock && r < 0.085) kind = 'rock';
      else if (t === Tile.Forest && r >= 0.15 && r < 0.17) kind = 'bush';

      if (kind) {
        const px = x + 0.2 + rng() * 0.6;
        const py = y + 0.2 + rng() * 0.6;
        const id = nodeId++;
        if (nearCampfire(px, py, 3.5) || nearBoss(px, py, 8.5)) continue; // id 仍然递增，保持确定性
        w.nodes.push({ id, kind, x: px, y: py });
      }
    }
  }

  // ---- 动物分布（陆地按连通域，海洋生物在浅水） ----
  const caps: Record<AnimalKind, number> = {
    crab: 50, boar: 44, deer: 34, wolf: 46, bear: 1, snake: 32, goat: 20, gull: 26,
    tiger: 12, fish: 32, turtle: 14, shark: 16, bat: 0, fox: 0, // 蝙蝠/妖狐只在洞穴内（game.ts 生成）
  };
  const counts: Record<AnimalKind, number> = {
    crab: 0, boar: 0, deer: 0, wolf: 0, bear: 0, snake: 0, goat: 0, gull: 0,
    tiger: 0, fish: 0, turtle: 0, shark: 0, bat: 0, fox: 0,
  };
  const start = w.campfires[0] ?? { x: main.x, y: main.y };
  for (let y = 2; y < MAP - 2; y++) {
    for (let x = 2; x < MAP - 2; x++) {
      const t = w.tiles[y * MAP + x] as Tile;
      const r = rng();
      let kind: AnimalKind | null = null;
      if (t === Tile.Sand && r < 0.02) kind = 'crab';
      else if (t === Tile.Sand && r >= 0.02 && r < 0.034) kind = 'gull';
      else if (t === Tile.Grass && r < 0.008) kind = 'boar';
      else if (t === Tile.Grass && r >= 0.008 && r < 0.015) kind = 'deer';
      else if (t === Tile.Grass && r >= 0.015 && r < 0.021) kind = 'snake';
      else if (t === Tile.Forest && r < 0.016) kind = 'wolf';
      else if (t === Tile.Forest && r >= 0.016 && r < 0.022) kind = 'snake';
      else if (t === Tile.Forest && r >= 0.022 && r < 0.0255) kind = 'tiger';
      else if (t === Tile.Rock && r < 0.05) kind = 'goat';
      // 山羊也栖息在主岛山坡草地
      else if (t === Tile.Grass && r >= 0.021 && r < 0.03 && Math.hypot(x - main.x, y - main.y) < 30) kind = 'goat';
      // 海洋生物：浅水区
      else if (t === Tile.Water && r < 0.012) kind = 'fish';
      else if (t === Tile.Water && r >= 0.012 && r < 0.017) kind = 'turtle';
      else if (t === Tile.Water && r >= 0.017 && r < 0.023) kind = 'shark';

      if (!kind || counts[kind] >= caps[kind]) continue;
      const def = { marine: kind === 'fish' || kind === 'turtle' || kind === 'shark' };
      if (!def.marine && !reachable(x, y)) continue; // 陆地动物只刷在有效岛屿
      const px = x + 0.5;
      const py = y + 0.5;
      if (Math.hypot(px - start.x, py - start.y) < 10) continue; // 出生点附近安全
      if (nearCampfire(px, py, 5.5) || nearBoss(px, py, kind === 'goat' ? 8.5 : 11)) continue;
      counts[kind]++;
      w.spawns.push({ kind, x: px, y: py });
    }
  }
  // 岛屿之王
  w.spawns.push({ kind: 'bear', x: w.bossPos.x, y: w.bossPos.y });

  // ---- 岛屿小 Boss：每座非巨熊岛放 1 只精英守护者（落在岛中心附近的有效陆地）----
  // 在岛中心周围螺旋搜索最近的可达陆地格
  const findLand = (cx: number, cy: number): { x: number; y: number } | null => {
    for (let r = 0; r <= 18; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // 只看当前环
          const tx = Math.floor(cx) + dx;
          const ty = Math.floor(cy) + dy;
          if (tx < 1 || ty < 1 || tx >= MAP - 1 || ty >= MAP - 1) continue;
          const wx = tx + 0.5;
          const wy = ty + 0.5;
          if (!reachable(tx, ty) || nearBoss(wx, wy, 8)) continue;
          if (Math.hypot(wx - start.x, wy - start.y) < 16) continue; // 远离出生点，别一开局就贴脸
          return { x: wx, y: wy };
        }
      }
    }
    return null;
  };
  let mbIdx = 0;
  for (const isle of isles) {
    if (isle === bossIsle) continue; // 巨熊岛不再放小 Boss
    const spot = findLand(isle.x, isle.y);
    if (!spot) continue;
    const mb = MINIBOSSES[mbIdx % MINIBOSSES.length];
    mbIdx++;
    w.spawns.push({ kind: mb.base, x: spot.x, y: spot.y, miniBoss: mb.id });
    w.miniBosses.push({ id: mb.id, x: spot.x, y: spot.y });
  }

  return w;
}
