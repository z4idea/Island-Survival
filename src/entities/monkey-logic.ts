// @author: zhjj
import { CURRENCY, RES_NAME, type CurrencyKind, type ResKind } from '../defs';

export type StolenKind = ResKind | CurrencyKind;
export type StolenItem = { kind: StolenKind; amount: number };
export type MonkeyInventory = Record<StolenKind, number>;

export const MONKEY_ESCAPE_DISTANCE = 18;
const STOLEN_KINDS: StolenKind[] = ['wood', 'stone', 'berry', 'meat', 'hide', 'silver', 'gold', 'diamond'];

function treeRoll(seed: number, nodeId: number): number {
  let n = (seed ^ Math.imul(nodeId + 1, 0x9e3779b1)) >>> 0;
  n ^= n >>> 16;
  n = Math.imul(n, 0x7feb352d);
  n ^= n >>> 15;
  n = Math.imul(n, 0x846ca68b);
  n ^= n >>> 16;
  return (n >>> 0) / 0x100000000;
}

export function hasHiddenMonkey(seed: number, nodeId: number): boolean {
  return treeRoll(seed, nodeId) < 0.08;
}

export function pickStolenItem(inventory: MonkeyInventory, random: () => number = Math.random): StolenItem | null {
  const available = STOLEN_KINDS.filter((kind) => inventory[kind] > 0);
  if (available.length === 0) return null;
  const kind = available[Math.min(available.length - 1, Math.floor(random() * available.length))];
  return { kind, amount: Math.max(1, Math.ceil(inventory[kind] * 0.1)) };
}

export function applyStolenItem(
  inventory: MonkeyInventory,
  stolen: StolenItem,
  direction: -1 | 1,
): MonkeyInventory {
  return {
    ...inventory,
    [stolen.kind]: Math.max(0, inventory[stolen.kind] + stolen.amount * direction),
  };
}

export function hasMonkeyEscaped(startX: number, startY: number, x: number, y: number): boolean {
  return Math.hypot(x - startX, y - startY) >= MONKEY_ESCAPE_DISTANCE;
}

export function stolenItemLabel(kind: StolenKind): string {
  return kind in RES_NAME ? RES_NAME[kind as ResKind] : CURRENCY[kind as CurrencyKind].name;
}
