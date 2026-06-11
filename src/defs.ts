// @author: zhjj
// 全局常量与数据定义：地形 / 武器 / 动物 / 资源

export const SCALE = 32; // 每个世界单位对应的像素数（1 单位 = 1 格）
export const MAP = 160; // 地图边长（格）
export const DAY_LENGTH = 300; // 一个昼夜循环的秒数

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

// ---------- 武器 ----------
export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  dmg: number;
  range: number; // 攻击距离（世界单位）
  arc: number; // 攻击扇形角度（弧度）
  cd: number; // 冷却（秒）
  knock: number; // 击退力度
  projectile?: boolean; // 弓
  lunge?: number; // 攻击时向前的小冲量
}

export const WEAPONS: WeaponDef[] = [
  { id: 'sword', name: '猎刀', icon: '🗡️', dmg: 12, range: 1.7, arc: (Math.PI * 120) / 180, cd: 0.32, knock: 6, lunge: 1.6 },
  { id: 'spear', name: '长矛', icon: '🔱', dmg: 19, range: 2.7, arc: (Math.PI * 44) / 180, cd: 0.62, knock: 9, lunge: 3.2 },
  { id: 'bow', name: '短弓', icon: '🏹', dmg: 14, range: 14, arc: 0, cd: 0.7, knock: 4, projectile: true },
];

// ---------- 动物 ----------
export type AnimalKind = 'crab' | 'boar' | 'wolf' | 'deer' | 'bear' | 'snake' | 'goat' | 'gull';

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
  retaliate?: boolean; // 中立，受击才反击（山羊）
  flying?: boolean; // 飞行：无碰撞、可越过水面（海鸥）
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
    kind: 'bear', name: '远古巨熊', hp: 560, dmg: 28, speed: 3.1, aggroR: 12, atkR: 2.3,
    atkCd: 1.7, radius: 0.95, charge: true, boss: true, drops: { meat: 8, hide: 6 }, color: 0x4f3a28,
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
  dashSpeed: 14.5,
  dashTime: 0.2,
  dashIFrames: 0.32,
  staminaRegen: 26,
};
