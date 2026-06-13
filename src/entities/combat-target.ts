// @author: zhjj
import type { Game } from '../game';

export interface CombatTarget {
  readonly targetType: 'animal' | 'monkey';
  readonly radius: number;
  x: number;
  y: number;
  dead: boolean;
  damage(amount: number, kx: number, ky: number, game: Game): void;
}
