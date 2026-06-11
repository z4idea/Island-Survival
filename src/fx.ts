// @author: zhjj
// 粒子系统与伤害飘字（对象池实现）

import { Container, Graphics, Text } from 'pixi.js';
import { SCALE } from './defs';

interface Particle {
  g: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  drag: number;
}

export interface BurstOpts {
  color: number;
  count?: number;
  speed?: number;
  life?: number;
  size?: number;
  alpha?: number;
}

export class Particles {
  container = new Container();
  private active: Particle[] = [];
  private pool: Graphics[] = [];

  burst(x: number, y: number, opts: BurstOpts): void {
    const count = opts.count ?? 8;
    const speed = opts.speed ?? 3;
    const life = opts.life ?? 0.5;
    const size = opts.size ?? 3;
    for (let i = 0; i < count; i++) {
      if (this.active.length > 350) break;
      const g = this.pool.pop() ?? new Graphics();
      g.clear();
      g.circle(0, 0, size * (0.6 + Math.random() * 0.8)).fill({ color: opts.color, alpha: opts.alpha ?? 1 });
      g.position.set(x * SCALE, y * SCALE);
      g.alpha = 1;
      g.visible = true;
      const ang = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.9) * SCALE;
      this.container.addChild(g);
      this.active.push({
        g,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: life * (0.7 + Math.random() * 0.6),
        maxLife: life,
        drag: 4,
      });
    }
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.g.visible = false;
        this.container.removeChild(p.g);
        this.pool.push(p.g);
        this.active.splice(i, 1);
        continue;
      }
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      const t = p.life / p.maxLife;
      p.g.alpha = Math.min(1, t * 2);
      p.g.scale.set(0.5 + t * 0.5);
    }
  }
}

interface FloatItem {
  t: Text;
  life: number;
  vy: number;
}

export class FloatTexts {
  container = new Container();
  private active: FloatItem[] = [];
  private pool: Text[] = [];

  show(x: number, y: number, str: string, color: number, size = 15): void {
    if (this.active.length > 40) return;
    const t =
      this.pool.pop() ??
      new Text({
        text: '',
        style: {
          fontFamily: '"Microsoft YaHei", sans-serif',
          fontSize: 16,
          fontWeight: '900',
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 4 },
        },
      });
    t.text = str;
    t.style.fontSize = size;
    t.style.fill = color;
    t.anchor.set(0.5);
    t.position.set(x * SCALE + (Math.random() - 0.5) * 14, y * SCALE - 18);
    t.alpha = 1;
    t.scale.set(1);
    this.container.addChild(t);
    this.active.push({ t, life: 0.9, vy: -46 });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const f = this.active[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.container.removeChild(f.t);
        this.pool.push(f.t);
        this.active.splice(i, 1);
        continue;
      }
      f.t.y += f.vy * dt;
      f.vy *= 1 - 2.5 * dt;
      f.t.alpha = Math.min(1, f.life * 2.2);
    }
  }
}
