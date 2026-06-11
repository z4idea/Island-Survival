// @author: zhjj
// 存档系统：localStorage 持久化

import type { ResKind } from '../defs';

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
    weapon: number;
    res: Record<ResKind, number>;
    upgrades: { atk: number; hp: number; stam: number };
  };
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
    if (data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
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
