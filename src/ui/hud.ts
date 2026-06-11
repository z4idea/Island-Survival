// @author: zhjj
// HUD：生命/耐力条、资源计数、武器栏、小地图、提示与各类界面切换

import { MAP, RES_EMOJI, Tile, UPGRADES, type ResKind } from '../defs';
import type { WorldData } from '../world/worldgen';
import type { Player } from '../entities/player';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

let toastTimer: number | undefined;

export function showHud(show: boolean): void {
  $('hud').classList.toggle('hidden', !show);
}

export function setHp(hp: number, max: number): void {
  $('hp-fill').style.width = `${Math.max(0, (hp / max) * 100)}%`;
  $('hp-text').textContent = `${Math.ceil(hp)} / ${max}`;
}

export function setStam(s: number, max: number): void {
  $('stam-fill').style.width = `${Math.max(0, (s / max) * 100)}%`;
}

export function setRes(res: Record<ResKind, number>): void {
  for (const k of Object.keys(res) as ResKind[]) {
    $(`res-${k}`).textContent = String(res[k]);
  }
}

export function bumpRes(kind: ResKind, value: number): void {
  const el = $(`res-${kind}`);
  el.textContent = String(value);
  const parent = el.parentElement!;
  parent.classList.remove('bump');
  void parent.offsetWidth; // 重置动画
  parent.classList.add('bump');
}

export function setPoison(on: boolean): void {
  $('poison-icon').classList.toggle('hidden', !on);
}

export function setWeapon(idx: number): void {
  document.querySelectorAll('#hotbar .slot').forEach((s, i) => {
    s.classList.toggle('active', i === idx);
  });
}

export function showPrompt(text: string | null): void {
  const el = $('prompt');
  if (!text) {
    el.classList.add('hidden');
  } else {
    el.classList.remove('hidden');
    el.innerHTML = text;
  }
}

export function toast(msg: string, ms = 2200): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), ms);
}

export function flashVignette(): void {
  const el = $('vignette');
  el.classList.add('flash');
  window.setTimeout(() => el.classList.remove('flash'), 120);
}

export function setNight(opacity: number): void {
  $('night-overlay').style.opacity = String(opacity);
}

export function setClock(emoji: string): void {
  $('clock').textContent = emoji;
}

export function setBossBar(frac: number | null): void {
  const box = $('boss-bar-box');
  if (frac === null) {
    box.classList.add('hidden');
  } else {
    box.classList.remove('hidden');
    $('boss-fill').style.width = `${Math.max(0, frac * 100)}%`;
  }
}

// ---------- 界面切换 ----------
export type Screen = 'title' | 'death' | 'win' | 'pause' | 'campfire' | null;

export function showScreen(s: Screen): void {
  $('title-screen').classList.toggle('hidden', s !== 'title');
  $('death-screen').classList.toggle('hidden', s !== 'death');
  $('win-screen').classList.toggle('hidden', s !== 'win');
  $('pause-screen').classList.toggle('hidden', s !== 'pause');
  $('campfire-menu').classList.toggle('hidden', s !== 'campfire');
}

// ---------- 篝火升级菜单 ----------
export function updateCampfireMenu(player: Player): void {
  for (const up of UPGRADES) {
    const btn = $(`cf-${up.id}`) as HTMLButtonElement;
    const lvl = player.upgrades[up.id];
    if (lvl >= up.maxLvl) {
      btn.innerHTML = `${up.name} <b>已达上限</b>`;
      btn.disabled = true;
      btn.classList.remove('cant');
      continue;
    }
    const cost = up.cost(lvl);
    const costStr = Object.entries(cost)
      .map(([k, n]) => `${RES_EMOJI[k as ResKind]}${n}`)
      .join(' ');
    const afford = Object.entries(cost).every(([k, n]) => player.res[k as ResKind] >= (n as number));
    btn.innerHTML = `${up.name} <b>Lv.${lvl}</b> · ${up.desc} <span class="cost">${costStr}</span>`;
    btn.disabled = false;
    btn.classList.toggle('cant', !afford);
  }
}

// ---------- 小地图 ----------
let mapBase: HTMLCanvasElement | null = null;

const MINI_COLORS: Record<Tile, string> = {
  [Tile.DeepWater]: '#14506b',
  [Tile.Water]: '#2d7d9a',
  [Tile.Sand]: '#e8d29a',
  [Tile.Grass]: '#79b85a',
  [Tile.Forest]: '#4e8f43',
  [Tile.Rock]: '#8d8d85',
};

export function initMinimap(world: WorldData): void {
  mapBase = document.createElement('canvas');
  mapBase.width = MAP;
  mapBase.height = MAP;
  const ctx = mapBase.getContext('2d')!;
  for (let y = 0; y < MAP; y++) {
    for (let x = 0; x < MAP; x++) {
      ctx.fillStyle = MINI_COLORS[world.tiles[y * MAP + x] as Tile];
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

export function drawMinimap(
  world: WorldData,
  px: number,
  py: number,
  bossAlive: boolean,
): void {
  if (!mapBase) return;
  const canvas = $('minimap') as unknown as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, MAP, MAP);
  ctx.drawImage(mapBase, 0, 0);
  // 篝火
  ctx.fillStyle = '#ffae34';
  for (const f of world.campfires) {
    ctx.beginPath();
    ctx.arc(f.x, f.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Boss
  if (bossAlive) {
    ctx.fillStyle = '#ff4030';
    ctx.beginPath();
    ctx.arc(world.bossPos.x, world.bossPos.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // 玩家
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.beginPath();
  ctx.arc(px, py, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
