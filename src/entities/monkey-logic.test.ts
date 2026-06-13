// @author: zhjj
import { describe, expect, it } from 'vitest';
import {
  MONKEY_ESCAPE_DISTANCE,
  applyStolenItem,
  hasHiddenMonkey,
  hasMonkeyEscaped,
  pickStolenItem,
  stolenItemLabel,
  type MonkeyInventory,
} from './monkey-logic';

const stock = (overrides: Partial<MonkeyInventory> = {}): MonkeyInventory => ({
  wood: 0,
  stone: 0,
  berry: 0,
  meat: 0,
  hide: 0,
  silver: 0,
  gold: 0,
  diamond: 0,
  ...overrides,
});

describe('tree monkey logic', () => {
  it('selects only a positive inventory entry and steals ten percent rounded up', () => {
    expect(pickStolenItem(stock({ wood: 21, diamond: 3 }), () => 0)).toEqual({ kind: 'wood', amount: 3 });
    expect(pickStolenItem(stock({ wood: 21, diamond: 3 }), () => 0.999)).toEqual({ kind: 'diamond', amount: 1 });
  });

  it('returns no stolen item when every inventory entry is empty', () => {
    expect(pickStolenItem(stock(), () => 0.5)).toBeNull();
  });

  it('subtracts and restores the exact stolen amount without crossing zero', () => {
    const stolen = { kind: 'gold' as const, amount: 2 };
    expect(applyStolenItem(stock({ gold: 11 }), stolen, -1).gold).toBe(9);
    expect(applyStolenItem(stock({ gold: 1 }), stolen, -1).gold).toBe(0);
    expect(applyStolenItem(stock({ gold: 9 }), stolen, 1).gold).toBe(11);
  });

  it('uses a stable seed and tree id decision with an eight percent threshold', () => {
    expect(hasHiddenMonkey(12345, 77)).toBe(hasHiddenMonkey(12345, 77));
    const hits = Array.from({ length: 10_000 }, (_, id) => hasHiddenMonkey(12345, id)).filter(Boolean).length;
    expect(hits).toBeGreaterThanOrEqual(700);
    expect(hits).toBeLessThanOrEqual(900);
  });

  it('escapes only after reaching the configured distance', () => {
    expect(hasMonkeyEscaped(0, 0, MONKEY_ESCAPE_DISTANCE - 0.01, 0)).toBe(false);
    expect(hasMonkeyEscaped(0, 0, MONKEY_ESCAPE_DISTANCE, 0)).toBe(true);
  });

  it('uses the existing Chinese names for stolen items', () => {
    expect(stolenItemLabel('berry')).toBe('浆果');
    expect(stolenItemLabel('diamond')).toBe('钻石');
  });
});
