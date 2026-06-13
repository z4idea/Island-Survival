// @author: zhjj
// HUD：生命/耐力条、资源计数、武器栏、小地图、提示与各类界面切换

import {
  ARTIFACTS, CURRENCY, FOODS, GEAR, MAP, RES_EMOJI, SKINS, TALENTS, Tile, TROPHY_BY_ID, UPGRADES, WEAPONS, WEAPON_BY_ID, WEAPON_UPG,
  type ArtifactDef, type CurrencyKind, type FoodKind, type Price, type ResKind,
} from '../defs';
import { STATUS_INFO, type StatusKind } from '../core/status';
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

// ---------- 随身熟食 ----------
export function setFood(food: Record<FoodKind, number>): void {
  for (const k of Object.keys(food) as FoodKind[]) {
    $(`food-${k}`).textContent = String(food[k]);
  }
}

export function bumpFood(kind: FoodKind, value: number): void {
  const el = $(`food-${kind}`);
  el.textContent = String(value);
  const parent = el.parentElement!;
  parent.classList.remove('bump');
  void parent.offsetWidth; // 重置动画
  parent.classList.add('bump');
}

/** 状态效果图标行（中毒/流血/魅惑/溺水…） */
export function setStatuses(kinds: StatusKind[]): void {
  $('status-icons').innerHTML = kinds
    .map((k) => `<span class="status-icon" title="${STATUS_INFO[k].name}">${STATUS_INFO[k].icon}</span>`)
    .join('');
}

// ---------- 货币 ----------
export function updateCoins(coins: Record<CurrencyKind, number>): void {
  for (const k of Object.keys(coins) as CurrencyKind[]) {
    $(`coin-${k}`).textContent = String(coins[k]);
  }
}

export function bumpCoin(kind: CurrencyKind, value: number): void {
  const el = $(`coin-${kind}`);
  el.textContent = String(value);
  const parent = el.parentElement!;
  parent.classList.remove('bump');
  void parent.offsetWidth;
  parent.classList.add('bump');
}

// ---------- 武器栏（按已拥有武器动态生成） ----------
export function buildHotbar(weaponIds: string[], activeIdx: number): void {
  const bar = $('hotbar');
  bar.innerHTML = weaponIds
    .map((id, i) => {
      const wd = WEAPON_BY_ID[id];
      return `<div class="slot${i === activeIdx ? ' active' : ''}">
        <span class="slot-key">${i + 1}</span>
        <span class="slot-icon">${wd.icon}</span>
        <span class="slot-name">${wd.name}</span>
      </div>`;
    })
    .join('');
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

export function setWeatherDim(opacity: number): void {
  $('weather-overlay').style.opacity = String(opacity);
}

export function setCaveOverlay(on: boolean): void {
  $('cave-overlay').classList.toggle('hidden', !on);
}

export function setBossBar(frac: number | null, name?: string): void {
  const box = $('boss-bar-box');
  if (frac === null) {
    box.classList.add('hidden');
  } else {
    box.classList.remove('hidden');
    if (name) $('boss-name').textContent = name;
    $('boss-fill').style.width = `${Math.max(0, frac * 100)}%`;
  }
}

const COMPANION_EMOJI: Record<string, string> = {
  wolf: '🐺', boar: '🐗', tiger: '🐯', fox: '🦊', crab: '🦀',
  turtle: '🐢', goat: '🐐', deer: '🦌', gull: '🕊️', snake: '🐍',
};

/** 伙伴图标行（丘比特收服） */
export function setCompanions(kinds: string[]): void {
  $('companions').innerHTML = kinds
    .map((k) => `<span class="res companion"><i>${COMPANION_EMOJI[k] ?? '🐾'}</i></span>`)
    .join('');
}

/** 小 Boss 战利品图标行（永久被动） */
export function setTrophies(ids: string[]): void {
  $('trophies').innerHTML = ids
    .map((id) => {
      const t = TROPHY_BY_ID[id as keyof typeof TROPHY_BY_ID];
      return t ? `<span class="res trophy" title="${t.name}：${t.desc}"><i>${t.icon}</i></span>` : '';
    })
    .join('');
}

// ---------- 界面切换 ----------
export type Screen = 'title' | 'death' | 'win' | 'pause' | 'campfire' | 'shop' | 'cook' | null;

export function showScreen(s: Screen): void {
  $('title-screen').classList.toggle('hidden', s !== 'title');
  $('death-screen').classList.toggle('hidden', s !== 'death');
  $('win-screen').classList.toggle('hidden', s !== 'win');
  $('pause-screen').classList.toggle('hidden', s !== 'pause');
  $('campfire-menu').classList.toggle('hidden', s !== 'campfire');
  $('shop-menu').classList.toggle('hidden', s !== 'shop');
  $('cook-menu').classList.toggle('hidden', s !== 'cook');
}

// ---------- 商店 ----------
export type ShopTab = 'weapons' | 'upgrade' | 'talents' | 'skins' | 'gear';

const TAB_NAMES: Record<ShopTab, string> = {
  weapons: '⚔️ 武器',
  upgrade: '⚒️ 武器升级',
  talents: '🌟 天赋',
  skins: '✨ 皮肤',
  gear: '🛶 道具',
};

function priceHtml(price: Price, p: Player): string {
  return (Object.entries(price) as [CurrencyKind, number][])
    .map(([k, n]) => {
      const c = CURRENCY[k];
      const lack = p.coins[k] < n ? ' lack' : '';
      return `<span class="coin${lack}" style="--coin-color:${c.css}">${c.char} ${n}</span>`;
    })
    .join('');
}

export function renderShop(p: Player, tab: ShopTab): void {
  // 余额
  $('shop-coins').innerHTML = (Object.keys(CURRENCY) as CurrencyKind[])
    .map((k) => `<span class="coin" style="--coin-color:${CURRENCY[k].css}">${CURRENCY[k].char} ${p.coins[k]}</span>`)
    .join('');
  // 选项卡
  $('shop-tabs').innerHTML = (Object.keys(TAB_NAMES) as ShopTab[])
    .map((t) => `<button class="shop-tab${t === tab ? ' active' : ''}" data-tab="${t}">${TAB_NAMES[t]}</button>`)
    .join('');

  let html = '';
  if (tab === 'weapons') {
    html = WEAPONS.filter((w) => w.price)
      .map((w) => {
        const owned = p.weapons.includes(w.id);
        const stats = w.projectile
          ? `伤害 ${w.dmg} · 冷却 ${w.cd}s · 远程`
          : `伤害 ${w.dmg} · 冷却 ${w.cd}s · 范围 ${w.range}`;
        const btn = owned
          ? `<button class="btn shop-btn" disabled>已拥有</button>`
          : `<button class="btn shop-btn" data-act="buy-weapon" data-id="${w.id}">${priceHtml(w.price!, p)}</button>`;
        return `<div class="shop-item">
          <span class="shop-icon">${w.icon}</span>
          <div class="shop-info"><b>${w.name}</b><small>${w.desc}</small><small class="stats">${stats}</small></div>
          ${btn}</div>`;
      })
      .join('');
  } else if (tab === 'upgrade') {
    html = p.weapons
      .map((id) => {
        const w = WEAPON_BY_ID[id];
        const lvl = p.weaponLvls[id] ?? 0;
        const dmgNow = Math.round(w.dmg * (1 + WEAPON_UPG.dmgPerLvl * lvl));
        const btn =
          lvl >= WEAPON_UPG.maxLvl
            ? `<button class="btn shop-btn" disabled>已满级</button>`
            : `<button class="btn shop-btn" data-act="upg-weapon" data-id="${id}">${priceHtml(WEAPON_UPG.cost(lvl), p)}</button>`;
        return `<div class="shop-item">
          <span class="shop-icon">${w.icon}</span>
          <div class="shop-info"><b>${w.name} <em>Lv.${lvl}/${WEAPON_UPG.maxLvl}</em></b>
            <small>当前伤害 ${dmgNow}${lvl < WEAPON_UPG.maxLvl ? ` → 升级后 ${Math.round(w.dmg * (1 + WEAPON_UPG.dmgPerLvl * (lvl + 1)))}` : ''}</small></div>
          ${btn}</div>`;
      })
      .join('');
  } else if (tab === 'talents') {
    html = TALENTS.map((t) => {
      const owned = p.talents.has(t.id);
      const btn = owned
        ? `<button class="btn shop-btn" disabled>已习得</button>`
        : `<button class="btn shop-btn" data-act="buy-talent" data-id="${t.id}">${priceHtml(t.price, p)}</button>`;
      return `<div class="shop-item">
        <span class="shop-icon">${t.icon}</span>
        <div class="shop-info"><b>${t.name}</b><small>${t.desc}</small></div>
        ${btn}</div>`;
    }).join('');
  } else if (tab === 'gear') {
    html = GEAR.map((g) => {
      const owned = p.gear.has(g.id);
      const btn = owned
        ? `<button class="btn shop-btn" disabled>已拥有</button>`
        : `<button class="btn shop-btn" data-act="buy-gear" data-id="${g.id}">${priceHtml(g.price, p)}</button>`;
      return `<div class="shop-item">
        <span class="shop-icon">${g.icon}</span>
        <div class="shop-info"><b>${g.name}</b><small>${g.desc}</small></div>
        ${btn}</div>`;
    }).join('');
  } else {
    html = SKINS.map((s) => {
      const owned = p.skins.includes(s.id);
      const active = p.activeSkin === s.id;
      let btn: string;
      if (active) btn = `<button class="btn shop-btn" disabled>使用中</button>`;
      else if (owned) btn = `<button class="btn shop-btn" data-act="equip-skin" data-id="${s.id}">装备</button>`;
      else btn = `<button class="btn shop-btn" data-act="buy-skin" data-id="${s.id}">${priceHtml(s.price!, p)}</button>`;
      const swatch =
        s.id === 'default'
          ? '<span class="skin-swatch" style="background:linear-gradient(135deg,#d8dee2,#8a8f99)"></span>'
          : `<span class="skin-swatch" style="background:linear-gradient(135deg,#${s.blade.toString(16).padStart(6, '0')},#${s.accent.toString(16).padStart(6, '0')})"></span>`;
      return `<div class="shop-item">
        ${swatch}
        <div class="shop-info"><b>${s.name}</b><small>${s.desc}</small></div>
        ${btn}</div>`;
    }).join('');
  }
  $('shop-items').innerHTML = html;
}

// ---------- 篝火烹饪 ----------
export function renderCook(p: Player): void {
  // 当前持有的生鲜
  $('cook-res').innerHTML = (['meat', 'berry', 'hide', 'wood'] as ResKind[])
    .map((k) => `<span class="coin" style="--coin-color:#cfe3b0">${RES_EMOJI[k]} ${p.res[k]}</span>`)
    .join('');

  $('cook-items').innerHTML = FOODS.map((f) => {
    const owned = p.food[f.id] ?? 0;
    const afford = Object.entries(f.recipe).every(([k, n]) => p.res[k as ResKind] >= (n as number));
    const costStr = Object.entries(f.recipe)
      .map(([k, n]) => {
        const lack = p.res[k as ResKind] < (n as number) ? ' lack' : '';
        return `<span class="coin${lack}" style="--coin-color:#cfe3b0">${RES_EMOJI[k as ResKind]} ${n}</span>`;
      })
      .join('');
    const btn = `<button class="btn shop-btn${afford ? '' : ' cant'}" data-cook="${f.id}">${costStr}</button>`;
    return `<div class="shop-item">
      <span class="shop-icon">${f.icon}</span>
      <div class="shop-info"><b>${f.name} <em>持有 ${owned}</em></b>
        <small>${f.desc}</small>
        <small class="stats">回血 +${f.heal}${f.stam ? ` · 体力 +${f.stam}` : ''}${f.atkBuff ? ` · 攻击 +${Math.round(f.atkBuff * 100)}% / ${f.atkBuffDur}s` : ''}${f.regen ? ` · 持续回血 ${f.regen}/s × ${f.regenDur}s` : ''}</small></div>
      ${btn}</div>`;
  }).join('');
}

// ---------- 神器祝福仪式 ----------
let blessTimer: number | undefined;

/** 播放神器抽取仪式：图标快速轮换 → 减速 → 揭晓 → 显示「接受」按钮 */
export function showBlessingCeremony(art: ArtifactDef, onReveal: () => void): void {
  const screen = $('blessing-screen');
  screen.classList.remove('hidden', 'revealed');
  $('blessing-accept').classList.add('hidden');
  $('blessing-name').textContent = '';
  $('blessing-kind').textContent = '';
  $('blessing-desc').textContent = '';
  $('blessing-lore').textContent = '';
  const icon = $('blessing-icon');
  const pool = ARTIFACTS.map((a) => a.icon);
  let i = Math.floor(Math.random() * pool.length);
  let delay = 90;
  if (blessTimer) clearTimeout(blessTimer);

  const reveal = (): void => {
    icon.textContent = art.icon;
    const name = $('blessing-name');
    name.textContent = art.name;
    name.style.filter = `drop-shadow(0 0 18px ${art.css})`;
    $('blessing-kind').textContent = art.slot === 'weapon' ? '✦ 神器 · 武器 ✦' : '✦ 神器 · 挂件 ✦';
    $('blessing-desc').textContent = art.desc;
    $('blessing-lore').textContent = art.lore;
    screen.classList.add('revealed');
    $('blessing-accept').classList.remove('hidden');
    onReveal();
  };
  const spin = (): void => {
    i = (i + 1) % pool.length;
    icon.textContent = pool[i];
    icon.classList.remove('tick');
    void icon.offsetWidth; // 重置动画
    icon.classList.add('tick');
    delay *= 1.22;
    blessTimer = window.setTimeout(delay < 520 ? spin : reveal, delay < 520 ? delay : 480);
  };
  spin();
}

export function hideBlessing(): void {
  if (blessTimer) clearTimeout(blessTimer);
  $('blessing-screen').classList.add('hidden');
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

// ---------- 小地图（带战争迷雾） ----------
let mapBase: HTMLCanvasElement | null = null;
let fogCanvas: HTMLCanvasElement | null = null;

const MINI_COLORS: Record<Tile, string> = {
  [Tile.DeepWater]: '#14506b',
  [Tile.Water]: '#2d7d9a',
  [Tile.Sand]: '#e8d29a',
  [Tile.Grass]: '#79b85a',
  [Tile.Forest]: '#4e8f43',
  [Tile.Rock]: '#8d8d85',
};

export function initMinimap(world: WorldData, explored: Uint8Array): void {
  const canvas = $('minimap') as unknown as HTMLCanvasElement;
  canvas.width = MAP;
  canvas.height = MAP;

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

  // 迷雾层：未探索处不透明，已探索处透明
  fogCanvas = document.createElement('canvas');
  fogCanvas.width = MAP;
  fogCanvas.height = MAP;
  const fctx = fogCanvas.getContext('2d')!;
  const img = fctx.createImageData(MAP, MAP);
  for (let i = 0; i < MAP * MAP; i++) {
    img.data[i * 4] = 7;
    img.data[i * 4 + 1] = 14;
    img.data[i * 4 + 2] = 22;
    img.data[i * 4 + 3] = explored[i] ? 0 : 242;
  }
  fctx.putImageData(img, 0, 0);
}

/** 揭开迷雾（径向渐变，柔和边缘） */
export function revealFog(x: number, y: number, r: number): void {
  if (!fogCanvas) return;
  const fctx = fogCanvas.getContext('2d')!;
  fctx.globalCompositeOperation = 'destination-out';
  const grad = fctx.createRadialGradient(x, y, r * 0.55, x, y, r);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  fctx.fillStyle = grad;
  fctx.beginPath();
  fctx.arc(x, y, r, 0, Math.PI * 2);
  fctx.fill();
  fctx.globalCompositeOperation = 'source-over';
}

export function drawMinimap(
  world: WorldData,
  px: number,
  py: number,
  bossAlive: boolean,
  blessing: { x: number; y: number } | null = null,
  miniBosses: { x: number; y: number }[] = [],
): void {
  if (!mapBase || !fogCanvas) return;
  const canvas = $('minimap') as unknown as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, MAP, MAP);
  ctx.drawImage(mapBase, 0, 0);
  // 篝火（迷雾下自动隐藏）
  ctx.fillStyle = '#ffae34';
  for (const f of world.campfires) {
    ctx.beginPath();
    ctx.arc(f.x, f.y, 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Boss
  if (bossAlive) {
    ctx.fillStyle = '#ff4030';
    ctx.beginPath();
    ctx.arc(world.bossPos.x, world.bossPos.y, 4.2, 0, Math.PI * 2);
    ctx.fill();
  }
  // 小 Boss（未击杀）：金色菱形标记
  ctx.fillStyle = '#ffce4a';
  for (const m of miniBosses) {
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-2.6, -2.6, 5.2, 5.2);
    ctx.restore();
  }
  // 迷雾盖在标记之上 → 未探索的篝火/Boss/小 Boss 不可见
  ctx.drawImage(fogCanvas, 0, 0);
  // 神器祝福：自天而降的指引之光，无视迷雾可见
  if (blessing) {
    ctx.save();
    ctx.shadowColor = '#fffbe8';
    ctx.shadowBlur = 7;
    ctx.fillStyle = '#fffbe8';
    ctx.strokeStyle = 'rgba(255, 251, 232, 0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(blessing.x, blessing.y, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(blessing.x, blessing.y - 7);
    ctx.lineTo(blessing.x, blessing.y + 7);
    ctx.moveTo(blessing.x - 7, blessing.y);
    ctx.lineTo(blessing.x + 7, blessing.y);
    ctx.stroke();
    ctx.restore();
  }
  // 玩家永远可见
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.beginPath();
  ctx.arc(px, py, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
