// @author: zhjj
// 玩家：移动 / 翻滚闪避（无敌帧）/ 三种武器攻击 / 资源与升级

import RAPIER from '@dimforge/rapier2d-compat';
import { Container, Graphics } from 'pixi.js';
import {
  CURRENCY, GROUPS, PLAYER, SCALE, WEAPON_BY_ID, WEAPON_UPG, SKIN_BY_ID, Tile,
  type CurrencyKind, type Price, type ResKind, type WeaponDef,
} from '../defs';
import type { Game } from '../game';
import { sfx } from '../core/audio';
import * as hud from '../ui/hud';

export class Player {
  body: RAPIER.RigidBody;
  root = new Container();
  private shadow = new Graphics();
  private boatG = new Graphics();
  private bodyC = new Container(); // 身体（带走路弹跳）
  private figure = new Graphics();
  private weaponG = new Graphics();
  private slashG = new Graphics();

  x = 0;
  y = 0;
  hp = PLAYER.hp;
  maxHp = PLAYER.hp;
  stam = PLAYER.stamina;
  maxStam = PLAYER.stamina;
  res: Record<ResKind, number> = { wood: 0, stone: 0, berry: 0, meat: 0, hide: 0 };
  upgrades = { atk: 0, hp: 0, stam: 0 };
  weaponIdx = 0;
  weapons: string[] = ['sword', 'spear', 'bow']; // 已拥有武器 id
  weaponLvls: Record<string, number> = {};
  coins: Record<CurrencyKind, number> = { silver: 0, gold: 0, diamond: 0 };
  skins: string[] = ['default'];
  activeSkin = 'default';
  talents = new Set<string>();
  gear = new Set<string>(); // 道具（小木舟等）
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
  private poisonT = 0; // 中毒剩余时间
  private poisonFloatT = 0;

  constructor(world: RAPIER.World, x: number, y: number, groups: number) {
    this.x = x;
    this.y = y;
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).lockRotations().setCcdEnabled(true);
    this.body = world.createRigidBody(desc);
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.ball(PLAYER.radius).setCollisionGroups(groups).setFriction(0).setRestitution(0),
      this.body,
    );

    this.shadow.ellipse(0, 6, 12, 5).fill({ color: 0x000000, alpha: 0.28 });
    this.root.addChild(this.shadow);
    this.root.addChild(this.slashG);
    // 小木舟（乘船时显示）
    this.boatG.ellipse(0, 3, 18, 10).fill(0x7a5230);
    this.boatG.ellipse(0, 3, 14, 7).fill(0x9a7048);
    this.boatG.poly([14, 3, 24, 1, 24, 5]).fill(0x7a5230); // 船头
    this.boatG.rect(-4, -1, 8, 2).fill(0x5e3d26); // 座板
    this.boatG.ellipse(0, 3, 18, 10).stroke({ width: 2, color: 0x5e3d26 });
    this.boatG.visible = false;
    this.root.addChild(this.boatG);
    this.drawFigure();
    this.bodyC.addChild(this.figure);
    this.bodyC.addChild(this.weaponG);
    this.root.addChild(this.bodyC);
    this.drawWeapon();
  }

  get weapon(): WeaponDef {
    return WEAPON_BY_ID[this.weapons[this.weaponIdx]] ?? WEAPON_BY_ID.sword;
  }

  get dmgMul(): number {
    return 1 + this.upgrades.atk * 0.15;
  }

  /** 武器最终伤害：基础 × 武器等级 × 篝火攻击强化 */
  weaponDmg(wd: WeaponDef): number {
    const lvl = this.weaponLvls[wd.id] ?? 0;
    return wd.dmg * (1 + WEAPON_UPG.dmgPerLvl * lvl) * this.dmgMul;
  }

  hasTalent(id: string): boolean {
    return this.talents.has(id);
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

    // 同步上一帧物理位置
    const t = this.body.translation();
    this.x = t.x;
    this.y = t.y;

    // 瞄准
    const mw = game.screenToWorld(input.mouseX, input.mouseY);
    this.aim = Math.atan2(mw.y - this.y, mw.x - this.x);

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
    this.moving = ml > 0;

    // 翻滚闪避
    if (
      (input.wasPressed('Space') || input.wasClickRight()) &&
      this.dashT <= 0 &&
      this.stam >= PLAYER.dashCost
    ) {
      this.dashT = PLAYER.dashTime;
      if (ml > 0) {
        this.dashDx = mx;
        this.dashDy = my;
      } else {
        this.dashDx = Math.cos(this.aim);
        this.dashDy = Math.sin(this.aim);
      }
      this.stam -= PLAYER.dashCost;
      this.stamDelay = 0.55;
      this.iframes = Math.max(this.iframes, PLAYER.dashIFrames);
      sfx.dash();
      game.particles.burst(this.x, this.y, { color: 0xd8d0b8, count: 7, speed: 2, life: 0.4, size: 3, alpha: 0.7 });
    }

    // 速度
    // 水面状态：拥有小木舟则自动乘船（乘船可穿越深水屏障）
    // 洞穴内部在地图坐标之外（tile 会返回深水），强制视为岩地
    const tileHere = game.inCave !== null ? Tile.Rock : game.worldData.tile(this.x, this.y);
    const onWater = tileHere <= Tile.Water;
    const sailingNow = onWater && this.gear.has('boat');
    if (sailingNow !== this.sailing) {
      this.sailing = sailingNow;
      this.collider.setCollisionGroups(sailingNow ? GROUPS.PLAYER_BOAT : GROUPS.PLAYER);
      this.boatG.visible = sailingNow;
      this.shadow.visible = !sailingNow;
    }

    let vx: number;
    let vy: number;
    if (this.dashT > 0) {
      this.dashT -= dt;
      vx = this.dashDx * PLAYER.dashSpeed;
      vy = this.dashDy * PLAYER.dashSpeed;
    } else {
      const rainMul = game.inCave !== null ? 1 : 1 - 0.2 * game.rainIntensity; // 雨天移速 -20%（洞内不受雨影响）
      const sp =
        (this.sailing
          ? 7.0
          : PLAYER.speed * (onWater ? 0.55 : 1) * (this.hasTalent('sprinter') ? 1.08 : 1)) * rainMul;
      vx = mx * sp;
      vy = my * sp;
    }

    // 溺水：在水中（未乘船）超过 5 秒持续掉血
    if (onWater && !this.sailing && !this.dead) {
      if (this.waterT <= 3.5 && this.waterT + dt > 3.5) {
        game.floats.show(this.x, this.y - 0.8, '体力不支…', 0x6ec6e0, 13);
      }
      this.waterT += dt;
      if (this.waterT > 5) {
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
    // 击退衰减
    const damp = Math.max(0, 1 - 6 * dt);
    this.kvx *= damp;
    this.kvy *= damp;
    this.body.setLinvel({ x: vx + this.kvx, y: vy + this.kvy }, true);

    // 耐力恢复
    if (this.stamDelay <= 0) this.stam = Math.min(this.maxStam, this.stam + PLAYER.staminaRegen * dt);

    // 武器切换（数字键对应已拥有武器列表）
    for (let i = 0; i < this.weapons.length && i < 8; i++) {
      if (input.wasPressed(`Digit${i + 1}`) && this.weaponIdx !== i) {
        this.weaponIdx = i;
        this.drawWeapon();
        hud.setWeapon(i);
        sfx.ui();
      }
    }

    // 攻击
    if (input.mouseLeft && this.cd <= 0 && !game.menuOpen) {
      this.attack(game);
    }

    // 进食（同时解除中毒）
    if (
      input.wasPressed('KeyQ') &&
      this.eatCd <= 0 &&
      this.res.berry > 0 &&
      (this.hp < this.maxHp || this.poisonT > 0)
    ) {
      this.res.berry--;
      this.heal(6, game);
      this.curePoison(game);
      this.eatCd = 1.0; // 进食有冷却，战斗中不能无限回血
      hud.bumpRes('berry', this.res.berry);
      sfx.eat();
    }
    if (
      input.wasPressed('KeyF') &&
      this.eatCd <= 0 &&
      this.res.meat > 0 &&
      (this.hp < this.maxHp || this.poisonT > 0)
    ) {
      this.res.meat--;
      this.heal(14, game);
      this.curePoison(game);
      this.eatCd = 1.0; // 进食有冷却，战斗中不能无限回血
      hud.bumpRes('meat', this.res.meat);
      sfx.eat();
    }

    // 中毒持续掉血（无视无敌帧，可被进食解除）
    if (this.poisonT > 0) {
      this.poisonT -= dt;
      this.hp -= 3 * dt;
      this.poisonFloatT -= dt;
      if (this.poisonFloatT <= 0) {
        this.poisonFloatT = 1;
        game.floats.show(this.x, this.y - 0.6, '-3', 0x8fd84a, 13);
        game.particles.burst(this.x, this.y - 0.3, { color: 0x8fd84a, count: 3, speed: 1.2, life: 0.5, size: 2 });
      }
      if (this.poisonT <= 0) this.curePoison(game);
      if (this.hp <= 0) {
        this.hp = 0;
        this.dead = true;
        hud.setPoison(false);
        game.onPlayerDeath();
      }
    }

    this.animate(dt);
  }

  private attack(game: Game): void {
    const wd = this.weapon;
    this.cd = wd.cd;
    this.swingT = 0;
    this.swingDir *= -1;
    if (wd.projectile) {
      game.projectiles.fire(
        this.x + Math.cos(this.aim) * 0.5,
        this.y + Math.sin(this.aim) * 0.5,
        this.aim,
        wd.projSpeed ?? 17,
        this.weaponDmg(wd),
        wd.knock,
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
    const r = wd.range * SCALE;
    const skin = SKIN_BY_ID[this.activeSkin] ?? SKIN_BY_ID.default;
    const color = wd.flame && skin.id === 'default' ? 0xffa050 : skin.slash;
    if (wd.id === 'spear') {
      g.poly([8, -3, r, -1.2, r, 1.2, 8, 3]).fill({ color, alpha: 0.5 });
    } else {
      g.arc(0, 0, r * 0.85, -wd.arc / 2, wd.arc / 2).arc(0, 0, r * 0.45, wd.arc / 2, -wd.arc / 2, true).closePath();
      g.fill({ color, alpha: 0.4 });
    }
    g.rotation = this.aim;
    g.alpha = 1;
  }

  heal(n: number, game: Game): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
    game.floats.show(this.x, this.y - 0.4, `+${n}`, 0x8fe88a, 14);
    game.particles.burst(this.x, this.y - 0.3, { color: 0x8fe88a, count: 6, speed: 1.5, life: 0.5, size: 2.5 });
  }

  /** 中毒：持续掉血，进食可解。返回值无；叠加时取剩余时间更长者 */
  applyPoison(duration: number, game: Game): void {
    if (this.dead) return;
    if (this.poisonT <= 0) {
      game.floats.show(this.x, this.y - 0.8, '中毒!', 0x8fd84a, 15);
      hud.setPoison(true);
    }
    this.poisonT = Math.max(this.poisonT, duration);
    this.figure.tint = 0xb0e890;
  }

  curePoison(game: Game): void {
    if (this.poisonT > 0) {
      game.floats.show(this.x, this.y - 0.8, '毒解', 0xcfe8cf, 13);
    }
    this.poisonT = 0;
    this.figure.tint = 0xffffff;
    hud.setPoison(false);
  }

  /** 返回 true 表示伤害实际生效（未被无敌帧挡掉） */
  takeDamage(dmg: number, kx: number, ky: number, game: Game): boolean {
    if (this.dead || this.iframes > 0) return false;
    if (this.hasTalent('tough')) dmg *= 0.9;
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

    // 翻滚时旋转身体
    if (this.dashT > 0) {
      this.bodyC.rotation += dt * 22 * (this.dashDx >= 0 ? 1 : -1);
    } else {
      this.bodyC.rotation = 0;
    }

    // 武器朝向 + 挥舞动画
    const wd = this.weapon;
    if (this.swingT >= 0) {
      this.swingT += dt / 0.16;
      if (this.swingT >= 1) this.swingT = -1;
    }
    let rot = this.aim;
    let off = 0;
    if (this.swingT >= 0 && !wd.projectile) {
      if (wd.id === 'spear') {
        off = Math.sin(this.swingT * Math.PI) * wd.range * 0.45 * SCALE * 0.5;
      } else {
        rot += (this.swingT - 0.5) * wd.arc * 1.5 * this.swingDir;
      }
    }
    this.weaponG.rotation = rot;
    this.weaponG.position.set(Math.cos(rot) * off * 0.04, Math.sin(rot) * off * 0.04 - 2);
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
