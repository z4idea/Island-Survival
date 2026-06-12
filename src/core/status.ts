// @author: zhjj
// 玩家状态效果统一管理：中毒 / 流血 / 魅惑 / 溺水……
// 伤害结算由各效果来源负责（毒在 player、吸血在蝙蝠、溺水在 player），
// 本模块只管理状态的存在与时长，并驱动 HUD 图标。

export type StatusKind = 'poison' | 'bleed' | 'charm' | 'drown';

export const STATUS_INFO: Record<StatusKind, { icon: string; name: string; color: number }> = {
  poison: { icon: '☠️', name: '中毒：持续掉血，进食可解', color: 0x8fd84a },
  bleed: { icon: '🩸', name: '流血：蝙蝠正在吸血！', color: 0xff5040 },
  charm: { icon: '💫', name: '魅惑：移动方向颠倒', color: 0xff8ac8 },
  drown: { icon: '💧', name: '溺水：持续掉血，快上岸或乘船', color: 0x6ec6e0 },
};

export class Statuses {
  private map = new Map<StatusKind, number>(); // 剩余秒数

  /** 施加 / 续上状态（取剩余时间更长者） */
  add(kind: StatusKind, duration: number): void {
    this.map.set(kind, Math.max(this.map.get(kind) ?? 0, duration));
  }

  /** 移除状态，返回移除前是否存在 */
  clear(kind: StatusKind): boolean {
    return this.map.delete(kind);
  }

  has(kind: StatusKind): boolean {
    return this.map.has(kind);
  }

  /** 倒计时，返回本帧到期的状态列表 */
  update(dt: number): StatusKind[] {
    const expired: StatusKind[] = [];
    for (const [k, t] of this.map) {
      const nt = t - dt;
      if (nt <= 0) {
        this.map.delete(k);
        expired.push(k);
      } else {
        this.map.set(k, nt);
      }
    }
    return expired;
  }

  list(): StatusKind[] {
    return [...this.map.keys()];
  }

  clearAll(): void {
    this.map.clear();
  }
}
