# Tree Monkey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic hidden monkeys that steal 10% of one resource or currency when the player touches their tree, then flee and either escape with the loot or return it when killed.

**Architecture:** Keep theft selection, deterministic spawn checks, inventory arithmetic, and escape-distance checks in a pure `monkey-logic.ts` module. Add a dedicated `Monkey` runtime entity instead of extending the normal animal AI, while exposing a small shared combat-target interface so existing attacks can damage both animals and monkeys without giving monkeys normal drops or respawns.

**Tech Stack:** TypeScript, PixiJS 8, Rapier 2D, Vite 4, Vitest 0.34.6, Node 16.

---

## File Map

- Create `src/entities/monkey-logic.ts`: deterministic hidden-tree check, theft selection, inventory delta, and escape-distance helpers.
- Create `src/entities/combat-target.ts`: shared target contract and animal/monkey type guards needed by damage sources.
- Create `src/entities/monkey.ts`: monkey rendering, physics, fleeing, damage, refund, escape, and cleanup.
- Create `src/entities/monkey-logic.test.ts`: pure behavior tests.
- Create `src/entities/player-monkey.test.ts`: direct tests for mixed player inventory deduction/refund and HUD synchronization.
- Modify `src/entities/animals.ts`: implement the shared combat-target contract without changing animal behavior.
- Modify `src/entities/player.ts`: expose unified inventory snapshot/change methods with HUD synchronization.
- Modify `src/entities/projectiles.ts`: allow arrows to hit monkeys while preserving love-arrow behavior for animals only.
- Modify `src/game.ts`: mark hidden trees, draw tails, trigger theft, maintain monkeys, and include them in melee/AOE/lightning cleanup flows.
- Modify `package.json` and `package-lock.json`: add Node 16-compatible Vitest and a focused test command.
- Modify `README.md`: document hidden-tree tails, theft, pursuit, and recovery.

### Task 1: Add the Node 16-Compatible Test Harness

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/entities/monkey-logic.test.ts`

- [ ] **Step 1: Install the compatible test dependency**

Run:

```powershell
npm install --save-dev vitest@0.34.6
```

Expected: `package.json` and `package-lock.json` record `vitest` 0.34.x without changing Vite's major version.

- [ ] **Step 2: Add the focused test script**

Add to `package.json`:

```json
"test:monkey": "vitest run src/entities"
```

- [ ] **Step 3: Create the initial failing test**

Create `src/entities/monkey-logic.test.ts` with `// @author: zhjj` as the first line and tests importing the wished-for API:

```typescript
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
```

- [ ] **Step 4: Run the test and verify RED**

Run:

```powershell
npm run test:monkey
```

Expected: FAIL because `./monkey-logic` does not exist.

### Task 2: Implement Pure Monkey Rules

**Files:**
- Create: `src/entities/monkey-logic.ts`
- Test: `src/entities/monkey-logic.test.ts`

- [ ] **Step 1: Implement the minimal pure API**

Create `src/entities/monkey-logic.ts` with `// @author: zhjj` as the first line:

```typescript
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
```

- [ ] **Step 2: Run tests and verify GREEN**

Run:

```powershell
npm run test:monkey
```

Expected: all five tests PASS.

- [ ] **Step 3: Run static compilation**

Run:

```powershell
npm run check
```

Expected: zero TypeScript errors.

- [ ] **Step 4: Commit pure rules**

```powershell
git add package.json package-lock.json src/entities/monkey-logic.ts src/entities/monkey-logic.test.ts
git commit -m "feat: add tree monkey theft rules"
```

### Task 3: Add Unified Inventory Mutation

**Files:**
- Modify: `src/entities/player.ts`
- Create: `src/entities/player-monkey.test.ts`

- [ ] **Step 1: Add failing player inventory tests**

Create `src/entities/player-monkey.test.ts` with `// @author: zhjj` as the first line:

```typescript
// @author: zhjj
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Player } from './player';
import * as hud from '../ui/hud';

vi.mock('../ui/hud', () => ({
  bumpRes: vi.fn(),
  bumpCoin: vi.fn(),
}));

function playerWithoutRuntime(): Player {
  const player = Object.create(Player.prototype) as Player;
  player.res = { wood: 10, stone: 0, berry: 0, meat: 0, hide: 0 };
  player.coins = { silver: 8, gold: 3, diamond: 2 };
  return player;
}

describe('player monkey inventory', () => {
  beforeEach(() => vi.clearAllMocks());

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
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm run test:monkey
```

Expected: FAIL because `Player.monkeyInventory` and `Player.changeMonkeyItem` do not exist.

- [ ] **Step 3: Add player inventory methods**

In `src/entities/player.ts`, import `MonkeyInventory` and `StolenItem`. Add:

```typescript
monkeyInventory(): MonkeyInventory {
  return { ...this.res, ...this.coins };
}

changeMonkeyItem(item: StolenItem, direction: -1 | 1): void {
  const next = Math.max(0, this.monkeyInventory()[item.kind] + item.amount * direction);
  if (item.kind in this.res) {
    const kind = item.kind as ResKind;
    this.res[kind] = next;
    hud.bumpRes(kind, next);
  } else {
    const kind = item.kind as CurrencyKind;
    this.coins[kind] = next;
    hud.bumpCoin(kind, next);
  }
}
```

Do not use `addRes`/`addCoin` for theft because those methods always show positive pickup feedback.

- [ ] **Step 4: Synchronize codegraph before further codegraph use**

Run the repository's configured sync command:

```powershell
npx @colbymchenry/codegraph sync
```

Expected: `.codegraph` index updates successfully.

- [ ] **Step 5: Run tests and static compilation**

```powershell
npm run test:monkey
npm run check
```

Expected: tests pass and TypeScript reports zero errors.

- [ ] **Step 6: Commit inventory integration**

```powershell
git add src/entities/player.ts src/entities/player-monkey.test.ts
git commit -m "feat: support monkey inventory theft"
```

### Task 4: Create the Dedicated Monkey Entity

**Files:**
- Create: `src/entities/combat-target.ts`
- Create: `src/entities/monkey.ts`
- Modify: `src/entities/animals.ts`

- [ ] **Step 1: Define the shared combat target contract**

Create `src/entities/combat-target.ts` with the author line:

```typescript
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
```

- [ ] **Step 2: Adapt normal animals without changing behavior**

Make `Animal implements CombatTarget`, add:

```typescript
readonly targetType = 'animal' as const;

get radius(): number {
  return this.def.radius;
}
```

Keep all existing `Animal` AI, drops, love, burn, and respawn behavior unchanged.

- [ ] **Step 3: Implement `Monkey`**

Create `src/entities/monkey.ts` with the author line. Implement:

- `targetType = 'monkey'`, `radius = 0.48`, `hp = 34`.
- A dynamic Rapier body using `GROUPS.ANIMAL`.
- Programmatic Pixi monkey body, face, ears, tail, shadow, health bar, run bob, and carried-loot marker.
- Initial direction = normalized vector away from player, rotated by a random angle in `[-0.35, 0.35]`.
- Movement speed = `10.5` world units/second.
- `update(dt, game)` reads the previous physics position, applies knockback decay, sets velocity, updates animation, and calls `escape(game)` when `hasMonkeyEscaped(...)` becomes true.
- `damage(...)` applies damage, flash, knockback, health-bar visibility, hit particles, and calls `die(game)` at zero HP.
- `die(game)` refunds `stolen` through `player.changeMonkeyItem(stolen, 1)`, displays `夺回 {label} x{amount}`, then removes the entity without normal drops.
- `escape(game)` displays an escape message and removes the entity without refund.
- `destroy(game)` removes the rigid body and Pixi root idempotently.

- [ ] **Step 4: Run static compilation**

Run:

```powershell
npm run check
```

Expected: zero TypeScript errors.

- [ ] **Step 5: Synchronize codegraph**

Run:

```powershell
npx @colbymchenry/codegraph sync
```

Expected: new combat target and monkey symbols appear in the index.

- [ ] **Step 6: Commit the entity**

```powershell
git add src/entities/combat-target.ts src/entities/monkey.ts src/entities/animals.ts
git commit -m "feat: add fleeing monkey entity"
```

### Task 5: Mark Trees, Draw Tails, and Trigger Theft

**Files:**
- Modify: `src/game.ts`

- [ ] **Step 1: Extend tree runtime state**

Add to `WNode`:

```typescript
monkeyHidden: boolean;
monkeyTriggered: boolean;
monkeyTail: Graphics | null;
```

Add to `Game`:

```typescript
monkeys: Monkey[] = [];
```

- [ ] **Step 2: Initialize hidden monkeys without changing worldgen RNG**

In `buildNodes`, for each ordinary tree:

```typescript
const monkeyHidden = nd.kind === 'tree' && hasHiddenMonkey(this.worldData.seed, nd.id);
const monkeyTail = monkeyHidden ? this.drawMonkeyTail(root) : null;
```

Store the fields on `WNode`. `drawMonkeyTail` must place a curved brown tail at the tree-canopy edge and return its `Graphics`.

- [ ] **Step 3: Animate tails and trigger on body contact**

In `updateNodes(dt)`, animate only visible tails:

```typescript
if (n.monkeyTail?.visible) {
  n.monkeyTail.rotation = Math.sin(this.time * 3 + n.id) * 0.12;
}
```

Add `updateTreeMonkeys()` after `player.update` and before monkey/entity updates. For each alive, hidden, untriggered tree, trigger when:

```typescript
Math.hypot(n.x - this.player.x, n.y - this.player.y) <= 1.15
```

The trigger method must:

1. Set `monkeyTriggered = true`.
2. Hide the tail.
3. Call `pickStolenItem(player.monkeyInventory())`.
4. Deduct the item through `changeMonkeyItem(stolen, -1)`.
5. Show `猴子偷走了 {label} x{amount}!` or `猴子什么也没偷到!`.
6. Spawn `Monkey` beside the tree, add its root to `objects`, and push it to `monkeys`.

- [ ] **Step 4: Update and clean monkeys in the frame loop**

Before `physWorld.step()`:

```typescript
for (const monkey of this.monkeys) monkey.update(dt, this);
this.monkeys = this.monkeys.filter((monkey) => !monkey.removed);
```

During animal regeneration/player death cleanup, destroy all active monkeys and clear the list. Do not reset each tree's `monkeyTriggered` flag.

- [ ] **Step 5: Run tests and static compilation**

```powershell
npm run test:monkey
npm run check
```

Expected: focused tests pass and TypeScript reports zero errors.

- [ ] **Step 6: Synchronize codegraph**

```powershell
npx @colbymchenry/codegraph sync
```

Expected: updated `WNode`, tree trigger, and monkey lifecycle are indexed.

- [ ] **Step 7: Commit tree integration**

```powershell
git add src/game.ts
git commit -m "feat: trigger monkeys from hidden trees"
```

### Task 6: Include Monkeys in Every Player Damage Source

**Files:**
- Modify: `src/game.ts`
- Modify: `src/entities/player.ts`
- Modify: `src/entities/projectiles.ts`

- [ ] **Step 1: Add a game target iterator**

In `Game`, add:

```typescript
combatTargets(): CombatTarget[] {
  return [...this.animals, ...this.monkeys];
}
```

- [ ] **Step 2: Update melee targeting**

Change `meleeStrike` to iterate `combatTargets()`. Preserve animal-only rules through `targetType` checks:

- Skip `meleeImmune` and `latched` only for animals.
- Apply flame burn, thunder special behavior, vampire healing, and normal hitstop consistently.
- Do not call animal-only fields on monkeys.

- [ ] **Step 3: Update projectile targeting**

In `Projectiles.update`, iterate `game.combatTargets()`:

- Use `target.radius` for hit distance.
- Keep `latched` filtering for animals.
- Apply `makeLoved` only when `target.targetType === 'animal'`.
- Damage monkeys normally and remove the arrow after a hit.

- [ ] **Step 4: Update AOE and lightning targeting**

Change nether fire and lightning loops to use `combatTargets()`:

- Preserve `latched`/`meleeImmune` filters for animals.
- Apply burn only to animals because monkey damage is immediate and monkeys have no burn lifecycle.
- Allow direct and chained lightning damage to monkeys.

- [ ] **Step 5: Update holy-wing dash targeting**

In `Player.update`, make `dashHits` store `CombatTarget`, iterate `game.combatTargets()`, and retain animal-only immunity checks. Use `target.radius` for collision distance.

- [ ] **Step 6: Run tests and static compilation**

```powershell
npm run test:monkey
npm run check
```

Expected: tests pass and TypeScript reports zero errors.

- [ ] **Step 7: Synchronize codegraph and inspect impact**

```powershell
npx @colbymchenry/codegraph sync
```

Then use codegraph impact/call flow checks for `combatTargets`, `meleeStrike`, and `Projectiles.update` to confirm all intended damage entry points are covered.

- [ ] **Step 8: Commit combat integration**

```powershell
git add src/game.ts src/entities/player.ts src/entities/projectiles.ts
git commit -m "feat: let players recover stolen loot"
```

### Task 7: Documentation and Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update player-facing gameplay documentation**

Add a concise Chinese section explaining:

```markdown
- 部分普通树会露出猴子尾巴。靠近并触碰树后，猴子会随机偷走一种当前持有的资源或货币的 10%（向上取整）。
- 猴子不会攻击，只会快速逃跑；在它跑远消失前击杀可夺回全部赃物。
```

- [ ] **Step 2: Run focused tests**

```powershell
npm run test:monkey
```

Expected: all monkey logic tests PASS with no warnings.

- [ ] **Step 3: Run the project-required static compilation**

```powershell
npm run check
```

Expected: zero TypeScript errors. Do not run the full build.

- [ ] **Step 4: Review the final diff**

```powershell
git diff --check
git status --short
git diff --stat HEAD~4
```

Expected: no whitespace errors; generated directories remain untracked and unstaged.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md
git commit -m "docs: explain tree monkey encounters"
```

- [ ] **Step 6: Report the AGENTS refresh trigger**

The final response must include exactly:

```text
这次改动触及 AGENTS refresh trigger，建议现在执行 $project-agents-md 更新 AGENTS.md。
```

The trigger is hit because the change adds a runtime entity/event, modifies damage-target filtering, and adds a new runtime spawn path.
