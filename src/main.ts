// @author: zhjj
// 入口：标题画面 → 创建游戏实例，并接通所有 UI 按钮

import { Game } from './game';
import { hasSave, loadSave, clearSave } from './core/save';
import { sfx } from './core/audio';
import * as hud from './ui/hud';
import './style.css';

let game: Game | null = null;

const $ = (id: string): HTMLElement => document.getElementById(id)!;

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
  const btnContinue = $('btn-continue') as HTMLButtonElement;
  btnContinue.disabled = !hasSave();

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
