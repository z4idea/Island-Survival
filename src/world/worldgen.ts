// @author: zhjj
// 程序化孤岛生成：高度场 + 生物群系 + 资源 / 篝火 / 动物分布

import { MAP, Tile, walkable, type AnimalKind } from '../defs';
import { Noise2D, mulberry32 } from '../utils/noise';

export type NodeKind = 'tree' | 'palm' | 'rock' | 'bush';

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
}

export class WorldData {
  tiles: Uint8Array = new Uint8Array(MAP * MAP);
  nodes: NodeData[] = [];
  campfires: CampfirePoint[] = [];
  spawns: SpawnPoint[] = [];
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
}

export function generateWorld(seed: number): WorldData {
  const w = new WorldData(seed);
  const elev = new Noise2D(seed);
  const moist = new Noise2D(seed ^ 0x5f3759df);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const C = MAP / 2;
  const R = MAP / 2;

  // ---- 高度场 → 地形 ----
  for (let y = 0; y < MAP; y++) {
    for (let x = 0; x < MAP; x++) {
      const d = Math.hypot(x - C, y - C) / R; // 0..~1.41
      const e = elev.fbm(x * 0.045, y * 0.045, 4);
      const distC = Math.hypot(x - C, y - C);
      const peak = 0.3 * Math.exp(-((distC / 14) ** 2)); // 中央山峰
      const v = e * 0.62 + (1 - d * d) * 0.46 - 0.3 + peak;

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

  // ---- Boss 决斗场：中央山顶保证为开阔岩地 ----
  for (let y = -7; y <= 7; y++) {
    for (let x = -7; x <= 7; x++) {
      if (Math.hypot(x, y) <= 7) {
        w.tiles[(C + y) * MAP + (C + x)] = Tile.Rock;
      }
    }
  }
  w.bossPos = { x: C + 0.5, y: C + 0.5 };

  // ---- 主岛连通域：从岛心沿陆地洪泛填充，排除离岸礁岛 ----
  const reachable = new Uint8Array(MAP * MAP);
  {
    const stack: number[] = [C * MAP + C];
    reachable[C * MAP + C] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const ix = i % MAP;
      const iy = (i / MAP) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = ix + dx;
        const ny = iy + dy;
        if (nx < 1 || ny < 1 || nx >= MAP - 1 || ny >= MAP - 1) continue;
        const ni = ny * MAP + nx;
        if (reachable[ni]) continue;
        if (walkable(w.tiles[ni] as Tile)) {
          reachable[ni] = 1;
          stack.push(ni);
        }
      }
    }
  }

  // ---- 篝火：最远点采样，保证彼此分散（只放在主岛陆地上）----
  const candidates: { x: number; y: number }[] = [];
  for (let y = 10; y < MAP - 10; y += 2) {
    for (let x = 10; x < MAP - 10; x += 2) {
      const t = w.tiles[y * MAP + x] as Tile;
      if (
        (t === Tile.Sand || t === Tile.Grass) &&
        reachable[y * MAP + x] &&
        Math.hypot(x - C, y - C) > 16
      ) {
        candidates.push({ x: x + 0.5, y: y + 0.5 });
      }
    }
  }
  const fires: { x: number; y: number }[] = [];
  if (candidates.length > 0) {
    // 从最靠南的沙滩点开始（出生点）
    let first = candidates[0];
    for (const c of candidates) {
      const t = w.tile(c.x, c.y);
      const ft = w.tile(first.x, first.y);
      if (t === Tile.Sand && (ft !== Tile.Sand || c.y > first.y)) first = c;
    }
    fires.push(first);
    while (fires.length < 6) {
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
      if (bestD < 18) break;
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

  // ---- 动物分布 ----
  const caps: Record<AnimalKind, number> = {
    crab: 32, boar: 26, deer: 20, wolf: 28, bear: 1, snake: 18, goat: 12, gull: 14,
  };
  const counts: Record<AnimalKind, number> = {
    crab: 0, boar: 0, deer: 0, wolf: 0, bear: 0, snake: 0, goat: 0, gull: 0,
  };
  const start = w.campfires[0] ?? { x: C, y: C + 40 };
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
      else if (t === Tile.Rock && r < 0.05) kind = 'goat';
      // 岩石群系很小（多为中央山峰），山羊也栖息在山坡草地
      else if (t === Tile.Grass && r >= 0.021 && r < 0.03 && Math.hypot(x - C, y - C) < 26) kind = 'goat';
      if (!kind || counts[kind] >= caps[kind]) continue;
      if (!reachable[y * MAP + x]) continue; // 不在离岸礁岛上刷动物
      const px = x + 0.5;
      const py = y + 0.5;
      if (Math.hypot(px - start.x, py - start.y) < 10) continue; // 出生点附近安全
      // 山羊栖息在山峰附近，放宽 Boss 排除半径（仍避开 7 格决斗场）
      if (nearCampfire(px, py, 5.5) || nearBoss(px, py, kind === 'goat' ? 8.5 : 11)) continue;
      counts[kind]++;
      w.spawns.push({ kind, x: px, y: py });
    }
  }
  // 岛屿之王
  w.spawns.push({ kind: 'bear', x: w.bossPos.x, y: w.bossPos.y });

  return w;
}
