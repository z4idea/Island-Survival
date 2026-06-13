// @author: zhjj
// 世界事件导演（Event Director）：在「昼夜 / 天气」这类持续环境节律之外，
// 按世界年龄解锁、定期掷骰，主动制造一次性的戏剧化世界事件（血月夜等）。
//
// 设计要点：
// - 天气(rain) 仍是独立的环境层，与世界事件并存（血月可以下在雨夜里），不归本导演管。
// - 同一时刻只有一个「世界事件」处于激活状态，避免叙事过载。
// - 解锁门槛(minAge) 复用「世界时长成长」的思路——越老的世界越危险、越戏剧化。
import type { Game } from '../game';
import * as hud from '../ui/hud';
import { sfx } from '../core/audio';

export interface WorldEventDef {
  id: string;
  name: string;
  icon: string;
  /** 解锁所需世界年龄（秒）。 */
  minAge: number;
  /** 掷骰权重（越大越容易被选中）。 */
  weight: number;
  /** 触发一次后，本事件的最短再触发间隔（秒）。 */
  cooldown: number;
  /** 额外开始条件（如血月仅在夜晚）。 */
  canStart(game: Game): boolean;
  onStart(game: Game): void;
  onTick(game: Game, dt: number): void;
  /** 结束条件（如血月：天亮）。 */
  shouldEnd(game: Game): boolean;
  onEnd(game: Game): void;
}

export class EventDirector {
  active: WorldEventDef | null = null;
  private events: WorldEventDef[];
  private lastFired: Record<string, number> = {};
  private rollT: number;

  constructor(events: WorldEventDef[]) {
    this.events = events;
    this.rollT = 90 + Math.random() * 90; // 开局先平静一会儿
  }

  update(game: Game, dt: number, age: number): void {
    if (this.active) {
      this.active.onTick(game, dt);
      if (this.active.shouldEnd(game)) {
        this.active.onEnd(game);
        this.lastFired[this.active.id] = age;
        this.active = null;
        this.rollT = 60 + Math.random() * 90;
      }
      return;
    }
    this.rollT -= dt;
    if (this.rollT > 0) return;
    this.rollT = 45 + Math.random() * 60; // 未命中：稍后再掷

    const pool = this.events.filter(
      (e) =>
        age >= e.minAge &&
        age - (this.lastFired[e.id] ?? -1e9) >= e.cooldown &&
        e.canStart(game),
    );
    if (pool.length === 0) return;
    // 留白：即便有可选事件，也有一定概率「什么都不发生」，让世界张弛有度。
    if (Math.random() < 0.35) return;

    const total = pool.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * total;
    let pick = pool[0];
    for (const e of pool) {
      r -= e.weight;
      if (r <= 0) {
        pick = e;
        break;
      }
    }
    this.active = pick;
    pick.onStart(game);
  }
}

// ---------------- 血月夜 ----------------
// 夜晚降临血月：全岛野兽陷入狂暴（仇恨范围扩大、更快更凶、连温顺/中立的也主动来袭），
// 作为代价/回报，期间所有掉落（资源与钱币）翻倍。高风险高回报，玩家会主动赌一把。
// 战斗侧的狂暴效果由 animals.ts 每帧读取 game.bloodMoon 派生；掉落翻倍由 game.lootMult 驱动。
class BloodMoon implements WorldEventDef {
  id = 'bloodmoon';
  name = '血月夜';
  icon = '🩸';
  minAge = 180; // 世界满 3 分钟后才可能降临
  weight = 1;
  cooldown = 300; // 两次血月至少间隔 5 分钟（约一个昼夜）
  private elapsed = 0;

  canStart(game: Game): boolean {
    return game.isNight;
  }

  onStart(game: Game): void {
    this.elapsed = 0;
    game.bloodMoon = true;
    game.lootMult = 2;
    hud.setBloodMoon(true);
    hud.toast('🩸 血月当空——全岛野兽陷入狂暴，掉落翻倍！', 4200);
    sfx.roar();
    game.addShake(0.5);
  }

  onTick(_game: Game, dt: number): void {
    this.elapsed += dt;
  }

  shouldEnd(game: Game): boolean {
    // 天亮即退；但至少持续 25 秒，避免黎明前触发瞬间结束。
    return this.elapsed > 25 && !game.isNight;
  }

  onEnd(game: Game): void {
    game.bloodMoon = false;
    game.lootMult = 1;
    hud.setBloodMoon(false);
    hud.toast('🌅 血月退去，岛上的野兽渐渐平息…', 3500);
  }
}

export const WORLD_EVENTS: WorldEventDef[] = [new BloodMoon()];
