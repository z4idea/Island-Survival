// @author: zhjj
// 入口：标题画面 → 创建游戏实例，并接通所有 UI 按钮

import { Game } from './game';
import { hasSave, loadSave, clearSave, writeSaveLocal } from './core/save';
import { register, login, logout, isLoggedIn, getUsername, fetchCloudSave, pushCloudSave } from './core/api';
import { sfx } from './core/audio';
import * as hud from './ui/hud';
import './style.css';

let game: Game | null = null;

const $ = (id: string): HTMLElement => document.getElementById(id)!;

/** 同步标题画面账号区与「继续旅程」按钮状态。 */
function refreshAccountUI(): void {
  const loggedIn = isLoggedIn();
  $('account-logged-out').classList.toggle('hidden', loggedIn);
  $('account-logged-in').classList.toggle('hidden', !loggedIn);
  if (loggedIn) $('account-status').textContent = `☁️ 已登录：${getUsername() ?? ''}`;
  ($('btn-continue') as HTMLButtonElement).disabled = !!game || !hasSave();
}

function showAccountMsg(text: string, kind: 'err' | 'ok'): void {
  const el = $('account-msg');
  el.textContent = text;
  el.className = kind; // 去掉 hidden 并着色
}
function clearAccountMsg(): void {
  const el = $('account-msg');
  el.className = 'hidden';
  el.textContent = '';
}

/** 登录/注册成功后协调云端与本地存档：云端有则镜像回本地，云端空但本地有则把本地种子上云。 */
async function syncOnLogin(): Promise<void> {
  const cloud = await fetchCloudSave();
  if (cloud) {
    writeSaveLocal(cloud);
  } else if (hasSave()) {
    const local = loadSave();
    if (local) await pushCloudSave(local);
  }
}

async function doAuth(kind: 'login' | 'register'): Promise<void> {
  const u = ($('acc-username') as HTMLInputElement).value.trim();
  const p = ($('acc-password') as HTMLInputElement).value;
  if (!u || !p) {
    showAccountMsg('请输入用户名和密码', 'err');
    return;
  }
  const loginBtn = $('btn-login') as HTMLButtonElement;
  const regBtn = $('btn-register') as HTMLButtonElement;
  loginBtn.disabled = true;
  regBtn.disabled = true;
  showAccountMsg(kind === 'login' ? '登录中…' : '注册中…', 'ok');
  try {
    if (kind === 'login') await login(u, p);
    else await register(u, p);
    await syncOnLogin();
    ($('acc-password') as HTMLInputElement).value = '';
    showAccountMsg(`☁️ ${kind === 'login' ? '登录' : '注册'}成功，存档已同步`, 'ok');
    refreshAccountUI();
  } catch (e) {
    showAccountMsg((e as Error).message, 'err');
  } finally {
    loginBtn.disabled = false;
    regBtn.disabled = false;
  }
}

async function startGame(continueGame: boolean): Promise<void> {
  sfx.unlock();
  const btnNew = $('btn-new') as HTMLButtonElement;
  const btnContinue = $('btn-continue') as HTMLButtonElement;
  btnNew.disabled = true;
  btnContinue.disabled = true;
  btnNew.textContent = '⛵ 正在漂向孤岛…';

  const save = continueGame ? loadSave() : null;
  if (!continueGame) clearSave();

  game = await Game.create(save);
  hud.showScreen(null);
  hud.showHud(true);
  (window as unknown as { __game: Game }).__game = game; // 调试钩子
}

function init(): void {
  refreshAccountUI();

  // 账号：登录 / 注册 / 退出
  $('btn-login').addEventListener('click', () => void doAuth('login'));
  $('btn-register').addEventListener('click', () => void doAuth('register'));
  $('btn-logout').addEventListener('click', () => {
    logout();
    clearAccountMsg();
    refreshAccountUI();
  });
  $('acc-password').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void doAuth('login');
  });

  $('btn-new').addEventListener('click', () => {
    if (game) return;
    if (hasSave() && !window.confirm('已有一份旅程存档，开始新的旅程将覆盖它。确定吗？')) return;
    void startGame(false);
  });
  $('btn-continue').addEventListener('click', () => {
    if (game) return;
    void startGame(true);
  });

  $('btn-respawn').addEventListener('click', () => game?.respawn());
  $('btn-resume').addEventListener('click', () => game?.setPaused(false));
  $('btn-quit').addEventListener('click', () => window.location.reload());
  $('btn-win-continue').addEventListener('click', () => game?.closeWin());

  $('cf-rest').addEventListener('click', () => game?.campfireAction('rest'));
  $('cf-atk').addEventListener('click', () => game?.campfireAction('atk'));
  $('cf-hp').addEventListener('click', () => game?.campfireAction('hp'));
  $('cf-stam').addEventListener('click', () => game?.campfireAction('stam'));
  $('cf-cook').addEventListener('click', () => game?.openCook());
  $('cf-shop').addEventListener('click', () => game?.openShop());
  $('cf-close').addEventListener('click', () => game?.campfireAction('close'));

  // 烹饪：菜单事件委托
  $('cook-close').addEventListener('click', () => game?.closeCook());
  $('cook-menu').addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-cook]') as HTMLElement | null;
    if (!target || !game || !target.dataset.cook) return;
    game.cookAction(target.dataset.cook);
  });

  // 神器祝福仪式：接受按钮
  $('blessing-accept').addEventListener('click', () => game?.acceptBlessing());

  // 商店：选项卡与购买按钮事件委托
  $('shop-close').addEventListener('click', () => game?.closeShop());
  $('shop-menu').addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-tab],[data-act]') as HTMLElement | null;
    if (!target || !game) return;
    if (target.dataset.tab) {
      game.setShopTab(target.dataset.tab as never);
    } else if (target.dataset.act && target.dataset.id) {
      game.shopAction(target.dataset.act, target.dataset.id);
    }
  });

  hud.showScreen('title');
}

init();
