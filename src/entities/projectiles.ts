// @author: zhjj
// 箭矢：飞行、命中动物 / 树木、落地消失

import { Container, Graphics } from 'pixi.js';
import { SCALE } from '../defs';
import type { Game } from '../game';

interface Arrow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  dmg: number;
  knock: number;
  stuck: number; // 钉住后的剩余展示时间
  sprite: Graphics;
}

export class Projectiles {
  container = new Container();
  private list: Arrow[] = [];

  fire(x: number, y: number, dir: number, speed: number, dmg: number, knock: number): void {
    const g = new Graphics();
    // 箭杆 + 箭头 + 尾羽
    g.rect(-12, -1, 22, 2).fill(0x9a7448);
    g.poly([10, -3, 16, 0, 10, 3]).fill(0xcfd6d6);
    g.poly([-12, -3, -7, 0, -12, 3]).fill(0xe8e4d8);
    g.rotation = dir;
    g.position.set(x * SCALE, y * SCALE);
    this.container.addChild(g);
    this.list.push({
      x,
      y,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      life: 1.0,
      dmg,
      knock,
      stuck: 0,
      sprite: g,
    });
  }

  update(dt: number, game: Game): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      if (a.stuck > 0) {
        a.stuck -= dt;
        a.sprite.alpha = Math.min(1, a.stuck * 2);
        if (a.stuck <= 0) this.remove(i);
        continue;
      }
      a.life -= dt;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.sprite.position.set(a.x * SCALE, a.y * SCALE);

      let hit = false;
      // 命中动物
      for (const an of game.animals) {
        if (an.dead) continue;
        const d = Math.hypot(an.x - a.x, an.y - a.y);
        if (d < an.def.radius + 0.22) {
          const dir = Math.atan2(a.vy, a.vx);
          an.damage(a.dmg, Math.cos(dir) * a.knock, Math.sin(dir) * a.knock, game);
          game.onArrowHit(a.x, a.y);
          hit = true;
          break;
        }
      }
      // 钉在树干 / 岩石上
      if (!hit) {
        for (const n of game.nodes) {
          if (!n.alive || n.kind === 'bush') continue;
          const d = Math.hypot(n.x - a.x, n.y - a.y);
          if (d < 0.38) {
            a.stuck = 1.4;
            hit = false;
            break;
          }
        }
      }
      if (hit) {
        this.remove(i);
      } else if (a.life <= 0 && a.stuck <= 0) {
        a.stuck = 0.8; // 落地停留片刻
      }
    }
  }

  private remove(i: number): void {
    const a = this.list[i];
    this.container.removeChild(a.sprite);
    a.sprite.destroy();
    this.list.splice(i, 1);
  }

  clear(): void {
    while (this.list.length) this.remove(0);
  }
}
