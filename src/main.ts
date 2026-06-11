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
  $('cf-close').addEventListener('click', () => game?.campfireAction('close'));

  hud.showScreen('title');
}

init();
