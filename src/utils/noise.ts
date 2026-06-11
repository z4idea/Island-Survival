// @author: zhjj
// 确定性随机数与值噪声（FBM），用于程序化岛屿生成

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(ix: number, iy: number, seed: number): number {
  let h = seed + ix * 374761393 + iy * 668265263;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export class Noise2D {
  constructor(private seed: number) {}

  /** 单层值噪声，返回 0..1 */
  noise(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = hash2(ix, iy, this.seed);
    const b = hash2(ix + 1, iy, this.seed);
    const c = hash2(ix, iy + 1, this.seed);
    const d = hash2(ix + 1, iy + 1, this.seed);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  /** 分形叠加噪声，返回约 0..1 */
  fbm(x: number, y: number, octaves = 4): number {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let total = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / total;
  }
}

/** 每格固定的微随机量（用于地表颜色抖动等） */
export function tileJitter(x: number, y: number, seed: number): number {
  return hash2(x, y, seed);
}
