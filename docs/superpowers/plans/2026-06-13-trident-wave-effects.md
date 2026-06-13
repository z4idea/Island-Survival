# Trident Wave Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the trident's generic pale slash and subtle water dots with a blue double-curl attack wave and visible rolling sea wake.

**Architecture:** Keep the effect local to `Player` using two dedicated PixiJS `Graphics` layers. Drive attack rendering from the existing `swingT` animation and drive movement rendering from `seaWalking` plus the player's velocity, without changing gameplay state.

**Tech Stack:** TypeScript, PixiJS 8 Graphics, Vite 4 static type checking

---

### Task 1: Add Dedicated Trident Graphics Layers

**Files:**
- Modify: `src/entities/player.ts:18-119`

- [ ] **Step 1: Add effect state**

Add `tridentSlashG`, `tridentWakeG`, and an attack direction field beside the existing player graphics and animation fields.

- [ ] **Step 2: Insert the layers**

Add the wake behind the shadow/body and the attack wave near the existing slash layer so both inherit the player's world position.

- [ ] **Step 3: Initialize hidden state**

Set both graphics invisible until their corresponding trident state is active.

### Task 2: Render the Double-Curl Attack Wave

**Files:**
- Modify: `src/entities/player.ts:739-805`

- [ ] **Step 1: Capture the attack direction**

When a trident attack starts, retain `aim` as the wave's fixed center direction for the duration of the swing.

- [ ] **Step 2: Suppress the generic slash**

In `drawSlash`, skip the normal skin-colored filled arc for `seaLord` weapons and clear `slashG`.

- [ ] **Step 3: Draw the trident wave each frame**

Add a helper that clears and redraws:

- a deep-blue outer arc,
- a bright-blue inner arc,
- segmented pale-blue foam along the crest.

Use `swingT` to expand the radius and reduce alpha near the end. Rotate the graphics to the captured attack direction.

- [ ] **Step 4: Hide completed waves**

Clear and hide the attack layer when the player is not holding the trident or `swingT` returns to `-1`.

### Task 3: Render the Rolling Sea Wake

**Files:**
- Modify: `src/entities/player.ts:535-568`
- Modify: `src/entities/player.ts:883-967`

- [ ] **Step 1: Pass movement state to the renderer**

Retain whether trident sea walking is active and use the body's actual linear velocity to orient the effect.

- [ ] **Step 2: Draw two curling wave wings**

Add a helper that draws mirrored deep-blue and bright-blue curves with short pale-blue foam segments. Scale their width and height from movement speed and animate curl using `animT`.

- [ ] **Step 3: Reduce dot spray density**

Keep only a lower-frequency, low-count blue spray behind the player so the Graphics wave is the primary visual.

- [ ] **Step 4: Clear inactive wake**

Hide and clear the wake when movement stops, the player leaves water, or the trident is unequipped.

### Task 4: Static Verification

**Files:**
- Verify: `src/entities/player.ts`

- [ ] **Step 1: Run TypeScript check**

Run:

```powershell
npm run check
```

Expected: exit code `0` with no TypeScript diagnostics.

- [ ] **Step 2: Check visual color and state guards**

Run:

```powershell
rg -n "tridentSlashG|tridentWakeG|seaWalking|0x167fb8|0x35bfe8|0xa7eaff" src/entities/player.ts
```

Expected: dedicated effect layers, blue palette constants, and sea-walking visibility guards are present.

