// @author: zhjj
// 全局常量与数据定义：地形 / 武器 / 动物 / 资源

export const SCALE = 32; // 每个世界单位对应的像素数（1 单位 = 1 格）
export const MAP = 320; // 地图边长（格）
export const DAY_LENGTH = 300; // 一个昼夜循环的秒数

// 碰撞分组：(membership << 16) | filter
// 位：bit0=STATIC bit1=PLAYER bit2=ANIMAL bit3=WATER bit4=WALL
// STATIC=树木/岩石/水晶（圣翼冲刺可穿过） WALL=洞穴岩壁+地图边界墙（永不可穿越）
// PLAYER=玩家 ANIMAL=陆地动物 WATER=深水屏障 MARINE=海洋动物
export const GROUPS = {
  STATIC: (0x0001 << 16) | 0x0006,
  PLAYER: (0x0002 << 16) | 0x001d, // 与静物/动物/深水屏障/实墙碰撞
  PLAYER_BOAT: (0x0002 << 16) | 0x0015, // 乘船：无视深水屏障（仍被实墙/静物挡）
  PLAYER_PHASE: (0x0002 << 16) | 0x001c, // 圣翼冲刺：无视静物（树/石），但实墙/动物/深水仍阻挡
  ANIMAL: (0x0004 << 16) | 0x001f,
  MARINE: (0x0004 << 16) | 0x0002, // 海洋动物只与玩家碰撞（靠 AI 留在水里）
  WATER: (0x0008 << 16) | 0x0006,
  WALL: (0x0010 << 16) | 0x0006, // 洞穴岩壁 / 世界边界墙：圣翼冲刺也无法穿越
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

// ---------- 食物 / 烹饪 ----------
// 生食（浆果/生肉）回血弱且生肉有概率食物中毒，详见 player.ts；
// 在篝火把生鲜烤成熟食：回血更高、零中毒风险，部分料理附带临时增益。
export type FoodKind = 'cookedMeat' | 'berryJerky' | 'skewer' | 'stew';

export interface FoodDef {
  id: FoodKind;
  name: string;
  icon: string;
  desc: string;
  recipe: Partial<Record<ResKind, number>>; // 配方（含 🪵 木柴当燃料）
  heal: number; // 即时回血
  /** 进食快捷键归属：meat→F 肉类、berry→Q 浆果类、supply→R 料理（buff，可满血食用） */
  slot: 'meat' | 'berry' | 'supply';
  stam?: number; // 额外回复耐力
  atkBuff?: number; // 临时攻击加成倍率（0.2 = +20%）
  atkBuffDur?: number; // 攻击加成持续秒数
  regen?: number; // 持续回血速度（每秒）
  regenDur?: number; // 持续回血秒数
}

export const FOODS: FoodDef[] = [
  {
    id: 'cookedMeat', name: '烤肉', icon: '🍗',
    desc: '篝火慢烤的兽肉，安全管饱的基础口粮（按 F 食用）',
    recipe: { meat: 10, wood: 10 }, heal: 22, slot: 'meat',
  },
  {
    id: 'berryJerky', name: '莓果干', icon: '🍓',
    desc: '烘干的浆果，回血之余还能恢复体力（按 Q 食用）',
    recipe: { berry: 20, wood: 10 }, heal: 10, slot: 'berry', stam: 30,
  },
  {
    id: 'skewer', name: '烤肉串', icon: '🍢',
    desc: '焦香四溢，食用后 30 秒内攻击力 +20%（按 R 食用）',
    recipe: { meat: 20, berry: 10, wood: 10 }, heal: 18, slot: 'supply',
    atkBuff: 0.2, atkBuffDur: 30,
  },
  {
    id: 'stew', name: '兽肉炖锅', icon: '🥘',
    desc: '兽肉与兽皮慢炖的浓汤，10 秒内持续回血（按 R 食用）',
    recipe: { meat: 20, hide: 10, wood: 10 }, heal: 15, slot: 'supply',
    regen: 4, regenDur: 10,
  },
];

export const FOOD_BY_ID = Object.fromEntries(FOODS.map((f) => [f.id, f])) as Record<FoodKind, FoodDef>;

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
  fox: { gold: 0.2, diamond: 0.05 },
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
  loveChance?: number; // 丘比特的弓：命中动物坠入爱河的概率
  cast?: boolean; // 施法武器（权杖）：在鼠标点击处召唤攻击
  castRange?: number; // 施法领域半径（世界单位）
  aoeR?: number; // 施法爆发半径（世界单位）
  thrust?: boolean; // 突刺型挥舞动画（长矛 / 雷霆神矛）
  thunder?: boolean; // 宙斯的雷霆神矛：命中动物召唤天降闪电（雨天升级为大型闪电）
  seaLord?: boolean; // 波塞冬的三叉戟：水域大幅加速 + 踏浪行走（无需船、不溺水）
  artifact?: boolean; // 神器：不在商店出售，只能通过神器祝福获得
  price?: Price; // 有价格 = 需在商店购买；无价格 = 初始拥有
}

const deg = (d: number) => (Math.PI * d) / 180;

export const WEAPONS: WeaponDef[] = [
  { id: 'sword', name: '猎刀', icon: '🗡️', desc: '均衡的横扫', dmg: 12, range: 1.7, arc: deg(120), cd: 0.45, knock: 6, lunge: 1.6 },
  { id: 'spear', name: '长矛', icon: '🔱', desc: '远距离突刺', dmg: 19, range: 2.7, arc: deg(44), cd: 0.8, knock: 9, lunge: 3.2, thrust: true },
  { id: 'bow', name: '短弓', icon: '🏹', desc: '基础远程', dmg: 14, range: 14, arc: 0, cd: 0.95, knock: 4, projectile: true },
  { id: 'axe', name: '战斧', icon: '🪓', desc: '沉重劈砍，伐木采石收获 +1', dmg: 26, range: 1.9, arc: deg(140), cd: 0.72, knock: 10, lunge: 1.2, chopBonus: 1, price: { silver: 40 } },
  { id: 'daggers', name: '双刃', icon: '⚔️', desc: '极快的连击', dmg: 7.5, range: 1.35, arc: deg(100), cd: 0.16, knock: 2.5, lunge: 1.0, price: { silver: 60, gold: 5 } },
  { id: 'hammer', name: '重锤', icon: '🔨', desc: '巨力一击，超强击退', dmg: 34, range: 1.85, arc: deg(110), cd: 0.95, knock: 16, lunge: 0.8, price: { gold: 25 } },
  { id: 'crossbow', name: '劲弩', icon: '🎯', desc: '高速重型弩矢', dmg: 26, range: 16, arc: 0, cd: 1.0, knock: 8, projectile: true, projSpeed: 26, price: { silver: 40, gold: 30 } },
  { id: 'flamesword', name: '烈焰剑', icon: '🔥', desc: '攻击点燃敌人，持续灼烧', dmg: 18, range: 1.75, arc: deg(120), cd: 0.32, knock: 6, lunge: 1.6, flame: true, price: { gold: 20, diamond: 12 } },
  // ---- 神器武器（神器祝福获得，不在商店出售） ----
  {
    id: 'cupidbow', name: '丘比特的弓', icon: '💘', desc: '爱神的金弓：被射中的动物有 10% 概率坠入爱河，从此不再攻击你',
    dmg: 16, range: 15, arc: 0, cd: 0.7, knock: 4, projectile: true, projSpeed: 20, loveChance: 0.1, artifact: true,
  },
  {
    id: 'scepter', name: '阿比努斯的权杖', icon: '🪄', desc: '冥界引渡者的权杖：在施法领域内点击地面，自地底唤起冥火焚烧敌人',
    dmg: 30, range: 8.5, arc: 0, cd: 1.1, knock: 7, cast: true, castRange: 8.5, aoeR: 1.7, artifact: true,
  },
  {
    id: 'thunderspear', name: '宙斯的雷霆神矛', icon: '⚡', desc: '众神之王的雷矛：命中的动物会被天降闪电劈中；雨天电闪雷鸣，化作威力更大的巨型雷霆',
    dmg: 22, range: 2.8, arc: deg(46), cd: 0.85, knock: 9, lunge: 3.2, thrust: true, thunder: true, artifact: true,
  },
  {
    id: 'trident', name: '波塞冬的三叉戟', icon: '🔱', desc: '海神的三叉戟：180° 横扫全场；身处海洋时水上疾行、踏浪而走，无需小舟也能纵横深海',
    dmg: 18, range: 2.2, arc: deg(180), cd: 0.55, knock: 8, lunge: 1.4, seaLord: true, artifact: true,
  },
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
  fx?: { color: number; color2?: number; count: number }; // 粒子光效（挥击迸发 + 待机微光）
  price?: Price; // 无价格 = 初始拥有
}

export const SKINS: SkinDef[] = [
  { id: 'default', name: '原色', desc: '朴实的本来面目', blade: 0, accent: 0, slash: 0xffffff },
  { id: 'gilded', name: '鎏金', desc: '金光流转，富贵逼人', blade: 0xffd87a, accent: 0xb8862b, slash: 0xffe9a0, fx: { color: 0xffe9a0, count: 3 }, price: { gold: 15 } },
  { id: 'jade', name: '翡翠', desc: '温润碧色', blade: 0x7ee8a0, accent: 0x2e8b57, slash: 0xa0ffc0, fx: { color: 0x8fe8a8, count: 3 }, price: { gold: 15 } },
  { id: 'crimson', name: '血色', desc: '饮血之刃', blade: 0xff6b5d, accent: 0x8b1a10, slash: 0xff9a8a, fx: { color: 0xff7a6b, count: 3 }, price: { silver: 30, gold: 12 } },
  { id: 'ice', name: '寒冰', desc: '凛冬将至', blade: 0xa8e0ff, accent: 0x4682b4, slash: 0xd0f0ff, fx: { color: 0xc8ecff, color2: 0x6ec6e0, count: 4 }, price: { diamond: 6 } },
  { id: 'starlight', name: '星辉', desc: '缀满星尘的传说之刃', blade: 0xfff8d8, accent: 0xb8a8ff, slash: 0xfff0c0, fx: { color: 0xfff0a0, color2: 0xb8a8ff, count: 6 }, price: { diamond: 15 } },
  { id: 'void', name: '幽冥', desc: '深渊的低语缠绕刀锋', blade: 0x6a4a9a, accent: 0x2a1a4a, slash: 0xb08aff, fx: { color: 0x8a5aff, color2: 0x3a2a6a, count: 5 }, price: { gold: 30, diamond: 8 } },
  { id: 'thunder', name: '雷光', desc: '裂空之雷，余响不绝', blade: 0xfff8b0, accent: 0x4a8ae0, slash: 0xd8f0ff, fx: { color: 0xffe860, color2: 0x8ad8ff, count: 6 }, price: { gold: 40, diamond: 10 } },
];

export const SKIN_BY_ID: Record<string, SkinDef> = Object.fromEntries(SKINS.map((s) => [s.id, s]));

// ---------- 神器（神器祝福获得） ----------
export interface ArtifactDef {
  id: string; // 武器 id（slot=weapon）或挂件 id（slot=relic）
  slot: 'weapon' | 'relic'; // 武器进武器栏；挂件是被动饰品（新系列）
  name: string;
  icon: string;
  desc: string;
  lore: string; // 神话出处风味文案（祝福仪式上展示）
  color: number; // 主题色（特效与 UI）
  css: string;
}

export const ARTIFACTS: ArtifactDef[] = [
  {
    id: 'cupidbow', slot: 'weapon', name: '丘比特的弓', icon: '💘',
    desc: '爱神的金弓 —— 被金箭射中的动物有 10% 概率坠入爱河：被粉色爱心环绕，从此爱慕你、永不攻击你',
    lore: '「被金箭命中的心，会燃起永不熄灭的爱火。」 —— 奥维德《变形记》',
    color: 0xff8ac8, css: '#ff8ac8',
  },
  {
    id: 'scepter', slot: 'weapon', name: '阿比努斯的权杖', icon: '🪄',
    desc: '冥界引渡者的乌木权杖 —— 持杖时身周浮现施法领域，在领域内点击，自地底唤起冥火焚烧敌人',
    lore: '「亡者之火不灼生者，除非持杖者意欲如此。」 —— 《亡灵之书》残卷',
    color: 0x7af0c8, css: '#7af0c8',
  },
  {
    id: 'thunderspear', slot: 'weapon', name: '宙斯的雷霆神矛', icon: '⚡',
    desc: '众神之王的雷矛 —— 形如金色闪电、电芒缭绕。命中的动物会被一道天降闪电劈中；雨天电闪雷鸣，化作威力更大的巨型雷霆',
    lore: '「他掷出的不是长矛，而是天空的怒火。」 —— 赫西俄德《神谱》',
    color: 0xffe24a, css: '#ffe24a',
  },
  {
    id: 'trident', slot: 'weapon', name: '波塞冬的三叉戟', icon: '🔱',
    desc: '海神的三叉戟 —— 蓝色水波缭绕。挥动时横扫身前 180°；身处海洋水域时获得海神之力：水上大幅加速、踏浪而行，无需小舟即可纵横深海，所过之处泛起波纹',
    lore: '「他以三叉戟搅动海洋，波涛皆听其号令。」 —— 荷马《奥德赛》',
    color: 0x3a9ad8, css: '#3a9ad8',
  },
  {
    id: 'wings', slot: 'relic', name: '大天使的翅膀', icon: '🕊️',
    desc: '圣洁的羽翼挂件 —— 翻滚化作圣翼冲刺：高速掠地、无视树木与岩石穿行而过，并撞伤冲刺路径上的一切生物',
    lore: '「他展开羽翼掠过大地，所过之处黑暗尽散。」 —— 《以诺书》',
    color: 0xffe9a0, css: '#ffe9a0',
  },
];

export const ARTIFACT_BY_ID: Record<string, ArtifactDef> = Object.fromEntries(ARTIFACTS.map((a) => [a.id, a]));

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
  | 'tiger' | 'fish' | 'turtle' | 'shark' | 'bat' | 'fox';

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
  charm?: boolean; // 攻击附带魅惑：移动反向（狐狸）
  retaliate?: boolean; // 中立，受击才反击（山羊 / 海龟）
  flying?: boolean; // 飞行：无碰撞、可越过水面（海鸥 / 蝙蝠）
  marine?: boolean; // 海洋动物：AI 限制在水中活动
  latcher?: boolean; // 吸附吸血（蝙蝠）：贴近后挂在玩家头上持续掉血
  meleeImmune?: boolean; // 近战打不到（飞得太高），只能用弓弩
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
    // 吸血蝙蝠：飞行极快，贴身后挂在头上吸血（共 20 点后消失，可叠加）。
    // 近战打不到，唯一反制是在被发现前用弓弩射杀（30 血 ≈ 短弓 3 箭）。
    kind: 'bat', name: '吸血蝙蝠', hp: 30, dmg: 0, speed: 8, aggroR: 8.5, atkR: 0,
    atkCd: 0, radius: 0.3, flying: true, latcher: true, meleeImmune: true,
    drops: { hide: 1 }, color: 0x6a5a7a,
  },
  fox: {
    // 妖狐：洞穴猎手，属性近似猛虎，攻击附带魅惑（WASD 反向）
    kind: 'fox', name: '妖狐', hp: 100, dmg: 16, speed: 5.0, aggroR: 7.5, atkR: 1.15,
    atkCd: 1.4, radius: 0.45, charge: true, chargeSpeed: 10.5, chargeDur: 0.4, chargeMin: 2, chargeMax: 5.5,
    charm: true, drops: { meat: 2, hide: 2 }, color: 0xd9743a,
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
