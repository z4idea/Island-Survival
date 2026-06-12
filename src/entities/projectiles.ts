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
  love: number; // 丘比特的弓：命中后坠入爱河的概率（0 = 普通箭）
  trailT: number; // 爱心箭的粉色尾迹间隔
  stuck: number; // 钉住后的剩余展示时间
  sprite: Graphics;
}

export class Projectiles {
  container = new Container();
  private list: Arrow[] = [];

  fire(x: number, y: number, dir: number, speed: number, dmg: number, knock: number, love = 0): void {
    const g = new Graphics();
    if (love > 0) {
      // 丘比特之箭：粉色箭杆 + 心形箭头 + 粉色尾羽
      g.rect(-12, -1, 22, 2).fill(0xe890b8);
      g.circle(11.5, -1.8, 2.1).fill(0xff5080);
      g.circle(11.5, 1.8, 2.1).fill(0xff5080);
      g.poly([9.8, -3.2, 16.5, 0, 9.8, 3.2]).fill(0xff5080);
      g.poly([-12, -3, -7, 0, -12, 3]).fill(0xffd0e0);
    } else {
      // 箭杆 + 箭头 + 尾羽
      g.rect(-12, -1, 22, 2).fill(0x9a7448);
      g.poly([10, -3, 16, 0, 10, 3]).fill(0xcfd6d6);
      g.poly([-12, -3, -7, 0, -12, 3]).fill(0xe8e4d8);
    }
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
      love,
      trailT: 0,
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
      // 爱心箭尾迹
      if (a.love > 0) {
        a.trailT -= dt;
        if (a.trailT <= 0) {
          a.trailT = 0.05;
          game.particles.burst(a.x, a.y, { color: 0xff8ac8, count: 1, speed: 0.4, life: 0.35, size: 2, alpha: 0.85 });
        }
      }
      // 子步进移动：箭速很快（最高 26 格/秒），整帧位移可能越过细小实体，
      // 按 ≤0.22 格一步推进并逐步检测，保证树干/岩壁不被穿透
      const moveLen = Math.hypot(a.vx, a.vy) * dt;
      const steps = Math.max(1, Math.ceil(moveLen / 0.22));
      let hit = false;
      for (let s = 0; s < steps && !hit && a.stuck <= 0; s++) {
        a.x += (a.vx * dt) / steps;
        a.y += (a.vy * dt) / steps;
        // 命中动物（吸附在玩家头上的蝙蝠射不到）
        for (const an of game.animals) {
          if (an.dead || an.latched) continue;
          const d = Math.hypot(an.x - a.x, an.y - a.y);
          if (d < an.def.radius + 0.22) {
            const dir = Math.atan2(a.vy, a.vx);
            an.damage(a.dmg, Math.cos(dir) * a.knock, Math.sin(dir) * a.knock, game);
            // 丘比特之箭：概率使动物坠入爱河
            if (a.love > 0 && !an.dead && Math.random() < a.love) an.makeLoved(game);
            game.onArrowHit(a.x, a.y);
            hit = true;
            break;
          }
        }
        if (hit) break;
        // 钉在实体上：树干 / 岩石 / 浆果丛 / 水晶
        for (const n of game.nodes) {
          if (!n.alive) continue;
          const blockR = n.kind === 'bush' ? 0.5 : n.kind === 'rock' ? 0.45 : 0.38;
          if (Math.hypot(n.x - a.x, n.y - a.y) < blockR) {
            a.stuck = 1.4;
            break;
          }
        }
        // 钉在洞穴岩壁上
        if (a.stuck <= 0 && game.isSolidAt(a.x, a.y)) {
          a.stuck = 1.4;
          game.particles.burst(a.x, a.y, { color: 0x9a9a92, count: 3, speed: 1.5, life: 0.3, size: 2 });
        }
      }
      a.sprite.position.set(a.x * SCALE, a.y * SCALE);
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
