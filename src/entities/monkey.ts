// @author: zhjj
import RAPIER from '@dimforge/rapier2d-compat';
import { Container, Graphics } from 'pixi.js';
import { GROUPS, SCALE } from '../defs';
import type { Game } from '../game';
import type { CombatTarget } from './combat-target';
import { hasMonkeyEscaped, stolenItemLabel, type StolenItem } from './monkey-logic';

const MONKEY_SPEED = 10.5;

export class Monkey implements CombatTarget {
  readonly targetType = 'monkey' as const;
  readonly radius = 0.48;
  readonly root = new Container();
  readonly stolen: StolenItem | null;

  x: number;
  y: number;
  dead = false;
  removed = false;

  private body: RAPIER.RigidBody | null;
  private bodyC = new Container();
  private gfx = new Graphics();
  private hpBar = new Graphics();
  private startX: number;
  private startY: number;
  private dirX: number;
  private dirY: number;
  private hp = 34;
  private kvx = 0;
  private kvy = 0;
  private flashT = 0;
  private hpShowT = 0;
  private runT = 0;
  private stuckT = 0;
  private lastX: number;
  private lastY: number;

  constructor(
    world: RAPIER.World,
    x: number,
    y: number,
    playerX: number,
    playerY: number,
    stolen: StolenItem | null,
  ) {
    this.x = x;
    this.y = y;
    this.startX = x;
    this.startY = y;
    this.lastX = x;
    this.lastY = y;
    this.stolen = stolen;

    let dx = x - playerX;
    let dy = y - playerY;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const offset = (Math.random() - 0.5) * 0.7;
    this.dirX = dx * Math.cos(offset) - dy * Math.sin(offset);
    this.dirY = dx * Math.sin(offset) + dy * Math.cos(offset);

    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).lockRotations());
    world.createCollider(
      RAPIER.ColliderDesc.ball(this.radius).setCollisionGroups(GROUPS.ANIMAL).setFriction(0),
      this.body,
    );

    const shadow = new Graphics();
    shadow.ellipse(0, this.radius * SCALE * 0.5, this.radius * SCALE * 1.05, this.radius * SCALE * 0.42)
      .fill({ color: 0x000000, alpha: 0.26 });
    this.root.addChild(shadow);
    this.drawBody();
    this.root.addChild(this.bodyC);
    this.root.addChild(this.hpBar);
    this.root.position.set(x * SCALE, y * SCALE);
  }

  // 俯视侧身造型，朝向 +x（与其他动物风格一致，靠 bodyC.scale.x 翻转朝向）
  private drawBody(): void {
    const g = this.gfx;
    const body = 0x85502c;
    const dark = 0x5b3320;
    const face = 0xd6a26d;
    g.clear();
    // 卷曲的长尾（画在身体后方）
    g.moveTo(-12, 3).quadraticCurveTo(-25, 4, -24, -6).quadraticCurveTo(-23, -12, -18, -11)
      .stroke({ width: 3.5, color: body });
    g.ellipse(-8, 7, 4, 3).fill(dark); // 后腿
    g.ellipse(-2, 0, 14, 9).fill(body); // 身体
    g.ellipse(0, 3, 8, 5).fill(face); // 浅色腹部
    g.circle(8, -8, 3).fill(dark); // 远耳
    g.circle(16, -8, 3).fill(dark); // 近耳
    g.circle(8, -8, 1.5).fill(face);
    g.circle(16, -8, 1.5).fill(face);
    g.circle(12, -2, 7).fill(body); // 头
    g.ellipse(13, 0, 5.5, 5.5).fill(face); // 面盘
    g.circle(10, -3, 1.4).fill(0x21160f); // 眼
    g.circle(15, -3, 1.4).fill(0x21160f);
    g.ellipse(13, 2, 2.4, 1.6).fill(dark); // 口鼻
    if (this.stolen) {
      g.circle(-6, 6, 5).fill(0xc99b50); // 背着偷来的赃物口袋
      g.moveTo(-9, 2).lineTo(-3, 2).stroke({ color: 0x6a431f, width: 2 });
    }
    this.bodyC.addChild(g);
  }

  update(dt: number, game: Game): void {
    if (this.removed || !this.body) return;

    const pos = this.body.translation();
    this.x = pos.x;
    this.y = pos.y;
    const moved = Math.hypot(this.x - this.lastX, this.y - this.lastY);
    this.stuckT = moved < 0.015 ? this.stuckT + dt : 0;
    this.lastX = this.x;
    this.lastY = this.y;
    if (this.stuckT > 0.35) {
      const turn = Math.random() < 0.5 ? -0.75 : 0.75;
      const dx = this.dirX * Math.cos(turn) - this.dirY * Math.sin(turn);
      const dy = this.dirX * Math.sin(turn) + this.dirY * Math.cos(turn);
      this.dirX = dx;
      this.dirY = dy;
      this.stuckT = 0;
    }

    const damp = Math.max(0, 1 - 7 * dt);
    this.kvx *= damp;
    this.kvy *= damp;
    this.body.setLinvel({
      x: this.dirX * MONKEY_SPEED + this.kvx,
      y: this.dirY * MONKEY_SPEED + this.kvy,
    }, true);

    this.runT += dt * 16;
    this.bodyC.y = Math.sin(this.runT) * 3;
    this.bodyC.rotation = Math.sin(this.runT * 0.5) * 0.08;
    this.bodyC.scale.x = this.dirX < 0 ? -1 : 1;
    this.root.position.set(this.x * SCALE, this.y * SCALE);
    this.root.zIndex = this.y;

    this.flashT = Math.max(0, this.flashT - dt);
    this.gfx.tint = this.flashT > 0 ? 0xffd8b8 : 0xffffff;
    this.hpShowT = Math.max(0, this.hpShowT - dt);
    this.hpBar.visible = this.hpShowT > 0;

    if (hasMonkeyEscaped(this.startX, this.startY, this.x, this.y)) this.escape(game);
  }

  damage(amount: number, kx: number, ky: number, game: Game): void {
    if (this.removed || this.dead) return;
    this.hp -= amount;
    this.kvx += kx;
    this.kvy += ky;
    this.flashT = 0.1;
    this.hpShowT = 1.5;
    this.drawHp();
    game.floats.show(this.x, this.y - 0.8, `-${Math.round(amount)}`, 0xffd0a0, 14);
    game.particles.burst(this.x, this.y, { color: 0x9b643d, count: 6, speed: 2.5, life: 0.4, size: 2.5 });
    if (this.hp <= 0) this.die(game);
  }

  private drawHp(): void {
    const ratio = Math.max(0, this.hp / 34);
    this.hpBar.clear();
    this.hpBar.roundRect(-16, -35, 32, 5, 2).fill(0x251714);
    this.hpBar.roundRect(-15, -34, 30 * ratio, 3, 1).fill(0xf0a34a);
  }

  private die(game: Game): void {
    if (this.removed) return;
    this.dead = true;
    if (this.stolen) {
      game.player.changeMonkeyItem(this.stolen, 1);
      game.floats.show(
        this.x,
        this.y - 0.8,
        `夺回 ${stolenItemLabel(this.stolen.kind)} x${this.stolen.amount}`,
        0xffe080,
        15,
      );
    }
    game.particles.burst(this.x, this.y, { color: 0xb87943, count: 12, speed: 3.2, life: 0.55, size: 3 });
    this.destroy(game);
  }

  private escape(game: Game): void {
    if (this.removed) return;
    const text = this.stolen
      ? `猴子带着 ${stolenItemLabel(this.stolen.kind)} 跑掉了!`
      : '猴子跑掉了!';
    game.floats.show(this.x, this.y - 0.7, text, 0xffb060, 13);
    this.destroy(game);
  }

  destroy(game: Game): void {
    if (this.removed) return;
    this.dead = true;
    this.removed = true;
    if (this.body) {
      game.physWorld.removeRigidBody(this.body);
      this.body = null;
    }
    if (this.root.parent) this.root.parent.removeChild(this.root);
  }
}
