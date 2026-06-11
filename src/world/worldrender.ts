// @author: zhjj
// 地形渲染：按区块绘制瓦片、海岸浪花动画、视野裁剪

import { Container, Graphics } from 'pixi.js';
import { MAP, SCALE, TILE_COLORS, Tile, walkable } from '../defs';
import { tileJitter } from '../utils/noise';
import type { WorldData } from './worldgen';

const CHUNK = 16; // 每区块 16x16 格

/** 颜色明暗调整：f > 0 变亮，f < 0 变暗 */
function shade(color: number, f: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const adj = (c: number) => Math.max(0, Math.min(255, Math.round(f > 0 ? c + (255 - c) * f : c * (1 + f))));
  return (adj(r) << 16) | (adj(g) << 8) | adj(b);
}

interface Chunk {
  g: Graphics;
  px: number; // 像素坐标
  py: number;
}

export class WorldRenderer {
  container = new Container();
  private chunks: Chunk[] = [];
  private foam = new Graphics();

  build(w: WorldData): void {
    // 地图范围之外铺一圈深海，避免镜头看到“世界尽头”
    const border = new Graphics();
    const M = 64 * SCALE;
    border
      .rect(-M, -M, MAP * SCALE + M * 2, MAP * SCALE + M * 2)
      .fill(TILE_COLORS[Tile.DeepWater]);
    this.container.addChild(border);

    const n = Math.ceil(MAP / CHUNK);
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const g = new Graphics();
        for (let ty = 0; ty < CHUNK; ty++) {
          for (let tx = 0; tx < CHUNK; tx++) {
            const x = cx * CHUNK + tx;
            const y = cy * CHUNK + ty;
            if (x >= MAP || y >= MAP) continue;
            const t = w.tiles[y * MAP + x] as Tile;
            const j = tileJitter(x, y, w.seed);
            const base = TILE_COLORS[t];
            const color = shade(base, (j - 0.5) * 0.11);
            g.rect(tx * SCALE, ty * SCALE, SCALE, SCALE).fill(color);

            // 地表细节装饰
            const j2 = tileJitter(x, y, w.seed ^ 0xabcdef);
            if (t === Tile.Grass && j2 < 0.16) {
              const dx = tx * SCALE + 6 + j * 18;
              const dy = ty * SCALE + 6 + j2 * 110;
              g.rect(dx, dy, 3, 6).fill(shade(base, -0.22));
              g.rect(dx + 5, dy + 2, 3, 5).fill(shade(base, -0.16));
            } else if (t === Tile.Forest && j2 < 0.2) {
              g.circle(tx * SCALE + 8 + j * 16, ty * SCALE + 8 + j2 * 80, 2.5).fill(shade(base, -0.18));
            } else if (t === Tile.Sand && j2 < 0.12) {
              g.circle(tx * SCALE + 6 + j * 20, ty * SCALE + 6 + j2 * 160, 1.8).fill(shade(base, -0.16));
            } else if (t === Tile.Rock && j2 < 0.1) {
              g.rect(tx * SCALE + 5 + j * 16, ty * SCALE + 10 + j2 * 140, 9, 2).fill(shade(base, -0.2));
            } else if (t === Tile.Water && j2 < 0.1) {
              g.rect(tx * SCALE + 4 + j * 14, ty * SCALE + 8 + j2 * 160, 12, 2).fill(shade(base, 0.18));
            } else if (t === Tile.DeepWater && j2 < 0.06) {
              g.rect(tx * SCALE + 4 + j * 14, ty * SCALE + 10 + j2 * 200, 10, 2).fill(shade(base, 0.12));
            }
          }
        }
        g.position.set(cx * CHUNK * SCALE, cy * CHUNK * SCALE);
        this.container.addChild(g);
        this.chunks.push({ g, px: cx * CHUNK * SCALE, py: cy * CHUNK * SCALE });
      }
    }

    // 海岸浪花：水面上紧贴陆地的格子
    for (let y = 1; y < MAP - 1; y++) {
      for (let x = 1; x < MAP - 1; x++) {
        const t = w.tiles[y * MAP + x] as Tile;
        if (t !== Tile.Water) continue;
        const nearLand =
          walkable(w.tiles[y * MAP + x - 1] as Tile) ||
          walkable(w.tiles[y * MAP + x + 1] as Tile) ||
          walkable(w.tiles[(y - 1) * MAP + x] as Tile) ||
          walkable(w.tiles[(y + 1) * MAP + x] as Tile);
        if (nearLand) {
          this.foam.rect(x * SCALE + 2, y * SCALE + 2, SCALE - 4, SCALE - 4).fill({ color: 0xcfeef2, alpha: 0.5 });
        }
      }
    }
    this.foam.alpha = 0.4;
    this.container.addChild(this.foam);
  }

  /** 浪花呼吸动画 */
  animate(time: number): void {
    this.foam.alpha = 0.22 + 0.2 * (0.5 + 0.5 * Math.sin(time * 1.6));
  }

  /** 只显示镜头附近的区块 */
  cull(camX: number, camY: number, viewW: number, viewH: number): void {
    const pad = CHUNK * SCALE;
    const left = camX * SCALE - viewW / 2 - pad;
    const right = camX * SCALE + viewW / 2 + pad;
    const top = camY * SCALE - viewH / 2 - pad;
    const bottom = camY * SCALE + viewH / 2 + pad;
    for (const c of this.chunks) {
      c.g.visible = c.px + pad > left && c.px < right && c.py + pad > top && c.py < bottom;
    }
  }
}
