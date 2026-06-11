// @author: zhjj
// 掉落物：散落、吸附、拾取

import { Container, Text } from 'pixi.js';
import { RES_EMOJI, SCALE, type ResKind } from '../defs';
import type { Game } from '../game';

interface Drop {
  kind: ResKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number; // 存在时间
  sprite: Text;
}

export class Drops {
  container = new Container();
  private list: Drop[] = [];

  spawn(kind: ResKind, x: number, y: number, count = 1): void {
    for (let i = 0; i < count; i++) {
      if (this.list.length > 120) return;
      const sprite = new Text({
        text: RES_EMOJI[kind],
        style: { fontSize: 18 },
      });
      sprite.anchor.set(0.5);
      const ang = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 2.5;
      const d: Drop = {
        kind,
        x: x + (Math.random() - 0.5) * 0.3,
        y: y + (Math.random() - 0.5) * 0.3,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        t: 0,
        sprite,
      };
      sprite.position.set(d.x * SCALE, d.y * SCALE);
      this.container.addChild(sprite);
      this.list.push(d);
    }
  }

  update(dt: number, game: Game): void {
    const p = game.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.t += dt;
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      const dist = Math.hypot(dx, dy);
      // 0.3 秒后开始被玩家吸附
      if (d.t > 0.3 && dist < 2.2 && !p.dead) {
        const pull = 26 * dt;
        d.vx += (dx / (dist || 1)) * pull;
        d.vy += (dy / (dist || 1)) * pull;
      }
      const damp = Math.max(0, 1 - 5 * dt);
      d.vx *= damp;
      d.vy *= damp;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.sprite.position.set(d.x * SCALE, d.y * SCALE);
      d.sprite.y += Math.sin(d.t * 5 + i) * 2; // 漂浮感
      // 拾取
      if (d.t > 0.35 && dist < 0.55 && !p.dead) {
        p.addRes(d.kind, 1, game);
        this.container.removeChild(d.sprite);
        d.sprite.destroy();
        this.list.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const d of this.list) {
      this.container.removeChild(d.sprite);
      d.sprite.destroy();
    }
    this.list = [];
  }
}
