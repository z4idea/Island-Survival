// @author: zhjj
// 全局常量与数据定义：地形 / 武器 / 动物 / 资源

export const SCALE = 32; // 每个世界单位对应的像素数（1 单位 = 1 格）
export const MAP = 320; // 地图边长（格）
export const DAY_LENGTH = 300; // 一个昼夜循环的秒数

// 碰撞分组：(membership << 16) | filter
// STATIC=树木岩石 PLAYER=玩家 ANIMAL=陆地动物 WATER=深水屏障 MARINE=海洋动物
export const GROUPS = {
  STATIC: (0x0001 << 16) | 0x0006,
  PLAYER: (0x0002 << 16) | 0x000d, // 与静物/动物/深水屏障碰撞
  PLAYER_BOAT: (0x0002 << 16) | 0x0005, // 乘船：无视深水屏障
  ANIMAL: (0x0004 << 16) | 0x000f,
  MARINE: (0x0004 << 16) | 0x0002, // 海洋动物只与玩家碰撞（靠 AI 留在水里）
  WATER: (0x0008 << 16) | 0x0006,
} as const;

export enum Tile {
  DeepWater = 0,
  Water = 1,
  Sand = 2,
  Grass = 3,
  Forest = 4,
  Rock = 5,
}

export function walkable(t: Tile): boolean {
  return t >= Tile.Sand;
}

export const TILE_COLORS: Record<Tile, number> = {
  [Tile.DeepWater]: 0x14506b,
  [Tile.Water]: 0x2d7d9a,
  [Tile.Sand]: 0xe8d29a,
  [Tile.Grass]: 0x79b85a,
  [Tile.Forest]: 0x4e8f43,
  [Tile.Rock]: 0x8d8d85,
};

// ---------- 资源 ----------
export type ResKind = 'wood' | 'stone' | 'berry' | 'meat' | 'hide';
export const RES_EMOJI: Record<ResKind, string> = {
  wood: '🪵',
  stone: '🪨',
  berry: '🫐',
  meat: '🍖',
  hide: '🐾',
};
export const RES_NAME: Record<ResKind, string> = {
  wood: '木材',
  stone: '石块',
  berry: '浆果',
  meat: '生肉',
  hide: '兽皮',
};

// ---------- 货币 ----------
export type CurrencyKind = 'silver' | 'gold' | 'diamond';
export type Price = Partial<Record<CurrencyKind, number>>;

export const CURRENCY: Record<CurrencyKind, { name: string; char: string; color: number; css: string }> = {
  silver: { name: '银币', char: '●', color: 0xc8ccd2, css: '#c8ccd2' },
  gold: { name: '金币', char: '●', color: 0xffd24a, css: '#ffd24a' },
  diamond: { name: '钻石', char: '◆', color: 0x6ee0ff, css: '#6ee0ff' },
};

/** 击杀动物的金币/钻石掉率（银币全员 65% 概率 1~2 枚） */
export const COIN_TABLE: Record<AnimalKind, { gold: number; diamond: number }> = {
  crab: { gold: 0.06, diamond: 0.005 },
  gull: { gold: 0.08, diamond: 0.005 },
  deer: { gold: 0.08, diamond: 0.01 },
  snake: { gold: 0.12, diamond: 0.02 },
  boar: { gold: 0.12, diamond: 0.02 },
  wolf: { gold: 0.14, diamond: 0.03 },
  goat: { gold: 0.16, diamond: 0.03 },
  bear: { gold: 1, diamond: 1 },
  tiger: { gold: 0.2, diamond: 0.05 },
  fish: { gold: 0.03, diamond: 0.003 },
  turtle: { gold: 0.1, diamond: 0.015 },
  shark: { gold: 0.22, diamond: 0.05 },
  bat: { gold: 0.08, diamond: 0.02 },
};

// ---------- 道具（商店） ----------
export interface GearDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  price: Price;
}

export const GEAR: GearDef[] = [
  {
    id: 'boat', name: '小木舟', icon: '🛶',
    desc: '在水上自动乘船：不再溺水、航速提升，可远渡深海探索其他岛屿',
    price: { silver: 60, gold: 35 },
  },
];

export const GEAR_BY_ID: Record<string, GearDef> = Object.fromEntries(GEAR.map((g) => [g.id, g]));

// ---------- 武器 ----------
export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  dmg: number;
  range: number; // 攻击距离（世界单位）
  arc: number; // 攻击扇形角度（弧度）
  cd: number; // 冷却（秒）
  knock: number; // 击退力度
  projectile?: boolean; // 远程
  projSpeed?: number; // 弹道速度（默认 17）
  lunge?: number; // 攻击时向前的小冲量
  flame?: boolean; // 点燃敌人（灼烧 DoT）
  chopBonus?: number; // 伐木/采石额外掉落
  price?: Price; // 有价格 = 需在商店购买；无价格 = 初始拥有
}

const deg = (d: number) => (Math.PI * d) / 180;

export const WEAPONS: WeaponDef[] = [
  { id: 'sword', name: '猎刀', icon: '🗡️', desc: '均衡的横扫', dmg: 12, range: 1.7, arc: deg(120), cd: 0.45, knock: 6, lunge: 1.6 },
  { id: 'spear', name: '长矛', icon: '🔱', desc: '远距离突刺', dmg: 19, range: 2.7, arc: deg(44), cd: 0.8, knock: 9, lunge: 3.2 },
  { id: 'bow', name: '短弓', icon: '🏹', desc: '基础远程', dmg: 14, range: 14, arc: 0, cd: 0.95, knock: 4, projectile: true },
  { id: 'axe', name: '战斧', icon: '🪓', desc: '沉重劈砍，伐木采石收获 +1', dmg: 26, range: 1.9, arc: deg(140), cd: 0.72, knock: 10, lunge: 1.2, chopBonus: 1, price: { silver: 40 } },
  { id: 'daggers', name: '双刃', icon: '⚔️', desc: '极快的连击', dmg: 7.5, range: 1.35, arc: deg(100), cd: 0.16, knock: 2.5, lunge: 1.0, price: { silver: 60, gold: 5 } },
  { id: 'hammer', name: '重锤', icon: '🔨', desc: '巨力一击，超强击退', dmg: 34, range: 1.85, arc: deg(110), cd: 0.95, knock: 16, lunge: 0.8, price: { gold: 25 } },
  { id: 'crossbow', name: '劲弩', icon: '🎯', desc: '高速重型弩矢', dmg: 26, range: 16, arc: 0, cd: 1.0, knock: 8, projectile: true, projSpeed: 26, price: { silver: 40, gold: 30 } },
  { id: 'flamesword', name: '烈焰剑', icon: '🔥', desc: '攻击点燃敌人，持续灼烧', dmg: 18, range: 1.75, arc: deg(120), cd: 0.32, knock: 6, lunge: 1.6, flame: true, price: { gold: 20, diamond: 12 } },
];

export const WEAPON_BY_ID: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/** 武器升级：每级 +12% 伤害 */
export const WEAPON_UPG = {
  maxLvl: 5,
  dmgPerLvl: 0.12,
  cost(lvl: number): Price {
    const p: Price = { silver: 16 + 12 * lvl };
    if (lvl >= 2) p.gold = 3 * (lvl - 1);
    return p;
  },
};

// ---------- 武器皮肤 ----------
export interface SkinDef {
  id: string;
  name: string;
  desc: string;
  blade: number; // 刃部颜色
  accent: number; // 描边/配件颜色
  slash: number; // 挥砍残影颜色
  price?: Price; // 无价格 = 初始拥有
}

export const SKINS: SkinDef[] = [
  { id: 'default', name: '原色', desc: '朴实的本来面目', blade: 0, accent: 0, slash: 0xffffff },
  { id: 'gilded', name: '鎏金', desc: '金光流转，富贵逼人', blade: 0xffd87a, accent: 0xb8862b, slash: 0xffe9a0, price: { gold: 15 } },
  { id: 'jade', name: '翡翠', desc: '温润碧色', blade: 0x7ee8a0, accent: 0x2e8b57, slash: 0xa0ffc0, price: { gold: 15 } },
  { id: 'crimson', name: '血色', desc: '饮血之刃', blade: 0xff6b5d, accent: 0x8b1a10, slash: 0xff9a8a, price: { silver: 30, gold: 12 } },
  { id: 'ice', name: '寒冰', desc: '凛冬将至', blade: 0xa8e0ff, accent: 0x4682b4, slash: 0xd0f0ff, price: { diamond: 6 } },
];

export const SKIN_BY_ID: Record<string, SkinDef> = Object.fromEntries(SKINS.map((s) => [s.id, s]));

// ---------- 人物天赋 ----------
export interface TalentDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  price: Price;
}

export const TALENTS: TalentDef[] = [
  { id: 'scavenger', name: '拾荒者', icon: '🧺', desc: '采集与猎物资源有 30% 概率翻倍', price: { silver: 50 } },
  { id: 'lucky', name: '幸运', icon: '🍀', desc: '钱币掉落概率 +50%', price: { silver: 80 } },
  { id: 'sprinter', name: '疾风', icon: '💨', desc: '移动速度 +8%', price: { silver: 45, gold: 8 } },
  { id: 'vampire', name: '嗜血', icon: '🩸', desc: '近战击杀恢复 4 点生命', price: { gold: 18 } },
  { id: 'tough', name: '坚韧', icon: '🛡️', desc: '受到的伤害 -10%', price: { gold: 22 } },
];

export const TALENT_BY_ID: Record<string, TalentDef> = Object.fromEntries(TALENTS.map((t) => [t.id, t]));

// ---------- 动物 ----------
export type AnimalKind =
  | 'crab' | 'boar' | 'wolf' | 'deer' | 'bear' | 'snake' | 'goat' | 'gull'
  | 'tiger' | 'fish' | 'turtle' | 'shark' | 'bat';

export interface AnimalDef {
  kind: AnimalKind;
  name: string;
  hp: number;
  dmg: number;
  speed: number;
  aggroR: number; // 仇恨半径（0 = 被动）
  atkR: number;
  atkCd: number;
  radius: number; // 物理半径
  flee?: boolean; // 受惊逃跑（鹿 / 海鸥）
  charge?: boolean; // 冲锋（野猪 / 熊 / 蛇 / 山羊）
  chargeSpeed?: number; // 冲锋速度（默认 9.5，Boss 11）
  chargeDur?: number; // 冲锋持续（默认 0.65，Boss 0.85）
  chargeMin?: number; // 触发冲锋的最近距离（默认 3）
  chargeMax?: number; // 触发冲锋的最远距离（默认 7，Boss 9）
  poison?: boolean; // 攻击附带中毒（蛇）
  retaliate?: boolean; // 中立，受击才反击（山羊 / 海龟）
  flying?: boolean; // 飞行：无碰撞、可越过水面（海鸥）
  marine?: boolean; // 海洋动物：AI 限制在水中活动
  boss?: boolean;
  drops: Partial<Record<ResKind, number>>;
  color: number;
}

export const ANIMALS: Record<AnimalKind, AnimalDef> = {
  crab: {
    kind: 'crab', name: '岩蟹', hp: 32, dmg: 9, speed: 2.0, aggroR: 5, atkR: 0.95,
    atkCd: 1.1, radius: 0.32, drops: { meat: 1 }, color: 0xd95f43,
  },
  boar: {
    kind: 'boar', name: '野猪', hp: 78, dmg: 17, speed: 2.9, aggroR: 7.5, atkR: 1.1,
    atkCd: 1.4, radius: 0.45, charge: true, drops: { meat: 2, hide: 1 }, color: 0x7a5236,
  },
  wolf: {
    kind: 'wolf', name: '灰狼', hp: 52, dmg: 14, speed: 4.6, aggroR: 9.5, atkR: 1.15,
    atkCd: 0.95, radius: 0.4, drops: { meat: 1, hide: 2 }, color: 0x8a8f99,
  },
  deer: {
    kind: 'deer', name: '麋鹿', hp: 30, dmg: 0, speed: 4.6, aggroR: 0, atkR: 0,
    atkCd: 0, radius: 0.4, flee: true, drops: { meat: 2, hide: 1 }, color: 0xb98e5e,
  },
  bear: {
    kind: 'bear', name: '远古巨熊', hp: 750, dmg: 34, speed: 3.1, aggroR: 12, atkR: 2.3,
    atkCd: 1.7, radius: 0.95, charge: true, boss: true, drops: { meat: 8, hide: 6 }, color: 0x4f3a28,
  },
  tiger: {
    kind: 'tiger', name: '猛虎', hp: 110, dmg: 20, speed: 5.2, aggroR: 9, atkR: 1.3,
    atkCd: 1.0, radius: 0.55, charge: true, chargeSpeed: 11, chargeDur: 0.45, chargeMin: 2, chargeMax: 6,
    drops: { meat: 3, hide: 2 }, color: 0xe8923a,
  },
  fish: {
    kind: 'fish', name: '游鱼', hp: 10, dmg: 0, speed: 4.5, aggroR: 0, atkR: 0,
    atkCd: 0, radius: 0.22, flee: true, marine: true, drops: { meat: 1 }, color: 0x6aa8d8,
  },
  turtle: {
    kind: 'turtle', name: '海龟', hp: 70, dmg: 10, speed: 2.4, aggroR: 0, atkR: 1.0,
    atkCd: 1.5, radius: 0.5, retaliate: true, marine: true, drops: { meat: 2, hide: 1 }, color: 0x4e8f6a,
  },
  shark: {
    kind: 'shark', name: '巨鲨', hp: 90, dmg: 22, speed: 5.5, aggroR: 7.5, atkR: 1.1,
    atkCd: 1.2, radius: 0.6, charge: true, chargeSpeed: 12, chargeDur: 0.5, chargeMin: 2, chargeMax: 6,
    marine: true, drops: { meat: 3, hide: 2 }, color: 0x7a8a99,
  },
  snake: {
    kind: 'snake', name: '毒蛇', hp: 26, dmg: 8, speed: 3.4, aggroR: 4.5, atkR: 1.0,
    atkCd: 1.6, radius: 0.3, charge: true, chargeSpeed: 8.5, chargeDur: 0.4, chargeMin: 1.5, chargeMax: 5,
    poison: true, drops: { meat: 1 }, color: 0x6fae3f,
  },
  goat: {
    kind: 'goat', name: '岩山羊', hp: 55, dmg: 12, speed: 3.8, aggroR: 0, atkR: 1.05,
    atkCd: 1.2, radius: 0.42, charge: true, chargeSpeed: 8, chargeDur: 0.5,
    retaliate: true, drops: { meat: 1, hide: 2 }, color: 0xd8d4c8,
  },
  gull: {
    kind: 'gull', name: '海鸥', hp: 14, dmg: 0, speed: 5.2, aggroR: 0, atkR: 0,
    atkCd: 0, radius: 0.28, flee: true, flying: true, drops: { meat: 1 }, color: 0xf0f0ea,
  },
  bat: {
    kind: 'bat', name: '洞穴蝙蝠', hp: 18, dmg: 7, speed: 4.8, aggroR: 7, atkR: 0.9,
    atkCd: 1.0, radius: 0.3, drops: { hide: 1 }, color: 0x6a5a7a,
  },
};

// ---------- 升级 ----------
export interface UpgradeDef {
  id: 'atk' | 'hp' | 'stam';
  name: string;
  desc: string;
  maxLvl: number;
  cost: (lvl: number) => Partial<Record<ResKind, number>>;
}

export const UPGRADES: UpgradeDef[] = [
  {
    id: 'atk', name: '⚔️ 磨砺武器', desc: '攻击伤害 +15%', maxLvl: 8,
    cost: (l) => ({ wood: 8 + l * 5, stone: 5 + l * 4 }),
  },
  {
    id: 'hp', name: '❤️ 强健体魄', desc: '生命上限 +20', maxLvl: 8,
    cost: (l) => ({ meat: 3 + l * 2, hide: 2 + l * 2 }),
  },
  {
    id: 'stam', name: '⚡ 轻盈步伐', desc: '耐力上限 +20', maxLvl: 5,
    cost: (l) => ({ berry: 6 + l * 4, wood: 4 + l * 3 }),
  },
];

// ---------- 玩家 ----------
export const PLAYER = {
  radius: 0.34,
  speed: 5.3,
  hp: 100,
  stamina: 100,
  dashCost: 26,
  dashSpeed: 12,
  dashTime: 0.16, // 翻滚距离 ≈ 1.9 格（原 2.9）
  dashIFrames: 0.3,
  staminaRegen: 14, // 体力恢复放缓
};
