// @author: zhjj
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Player } from './player';
import * as hud from '../ui/hud';

vi.mock('pixi.js', () => ({
  Container: class {},
  Graphics: class {},
}));

vi.mock('../ui/hud', async () => {
  const actual = await vi.importActual<typeof import('../ui/hud')>('../ui/hud');
  return {
    ...actual,
    bumpRes: vi.fn(),
    bumpCoin: vi.fn(),
  };
});

function playerWithoutRuntime(): Player {
  const player = Object.create(Player.prototype) as Player;
  player.res = { wood: 10, stone: 0, berry: 0, meat: 0, hide: 0 };
  player.coins = { silver: 8, gold: 3, diamond: 2 };
  return player;
}

describe('player monkey inventory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns one combined resource and currency snapshot', () => {
    expect(playerWithoutRuntime().monkeyInventory()).toEqual({
      wood: 10,
      stone: 0,
      berry: 0,
      meat: 0,
      hide: 0,
      silver: 8,
      gold: 3,
      diamond: 2,
    });
  });

  it('deducts and restores resources while updating the resource HUD', () => {
    const player = playerWithoutRuntime();
    player.changeMonkeyItem({ kind: 'wood', amount: 2 }, -1);
    expect(player.res.wood).toBe(8);
    expect(hud.bumpRes).toHaveBeenCalledWith('wood', 8);
    player.changeMonkeyItem({ kind: 'wood', amount: 2 }, 1);
    expect(player.res.wood).toBe(10);
  });

  it('deducts and restores currencies while updating the currency HUD', () => {
    const player = playerWithoutRuntime();
    player.changeMonkeyItem({ kind: 'diamond', amount: 1 }, -1);
    expect(player.coins.diamond).toBe(1);
    expect(hud.bumpCoin).toHaveBeenCalledWith('diamond', 1);
    player.changeMonkeyItem({ kind: 'diamond', amount: 1 }, 1);
    expect(player.coins.diamond).toBe(2);
  });
});
