// @author: zhjj
// 玩家：移动 / 翻滚闪避（无敌帧）/ 三种武器攻击 / 资源与升级

import RAPIER from '@dimforge/rapier2d-compat';
import { Container, Graphics } from 'pixi.js';
import {
  CURRENCY, FOOD_BY_ID, GROUPS, PLAYER, SCALE, WEAPON_BY_ID, WEAPON_UPG, SKIN_BY_ID, Tile,
  type CurrencyKind, type FoodDef, type FoodKind, type Price, type ResKind, type WeaponDef,
} from '../defs';
import type { Game } from '../game';
import { sfx } from '../core/audio';
import { Statuses } from '../core/status';
import * as hud from '../ui/hud';
import type { CombatTarget } from './combat-target';
import type { MonkeyInventory, StolenItem } from './monkey-logic';

export class Player {
  body: RAPIER.RigidBody;
  root = new Container();
  private shadow = new Graphics();
  private boatG = new Graphics();
  private bodyC = new Container(); // 身体（带走路弹跳）
  private figure = new Graphics();
  private weaponG = new Graphics();
  private flameG = new Graphics(); // 烈焰剑：刃上常燃的火苗
  private slashG = new Graphics();
  private tridentSlashG = new Graphics(); // 三叉戟：攻击时的双层卷浪
  private tridentWakeG = new Graphics(); // 三叉戟：海中行走时的卷浪尾迹
  private rangeG = new Graphics(); // 权杖：身周施法领域环
  private castG = new Graphics(); // 权杖：施法落点标记
  private wingsC = new Container(); // 大天使的翅膀（挂件）
  private wingL = new Graphics();
  private wingR = new Graphics();

  x = 0;
  y = 0;
  hp = PLAYER.hp;
  maxHp = PLAYER.hp;
  stam = PLAYER.stamina;
  maxStam = PLAYER.stamina;
  res: Record<ResKind, number> = { wood: 0, stone: 0, berry: 0, meat: 0, hide: 0 };
  food: Record<FoodKind, number> = { cookedMeat: 0, berryJerky: 0, skewer: 0, stew: 0 };
  upgrades = { atk: 0, hp: 0, stam: 0 };
  weaponIdx = 0;
  weapons: string[] = ['sword', 'spear', 'bow']; // 已拥有武器 id
  weaponLvls: Record<string, number> = {};
  coins: Record<CurrencyKind, number> = { silver: 0, gold: 0, diamond: 0 };
  skins: string[] = ['default'];
  activeSkin = 'default';
  talents = new Set<string>();
  gear = new Set<string>(); // 道具（小木舟等）
  relics = new Set<string>(); // 神器挂件（大天使的翅膀等）
  trophies = new Set<string>(); // 小 Boss 战利品（永久被动，见 defs.TROPHIES）
  sailing = false; // 当前是否乘船
  waterT = 0; // 在水中（未乘船）的持续时间
  private drownTick = 0;
  private rippleT = 0;
  private collider: RAPIER.Collider;
  dead = false;

  aim = 0;
  private cd = 0;
  private swingT = -1; // 0..1 攻击动画进度，-1 表示未攻击
  private swingDir = 1;
  private dashT = -1;
  private dashDx = 0;
  private dashDy = 0;
  iframes = 0;
  private stamDelay = 0;
  private kvx = 0; // 击退速度
  private kvy = 0;
  private moving = false;
  private bobT = 0;
  private eatCd = 0;
  private atkBuffT = 0; // 烤肉串：临时攻击加成剩余秒数
  private atkBuffMul = 0; // 攻击加成倍率
  private regenT = 0; // 兽肉炖锅：持续回血剩余秒数
  private regenRate = 0; // 每秒回血量
  private regenFloatT = 0; // 持续回血飘字节流
  statuses = new Statuses(); // 中毒 / 流血 / 魅惑 / 溺水 / 食物中毒
  private statusKey = '';
  private poisonFloatT = 0;
  private skinFxT = 0;
  private flameEmberT = 0; // 烈焰剑余烬发射间隔
  private flameAnimT = 0; // 火苗跳动相位
  private animT = 0; // 通用动画相位（领域环脉动 / 圣翼呼吸）
  private netherEmberT = 0; // 权杖宝珠的冥火余烬间隔
  private thunderEmberT = 0; // 雷霆神矛的电芒火花间隔
  private tridentEmberT = 0; // 三叉戟的海蓝水沫间隔
  private tridentAttackAim = 0; // 三叉戟攻击开始时锁定的卷浪朝向
  private seaWalking = false; // 当前是否由三叉戟驱动踏浪
  private castTx = 0; // 权杖施法落点（已收束到领域内）
  private castTy = 0;
  private dashHits = new Set<CombatTarget>(); // 圣翼冲刺：每次冲刺对每个目标只伤害一次
  private wingsDrawn = false;
  private colGroup = GROUPS.PLAYER; // 当前碰撞组（乘船 / 圣翼相位时切换）

  constructor(world: RAPIER.World, x: number, y: number, groups: number) {
    this.x = x;
    this.y = y;
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).lockRotations().setCcdEnabled(true);
    this.body = world.createRigidBody(desc);
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.ball(PLAYER.radius).setCollisionGroups(groups).setFriction(0).setRestitution(0),
      this.body,
    );

    this.root.addChild(this.rangeG); // 施法领域环贴地，画在最底层
    this.tridentWakeG.visible = false;
    this.root.addChild(this.tridentWakeG);
    this.shadow.ellipse(0, 6, 12, 5).fill({ color: 0x000000, alpha: 0.28 });
    this.root.addChild(this.shadow);
    this.root.addChild(this.slashG);
    this.tridentSlashG.visible = false;
    this.root.addChild(this.tridentSlashG);
    this.root.addChild(this.castG);
    // 小木舟（乘船时显示）
    this.boatG.ellipse(0, 3, 18, 10).fill(0x7a5230);
    this.boatG.ellipse(0, 3, 14, 7).fill(0x9a7048);
    this.boatG.poly([14, 3, 24, 1, 24, 5]).fill(0x7a5230); // 船头
    this.boatG.rect(-4, -1, 8, 2).fill(0x5e3d26); // 座板
    this.boatG.ellipse(0, 3, 18, 10).stroke({ width: 2, color: 0x5e3d26 });
    this.boatG.visible = false;
    this.root.addChild(this.boatG);
    this.drawFigure();
    this.wingsC.addChild(this.wingL);
    this.wingsC.addChild(this.wingR);
    this.wingsC.visible = false;
    this.bodyC.addChild(this.wingsC); // 翅膀在身体之后
    this.bodyC.addChild(this.figure);
    this.bodyC.addChild(this.weaponG);
    this.bodyC.addChild(this.flameG);
    this.root.addChild(this.bodyC);
    this.drawWeapon();
  }

  get weapon(): WeaponDef {
    return WEAPON_BY_ID[this.weapons[this.weaponIdx]] ?? WEAPON_BY_ID.sword;
  }

  get dmgMul(): number {
    const buff = this.atkBuffT > 0 ? this.atkBuffMul : 0;
    const trophy = this.hasTrophy('tigerfang') ? 1.12 : 1; // 虎王之牙：攻击 +12%
    return (1 + this.upgrades.atk * 0.15) * (1 + buff) * trophy;
  }

  /** 武器最终伤害：基础 × 武器等级 × 篝火攻击强化 */
  weaponDmg(wd: WeaponDef): number {
    const lvl = this.weaponLvls[wd.id] ?? 0;
    return wd.dmg * (1 + WEAPON_UPG.dmgPerLvl * lvl) * this.dmgMul;
  }

  hasTalent(id: string): boolean {
    return this.talents.has(id);
  }

  hasTrophy(id: string): boolean {
    return this.trophies.has(id);
  }

  hasRelic(id: string): boolean {
    return this.relics.has(id);
  }

  canAfford(price: Price): boolean {
    return Object.entries(price).every(([k, n]) => this.coins[k as CurrencyKind] >= (n ?? 0));
  }

  pay(price: Price): void {
    for (const [k, n] of Object.entries(price)) {
      this.coins[k as CurrencyKind] -= n ?? 0;
    }
  }

  addCoin(kind: CurrencyKind, n: number, game: Game): void {
    this.coins[kind] += n;
    hud.bumpCoin(kind, this.coins[kind]);
    game.floats.show(this.x, this.y - 0.5, `+${n}${CURRENCY[kind].char}`, CURRENCY[kind].color, 13);
    sfx.pickup();
  }

  monkeyInventory(): MonkeyInventory {
    return { ...this.res, ...this.coins };
  }

  changeMonkeyItem(item: StolenItem, direction: -1 | 1): void {
    const next = Math.max(0, this.monkeyInventory()[item.kind] + item.amount * direction);
    if (item.kind in this.res) {
      const kind = item.kind as ResKind;
      this.res[kind] = next;
      hud.bumpRes(kind, next);
    } else {
      const kind = item.kind as CurrencyKind;
      this.coins[kind] = next;
      hud.bumpCoin(kind, next);
    }
  }

  private drawFigure(): void {
    const g = this.figure;
    g.clear();
    // 斗篷
    g.circle(0, 0, 11).fill(0x3a6f8f);
    g.circle(0, 0, 11).stroke({ width: 2, color: 0x27506a });
    // 头部 + 红头巾
    g.circle(0, -4, 6.5).fill(0xe8b88a);
    g.arc(0, -4, 6.5, Math.PI * 1.05, Math.PI * 1.95).fill(0xc94f3d);
    g.rect(-6.5, -6.5, 13, 3).fill(0xc94f3d);
  }

  /** 根据当前武器与皮肤重绘手持物 */
  drawWeapon(): void {
    const g = this.weaponG;
    g.clear();
    const wd = this.weapon;
    const skin = SKIN_BY_ID[this.activeSkin] ?? SKIN_BY_ID.default;
    const useSkin = skin.id !== 'default';
    // 各武器的本色刃部 / 配件色，可被皮肤覆盖
    const blade = (natural: number) => (useSkin ? skin.blade : natural);
    const accent = (natural: number) => (useSkin ? skin.accent : natural);

    switch (wd.id) {
      case 'sword':
        g.rect(10, -1.5, 7, 3).fill(0x6b4a2c); // 柄
        g.rect(16, -3.5, 3, 7).fill(accent(0xb89a50)); // 护手
        g.poly([19, -2.5, 36, -1, 38, 0, 36, 1, 19, 2.5]).fill(blade(0xd8dee2)); // 刃
        break;
      case 'spear':
        g.rect(6, -1.2, 40, 2.4).fill(0x8a6a3c);
        g.poly([46, -4, 56, 0, 46, 4]).fill(blade(0xc8ced2));
        break;
      case 'axe':
        g.rect(8, -1.6, 26, 3.2).fill(0x7a5a34); // 长柄
        g.poly([30, -3, 28, -12, 40, -8, 38, 0]).fill(blade(0xc8ced2)); // 上刃
        g.poly([30, 3, 28, 12, 40, 8, 38, 0]).fill(blade(0xb8bec4)); // 下刃
        g.rect(29, -3, 4, 6).fill(accent(0x8a8f99));
        break;
      case 'daggers':
        g.rect(8, -6.5, 6, 2.4).fill(0x5a4a32); // 双柄
        g.rect(8, 4.1, 6, 2.4).fill(0x5a4a32);
        g.poly([14, -6.5, 26, -5.8, 27, -5.3, 14, -4.1]).fill(blade(0xd8dee2)); // 双刃
        g.poly([14, 4.1, 26, 4.8, 27, 5.3, 14, 6.5]).fill(blade(0xd8dee2));
        break;
      case 'hammer':
        g.rect(8, -1.6, 24, 3.2).fill(0x7a5a34); // 柄
        g.roundRect(28, -8, 13, 16, 2).fill(blade(0x9aa0a8)); // 锤头
        g.rect(28, -8, 4, 16).fill(accent(0x6e747e));
        break;
      case 'bow':
        g.arc(22, 0, 13, -Math.PI / 2.2, Math.PI / 2.2).stroke({ width: 3, color: blade(0x8a6a3c) });
        g.moveTo(22 + 13 * Math.cos(-Math.PI / 2.2), 13 * Math.sin(-Math.PI / 2.2))
          .lineTo(22 + 13 * Math.cos(Math.PI / 2.2), 13 * Math.sin(Math.PI / 2.2))
          .stroke({ width: 1, color: 0xd8d4c8 });
        break;
      case 'crossbow':
        g.rect(8, -2, 22, 4).fill(0x6b4a2c); // 弩身
        g.arc(26, 0, 10, -Math.PI / 1.9, Math.PI / 1.9).stroke({ width: 3, color: blade(0x8a8f99) }); // 弩臂
        g.moveTo(26, -10).lineTo(26, 10).stroke({ width: 1, color: 0xd8d4c8 });
        g.rect(24, -1, 12, 2).fill(accent(0x9a7448)); // 上弦的弩矢
        break;
      case 'flamesword':
        g.rect(10, -1.5, 7, 3).fill(0x3a2a1c);
        g.rect(16, -3.5, 3, 7).fill(accent(0x8b3a10));
        g.poly([19, -2.5, 36, -1, 38, 0, 36, 1, 19, 2.5]).fill(blade(0xff8a3a)); // 烈焰刃
        g.poly([21, -2, 30, -1.2, 30, 1.2, 21, 2]).fill(useSkin ? skin.blade : 0xffd24a); // 焰心
        break;
      case 'cupidbow': {
        // 丘比特的弓：粉金弓臂 + 金色弓梢 + 心形装饰
        const a0 = -Math.PI / 2.2;
        const a1 = Math.PI / 2.2;
        g.arc(22, 0, 13, a0, a1).stroke({ width: 3.5, color: blade(0xf0b8d0) });
        g.moveTo(22 + 13 * Math.cos(a0), 13 * Math.sin(a0))
          .lineTo(22 + 13 * Math.cos(a1), 13 * Math.sin(a1))
          .stroke({ width: 1, color: 0xffe0ec });
        g.circle(22 + 13 * Math.cos(a0), 13 * Math.sin(a0), 2).fill(accent(0xe8c870));
        g.circle(22 + 13 * Math.cos(a1), 13 * Math.sin(a1), 2).fill(accent(0xe8c870));
        g.circle(33.5, -1.4, 1.8).fill(0xff5080); // 心形（搭在弦上的爱之箭头）
        g.circle(33.5, 1.4, 1.8).fill(0xff5080);
        g.poly([32, -2.6, 37.5, 0, 32, 2.6]).fill(0xff5080);
        break;
      }
      case 'scepter':
        // 阿比努斯的权杖：乌木杖身 + 金质月牙托 + 冥火宝珠
        g.rect(6, -1.4, 32, 2.8).fill(0x3a2a4a);
        g.rect(6, -1.4, 32, 1).fill(0x4e3a66); // 杖身高光
        g.poly([34, -4, 40, -8.5, 41, -2.5]).fill(accent(0xd8c060)); // 月牙托
        g.poly([34, 4, 40, 8.5, 41, 2.5]).fill(accent(0xd8c060));
        g.circle(42, 0, 7).fill({ color: 0x7af0c8, alpha: 0.18 }); // 宝珠外辉
        g.circle(42, 0, 4.5).fill(blade(0x7af0c8)); // 冥火宝珠
        g.circle(40.8, -1.2, 1.6).fill(0xd8fff0); // 珠内高光
        break;
      case 'thunderspear': {
        // 宙斯的雷霆神矛：矛身是一道金色闪电，外裹电芒辉光
        const bolt = [6, 1.4, 16, -3.2, 22, 1, 32, -3, 40, 0.6, 48, -1.8]; // Z 形闪电折线（武器本地坐标）
        // 外层辉光
        for (let i = 0; i < bolt.length - 2; i += 2) {
          g.moveTo(bolt[i], bolt[i + 1]).lineTo(bolt[i + 2], bolt[i + 3]).stroke({ width: 7, color: blade(0xffe24a), alpha: 0.28 });
        }
        // 金色矛身
        for (let i = 0; i < bolt.length - 2; i += 2) {
          g.moveTo(bolt[i], bolt[i + 1]).lineTo(bolt[i + 2], bolt[i + 3]).stroke({ width: 3.6, color: blade(0xffd24a) });
        }
        // 炽白电芯
        for (let i = 0; i < bolt.length - 2; i += 2) {
          g.moveTo(bolt[i], bolt[i + 1]).lineTo(bolt[i + 2], bolt[i + 3]).stroke({ width: 1.5, color: useSkin ? skin.blade : 0xfff8d8 });
        }
        // 矛尖
        g.poly([48, -4.4, 58, 0.4, 48, 2.6]).fill(blade(0xffe24a));
        g.poly([50, -1.6, 56, 0.4, 50, 1.4]).fill(useSkin ? skin.blade : 0xfff8d8);
        // 握柄护环
        g.circle(7, 0.7, 2.4).fill(accent(0xc8a030));
        break;
      }
      case 'trident': {
        // 波塞冬的三叉戟：蓝色杖身 + 三股鱼叉尖
        g.rect(6, -1.3, 30, 2.6).fill(accent(0x2a5a9a)); // 杖身
        g.rect(6, -1.3, 30, 1).fill(0x6ec6ff); // 高光
        g.rect(33, -7, 2.6, 14).fill(accent(0x2a5a9a)); // 横档
        // 中股（最长）
        g.rect(34, -1, 18, 2).fill(blade(0x3a9ad8));
        g.poly([50, -2.4, 57, 0, 50, 2.4]).fill(blade(0x6ec6ff));
        // 上股
        g.moveTo(34, -6).lineTo(48, -6).stroke({ width: 2.4, color: blade(0x3a9ad8) });
        g.poly([46, -8.4, 53, -6, 46, -3.6]).fill(blade(0x6ec6ff));
        // 下股
        g.moveTo(34, 6).lineTo(48, 6).stroke({ width: 2.4, color: blade(0x3a9ad8) });
        g.poly([46, 3.6, 53, 6, 46, 8.4]).fill(blade(0x6ec6ff));
        // 海蓝宝石
        g.circle(33, 0, 2.6).fill(useSkin ? skin.blade : 0x9ae0ff);
        break;
      }
    }
    this.drawCastUi(wd);
  }

  /** 权杖：施法领域环与落点标记（仅手持施法武器时显示） */
  private drawCastUi(wd: WeaponDef): void {
    this.rangeG.clear();
    this.castG.clear();
    this.rangeG.visible = !!wd.cast;
    this.castG.visible = !!wd.cast;
    if (!wd.cast) return;
    const r = (wd.castRange ?? 8) * SCALE;
    // 虚线领域环 + 朦胧外圈
    const SEG = 40;
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2;
      const a1 = a0 + ((Math.PI * 2) / SEG) * 0.55;
      this.rangeG.moveTo(Math.cos(a0) * r, Math.sin(a0) * r).arc(0, 0, r, a0, a1)
        .stroke({ width: 2, color: 0x7af0c8, alpha: 0.5 });
    }
    this.rangeG.circle(0, 0, r).stroke({ width: 10, color: 0x7af0c8, alpha: 0.05 });
    // 落点标记：圆环 + 中心点 + 四向刻度
    this.castG.circle(0, 0, 9).stroke({ width: 2, color: 0x7af0c8, alpha: 0.9 });
    this.castG.circle(0, 0, 2.2).fill({ color: 0x7af0c8, alpha: 0.9 });
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      this.castG.moveTo(Math.cos(a) * 12, Math.sin(a) * 12)
        .lineTo(Math.cos(a) * 17, Math.sin(a) * 17)
        .stroke({ width: 2, color: 0x7af0c8, alpha: 0.7 });
    }
  }

  /** 大天使的翅膀（挂件）：左右翼形，拥有后常驻背后 */
  private drawWings(): void {
    for (const [g, s] of [[this.wingR, 1], [this.wingL, -1]] as [Graphics, number][]) {
      g.clear();
      // 主翼面（白羽，向斜上展开）
      g.moveTo(0, 0)
        .quadraticCurveTo(10 * s, -14, 30 * s, -13)
        .quadraticCurveTo(22 * s, -6, 19 * s, -1)
        .quadraticCurveTo(10 * s, 4, 0, 2)
        .closePath()
        .fill(0xfdf8ec);
      // 分层羽片
      g.ellipse(26 * s, -10, 5, 2.4).fill(0xfffdf4);
      g.ellipse(20 * s, -4, 4.5, 2.2).fill(0xf6ecd6);
      g.ellipse(13 * s, 0, 4, 2).fill(0xf6ecd6);
      g.moveTo(4 * s, -3).quadraticCurveTo(14 * s, -9, 26 * s, -11).stroke({ width: 1.5, color: 0xe8d8b0 });
      // 金色描边（神性轮廓）
      g.moveTo(0, 0).quadraticCurveTo(10 * s, -14, 30 * s, -13).stroke({ width: 1.5, color: 0xe8c870, alpha: 0.9 });
      g.position.set(s * 3, -6);
    }
  }

  addRes(kind: ResKind, n: number, game: Game): void {
    this.res[kind] += n;
    hud.bumpRes(kind, this.res[kind]);
    game.floats.show(this.x, this.y - 0.5, `+${n}`, 0xffe9a0, 13);
    sfx.pickup();
  }

  update(dt: number, game: Game): void {
    if (this.dead) return;
    const input = game.input;
    this.cd -= dt;
    this.iframes -= dt;
    this.stamDelay -= dt;
    this.eatCd -= dt;
    this.atkBuffT -= dt;
    this.regenT -= dt;
    this.animT += dt;

    // 兽肉炖锅：持续回血（不打飘字会看不见，节流提示）
    if (this.regenT > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenRate * dt);
      this.regenFloatT -= dt;
      if (this.regenFloatT <= 0) {
        this.regenFloatT = 0.6;
        game.floats.show(this.x, this.y - 0.5, `+${this.regenRate}`, 0x8fe88a, 12);
      }
    }

    // 同步上一帧物理位置
    const t = this.body.translation();
    this.x = t.x;
    this.y = t.y;

    // 瞄准
    const mw = game.screenToWorld(input.mouseX, input.mouseY);
    this.aim = Math.atan2(mw.y - this.y, mw.x - this.x);

    // 权杖：施法落点（超出领域则收束到边缘），并驱动领域环/落点指示
    if (this.weapon.cast) {
      const cr = this.weapon.castRange ?? 8;
      let cdx = mw.x - this.x;
      let cdy = mw.y - this.y;
      const cl = Math.hypot(cdx, cdy);
      if (cl > cr) {
        cdx = (cdx / cl) * cr;
        cdy = (cdy / cl) * cr;
      }
      this.castTx = this.x + cdx;
      this.castTy = this.y + cdy;
      this.rangeG.alpha = 0.55 + Math.sin(this.animT * 2.5) * 0.25;
      this.castG.position.set(cdx * SCALE, cdy * SCALE);
      this.castG.rotation = this.animT * 1.5;
      this.castG.alpha = this.cd > 0 ? 0.25 : 0.9; // 冷却中变暗
    }

    // 移动输入
    let mx = 0;
    let my = 0;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) my -= 1;
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) my += 1;
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) mx -= 1;
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) mx += 1;
    const ml = Math.hypot(mx, my);
    if (ml > 0) {
      mx /= ml;
      my /= ml;
    }
    // 魅惑：移动方向颠倒
    if (this.statuses.has('charm')) {
      mx = -mx;
      my = -my;
      if (Math.random() < dt * 6) {
        game.particles.burst(this.x, this.y - 0.7, { color: 0xff8ac8, count: 1, speed: 1, life: 0.5, size: 2, alpha: 0.8 });
      }
    }
    this.moving = ml > 0;

    // 翻滚闪避
    if (
      (input.wasPressed('Space') || input.wasClickRight()) &&
      this.dashT <= 0 &&
      this.stam >= PLAYER.dashCost
    ) {
      const wings = this.relics.has('wings'); // 大天使的翅膀：翻滚变为圣翼冲刺
      this.dashT = wings ? 0.24 : PLAYER.dashTime;
      if (ml > 0) {
        this.dashDx = mx;
        this.dashDy = my;
      } else {
        this.dashDx = Math.cos(this.aim);
        this.dashDy = Math.sin(this.aim);
      }
      this.stam -= PLAYER.dashCost;
      this.stamDelay = 0.55;
      this.iframes = Math.max(this.iframes, wings ? 0.42 : PLAYER.dashIFrames);
      this.dashHits.clear();
      if (wings) {
        sfx.wing();
        game.particles.burst(this.x, this.y, { color: 0xfff6dc, count: 10, speed: 2.5, life: 0.5, size: 3, alpha: 0.9 });
      } else {
        sfx.dash();
        game.particles.burst(this.x, this.y, { color: 0xd8d0b8, count: 7, speed: 2, life: 0.4, size: 3, alpha: 0.7 });
      }
    }

    // 速度
    // 水面状态：拥有小木舟则自动乘船（乘船可穿越深水屏障）
    // 洞穴内部在地图坐标之外（tile 会返回深水），强制视为岩地
    const tileHere = game.inCave !== null ? Tile.Rock : game.worldData.tile(this.x, this.y);
    const onWater = tileHere <= Tile.Water;
    // 波塞冬的三叉戟：手持时踏浪行走（无需船、不溺水、可越深水）
    const seaWalking = onWater && this.weapon.seaLord;
    this.seaWalking = !!seaWalking;
    // 乘船优先级低于海神之力（拿三叉戟时不显示船）
    const sailingNow = onWater && this.gear.has('boat') && !seaWalking;
    const waterFree = sailingNow || seaWalking; // 可自由通行水面（不溺水、可越深水屏障）
    if (sailingNow !== this.sailing) {
      this.sailing = sailingNow;
      this.boatG.visible = sailingNow;
      this.shadow.visible = !sailingNow;
    }

    let vx: number;
    let vy: number;
    if (this.dashT > 0) {
      this.dashT -= dt;
      const wings = this.relics.has('wings');
      const dSpeed = wings ? 22 : PLAYER.dashSpeed; // 圣翼冲刺更迅疾
      vx = this.dashDx * dSpeed;
      vy = this.dashDy * dSpeed;
      if (wings) {
        // 圣翼冲刺：羽光尾迹 + 撞伤路径上的生物（每只一次）
        game.particles.burst(this.x - this.dashDx * 0.3, this.y - this.dashDy * 0.3, {
          color: Math.random() < 0.5 ? 0xfffdf4 : 0xffe9a0, count: 2, speed: 1.2, life: 0.45, size: 2.5, alpha: 0.9,
        });
        for (const target of game.combatTargets()) {
          if (target.dead || this.dashHits.has(target)) continue;
          if (target.targetType === 'animal' && (target.latched || target.def.meleeImmune)) continue;
          if (Math.hypot(target.x - this.x, target.y - this.y) < target.radius + 0.85) {
            this.dashHits.add(target);
            const kd = Math.atan2(target.y - this.y, target.x - this.x);
            target.damage(
              24 * this.dmgMul,
              Math.cos(kd) * 9 + this.dashDx * 4,
              Math.sin(kd) * 9 + this.dashDy * 4,
              game,
            );
            game.particles.burst(target.x, target.y, { color: 0xfff0c0, count: 8, speed: 3, life: 0.4, size: 3 });
            game.hitstop(0.025);
            sfx.hit();
          }
        }
      }
    } else {
      const rainMul = game.inCave !== null ? 1 : 1 - 0.2 * game.rainIntensity; // 雨天移速 -20%（洞内不受雨影响）
      const mane = this.hasTrophy('wolfmane') ? 1.1 : 1; // 头狼之鬃：移速 +10%
      const aura = game.companionSpeedMul(this.x, this.y); // 食草伙伴：加速光环
      let sp: number;
      if (seaWalking) sp = PLAYER.speed * 1.7 * (this.hasTalent('sprinter') ? 1.08 : 1) * mane * aura; // 海神之力：水上疾行
      else if (this.sailing) sp = 7.0;
      else sp = PLAYER.speed * (onWater ? 0.55 : 1) * (this.hasTalent('sprinter') ? 1.08 : 1) * mane * aura;
      sp *= rainMul;
      vx = mx * sp;
      vy = my * sp;
    }

    // 碰撞组同步：按状态动态拼装 filter（位定义见 defs.ts GROUPS）
    // 始终碰撞 ANIMAL(0x4)+WALL(0x10)；圣翼冲刺去掉 STATIC（穿树/石）；可通行水面去掉 WATER（越深水）
    const phasing = this.dashT > 0 && this.relics.has('wings');
    let filter = 0x0004 | 0x0010;
    if (!phasing) filter |= 0x0001; // STATIC
    if (!waterFree) filter |= 0x0008; // WATER
    const targetGroup = (0x0002 << 16) | filter;
    if (targetGroup !== this.colGroup) {
      this.colGroup = targetGroup;
      this.collider.setCollisionGroups(targetGroup);
    }

    // 溺水：在水中（未乘船 / 未踏浪）超过 5 秒持续掉血
    if (onWater && !waterFree && !this.dead) {
      if (this.waterT <= 3.5 && this.waterT + dt > 3.5) {
        game.floats.show(this.x, this.y - 0.8, '体力不支…', 0x6ec6e0, 13);
      }
      this.waterT += dt;
      if (this.waterT > 5) {
        this.statuses.add('drown', 0.4); // 维持型状态：驱动 HUD 图标
        this.drownTick -= dt;
        if (this.drownTick <= 0) {
          this.drownTick = 1;
          this.hp -= 4;
          game.floats.show(this.x, this.y - 0.6, '溺水 -4', 0x6ec6e0, 14);
          game.particles.burst(this.x, this.y, { color: 0xa8d8e8, count: 5, speed: 1.5, life: 0.5, size: 2.5, alpha: 0.8 });
          if (this.hp <= 0) {
            this.hp = 0;
            this.dead = true;
            game.onPlayerDeath();
            return;
          }
        }
      }
    } else {
      this.waterT = 0;
      this.drownTick = 0;
    }

    // 乘船视觉：船头转向 + 航迹涟漪
    if (this.sailing) {
      const lv = this.body.linvel();
      const spd = Math.hypot(lv.x, lv.y);
      if (spd > 0.5) {
        const target = Math.atan2(lv.y, lv.x);
        let diff = target - this.boatG.rotation;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.boatG.rotation += diff * Math.min(1, dt * 8);
        this.rippleT -= dt;
        if (this.rippleT <= 0) {
          this.rippleT = 0.18;
          game.particles.burst(this.x - lv.x * 0.06, this.y + 0.15 - lv.y * 0.06, {
            color: 0xcfeef2, count: 2, speed: 0.8, life: 0.6, size: 2.5, alpha: 0.5,
          });
        }
      }
    }
    // 踏浪行走（三叉戟）：Graphics 卷浪为主体，粒子只保留少量飞沫
    if (seaWalking && (vx !== 0 || vy !== 0)) {
      this.rippleT -= dt;
      if (this.rippleT <= 0) {
        this.rippleT = 0.18;
        game.particles.burst(this.x - vx * 0.05, this.y + 0.2 - vy * 0.05, {
          color: Math.random() < 0.5 ? 0x35bfe8 : 0xa7eaff,
          count: 1, speed: 1.1, life: 0.45, size: 2.6, alpha: 0.65,
        });
      }
    }
    // 击退衰减
    const damp = Math.max(0, 1 - 6 * dt);
    this.kvx *= damp;
    this.kvy *= damp;
    this.body.setLinvel({ x: vx + this.kvx, y: vy + this.kvy }, true);

    // 耐力恢复
    if (this.stamDelay <= 0) this.stam = Math.min(this.maxStam, this.stam + PLAYER.staminaRegen * dt);

    // 武器切换（数字键对应已拥有武器列表）
    for (let i = 0; i < this.weapons.length && i < 9; i++) {
      if (input.wasPressed(`Digit${i + 1}`) && this.weaponIdx !== i) {
        this.weaponIdx = i;
        this.drawWeapon();
        hud.setWeapon(i);
        sfx.ui();
      }
    }
    // 滚轮循环切换武器（向下 = 下一把，向上 = 上一把）
    if (input.wheel !== 0 && this.weapons.length > 1) {
      const dir = input.wheel > 0 ? 1 : -1;
      this.weaponIdx = (this.weaponIdx + dir + this.weapons.length) % this.weapons.length;
      this.drawWeapon();
      hud.setWeapon(this.weaponIdx);
      sfx.ui();
    }

    // 攻击
    if (input.mouseLeft && this.cd <= 0 && !game.menuOpen) {
      this.attack(game);
    }

    // 进食：Q 浆果类（优先熟食莓果干）/ F 肉类（优先熟食烤肉）/ R 料理（buff，可满血食用）
    // 生食回血弱且生肉有概率食物中毒，熟食回血高、零风险并能解食物中毒
    const wantHeal = this.hp < this.maxHp || this.statuses.has('poison') || this.statuses.has('foodpoison');
    if (input.wasPressed('KeyQ') && this.eatCd <= 0) {
      if (this.food.berryJerky > 0 && (wantHeal || this.stam < this.maxStam)) {
        this.consumeFood(FOOD_BY_ID.berryJerky, game);
      } else if (this.res.berry > 0 && wantHeal) {
        this.res.berry--;
        this.heal(4, game);
        this.curePoison(game);
        this.eatCd = 1.0; // 进食有冷却，战斗中不能无限回血
        hud.bumpRes('berry', this.res.berry);
        sfx.eat();
      }
    }
    if (input.wasPressed('KeyF') && this.eatCd <= 0) {
      if (this.food.cookedMeat > 0 && wantHeal) {
        this.consumeFood(FOOD_BY_ID.cookedMeat, game);
      } else if (this.res.meat > 0 && wantHeal) {
        this.eatRawMeat(game);
      }
    }
    if (input.wasPressed('KeyR') && this.eatCd <= 0) {
      if (this.food.skewer > 0) this.consumeFood(FOOD_BY_ID.skewer, game);
      else if (this.food.stew > 0) this.consumeFood(FOOD_BY_ID.stew, game);
    }

    // 中毒持续掉血（无视无敌帧，可被进食解除）
    if (this.statuses.has('poison')) {
      this.hp -= 3 * dt;
      this.poisonFloatT -= dt;
      if (this.poisonFloatT <= 0) {
        this.poisonFloatT = 1;
        game.floats.show(this.x, this.y - 0.6, '-3', 0x8fd84a, 13);
        game.particles.burst(this.x, this.y - 0.3, { color: 0x8fd84a, count: 3, speed: 1.2, life: 0.5, size: 2 });
      }
      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        game.onPlayerDeath();
        return;
      }
    }

    // 食物中毒持续掉血（生食所致，吃熟食或等时间解除）
    if (this.statuses.has('foodpoison')) {
      this.hp -= 2 * dt;
      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        game.onPlayerDeath();
        return;
      }
    }

    // 状态倒计时与到期处理 + HUD 图标同步
    const expired = this.statuses.update(dt);
    if (expired.includes('poison')) this.figure.tint = 0xffffff;
    if (expired.includes('charm')) game.floats.show(this.x, this.y - 0.6, '清醒了', 0xcfe8cf, 12);
    const key = this.statuses.list().join(',');
    if (key !== this.statusKey) {
      this.statusKey = key;
      hud.setStatuses(this.statuses.list());
    }

    // 烈焰剑：剑身持续冒火（与皮肤特效无关，是武器本体属性）
    if (this.weapon.flame) {
      this.flameEmberT -= dt;
      if (this.flameEmberT <= 0) {
        this.flameEmberT = 0.07;
        const d = 0.5 + Math.random() * 0.65; // 沿剑身随机位置
        const colors = [0xff8a3a, 0xffd24a, 0xff5030];
        game.particles.burst(
          this.x + Math.cos(this.aim) * d,
          this.y + Math.sin(this.aim) * d - 0.15,
          {
            color: colors[(Math.random() * 3) | 0],
            count: 1, speed: 0.7, life: 0.35 + Math.random() * 0.2, size: 2.2, alpha: 0.9,
          },
        );
      }
    }

    // 权杖：宝珠飘出幽绿冥火余烬
    if (this.weapon.cast) {
      this.netherEmberT -= dt;
      if (this.netherEmberT <= 0) {
        this.netherEmberT = 0.16;
        game.particles.burst(
          this.x + Math.cos(this.aim) * 1.3,
          this.y + Math.sin(this.aim) * 1.3 - 0.15,
          {
            color: Math.random() < 0.5 ? 0x7af0c8 : 0x4ae0a0,
            count: 1, speed: 0.6, life: 0.45, size: 2, alpha: 0.85,
          },
        );
      }
    }

    // 雷霆神矛：矛身缭绕的金色电芒火花（雨天更密）
    if (this.weapon.thunder) {
      this.thunderEmberT -= dt;
      if (this.thunderEmberT <= 0) {
        this.thunderEmberT = game.rainIntensity > 0.5 ? 0.05 : 0.11;
        const d = 0.7 + Math.random() * 1.2; // 沿矛身随机位置
        game.particles.burst(
          this.x + Math.cos(this.aim) * d + (Math.random() - 0.5) * 0.2,
          this.y + Math.sin(this.aim) * d - 0.15 + (Math.random() - 0.5) * 0.2,
          {
            color: Math.random() < 0.5 ? 0xffe24a : 0xfff8d8,
            count: 1, speed: 0.9, life: 0.3 + Math.random() * 0.2, size: 2, alpha: 0.9,
          },
        );
      }
    }

    // 三叉戟：戟身缭绕的海蓝水沫
    if (this.weapon.seaLord) {
      this.tridentEmberT -= dt;
      if (this.tridentEmberT <= 0) {
        this.tridentEmberT = 0.12;
        const d = 0.8 + Math.random() * 1.1; // 沿戟身随机位置
        game.particles.burst(
          this.x + Math.cos(this.aim) * d + (Math.random() - 0.5) * 0.25,
          this.y + Math.sin(this.aim) * d - 0.15 + (Math.random() - 0.5) * 0.25,
          {
            color: Math.random() < 0.5 ? 0x6ec6ff : 0x9ae0ff,
            count: 1, speed: 0.7, life: 0.35 + Math.random() * 0.2, size: 2, alpha: 0.85,
          },
        );
      }
    }

    // 皮肤待机微光
    this.skinFxT -= dt;
    if (this.skinFxT <= 0) {
      this.skinFxT = 0.45;
      const skin = SKIN_BY_ID[this.activeSkin];
      if (skin?.fx) {
        game.particles.burst(
          this.x + Math.cos(this.aim) * 0.75,
          this.y + Math.sin(this.aim) * 0.75 - 0.2,
          {
            color: Math.random() < 0.5 ? skin.fx.color : skin.fx.color2 ?? skin.fx.color,
            count: 1, speed: 0.5, life: 0.6, size: 1.8, alpha: 0.8,
          },
        );
      }
    }

    this.animate(dt);
  }

  private attack(game: Game): void {
    const wd = this.weapon;
    this.cd = wd.cd;
    this.swingT = 0;
    if (wd.seaLord) this.tridentAttackAim = this.aim;
    // 三叉戟：固定从左挥到右（180° 单向横扫）；其余武器左右交替
    this.swingDir = wd.seaLord ? 1 : -this.swingDir;
    // 皮肤粒子光效
    const skin = SKIN_BY_ID[this.activeSkin];
    if (skin?.fx) {
      const fxR = wd.projectile || wd.cast ? 0.8 : wd.range * 0.6;
      const fx = skin.fx;
      const tx = this.x + Math.cos(this.aim) * fxR;
      const ty = this.y + Math.sin(this.aim) * fxR;
      game.particles.burst(tx, ty, { color: fx.color, count: fx.count, speed: 2.4, life: 0.45, size: 2.5, alpha: 0.9 });
      if (fx.color2) {
        game.particles.burst(tx, ty, { color: fx.color2, count: Math.ceil(fx.count / 2), speed: 1.6, life: 0.55, size: 2 });
      }
    }
    if (wd.cast) {
      // 阿比努斯的权杖：在落点召唤冥火
      game.castNetherFire(this.castTx, this.castTy, this.weaponDmg(wd), wd.aoeR ?? 1.6, wd.knock);
      sfx.nether();
    } else if (wd.projectile) {
      game.projectiles.fire(
        this.x + Math.cos(this.aim) * 0.5,
        this.y + Math.sin(this.aim) * 0.5,
        this.aim,
        wd.projSpeed ?? 17,
        this.weaponDmg(wd),
        wd.knock,
        wd.loveChance ?? 0, // 丘比特的弓：爱心箭
      );
      sfx.bow();
    } else {
      if (wd.flame) {
        // 烈焰剑挥舞时的火星
        game.particles.burst(
          this.x + Math.cos(this.aim) * wd.range * 0.7,
          this.y + Math.sin(this.aim) * wd.range * 0.7,
          { color: 0xff8a3a, count: 5, speed: 2, life: 0.4, size: 2.5, alpha: 0.9 },
        );
      }
      if (wd.lunge) {
        this.kvx += Math.cos(this.aim) * wd.lunge;
        this.kvy += Math.sin(this.aim) * wd.lunge;
      }
      sfx.swing();
      game.meleeStrike(this, wd);
      this.drawSlash(wd);
    }
  }

  private drawSlash(wd: WeaponDef): void {
    const g = this.slashG;
    g.clear();
    if (wd.seaLord) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const r = wd.range * SCALE;
    const skin = SKIN_BY_ID[this.activeSkin] ?? SKIN_BY_ID.default;
    const color = wd.thunder && skin.id === 'default' ? 0xfff3a0 : wd.flame && skin.id === 'default' ? 0xffa050 : skin.slash;
    if (wd.thrust) {
      g.poly([8, -3, r, -1.2, r, 1.2, 8, 3]).fill({ color, alpha: 0.5 });
    } else {
      g.arc(0, 0, r * 0.85, -wd.arc / 2, wd.arc / 2).arc(0, 0, r * 0.45, wd.arc / 2, -wd.arc / 2, true).closePath();
      g.fill({ color, alpha: 0.4 });
    }
    g.rotation = this.aim;
    g.alpha = 1;
  }

  /** 三叉戟攻击：深蓝外浪、亮蓝内浪与浅蓝泡沫浪尖。 */
  private drawTridentSlash(): void {
    const g = this.tridentSlashG;
    const wd = this.weapon;
    g.clear();
    if (!wd.seaLord || this.swingT < 0) {
      g.visible = false;
      return;
    }

    const t = Math.min(1, this.swingT);
    const ease = 1 - (1 - t) * (1 - t);
    const fade = Math.min(1, t * 7) * Math.max(0, (1 - t) * 2.5);
    const start = -wd.arc / 2;
    const end = start + wd.arc * ease;
    const outerR = wd.range * SCALE * (0.72 + ease * 0.22);
    const innerR = outerR - 11;

    g.visible = true;
    g.rotation = this.tridentAttackAim;
    g.arc(0, 0, outerR, start, end).stroke({ width: 15, color: 0x167fb8, alpha: 0.58 * fade });
    g.arc(0, 0, innerR, start, end).stroke({ width: 7, color: 0x35bfe8, alpha: 0.86 * fade });

    const foamStep = 0.28;
    for (let a = start + 0.08; a < end - 0.04; a += foamStep) {
      const foamEnd = Math.min(end, a + 0.13);
      g.arc(0, 0, outerR + 7, a, foamEnd).stroke({
        width: 3,
        color: 0xa7eaff,
        alpha: 0.82 * fade,
      });
    }
  }

  /** 三叉戟踏浪：沿移动方向在玩家两侧卷起海浪。 */
  private drawTridentWake(): void {
    const g = this.tridentWakeG;
    const lv = this.body.linvel();
    const speed = Math.hypot(lv.x, lv.y);
    g.clear();
    if (!this.weapon.seaLord || !this.seaWalking || speed < 0.35) {
      g.visible = false;
      return;
    }

    const strength = Math.min(1, speed / (PLAYER.speed * 1.7));
    const curl = Math.sin(this.animT * 9) * 3;
    const length = 30 + strength * 17;
    const lift = 13 + strength * 10;
    g.visible = true;
    g.rotation = Math.atan2(lv.y, lv.x);
    g.alpha = 0.72 + strength * 0.22;

    for (const side of [-1, 1]) {
      const sy = side * 5;
      const crestY = side * (lift + curl);
      const tailY = side * (12 + curl * 0.45);
      g.moveTo(-3, sy)
        .bezierCurveTo(-14, side * 7, -21, crestY, -length, tailY)
        .stroke({ width: 11, color: 0x167fb8, alpha: 0.58 });
      g.moveTo(-5, side * 7)
        .bezierCurveTo(-17, side * 10, -24, side * (lift - 4 + curl), -length + 5, side * (10 + curl * 0.35))
        .stroke({ width: 5.5, color: 0x35bfe8, alpha: 0.9 });
      g.moveTo(-20, side * (lift - 1 + curl))
        .bezierCurveTo(-27, side * (lift + 3 + curl), -34, side * (16 + curl), -length + 1, tailY)
        .stroke({ width: 2.4, color: 0xa7eaff, alpha: 0.88 });
    }
  }

  heal(n: number, game: Game): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
    game.floats.show(this.x, this.y - 0.4, `+${n}`, 0x8fe88a, 14);
    game.particles.burst(this.x, this.y - 0.3, { color: 0x8fe88a, count: 6, speed: 1.5, life: 0.5, size: 2.5 });
  }

  /** 中毒：持续掉血，进食可解；叠加时取剩余时间更长者 */
  applyPoison(duration: number, game: Game): void {
    if (this.dead || this.hasTrophy('snakescale')) return; // 巨蟒之鳞：免疫中毒
    if (!this.statuses.has('poison')) {
      game.floats.show(this.x, this.y - 0.8, '中毒!', 0x8fd84a, 15);
    }
    this.statuses.add('poison', duration);
    this.figure.tint = 0xb0e890;
  }

  curePoison(game: Game): void {
    if (this.statuses.clear('poison')) {
      game.floats.show(this.x, this.y - 0.8, '毒解', 0xcfe8cf, 13);
    }
    this.figure.tint = 0xffffff;
  }

  /** 食物中毒（生肉所致）：持续轻微掉血，只能靠熟食或时间解除 */
  applyFoodPoison(duration: number, game: Game): void {
    if (this.dead || this.hasTrophy('snakescale')) return; // 巨蟒之鳞：免疫食物中毒
    if (!this.statuses.has('foodpoison')) {
      game.floats.show(this.x, this.y - 0.8, '🤢 食物中毒!', 0xc7a14a, 14);
    }
    this.statuses.add('foodpoison', duration);
  }

  cureFoodPoison(game: Game): void {
    if (this.statuses.clear('foodpoison')) {
      game.floats.show(this.x, this.y - 0.8, '肠胃舒服多了', 0xcfe8cf, 12);
    }
  }

  /** 熟食结算：回血 / 回耐力 / 攻击或回血 buff / 解蛇毒与食物中毒 */
  private consumeFood(def: FoodDef, game: Game): void {
    this.food[def.id]--;
    if (def.heal) this.heal(def.heal, game);
    if (def.stam) {
      this.stam = Math.min(this.maxStam, this.stam + def.stam);
      hud.setStam(this.stam, this.maxStam);
    }
    if (def.atkBuff) {
      this.atkBuffMul = def.atkBuff;
      this.atkBuffT = def.atkBuffDur ?? 0;
      game.floats.show(this.x, this.y - 0.9, `⚔️ 攻击 +${Math.round(def.atkBuff * 100)}%`, 0xffb347, 14);
    }
    if (def.regen) {
      this.regenRate = def.regen;
      this.regenT = def.regenDur ?? 0;
    }
    this.curePoison(game); // 进食解蛇毒（沿用既有机制）
    this.cureFoodPoison(game); // 熟食安抚肠胃
    this.eatCd = 1.0;
    hud.bumpFood(def.id, this.food[def.id]);
    sfx.eat();
  }

  /** 吃生肉：劣质应急口粮，回血弱且有概率食物中毒 */
  private eatRawMeat(game: Game): void {
    this.res.meat--;
    this.heal(7, game);
    this.curePoison(game); // 进食仍可解蛇毒
    if (Math.random() < 0.3) this.applyFoodPoison(6, game);
    this.eatCd = 1.0;
    hud.bumpRes('meat', this.res.meat);
    sfx.eat();
  }

  /** 魅惑（狐狸）：移动方向颠倒一段时间 */
  applyCharm(duration: number, game: Game): void {
    if (this.dead) return;
    if (!this.statuses.has('charm')) {
      game.floats.show(this.x, this.y - 0.8, '魅惑!', 0xff8ac8, 15);
      game.particles.burst(this.x, this.y - 0.6, { color: 0xff8ac8, count: 8, speed: 1.8, life: 0.6, size: 2.5 });
    }
    this.statuses.add('charm', duration);
  }

  /** 直接放血（蝙蝠吸血等）：无视无敌帧，并点亮流血状态 */
  drainBlood(n: number, game: Game): void {
    if (this.dead) return;
    this.hp -= n;
    this.statuses.add('bleed', 0.7);
    game.floats.show(this.x, this.y - 0.7, `🩸-${n}`, 0xff5040, 14);
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      game.onPlayerDeath();
    }
  }

  /** 清空全部状态（复活时） */
  clearStatuses(): void {
    this.statuses.clearAll();
    this.figure.tint = 0xffffff;
    this.statusKey = '';
    this.atkBuffT = 0;
    this.regenT = 0;
    hud.setStatuses([]);
  }

  /** 返回 true 表示伤害实际生效（未被无敌帧挡掉） */
  takeDamage(dmg: number, kx: number, ky: number, game: Game): boolean {
    if (this.dead || this.iframes > 0) return false;
    if (this.hasTalent('tough')) dmg *= 0.9;
    if (this.hasTrophy('crabshell')) dmg *= 0.88; // 蟹王之壳：受伤 -12%
    this.hp -= dmg;
    this.iframes = 0.7;
    this.kvx += kx;
    this.kvy += ky;
    game.floats.show(this.x, this.y - 0.6, `-${Math.round(dmg)}`, 0xff7a6b, 17);
    game.particles.burst(this.x, this.y, { color: 0xd6402f, count: 10, speed: 3, life: 0.45, size: 3 });
    game.addShake(0.35);
    game.hitstop(0.05);
    hud.flashVignette();
    sfx.hurt();
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      game.onPlayerDeath();
    }
    return true;
  }

  private animate(dt: number): void {
    if (this.sailing) this.bobT += dt * 3;
    else if (this.moving) this.bobT += dt * 11;
    const bob = this.moving && !this.sailing ? Math.abs(Math.sin(this.bobT)) * 2.5 : 0;
    this.bodyC.y = this.sailing ? -3 + Math.sin(this.bobT) * 1.2 : -bob;
    this.bodyC.scale.y = 1 - (this.moving ? Math.abs(Math.cos(this.bobT)) * 0.05 : 0);

    // 翻滚时旋转身体（圣翼冲刺是滑翔，不翻滚）
    const hasWings = this.relics.has('wings');
    if (this.dashT > 0 && !hasWings) {
      this.bodyC.rotation += dt * 22 * (this.dashDx >= 0 ? 1 : -1);
    } else {
      this.bodyC.rotation = 0;
    }

    // 大天使的翅膀：常驻折叠微颤，冲刺时展开扇动
    if (hasWings) {
      if (!this.wingsDrawn) {
        this.wingsDrawn = true;
        this.drawWings();
      }
      this.wingsC.visible = true;
      if (this.dashT > 0) {
        const flap = Math.sin(this.animT * 26) * 0.35;
        this.wingsC.scale.set(1.25);
        this.wingsC.alpha = 1;
        this.wingL.rotation = -0.25 - flap;
        this.wingR.rotation = 0.25 + flap;
      } else {
        this.wingsC.scale.set(0.55 + Math.sin(this.animT * 2.2) * 0.04);
        this.wingsC.alpha = 0.85;
        this.wingL.rotation = -0.5;
        this.wingR.rotation = 0.5;
      }
    } else {
      this.wingsC.visible = false;
    }

    // 武器朝向 + 挥舞动画
    const wd = this.weapon;
    if (this.swingT >= 0) {
      this.swingT += dt / 0.16;
      if (this.swingT >= 1) this.swingT = -1;
    }
    this.drawTridentSlash();
    this.drawTridentWake();
    let rot = this.aim;
    let off = 0;
    if (this.swingT >= 0 && !wd.projectile) {
      if (wd.thrust) {
        off = Math.sin(this.swingT * Math.PI) * wd.range * 0.45 * SCALE * 0.5;
      } else {
        rot += (this.swingT - 0.5) * wd.arc * 1.5 * this.swingDir;
      }
    }
    this.weaponG.rotation = rot;
    this.weaponG.position.set(Math.cos(rot) * off * 0.04, Math.sin(rot) * off * 0.04 - 2);

    // 烈焰剑：刃上跳动的火苗（跟随武器旋转，每帧重绘闪烁）
    if (wd.flame) {
      this.flameAnimT += dt * 14;
      const f = this.flameG;
      f.clear();
      f.visible = true;
      for (let i = 0; i < 3; i++) {
        const bx = 22 + i * 6.5; // 沿刃排布（武器本地坐标，刃在 19~38px）
        const h = 5 + Math.sin(this.flameAnimT + i * 2.1) * 2.2;
        f.poly([bx - 2.5, -1, bx, -1 - h, bx + 2.5, -1]).fill({
          color: i % 2 ? 0xffd24a : 0xff8a3a,
          alpha: 0.7 + 0.2 * Math.sin(this.flameAnimT * 1.7 + i),
        });
      }
      f.rotation = this.weaponG.rotation;
      f.position.copyFrom(this.weaponG.position);
    } else if (this.flameG.visible) {
      this.flameG.clear();
      this.flameG.visible = false;
    }

    this.slashG.alpha = Math.max(0, this.slashG.alpha - dt * 7);

    // 无敌帧闪烁
    this.root.alpha = this.iframes > 0 && Math.floor(this.iframes * 18) % 2 === 0 ? 0.45 : 1;

    this.root.position.set(this.x * SCALE, this.y * SCALE);
    this.root.zIndex = this.y;
  }

  /** 复活 / 传送 */
  teleport(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.body.setTranslation({ x, y }, true);
    this.body.setLinvel({ x: 0, y: 0 }, true);
    this.kvx = 0;
    this.kvy = 0;
    this.root.position.set(x * SCALE, y * SCALE);
  }
}
