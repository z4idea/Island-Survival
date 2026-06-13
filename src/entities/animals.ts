// @author: zhjj
// 动物 AI：游荡 / 追击 / 逃跑 / 冲锋 / Boss 战斗模式

import RAPIER from '@dimforge/rapier2d-compat';
import { Container, Graphics } from 'pixi.js';
import { ANIMALS, COIN_TABLE, GROUPS, MINIBOSS_BY_ID, SCALE, Tile, type AnimalDef, type AnimalKind, type MiniBossDef, type ResKind } from '../defs';
import type { Game } from '../game';
import { sfx } from '../core/audio';
import type { CombatTarget } from './combat-target';

type State = 'idle' | 'wander' | 'chase' | 'windup' | 'charge' | 'flee' | 'latch' | 'dying';

/** 在 g 上画一颗小爱心（朝下尖） */
function drawHeart(g: Graphics, x: number, y: number, s: number, color: number, alpha: number): void {
  g.circle(x - s * 0.5, y - s * 0.3, s * 0.58).fill({ color, alpha });
  g.circle(x + s * 0.5, y - s * 0.3, s * 0.58).fill({ color, alpha });
  g.poly([x - s * 1.05, y - s * 0.08, x + s * 1.05, y - s * 0.08, x, y + s]).fill({ color, alpha });
}

export class Animal implements CombatTarget {
  readonly targetType = 'animal' as const;
  def: AnimalDef;
  body: RAPIER.RigidBody | null;
  root = new Container();
  private bodyC = new Container();
  private gfx = new Graphics();
  private hpBar = new Graphics();
  private alertG = new Graphics(); // 攻击预警（红色）
  private lovedG = new Graphics(); // 坠入爱河：环绕的粉色爱心（丘比特的弓）
  private enrageG = new Graphics(); // 狂暴：脚下的红色血气光环（神器守卫）

  x: number;
  y: number;
  hp: number;
  maxHp: number; // 出生时按成长系数定格
  dmg: number;
  private speedMul: number;
  dead = false;
  spawnIdx: number;
  burnT = 0; // 灼烧剩余时间（烈焰剑）
  private burnFxT = 0;
  private drainBudget = 20; // 吸血蝙蝠：吸满 20 点后消失
  private drainTickT = 0;

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

  get radius(): number {
    return this.def.radius;
  }
  aggro = false;
  loved = false; // 坠入爱河：不再主动攻击玩家（被打会心碎清醒）
  private loveT = 0; // 爱心环绕动画相位
  private loveFxT = 0; // 升腾爱心粒子间隔
  enraged = false; // 狂暴（神器守卫）：身体发红、攻击与移动更快、更暴躁
  private enrageFxT = 0; // 血气粒子间隔
  miniBoss: MiniBossDef | null = null; // 岛屿小 Boss（精英守护者）：倍率强化 + 专属掉落
  private bodyScale = 1; // 体型缩放（小 Boss 1.45），每帧朝向翻转时复用
  companion = false; // 玩家伙伴（丘比特收服）：跟随 + 战宠/加速，排除出玩家攻击目标
  foe: Animal | null = null; // 敌对动物当前的攻击目标：默认 null=打玩家，被战宠激怒则指向该战宠

  constructor(
    world: RAPIER.World,
    kind: AnimalKind,
    x: number,
    y: number,
    spawnIdx: number,
    groups: number,
    growth = 1, // 随游戏时长的成长系数（出生时快照）
    enraged = false, // 神器守卫：狂暴强化
    miniBossId?: string, // 岛屿小 Boss id（见 defs.MINIBOSSES）
  ) {
    this.def = ANIMALS[kind];
    this.enraged = enraged;
    this.miniBoss = miniBossId ? MINIBOSS_BY_ID[miniBossId] ?? null : null;
    const mb = this.miniBoss;
    // Boss 按半速成长，避免拖得久就打不动；小 Boss 随时长全速成长，再叠基底倍率
    const g = this.def.boss ? 1 + (growth - 1) * 0.5 : growth;
    this.maxHp = Math.round(this.def.hp * g * (enraged ? 1.25 : 1) * (mb ? mb.hpMul : 1));
    this.hp = this.maxHp;
    this.dmg = this.def.dmg * g * (enraged ? 1.35 : 1) * (mb ? mb.dmgMul : 1);
    this.speedMul = 1 + (g - 1) * 0.3; // 速度涨得最慢
    this.x = x;
    this.y = y;
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
    if (enraged) {
      const rr = this.def.radius * SCALE;
      this.enrageG.ellipse(0, rr * 0.5, rr * 1.3, rr * 0.62).fill({ color: 0xff2a1a, alpha: 0.5 });
      this.enrageG.ellipse(0, rr * 0.5, rr * 0.8, rr * 0.4).fill({ color: 0xff5030, alpha: 0.45 });
    }
    if (mb) {
      // 小 Boss：脚下金色王者光环
      const rr = this.def.radius * SCALE;
      this.enrageG.ellipse(0, rr * 0.6, rr * 1.6, rr * 0.7).fill({ color: 0xffd24a, alpha: 0.32 });
      this.enrageG.ellipse(0, rr * 0.6, rr * 1.0, rr * 0.45).fill({ color: 0xffe9a0, alpha: 0.3 });
      this.enrageG.visible = true;
    }
    this.enrageG.visible = enraged || mb !== null;
    this.root.addChild(this.enrageG);
    this.root.addChild(this.alertG);
    this.drawBody();
    if (mb) {
      // 头顶金色王冠 + 放大体型
      this.bodyScale = 1.45;
      this.bodyC.scale.set(1.45);
      const cy = -this.def.radius * SCALE - 8;
      this.gfx.poly([-7, cy, -7, cy - 7, -3.5, cy - 3, 0, cy - 9, 3.5, cy - 3, 7, cy - 7, 7, cy])
        .fill(0xffd24a).stroke({ width: 1, color: 0xb8860b });
    }
    this.bodyC.addChild(this.gfx);
    this.root.addChild(this.bodyC);
    this.hpBar.visible = false;
    this.root.addChild(this.hpBar);
    this.root.addChild(this.lovedG);
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
      case 'fox': {
        g.ellipse(-1, 0, 15, 9).fill(c);
        g.ellipse(2, 3, 8, 4).fill(0xf0e0d0); // 白色胸腹
        g.circle(12, -2, 6.5).fill(c); // 头
        g.poly([8, -7, 10, -14, 14, -7]).fill(c); // 大尖耳
        g.poly([14, -7, 18, -13, 19, -6]).fill(c);
        g.poly([9.5, -10, 10.5, -13, 12.5, -9]).fill(0x3a2a1a); // 耳内
        g.poly([16, -6, 22, -3, 16, -1]).fill(0xf0e0d0); // 尖吻
        g.circle(21, -2.5, 1).fill(0x2a1a10); // 鼻头
        g.circle(13, -4, 1.6).fill(0x8ad84a); // 绿瞳
        g.circle(16.5, -4, 1.6).fill(0x8ad84a);
        // 蓬松大尾巴（白尖）
        g.moveTo(-14, 0).quadraticCurveTo(-24, -6, -29, 1).quadraticCurveTo(-25, 5, -17, 4)
          .closePath().fill(c);
        g.circle(-27, 1, 3).fill(0xf0e0d0);
        break;
      }
      case 'bat': {
        g.ellipse(0, 0, 6, 8).fill(c); // 身体
        g.poly([-3, -2, -16, -8, -14, 2, -4, 3]).fill(0x4a3e58); // 左翼
        g.poly([3, -2, 16, -8, 14, 2, 4, 3]).fill(0x4a3e58);
        g.poly([-3, -7, -1, -11, 0, -7]).fill(c); // 耳朵
        g.poly([3, -7, 1, -11, 0, -7]).fill(c);
        g.circle(-2, -5, 1.2).fill(0xff5040); // 红眼
        g.circle(2, -5, 1.2).fill(0xff5040);
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

    // 战宠走独立分支（跟随 + 扑杀敌人），不混进敌人状态机
    if (this.companion) {
      this.updateCompanion(dt, game);
      return;
    }

    const p = game.player;
    // 攻击目标：默认玩家，被战宠攻击(taunt)后转向该战宠；战宠死/脱队则回到玩家
    if (this.foe && (this.foe.dead || !this.foe.companion)) this.foe = null;
    const foe = this.foe;
    const tgx = foe ? foe.x : p.x;
    const tgy = foe ? foe.y : p.y;
    const tgtDead = foe ? foe.dead : p.dead;
    const dx = tgx - this.x;
    const dy = tgy - this.y;
    const dist = Math.hypot(dx, dy);
    const night = game.isNight;
    const aggroR = this.def.aggroR * (night && this.def.kind === 'wolf' ? 1.45 : 1) * (this.miniBoss ? 1.8 : 1);

    let vx = 0;
    let vy = 0;
    let speed = this.def.speed * this.speedMul * ((this.def.boss || this.miniBoss) && this.hp < this.maxHp * 0.35 ? 1.3 : 1) * (this.enraged ? 1.55 : 1);
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
          if (dist < 6 && !tgtDead) this.setState('flee');
        } else if (!tgtDead && !this.loved && (dist < aggroR || ((this.enraged || this.miniBoss) && dist < 14))) {
          // 狂暴守卫 / 小 Boss：无视原本的被动/中立，主动扑向闯入者
          this.startAggro(game);
        }
        break;
      }
      case 'flee': {
        if (dist > 11 || tgtDead) {
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
        if (dist > Math.max(aggroR, 6) * 2.2 + 4 || tgtDead) {
          this.aggro = false;
          this.setState('wander');
          break;
        }
        // 吸血蝙蝠：贴近后挂到玩家头上
        if (this.def.latcher && dist < 0.6) {
          this.setState('latch');
          this.drainTickT = 0.6; // 咬住后稍顿再开始吸
          game.floats.show(p.x, p.y - 1, '蝙蝠咬住了你!', 0xff5040, 14);
          sfx.hurt();
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
        // 攻击前摇：原地蓄力 + 红色预警（狂暴时前摇更短，出手更快）
        const wt = (this.def.boss ? 0.5 : 0.38) * (this.enraged ? 0.6 : 1);
        this.drawAlert(this.stateT / wt);
        if (this.stateT >= wt) {
          this.alertG.clear();
          if (this.chargeDx !== 0 || this.chargeDy !== 0) {
            this.setState('charge');
            this.chargeCd = (this.def.boss ? 4.2 : 3.5) * (this.enraged ? 0.5 : 1);
          } else {
            // 挥击判定
            this.atkCd = this.def.atkCd * (this.enraged ? 0.55 : 1);
            const hitR = this.def.atkR + 0.55;
            if (dist < hitR && !tgtDead) {
              const kx = (dx / (dist || 1)) * 7;
              const ky = (dy / (dist || 1)) * 7;
              if (foe) {
                foe.takeEnemyHit(this.dmg, kx, ky, game); // 攻击战宠：纯伤害，无中毒/魅惑
              } else {
                const landed = p.takeDamage(this.dmg, kx, ky, game);
                if (landed && this.def.poison) p.applyPoison(4, game);
                if (landed && this.def.charm) p.applyCharm(3, game);
              }
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
        if (dist < this.def.radius + 0.55 && !tgtDead) {
          if (foe) {
            foe.takeEnemyHit(this.dmg * 1.4, this.chargeDx * 11, this.chargeDy * 11, game);
          } else {
            const landed = p.takeDamage(this.dmg * 1.4, this.chargeDx * 11, this.chargeDy * 11, game);
            if (landed && this.def.poison) p.applyPoison(4, game);
            if (landed && this.def.charm) p.applyCharm(3, game);
          }
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
      case 'latch': {
        // 挂在玩家头顶持续吸血；吸满额度后消失
        if (p.dead) {
          this.unlatch(game);
          break;
        }
        this.body.setTranslation(
          { x: p.x + Math.sin(this.stateT * 7) * 0.18, y: p.y - 0.55 },
          true,
        );
        this.drainTickT -= dt;
        if (this.drainTickT <= 0) {
          this.drainTickT = 1;
          const drain = Math.min(4, this.drainBudget);
          p.drainBlood(drain, game);
          this.drainBudget -= drain;
          game.particles.burst(p.x, p.y - 0.6, { color: 0xff5040, count: 3, speed: 1.5, life: 0.4, size: 2 });
          if (this.drainBudget <= 0) {
            this.vanish(game);
            return;
          }
        }
        break;
      }
      case 'dying':
        break;
    }

    this.finishUpdate(vx, vy, dt, game);
  }

  /** AI 决策后的统一收尾：击退/水域钳制/setLinvel + 朝向/弹跳/染色/光环/血条/层级（敌人与战宠共用） */
  private finishUpdate(vx: number, vy: number, dt: number, game: Game): void {
    if (!this.body) return;
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
    this.bodyC.scale.x = flip * this.bodyScale; // 小 Boss 放大体型（scale.y 在构造时设好）
    this.bodyC.rotation = Math.sin(this.faceAng) * 0.35 * flip;
    this.bodyC.y = -Math.abs(Math.sin(this.bobT)) * 2.2 - (this.def.flying ? 8 : 0);
    if (this.state === 'windup') {
      this.bodyC.x = Math.sin(this.stateT * 40) * 1.5; // 蓄力颤抖
    } else {
      this.bodyC.x = 0;
    }
    this.gfx.tint =
      this.flashT > 0 ? 0xffb0b0
        : this.burnT > 0 ? 0xffc8a0
          : this.loved ? 0xffc8e0
            : this.enraged ? 0xff5a4a // 狂暴：身体常态发红
              : 0xffffff;

    // 狂暴守卫：脚下血气光环脉动 + 升腾血色粒子
    if (this.enraged && !this.loved) {
      this.enrageG.visible = true;
      this.enrageG.alpha = 0.4 + Math.sin(game.time * 6) * 0.22;
      this.enrageFxT -= dt;
      if (this.enrageFxT <= 0) {
        this.enrageFxT = 0.4 + Math.random() * 0.5;
        game.particles.burst(this.x, this.y - this.def.radius * 0.4, {
          color: Math.random() < 0.5 ? 0xff4a3a : 0xff7040, count: 1, speed: 1.3, life: 0.5, size: 2.2, alpha: 0.85,
        });
      }
    } else {
      this.enrageG.visible = false;
    }

    // 坠入爱河：粉色爱心环绕 + 偶尔升腾的小爱心
    this.lovedG.clear();
    if (this.loved) {
      this.loveT += dt;
      const R = this.def.radius * SCALE + 9;
      for (let i = 0; i < 3; i++) {
        const a = this.loveT * 2.2 + (i * Math.PI * 2) / 3;
        const hx = Math.cos(a) * R;
        const hy = Math.sin(a) * R * 0.42 - this.def.radius * SCALE * 0.7;
        drawHeart(this.lovedG, hx, hy, 3.2, 0xff7ab0, Math.sin(a) > 0 ? 0.95 : 0.5);
      }
      this.loveFxT -= dt;
      if (this.loveFxT <= 0) {
        this.loveFxT = 0.8 + Math.random() * 0.7;
        game.particles.burst(this.x, this.y - this.def.radius - 0.3, {
          color: 0xff9ac8, count: 2, speed: 1, life: 0.6, size: 2, alpha: 0.9,
        });
      }
    }

    // 血条
    if (this.hpShowT > 0 || (this.def.boss && this.aggro)) {
      this.hpBar.visible = !this.def.boss;
      const w = this.def.boss ? 0 : 30;
      if (w > 0) {
        this.hpBar.clear();
        const top = -this.def.radius * SCALE - 16;
        this.hpBar.rect(-w / 2, top, w, 4).fill({ color: 0x000000, alpha: 0.6 });
        this.hpBar.rect(-w / 2 + 0.5, top + 0.5, (w - 1) * Math.max(0, this.hp / this.maxHp), 3).fill(0xe05448);
      }
    } else {
      this.hpBar.visible = false;
    }

    this.root.position.set(this.x * SCALE, this.y * SCALE);
    // 吸附中的蝙蝠画在玩家之上
    this.root.zIndex = this.state === 'latch' ? this.y + 2 : this.y;
  }

  /** 是否正吸附在玩家身上（吸附中无法被攻击） */
  get latched(): boolean {
    return this.state === 'latch';
  }

  /** 丘比特的弓：坠入爱河 —— 永久不再主动攻击玩家（被打会心碎清醒）。Boss 免疫 */
  makeLoved(game: Game): void {
    if (this.dead || this.loved) return;
    if (this.def.boss || this.miniBoss) {
      game.floats.show(this.x, this.y - 2, '巨兽不为所动…', 0xff8ac8, 14);
      return;
    }
    this.loved = true;
    this.aggro = false;
    this.alertG.clear();
    this.setState('wander');
    game.floats.show(this.x, this.y - 1, '坠入爱河!', 0xff8ac8, 16);
    game.particles.burst(this.x, this.y - 0.4, { color: 0xff8ac8, count: 14, speed: 2.5, life: 0.7, size: 3 });
    sfx.love();
  }

  /** 战宠/加速伙伴：跟随玩家；掠食者侦敌扑杀，食草者纯跟随（加速光环在玩家侧结算） */
  private updateCompanion(dt: number, game: Game): void {
    if (!this.body) return;
    const p = game.player;
    const speed = this.def.speed * this.speedMul * 1.2; // 略快以跟上玩家
    // 洞穴中或玩家死亡：原地待命
    if (game.inCave !== null || p.dead) {
      this.finishUpdate(0, 0, dt, game);
      return;
    }
    const pdx = p.x - this.x;
    const pdy = p.y - this.y;
    const pdist = Math.hypot(pdx, pdy);
    // 掉队太远：直接归队，免得被地形卡住
    if (pdist > 26) {
      this.body.setTranslation({ x: p.x - (pdx / (pdist || 1)) * 1.5, y: p.y - (pdy / (pdist || 1)) * 1.5 }, true);
      this.finishUpdate(0, 0, dt, game);
      return;
    }
    let vx = 0;
    let vy = 0;
    const enemy = this.def.dmg > 0 ? this.findEnemy(game) : null;
    if (enemy) {
      const ex = enemy.x - this.x;
      const ey = enemy.y - this.y;
      const ed = Math.hypot(ex, ey) || 1;
      const reach = this.def.atkR + enemy.radius + 0.3;
      if (ed <= reach) {
        if (this.atkCd <= 0) {
          this.atkCd = this.def.atkCd;
          enemy.foe = this; // 嘲讽：敌人转而攻击我
          enemy.damage(this.dmg, (ex / ed) * 7, (ey / ed) * 7, game);
          game.particles.burst((this.x + enemy.x) / 2, (this.y + enemy.y) / 2 - 0.3, { color: 0xfff0c0, count: 4, speed: 2.2, life: 0.3, size: 2.5 });
        }
      } else {
        vx = (ex / ed) * speed;
        vy = (ey / ed) * speed;
      }
    } else if (pdist > 2.6) {
      vx = (pdx / (pdist || 1)) * speed; // 跟随玩家
      vy = (pdy / (pdist || 1)) * speed;
    }
    this.finishUpdate(vx, vy, dt, game);
  }

  /** 战宠侦敌：最近的非伙伴/非爱河、可近战命中的威胁（仇恨中或有攻击力），范围 12 */
  private findEnemy(game: Game): Animal | null {
    let best: Animal | null = null;
    let bestD = 12 * 12;
    for (const a of game.animals) {
      if (a === this || a.dead || a.companion || a.loved) continue;
      if (a.def.marine || a.def.meleeImmune) continue; // 水里/飞太高打不到
      if (!a.aggro && a.def.dmg <= 0 && !a.def.boss && !a.miniBoss) continue; // 放过和平食草动物
      const d = (a.x - this.x) ** 2 + (a.y - this.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  /** 作为伙伴承受敌人伤害（纯伤害，无中毒/魅惑）；倒下即永久阵亡 */
  takeEnemyHit(dmg: number, kx: number, ky: number, game: Game): void {
    if (this.dead) return;
    this.hp -= dmg;
    this.flashT = 0.12;
    this.hpShowT = 4;
    this.kvx = kx;
    this.kvy = ky;
    this.knockT = 0.18;
    game.floats.show(this.x, this.y - this.def.radius, `${Math.round(dmg)}`, 0xff9ac8, 14);
    game.particles.burst(this.x, this.y, { color: 0xd6402f, count: 5, speed: 2.2, life: 0.4, size: 2.4 });
    if (this.hp <= 0) this.fallAsCompanion(game);
  }

  /** 伙伴阵亡：心碎消散，不掉落、不重生、不触发击杀结算（名册/存档交给 game.onCompanionDied） */
  private fallAsCompanion(game: Game): void {
    this.dead = true;
    this.setState('dying');
    this.dieT = 0.6;
    this.alertG.clear();
    this.hpBar.visible = false;
    this.lovedG.clear();
    if (this.body) {
      game.physWorld.removeRigidBody(this.body);
      this.body = null;
    }
    game.particles.burst(this.x, this.y - 0.3, { color: 0xff7ab0, count: 16, speed: 2.6, life: 0.85, size: 3 });
    game.onCompanionDied(this);
  }

  /** 强制脱离吸附（玩家进出洞穴 / 死亡时） */
  unlatch(game: Game): void {
    if (this.state !== 'latch' || !this.body) return;
    this.aggro = false;
    this.setState('wander');
    this.body.setTranslation({ x: this.home.x, y: this.home.y }, true);
    this.x = this.home.x;
    this.y = this.home.y;
    void game;
  }

  /** 吸饱后消失：不掉落，记录重生 */
  private vanish(game: Game): void {
    this.dead = true;
    this.setState('dying');
    this.dieT = 0.4;
    this.alertG.clear();
    this.hpBar.visible = false;
    if (this.body) {
      game.physWorld.removeRigidBody(this.body);
      this.body = null;
    }
    game.particles.burst(this.x, this.y, { color: 0x6a5a7a, count: 8, speed: 2, life: 0.4, size: 2.5, alpha: 0.8 });
    game.onAnimalKilled(this);
  }

  private drawAlert(t: number): void {
    this.alertG.clear();
    const r = (this.def.atkR + 0.4) * SCALE;
    this.alertG.circle(0, 0, r * Math.min(1, t)).stroke({ width: 3, color: 0xff4030, alpha: 0.7 });
    this.alertG.circle(0, 0, r).stroke({ width: 1.5, color: 0xff4030, alpha: 0.35 });
  }

  private startAggro(game: Game): void {
    if (this.loved) return; // 坠入爱河：不会仇恨玩家
    this.aggro = true;
    this.setState('chase');
    if (this.def.boss && !this.roared) {
      this.roared = true;
      sfx.roar();
      game.addShake(0.6);
    }
    // 狼群联动（爱河中的狼不响应）
    if (this.def.kind === 'wolf') {
      for (const a of game.animals) {
        if (a !== this && !a.dead && !a.loved && a.def.kind === 'wolf' && Math.hypot(a.x - this.x, a.y - this.y) < 12) {
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
    if (this.loved) {
      // 被攻击会心碎清醒，恢复原本的脾气
      this.loved = false;
      this.lovedG.clear();
      game.floats.show(this.x, this.y - 1.2, '心碎了…', 0xd88ab0, 13);
    }
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
    } else if (this.miniBoss) {
      game.drops.spawn('silver', this.x, this.y, 10);
      game.drops.spawn('gold', this.x, this.y, 4);
      game.drops.spawn('diamond', this.x, this.y, 2);
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
