// @author: zhjj
// 动物 AI：游荡 / 追击 / 逃跑 / 冲锋 / Boss 战斗模式

import RAPIER from '@dimforge/rapier2d-compat';
import { Container, Graphics } from 'pixi.js';
import { ANIMALS, COIN_TABLE, GROUPS, SCALE, Tile, type AnimalDef, type AnimalKind, type ResKind } from '../defs';
import type { Game } from '../game';
import { sfx } from '../core/audio';

type State = 'idle' | 'wander' | 'chase' | 'windup' | 'charge' | 'flee' | 'dying';

export class Animal {
  def: AnimalDef;
  body: RAPIER.RigidBody | null;
  root = new Container();
  private bodyC = new Container();
  private gfx = new Graphics();
  private hpBar = new Graphics();
  private alertG = new Graphics(); // 攻击预警（红色）

  x: number;
  y: number;
  hp: number;
  dead = false;
  spawnIdx: number;
  burnT = 0; // 灼烧剩余时间（烈焰剑）
  private burnFxT = 0;

  private state: State = 'idle';
  private stateT = 0;
  private home: { x: number; y: number };
  private tx = 0; // 游荡目标
  private ty = 0;
  private wanderT = 0;
  private atkCd = 0;
  private chargeCd = 0;
  private chargeDx = 0;
  private chargeDy = 0;
  private kvx = 0;
  private kvy = 0;
  private knockT = 0;
  private flashT = 0;
  private hpShowT = 0;
  private bobT = 0;
  private faceAng = 0;
  private dieT = 0;
  private roared = false;
  aggro = false;

  constructor(world: RAPIER.World, kind: AnimalKind, x: number, y: number, spawnIdx: number, groups: number) {
    this.def = ANIMALS[kind];
    this.x = x;
    this.y = y;
    this.hp = this.def.hp;
    this.home = { x, y };
    this.tx = x;
    this.ty = y;
    this.spawnIdx = spawnIdx;

    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).lockRotations();
    this.body = world.createRigidBody(desc);
    // 飞行动物不参与碰撞（可以越过水面与障碍）；海洋动物只与玩家碰撞
    const colGroups = this.def.flying ? (0x0004 << 16) | 0x0000 : this.def.marine ? GROUPS.MARINE : groups;
    world.createCollider(
      RAPIER.ColliderDesc.ball(this.def.radius).setCollisionGroups(colGroups).setFriction(0),
      this.body,
    );

    const shadow = new Graphics();
    shadow.ellipse(0, this.def.radius * SCALE * 0.55, this.def.radius * SCALE * 1.05, this.def.radius * SCALE * 0.45)
      .fill({ color: 0x000000, alpha: 0.26 });
    this.root.addChild(shadow);
    this.root.addChild(this.alertG);
    this.drawBody();
    this.bodyC.addChild(this.gfx);
    this.root.addChild(this.bodyC);
    this.hpBar.visible = false;
    this.root.addChild(this.hpBar);
    this.root.position.set(x * SCALE, y * SCALE);
  }

  private drawBody(): void {
    const g = this.gfx;
    const c = this.def.color;
    g.clear();
    switch (this.def.kind) {
      case 'crab': {
        g.ellipse(0, 0, 11, 8).fill(c);
        g.circle(10, -6, 4).fill(c); // 钳子
        g.circle(10, 6, 4).fill(c);
        g.circle(5, -3, 1.6).fill(0x222222); // 眼睛
        g.circle(5, 3, 1.6).fill(0x222222);
        for (let i = -1; i <= 1; i++) {
          g.moveTo(-4, i * 6).lineTo(-12, i * 7).stroke({ width: 1.5, color: 0xa8402c });
        }
        break;
      }
      case 'boar': {
        g.ellipse(0, 0, 16, 11).fill(c);
        g.ellipse(13, 0, 6, 5).fill(0x5e3d26); // 鼻头
        g.poly([14, -5, 20, -7, 16, -2]).fill(0xeae2ce); // 獠牙
        g.poly([14, 5, 20, 7, 16, 2]).fill(0xeae2ce);
        g.circle(8, -4, 1.6).fill(0x1a1a1a);
        g.circle(8, 4, 1.6).fill(0x1a1a1a);
        g.ellipse(-2, -9, 4, 3).fill(0x5e3d26); // 耳朵
        g.ellipse(-2, 9, 4, 3).fill(0x5e3d26);
        break;
      }
      case 'wolf': {
        g.ellipse(-2, 0, 14, 8.5).fill(c);
        g.circle(11, 0, 6.5).fill(c); // 头
        g.poly([13, -6, 18, -10, 16, -3]).fill(0x6e7480); // 耳朵
        g.poly([13, 6, 18, 10, 16, 3]).fill(0x6e7480);
        g.ellipse(16, 0, 4, 2.6).fill(0x6e7480); // 吻部
        g.circle(12, -3, 1.4).fill(0xffd24a);
        g.circle(12, 3, 1.4).fill(0xffd24a);
        g.moveTo(-15, 0).lineTo(-22, -4).stroke({ width: 3, color: c }); // 尾巴
        break;
      }
      case 'deer': {
        g.ellipse(-1, 0, 14, 8.5).fill(c);
        g.circle(11, -1, 5.5).fill(c);
        g.circle(9, -2, 1.4).fill(0x1a1a1a);
        // 鹿角
        g.moveTo(12, -5).lineTo(17, -11).stroke({ width: 2, color: 0x8a6a4a });
        g.moveTo(14, -8).lineTo(18, -7).stroke({ width: 2, color: 0x8a6a4a });
        g.moveTo(9, -6).lineTo(7, -12).stroke({ width: 2, color: 0x8a6a4a });
        g.circle(-13, -2, 2.5).fill(0xefe6d4); // 尾巴
        break;
      }
      case 'snake': {
        // S 形蛇身
        g.moveTo(-14, 4).quadraticCurveTo(-8, -5, -1, 0).quadraticCurveTo(5, 4, 10, 0)
          .stroke({ width: 5, color: c });
        g.moveTo(-14, 4).quadraticCurveTo(-8, -5, -1, 0).quadraticCurveTo(5, 4, 10, 0)
          .stroke({ width: 2, color: 0x4e8a30 });
        g.circle(12, -1, 4.5).fill(c); // 头
        g.circle(13.5, -2.5, 1.2).fill(0xd62f2f); // 眼
        g.moveTo(16, -1).lineTo(21, -2).stroke({ width: 1.2, color: 0xd62f2f }); // 信子
        g.moveTo(16, -1).lineTo(21, 1).stroke({ width: 1.2, color: 0xd62f2f });
        break;
      }
      case 'goat': {
        g.ellipse(-1, 0, 14, 9).fill(c);
        g.circle(11, -2, 6).fill(c); // 头
        g.ellipse(11, 2, 3, 4).fill(0xc0bcb0); // 吻部
        // 后弯羊角
        g.moveTo(9, -7).quadraticCurveTo(4, -14, -2, -12).stroke({ width: 2.5, color: 0x8a7a5a });
        g.moveTo(13, -7).quadraticCurveTo(10, -15, 4, -15).stroke({ width: 2.5, color: 0x8a7a5a });
        g.circle(13, -4, 1.4).fill(0x2a2a2a);
        g.rect(9, 5, 3, 5).fill(0xc0bcb0); // 山羊胡
        break;
      }
      case 'gull': {
        g.ellipse(0, 0, 11, 7).fill(c);
        g.circle(9, -3, 4.5).fill(c); // 头
        g.poly([12, -3, 19, -2, 12, -1]).fill(0xf0a030); // 喙
        g.circle(10, -4.5, 1.2).fill(0x2a2a2a);
        g.poly([-4, -2, -16, -8, -6, 2]).fill(0xb8bec4); // 翅膀
        g.poly([-4, 2, -14, 8, -5, 4]).fill(0xb8bec4);
        g.poly([-10, 0, -16, -1, -15, 2]).fill(0x3a3a3a); // 黑色翼尖
        break;
      }
      case 'tiger': {
        g.ellipse(-1, 0, 19, 12).fill(c);
        // 黑色条纹
        for (const sx of [-12, -5, 2, 9]) {
          g.moveTo(sx, -10).quadraticCurveTo(sx + 2, 0, sx, 10).stroke({ width: 2.5, color: 0x3a2a1a });
        }
        g.circle(15, -1, 8).fill(c); // 头
        g.poly([10, -8, 14, -13, 17, -7]).fill(0x3a2a1a); // 耳朵
        g.poly([18, -8, 23, -12, 23, -6]).fill(0x3a2a1a);
        g.ellipse(20, 2, 4.5, 3.5).fill(0xf0e0c8); // 吻部
        g.circle(17, -3.5, 1.8).fill(0xffd24a); // 眼
        g.circle(13, -4, 1.8).fill(0xffd24a);
        g.moveTo(-19, -2).quadraticCurveTo(-26, -6, -28, -1).stroke({ width: 3.5, color: c }); // 尾巴
        g.moveTo(-26, -4).lineTo(-28, -1).stroke({ width: 3.5, color: 0x3a2a1a });
        break;
      }
      case 'fish': {
        g.ellipse(1, 0, 9, 5).fill(c);
        g.poly([-7, 0, -14, -5, -14, 5]).fill(0x4e88b8); // 尾鳍
        g.poly([0, -4, 4, -9, 7, -4]).fill(0x4e88b8); // 背鳍
        g.circle(6, -1, 1.3).fill(0x1a1a2a);
        g.ellipse(2, 2, 4, 1.5).fill(0x9ac8e8); // 腹部高光
        break;
      }
      case 'turtle': {
        g.ellipse(0, 0, 14, 11).fill(0x3a6a4e); // 壳底
        g.ellipse(0, 0, 11, 8.5).fill(c); // 壳面
        g.moveTo(-8, -4).lineTo(8, -4).stroke({ width: 1.2, color: 0x3a6a4e }); // 壳纹
        g.moveTo(-9, 1).lineTo(9, 1).stroke({ width: 1.2, color: 0x3a6a4e });
        g.moveTo(-3, -8).lineTo(-3, 7).stroke({ width: 1.2, color: 0x3a6a4e });
        g.moveTo(4, -8).lineTo(4, 7).stroke({ width: 1.2, color: 0x3a6a4e });
        g.circle(14, 0, 4).fill(0x6aa87e); // 头
        g.circle(15.5, -1.5, 1.1).fill(0x1a1a1a);
        g.ellipse(-7, -10, 4, 2).fill(0x6aa87e); // 鳍肢
        g.ellipse(-7, 10, 4, 2).fill(0x6aa87e);
        g.ellipse(7, -10, 4, 2).fill(0x6aa87e);
        g.ellipse(7, 10, 4, 2).fill(0x6aa87e);
        break;
      }
      case 'shark': {
        g.ellipse(0, 0, 20, 8).fill(c);
        g.ellipse(2, 2.5, 16, 4.5).fill(0xc8d2da); // 白腹
        g.poly([-16, 0, -26, -8, -22, 0, -26, 6]).fill(c); // 尾鳍
        g.poly([-2, -7, 4, -17, 8, -7]).fill(0x5e6e7e); // 背鳍
        g.poly([4, 5, 10, 12, 12, 5]).fill(0x5e6e7e); // 胸鳍
        g.circle(14, -2.5, 1.6).fill(0x1a1a1a); // 眼
        g.moveTo(12, 3).quadraticCurveTo(16, 5, 19, 3).stroke({ width: 1.5, color: 0x4a5a66 }); // 嘴
        break;
      }
      case 'bear': {
        g.ellipse(0, 0, 30, 22).fill(c);
        g.ellipse(0, 0, 30, 22).stroke({ width: 3, color: 0x3a2a1c });
        g.circle(24, 0, 13).fill(c); // 头
        g.circle(24, 0, 13).stroke({ width: 2.5, color: 0x3a2a1c });
        g.circle(19, -11, 4.5).fill(0x3a2a1c); // 耳朵
        g.circle(19, 11, 4.5).fill(0x3a2a1c);
        g.ellipse(32, 0, 5.5, 4).fill(0x8a6a4a); // 吻部
        g.circle(27, -4.5, 2).fill(0xff5040); // 眼睛（凶恶红光）
        g.circle(27, 4.5, 2).fill(0xff5040);
        // 背部疤痕
        g.moveTo(-12, -8).lineTo(-2, -2).stroke({ width: 2.5, color: 0x6a4a32 });
        g.moveTo(-14, 2).lineTo(-4, 8).stroke({ width: 2.5, color: 0x6a4a32 });
        break;
      }
    }
  }

  private setState(s: State): void {
    this.state = s;
    this.stateT = 0;
  }

  update(dt: number, game: Game): void {
    if (this.dead) {
      if (this.state === 'dying') {
        this.dieT -= dt;
        this.root.alpha = Math.max(0, this.dieT / 0.5);
        this.root.scale.set(0.8 + 0.2 * Math.max(0, this.dieT / 0.5));
        if (this.dieT <= 0 && this.root.parent) this.root.parent.removeChild(this.root);
      }
      return;
    }
    if (!this.body) return;

    this.stateT += dt;
    this.atkCd -= dt;
    this.chargeCd -= dt;
    this.flashT -= dt;
    this.hpShowT -= dt;
    this.knockT -= dt;

    const t = this.body.translation();
    this.x = t.x;
    this.y = t.y;

    // 灼烧持续掉血
    if (this.burnT > 0) {
      this.burnT -= dt;
      this.hp -= 7 * dt;
      this.hpShowT = Math.max(this.hpShowT, 1);
      this.burnFxT -= dt;
      if (this.burnFxT <= 0) {
        this.burnFxT = 0.22;
        game.particles.burst(this.x, this.y - 0.3, { color: 0xff8a3a, count: 2, speed: 1.5, life: 0.45, size: 2.5, alpha: 0.9 });
      }
      if (this.hp <= 0) {
        this.die(game);
        return;
      }
    }

    const p = game.player;
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    const dist = Math.hypot(dx, dy);
    const night = game.isNight;
    const aggroR = this.def.aggroR * (night && this.def.kind === 'wolf' ? 1.45 : 1);

    let vx = 0;
    let vy = 0;
    let speed = this.def.speed * (this.def.boss && this.hp < this.def.hp * 0.35 ? 1.3 : 1);
    if (night && this.def.kind === 'wolf') speed *= 1.15; // 夜晚狼群更迅捷

    switch (this.state) {
      case 'idle':
      case 'wander': {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 1.5 + Math.random() * 3;
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 4;
          this.tx = this.home.x + Math.cos(a) * r;
          this.ty = this.home.y + Math.sin(a) * r;
          const targetOk = this.def.marine
            ? game.worldData.isWater(this.tx, this.ty)
            : game.worldData.isWalkable(this.tx, this.ty);
          if (!targetOk) {
            this.tx = this.home.x;
            this.ty = this.home.y;
          }
        }
        const ddx = this.tx - this.x;
        const ddy = this.ty - this.y;
        const dd = Math.hypot(ddx, ddy);
        if (dd > 0.3) {
          vx = (ddx / dd) * speed * 0.35;
          vy = (ddy / dd) * speed * 0.35;
        }
        // 进入仇恨 / 逃跑
        if (this.def.flee) {
          if (dist < 6 && !p.dead) this.setState('flee');
        } else if (aggroR > 0 && dist < aggroR && !p.dead) {
          this.startAggro(game);
        }
        break;
      }
      case 'flee': {
        if (dist > 11 || p.dead) {
          this.setState('wander');
          break;
        }
        const a = Math.atan2(-dy, -dx) + Math.sin(this.stateT * 3) * 0.5;
        vx = Math.cos(a) * speed;
        vy = Math.sin(a) * speed;
        break;
      }
      case 'chase': {
        // retaliate 类（山羊）aggroR 为 0，用保底脱战距离
        if (dist > Math.max(aggroR, 6) * 2.2 + 4 || p.dead) {
          this.aggro = false;
          this.setState('wander');
          break;
        }
        // 冲锋 / 突袭
        const cMin = this.def.chargeMin ?? 3;
        const cMax = this.def.chargeMax ?? (this.def.boss ? 9 : 7);
        if (this.def.charge && this.chargeCd <= 0 && dist > cMin && dist < cMax) {
          this.setState('windup');
          this.chargeDx = dx / dist;
          this.chargeDy = dy / dist;
          if (this.def.boss) sfx.roar();
          break;
        }
        // 近身攻击
        if (dist < this.def.atkR && this.atkCd <= 0) {
          this.setState('windup');
          this.chargeDx = 0;
          this.chargeDy = 0;
          break;
        }
        if (dist > this.def.atkR * 0.75) {
          vx = (dx / dist) * speed;
          vy = (dy / dist) * speed;
        }
        break;
      }
      case 'windup': {
        // 攻击前摇：原地蓄力 + 红色预警
        const wt = this.def.boss ? 0.5 : 0.38;
        this.drawAlert(this.stateT / wt);
        if (this.stateT >= wt) {
          this.alertG.clear();
          if (this.chargeDx !== 0 || this.chargeDy !== 0) {
            this.setState('charge');
            this.chargeCd = this.def.boss ? 4.2 : 3.5;
          } else {
            // 挥击判定
            this.atkCd = this.def.atkCd;
            const hitR = this.def.atkR + 0.55;
            if (dist < hitR && !p.dead) {
              const landed = p.takeDamage(this.def.dmg, (dx / (dist || 1)) * 7, (dy / (dist || 1)) * 7, game);
              if (landed && this.def.poison) p.applyPoison(4, game);
            }
            this.setState('chase');
          }
        }
        break;
      }
      case 'charge': {
        const chargeSpeed = this.def.chargeSpeed ?? (this.def.boss ? 11 : 9.5);
        const dur = this.def.chargeDur ?? (this.def.boss ? 0.85 : 0.65);
        vx = this.chargeDx * chargeSpeed;
        vy = this.chargeDy * chargeSpeed;
        // 冲撞判定
        if (dist < this.def.radius + 0.55 && !p.dead) {
          const landed = p.takeDamage(this.def.dmg * 1.4, this.chargeDx * 11, this.chargeDy * 11, game);
          if (landed && this.def.poison) p.applyPoison(4, game);
          this.setState('chase');
          break;
        }
        const aheadBlocked = this.def.marine
          ? !game.worldData.isWater(this.x + this.chargeDx, this.y + this.chargeDy)
          : !game.worldData.isWalkable(this.x + this.chargeDx, this.y + this.chargeDy);
        if (this.stateT >= dur || aheadBlocked) {
          this.setState('chase');
        }
        break;
      }
      case 'dying':
        break;
    }

    // 击退覆盖
    if (this.knockT > 0) {
      vx = this.kvx;
      vy = this.kvy;
      this.kvx *= Math.max(0, 1 - 5 * dt);
      this.kvy *= Math.max(0, 1 - 5 * dt);
    }
    // 海洋动物只能在水中移动（带轴向滑动，避免在岸边卡死）
    if (this.def.marine && (vx !== 0 || vy !== 0)) {
      const ok = (mx: number, my: number) => game.worldData.isWater(this.x + mx * 0.18, this.y + my * 0.18);
      if (!ok(vx, vy)) {
        if (ok(vx, 0)) vy = 0;
        else if (ok(0, vy)) vx = 0;
        else {
          vx = 0;
          vy = 0;
        }
      }
    }
    this.body.setLinvel({ x: vx, y: vy }, true);

    // ---- 视觉 ----
    const movingSpeed = Math.hypot(vx, vy);
    if (this.def.flying) this.bobT += dt * 7; // 飞行动物原地也扇翅膀
    if (movingSpeed > 0.2) {
      this.bobT += dt * (5 + movingSpeed * 1.6);
      const target = Math.atan2(vy, vx);
      let diff = target - this.faceAng;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.faceAng += diff * Math.min(1, dt * 10);
    }
    // 翻转而不是整体旋转（保持俯视感）：水平翻转 + 小幅倾斜
    const flip = Math.cos(this.faceAng) < 0 ? -1 : 1;
    this.bodyC.scale.x = flip;
    this.bodyC.rotation = Math.sin(this.faceAng) * 0.35 * flip;
    this.bodyC.y = -Math.abs(Math.sin(this.bobT)) * 2.2 - (this.def.flying ? 8 : 0);
    if (this.state === 'windup') {
      this.bodyC.x = Math.sin(this.stateT * 40) * 1.5; // 蓄力颤抖
    } else {
      this.bodyC.x = 0;
    }
    this.gfx.tint = this.flashT > 0 ? 0xffb0b0 : this.burnT > 0 ? 0xffc8a0 : 0xffffff;

    // 血条
    if (this.hpShowT > 0 || (this.def.boss && this.aggro)) {
      this.hpBar.visible = !this.def.boss;
      const w = this.def.boss ? 0 : 30;
      if (w > 0) {
        this.hpBar.clear();
        const top = -this.def.radius * SCALE - 16;
        this.hpBar.rect(-w / 2, top, w, 4).fill({ color: 0x000000, alpha: 0.6 });
        this.hpBar.rect(-w / 2 + 0.5, top + 0.5, (w - 1) * Math.max(0, this.hp / this.def.hp), 3).fill(0xe05448);
      }
    } else {
      this.hpBar.visible = false;
    }

    this.root.position.set(this.x * SCALE, this.y * SCALE);
    this.root.zIndex = this.y;
  }

  private drawAlert(t: number): void {
    this.alertG.clear();
    const r = (this.def.atkR + 0.4) * SCALE;
    this.alertG.circle(0, 0, r * Math.min(1, t)).stroke({ width: 3, color: 0xff4030, alpha: 0.7 });
    this.alertG.circle(0, 0, r).stroke({ width: 1.5, color: 0xff4030, alpha: 0.35 });
  }

  private startAggro(game: Game): void {
    this.aggro = true;
    this.setState('chase');
    if (this.def.boss && !this.roared) {
      this.roared = true;
      sfx.roar();
      game.addShake(0.6);
    }
    // 狼群联动
    if (this.def.kind === 'wolf') {
      for (const a of game.animals) {
        if (a !== this && !a.dead && a.def.kind === 'wolf' && Math.hypot(a.x - this.x, a.y - this.y) < 12) {
          if (a.state === 'idle' || a.state === 'wander') {
            a.aggro = true;
            a.setState('chase');
          }
        }
      }
    }
  }

  damage(dmg: number, kx: number, ky: number, game: Game): void {
    if (this.dead) return;
    this.hp -= dmg;
    this.flashT = 0.12;
    this.hpShowT = 4;
    const kMul = this.def.boss ? 0.12 : 1;
    this.kvx = kx * kMul;
    this.kvy = ky * kMul;
    this.knockT = 0.22;
    game.floats.show(this.x, this.y - this.def.radius, `${Math.round(dmg)}`, 0xffffff, this.def.boss ? 18 : 15);
    game.particles.burst(this.x, this.y, { color: 0xd6402f, count: 6, speed: 2.5, life: 0.4, size: 2.5 });

    if (this.hp <= 0) {
      this.die(game);
      return;
    }
    // 受击仇恨（retaliate 类平时中立，被打才反击）
    if (this.def.flee) {
      this.setState('flee');
    } else if (this.def.aggroR > 0 || this.def.retaliate) {
      this.startAggro(game);
    }
  }

  private die(game: Game): void {
    this.dead = true;
    this.setState('dying');
    this.dieT = 0.5;
    this.alertG.clear();
    this.hpBar.visible = false;
    if (this.body) {
      game.physWorld.removeRigidBody(this.body);
      this.body = null;
    }
    game.particles.burst(this.x, this.y, { color: this.def.color, count: 14, speed: 3.5, life: 0.6, size: 4 });
    // 资源掉落（拾荒者天赋：30% 概率翻倍）
    const mult = game.player.hasTalent('scavenger') && Math.random() < 0.3 ? 2 : 1;
    for (const [kind, n] of Object.entries(this.def.drops)) {
      game.drops.spawn(kind as ResKind, this.x, this.y, n * mult);
    }
    // 钱币掉落（幸运天赋：概率 ×1.5）
    const luck = game.player.hasTalent('lucky') ? 1.5 : 1;
    if (this.def.boss) {
      game.drops.spawn('silver', this.x, this.y, 18);
      game.drops.spawn('gold', this.x, this.y, 6);
      game.drops.spawn('diamond', this.x, this.y, 3);
    } else {
      const ct = COIN_TABLE[this.def.kind];
      if (Math.random() < 0.65 * luck) {
        game.drops.spawn('silver', this.x, this.y, Math.random() < 0.4 ? 2 : 1);
      }
      if (Math.random() < ct.gold * luck) game.drops.spawn('gold', this.x, this.y, 1);
      if (Math.random() < ct.diamond * luck) game.drops.spawn('diamond', this.x, this.y, 1);
    }
    game.onAnimalKilled(this);
  }

  /** 强制移除（重新生成动物时用） */
  destroy(game: Game): void {
    if (this.body) {
      game.physWorld.removeRigidBody(this.body);
      this.body = null;
    }
    if (this.root.parent) this.root.parent.removeChild(this.root);
    this.dead = true;
  }
}
