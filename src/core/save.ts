// @author: zhjj
// 存档系统：localStorage 持久化（v2：货币 / 商店武器 / 武器等级 / 皮肤 / 天赋）

import type { CurrencyKind, ResKind } from '../defs';

export interface SaveData {
  version: number;
  seed: number;
  campfireId: number; // 上次休息的篝火（复活点）
  removedNodes: number[]; // 已被采集摧毁的资源节点 id
  bossDefeated: boolean;
  player: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    maxStam: number;
    weapon: number; // 在已拥有武器列表中的下标
    res: Record<ResKind, number>;
    upgrades: { atk: number; hp: number; stam: number };
    coins: Record<CurrencyKind, number>;
    weapons: string[]; // 已拥有武器 id 列表
    weaponLvls: Record<string, number>;
    skins: string[];
    activeSkin: string;
    talents: string[];
    gear: string[]; // 道具（小木舟等）
  };
  explored: string; // 战争迷雾：按位打包 + base64
  openedChests?: number[]; // 洞穴中已开启的宝箱 id（v4 旧档可缺省）
  playTime: number;
}

const KEY = 'island-survival-save-v1';

export function hasSave(): boolean {
  return localStorage.getItem(KEY) !== null;
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    // 世界生成方式 / 地图尺寸变更时递增版本：旧档的 seed/坐标/节点 id 均不兼容
    // v3=240 群岛；v4=320 群岛（字段结构与 v3 相同）
    if (data.version !== 4) return null;
    return data;
  } catch {
    return null;
  }
}

/** 战争迷雾打包：每格 1 bit → base64 */
export function packExplored(explored: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(explored.length / 8));
  for (let i = 0; i < explored.length; i++) {
    if (explored[i]) bytes[i >> 3] |= 1 << (i & 7);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(s);
}

export function unpackExplored(packed: string, length: number): Uint8Array {
  const explored = new Uint8Array(length);
  try {
    const s = atob(packed);
    for (let i = 0; i < length; i++) {
      const byte = s.charCodeAt(i >> 3);
      if (byte & (1 << (i & 7))) explored[i] = 1;
    }
  } catch {
    // 损坏的迷雾数据：当作全未探索
  }
  return explored;
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 存储已满等情况：静默失败，不打断游戏
  }
}

export function clearSave(): void {
  localStorage.removeItem(KEY);
}
