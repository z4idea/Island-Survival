# AGENTS.md — Island Survival（孤岛求生）

## Refresh Metadata

- Last refreshed: 2026-06-13（refresh pass：新增**世界事件系统** —— [src/world/events.ts](src/world/events.ts) `EventDirector`（按世界年龄解锁、定期掷骰、单事件激活、冷却 + 留白）+ 首个事件**血月夜** `BloodMoon`；`Game.bloodMoon`/`lootMult`/`director` 字段、主循环在镜头后昼夜前插入 `director.update`、`updateDayNight` 增血月分支、`updateRespawns` 血月提速、`animals.ts` 战斗派生狂暴（仇恨/移速/伤害/被动转主动/染色）与 `die()` 读 `lootMult` 翻倍掉落、`hud.setBloodMoon` + 血色遮罩/vignette。⚠️ 天气(rain) 仍是独立环境层、不归 director 管。上一轮的伙伴/驯养系统仍准确，复核烹饪、小 Boss、猴子、神器、碰撞组、存档）
- Refresh basis: 全量 `src/`、`package.json`、`README.md`、Vite/TypeScript 配置及近期提交；关键调用链由 codegraph 同步后核对
- Confidence: high

## Project Overview

类 Hades 俯视角**群岛**生存动作游戏。纯前端单页应用，无后端、无静态素材：所有图形用 PixiJS Graphics/Text(emoji) 程序化绘制，音效用 WebAudio 合成，存档写 localStorage。玩法主轴：采集/狩猎 → 钱币 → 商店（武器/天赋/皮肤/小木舟）→ 乘船或持海神三叉戟跨岛 → 击败随机岛屿山顶的 Boss 巨熊。生命恢复靠**进食**：生食（浆果/生肉）回血弱、生肉有概率食物中毒，需在篝火 `🍳 烹饪` 把生鲜烤成熟食（回血高、零风险、部分附带攻击/回血 buff）带在身上。每座非巨熊岛（含主岛）山顶另有**岛屿小 Boss**（精英化的虎/狼/蟹/蛇/猪），击杀掉**专属战利品**（永久被动），是可选的变强支线。用丘比特之弓把野兽射成「坠入爱河」后按 E 可**收服为伙伴**（掠食者作战宠、食草作加速光环，上限 2、会永久阵亡）。额外运行时事件包括：随机岛屿天降**神器祝福**光柱（被狂暴守卫环绕），按 E 举行仪式随机获得 5 件神器之一；约 8% 普通树藏有会偷资源/货币并逃跑的猴子。

- 技术栈：TypeScript + Vite 4 + PixiJS 8 + `@dimforge/rapier2d-compat`（2D 物理）
- ⚠️ 本机 Node 为 **16.20**，因此 Vite 锁定在 ^4（Vite 5+ 需 Node 18+）。升级依赖前先确认 Node 版本约束。

## Architecture

双坐标系约定（全仓库最重要的不变量）：

- **世界单位**：1 单位 = 1 地图格。物理（Rapier）、AI、逻辑距离全部用世界单位。
- **像素**：渲染时乘 `SCALE`（= 32，定义于 [src/defs.ts](src/defs.ts)）。精灵尺寸直接以像素绘制，位置用 `pos * SCALE` 设置；舞台容器不缩放。
- 屏幕→世界换算只有一处：`Game.screenToWorld()`（[src/game.ts](src/game.ts)）。

UI 分两层：游戏画面是 Pixi canvas（`#app`）；HUD/菜单/标题画面全部是 **HTML/CSS DOM**（[index.html](index.html) + [src/style.css](src/style.css)），由 [src/ui/hud.ts](src/ui/hud.ts) 以 `getElementById` 操作。新增 UI 时遵守这个分界：世界内的视觉进 Pixi，叠加层 UI 进 DOM。

物理用法刻意保持最小 API 面（兼容性考虑）：仅 `World`、`RigidBodyDesc`、`ColliderDesc`、`setLinvel`、`translation`、`setCollisionGroups`、`step`。攻击判定/拾取/箭矢命中均为手写距离+角度计算（在 `Game.meleeStrike` / `Projectiles.update` / `Drops.update`），**不要**改成 Rapier 查询管线。碰撞分组统一定义在 [src/defs.ts](src/defs.ts) `GROUPS`（`(membership<<16)|filter`）：碰撞位：bit0=STATIC（树/石/水晶，可被圣翼冲刺穿过）、bit1=PLAYER、bit2=ANIMAL、bit3=WATER（深水屏障）、bit4=WALL（洞穴岩壁 + 地图边界墙，永不可穿越）。深水屏障是独立的 `WATER` 组，玩家乘船时切到 `PLAYER_BOAT`（filter 不含 WATER）实现渡海；圣翼冲刺（大天使翅膀）时切到 `PLAYER_PHASE`（filter 去掉 STATIC 位但**保留 WALL/WATER/ANIMAL**）——只穿树/石、不能穿洞壁或冲出地图/渡海；海洋动物 `MARINE` 组只与玩家碰撞，靠 AI 的 `isWater` 检查留在水里。玩家碰撞组由 `Player.update` 末尾集中同步（`colGroup` 缓存，相位 > 乘船 > 常规 的优先级），不要再在别处直接 `setCollisionGroups`。战争迷雾：`Game.explored`（Uint8Array）+ [src/ui/hud.ts](src/ui/hud.ts) 迷雾 canvas，存档时按位打包（save.ts `packExplored`）。

## Internal Modules

| 模块 | 职责 | 关键导出 | 下游依赖 |
| --- | --- | --- | --- |
| [src/main.ts](src/main.ts) | 入口：标题画面、按钮接线、商店事件委托（`#shop-menu` 上的 `data-tab`/`data-act`）、`window.__game` 调试钩子 | — | game, save, hud, audio |
| [src/game.ts](src/game.ts) | **中枢**：Pixi/Rapier 初始化、主循环、战斗/采集结算、篝火与存档、商店动作、战争迷雾、洞穴、神器祝福、冥火、天降闪电、昼夜/天气/镜头/重生；**树上猴子**由 `buildNodes` 写入 `WNode.monkeyHidden/monkeyTriggered/monkeyTail`，`updateTreeMonkeys` 触发偷窃并生成 `Monkey`；`combatTargets()` 汇总普通动物与猴子供 5 类伤害源使用（**已排除 `companion`，避免误伤宠**）；**伙伴：`companions[]` + `recruitCompanion`/`dismissCompanion`/`onCompanionDied`/`companionSpeedMul`/`restoreCompanions`，收服在 `updateInteraction` 的 E 分支**；**世界事件：`director`(EventDirector) + 全局标志 `bloodMoon`/`lootMult`（被 animals.ts 每帧/`die()` 读取），主循环镜头后昼夜前调 `director.update`，`updateDayNight` 血月分支染红夜幕/🩸 时钟，`updateRespawns` 血月提速** | `Game`, `WNode` | 几乎全部模块 |
| [src/defs.ts](src/defs.ts) | 数据定义（所有数值调参入口）：`SCALE/MAP(320)/Tile/GROUPS`、武器 `WEAPONS`（神器能力标志含 `loveChance`/`cast`/`thunder`/`seaLord`，`thrust` 标突刺动画）、神器 `ARTIFACTS`（当前 4 武器 + 1 挂件）、动物 `ANIMALS`、货币/掉率、升级、天赋、皮肤、道具、**食物 `FOODS`/`FOOD_BY_ID`（4 道烹饪配方：回血 + 可选耐力/攻击 buff/持续回血，`slot` 决定 Q/F/R 进食归属）**、**小 Boss `MINIBOSSES`/`MINIBOSS_BY_ID`（基底 `base`+`hpMul`/`dmgMul`+所掉 `trophy`）与战利品 `TROPHIES`/`TROPHY_BY_ID`（永久被动）**、玩家 `PLAYER` | 同左 | 无 |
| [src/world/worldgen.ts](src/world/worldgen.ts) | 程序化**群岛**（320×320）：随机 1 主岛 + 4~6 小岛、Boss 随机落在某岛山顶、陆地连通域标记（剔除碎礁）、篝火（10 个）随机起点 + 最远点采样、陆地/海洋动物分布；**每座非巨熊岛布 1 只小 Boss（`findLand` 螺旋找有效陆地，避开 Boss 场与出生点 16 格，类型按岛序循环 `MINIBOSSES`，不消耗 rng），写 `SpawnPoint.miniBoss` 与 `WorldData.miniBosses`** | `generateWorld`, `WorldData`, `Isle`, `MiniBossSpot` | noise, defs |
| [src/world/worldrender.ts](src/world/worldrender.ts) | 地形渲染：16×16 格区块 Graphics、海岸浪花动画、视野裁剪 | `WorldRenderer` | defs, noise |
| [src/world/events.ts](src/world/events.ts) | **世界事件导演**：`EventDirector`（持有 `WORLD_EVENTS`，按 `minAge` 解锁、`rollT` 定期掷骰、`weight` 权重抽取、`cooldown`/35% 留白概率，同一时刻只激活一个事件，`onStart/onTick/shouldEnd/onEnd` 生命周期）；事件实现 `WorldEventDef` 接口。首个事件 `BloodMoon`（仅夜晚触发、天亮退去且保底 25s，置 `game.bloodMoon=true`/`lootMult=2` + `hud.setBloodMoon` + `sfx.roar`）。**天气(rain) 刻意不进 director**，是独立的持续环境层 | `EventDirector`, `WorldEventDef`, `WORLD_EVENTS` | game(type), hud, audio |
| [src/entities/player.ts](src/entities/player.ts) | 玩家移动/翻滚/攻击/武器库存、状态、乘船、皮肤/神器视觉、资源与货币；**`food` 随身熟食 + 进食结算 `consumeFood`/`eatRawMeat`（Q 浆果类、F 肉类优先熟食，R 料理 buff；生肉 30% 触发 `applyFoodPoison`）+ 攻击 buff（折进 `dmgMul` getter）/持续回血计时器**；**`trophies` 小 Boss 战利品 + `hasTrophy`，5 个被动派生点：tigerfang(`dmgMul`)/wolfmane(移速)/crabshell(`takeDamage`)/snakescale(`applyPoison`+`applyFoodPoison` 免疫)/boarheart(`game.meleeStrike` 击杀回血)**；**移速另叠 `game.companionSpeedMul`（食草伙伴加速光环）**；`monkeyInventory`/`changeMonkeyItem` 为猴子偷取和返还统一更新资源/货币 HUD；`seaLord` 三叉戟在水域提供 `PLAYER.speed*1.7`、免溺水/免船并移除 WATER 过滤，`tridentSlashG`/`tridentWakeG` 绘制 180° 卷浪与踏浪尾迹；圣翼冲刺遍历 `game.combatTargets()` | `Player` | defs, combat-target, monkey-logic, hud, audio, status |
| [src/entities/animals.ts](src/entities/animals.ts) | 普通动物 AI 状态机、属性驱动行为、坠入爱河/狂暴/灼烧/掉落；实现 `CombatTarget`（`targetType:'animal'` + `radius`），供统一伤害入口与猴子并列处理；**`miniBoss` 字段（构造第 9 参 `miniBossId`）= 精英化：`hpMul`/`dmgMul` 叠在 growth 上、金冠 + `bodyScale`1.45（注意朝向翻转每帧覆盖 `bodyC.scale.x`，靠 `bodyScale` 保住）、aggro×1.8、低血提速、死亡掉中量钱币（战利品由 game 发）**；**`companion`/`foe` 字段 + 独立 `updateCompanion`（跟随 + `findEnemy` 扑杀，攻击即给敌人 `foe=this` 嘲讽）/`takeEnemyHit`（伙伴受击，0 血→`fallAsCompanion`→`game.onCompanionDied`）；敌人 AI 攻击目标已从写死 `p` 泛化为 `foe ?? p`；AI 后段（击退/setLinvel/朝向/染色/血条）抽成共用 `finishUpdate`**；**血月狂暴：`update`/`finishUpdate` 每帧读 `game.bloodMoon`（排除 companion/loved）派生 aggroR×1.7、移速×1.25、伤害×1.3、被动/中立动物主动来袭、身体染血色；`die()` 读 `game.lootMult` 让资源与钱币掉落翻倍** | `Animal` | defs, combat-target, audio |
| [src/entities/combat-target.ts](src/entities/combat-target.ts) | 普通动物与猴子的最小可伤害契约：坐标、半径、死亡态、`damage` | `CombatTarget` | game(type) |
| [src/entities/monkey-logic.ts](src/entities/monkey-logic.ts) | 纯逻辑：按 `seed + nodeId` 稳定判定 8% 藏猴树、从非零库存等概率选一类并偷 `ceil(10%)`、18 格逃脱判定、中文物品名；由 Vitest 覆盖 | 类型与纯函数 | defs |
| [src/entities/monkey.ts](src/entities/monkey.ts) | 专用逃跑实体，不复用 `Animal` AI/掉落/重生：速度 10.5，撞障后偏转；可受全部玩家伤害，击杀返还赃物，离触发点 18 格后携赃物消失 | `Monkey` | combat-target, monkey-logic, game(type) |
| [src/entities/drops.ts](src/entities/drops.ts) | 掉落物：资源 emoji Text + 货币彩色符号，散落→吸附→拾取（货币走 `addCoin`，资源走 `addRes`） | `Drops`, `DropKind` | defs |
| [src/entities/projectiles.ts](src/entities/projectiles.ts) | 箭矢：手动子步进飞行、命中 `game.combatTargets()`/钉树；爱心箭仅对 `targetType==='animal'` 调 `makeLoved`，猴子只受普通伤害 | `Projectiles` | defs |
| [src/ui/hud.ts](src/ui/hud.ts) | 全部 DOM 操作：血条/资源/**熟食计数(`setFood`/`bumpFood`)**/货币/动态武器栏(`buildHotbar`)/小地图 canvas + **战争迷雾层**(`initMinimap`/`revealFog`，`drawMinimap` 第 5 参 blessing→✦、第 6 参 miniBosses→金菱标记，均压在迷雾下)/**战利品图标行 `setTrophies`/伙伴图标行 `setCompanions`（kind→emoji）**/**Boss 血条 `setBossBar(frac, name?)` 可改名（巨熊/小 Boss 共用）**/界面切换/篝火菜单/商店渲染(`renderShop`，五选项卡 innerHTML)/**烹饪菜单渲染(`renderCook`，列 `FOODS` 配方/持有/增益)**/**神器祝福仪式**(`showBlessingCeremony` 图标轮换→揭晓动画 + `hideBlessing`) | 函数集合, `ShopTab` | defs |
| [src/core/](src/core) | `input.ts`（键鼠，`e.code` 体系）、`audio.ts`（合成音效单例 `sfx`）、`status.ts`（玩家状态效果统一管理 `Statuses`：poison/bleed/charm/drown/**foodpoison(食物中毒，吃熟食或时间解除)**——只管存在与时长并驱动 HUD 图标，伤害结算留在各来源处；新增状态在 `STATUS_INFO` 注册即可）、`save.ts`（localStorage，`SaveData` **v4**：货币/武器/皮肤/天赋/道具 gear/**神器挂件 relics**/**随身熟食 food**/**战利品 trophies + 已杀小 Boss miniBossesDefeated + 伙伴物种 companions**（均为可选字段，旧档缺省）/迷雾 explored（bit 打包 base64）/宝箱 openedChests；神器武器随 `weapons[]` 持久化；地图尺寸或世界生成变更时才递增版本，旧版本档直接判废返回 null） | — | — |
| [src/fx.ts](src/fx.ts) | 粒子与伤害飘字对象池 | `Particles`, `FloatTexts` | defs |
| [src/utils/noise.ts](src/utils/noise.ts) | 值噪声 FBM、`mulberry32`、`tileJitter` | — | 无 |

## Key Flows

### 启动链

`index.html` → [src/main.ts](src/main.ts) `init()` 绑定按钮 → 点击新游戏/继续 → `startGame()` → `Game.create(save)`（[src/game.ts](src/game.ts)）→ `RAPIER.init()` + `Application.init()` → `generateWorld(seed)`（群岛布局/Boss 岛/篝火都由种子决定）→ `WorldRenderer.build` → `buildWaterColliders`（深水边界 cuboid=WATER 组 + 地图四周外墙=WALL 组）→ `buildNodes`（跳过 `removedNodes`；按 `seed+nodeId` 稳定判定树上猴子并绘制尾巴）→ `buildCampfires` → `new Player`（读档时恢复武器/货币/天赋/道具/迷雾）→ `buildCaves` → `spawnAllAnimals` → 有存档伙伴时 `restoreCompanions(save.companions)` → `initMinimap(world, explored)` + 首次 `revealAround` → `app.ticker.add(tick)`。

### 帧循环（`Game.tick` → `updateWorld`）

顺序固定且有依赖：`player.update`（读上一帧物理位置 → 魅惑反向 → 乘船/海神踏浪/溺水判定 → 设置 `setLinvel`，攻击与 Q/F/R 进食入口；**buff 计时器递减 + 炖锅持续回血 + 中毒/食物中毒掉血** → 状态倒计时与 HUD 图标同步）→ `updateTreeMonkeys`（检测玩家触树、扣除随机资源并生成逃跑猴子）→ 各 `animal.update`（仅更新玩家曼哈顿距离 <55 或已死亡实例；伙伴在入口提前分流 `updateCompanion`，敌对动物走原 AI，随后共用 `finishUpdate` 做击退/水域钳制/`setLinvel`/视觉）→ 各 `monkey.update`（逃跑/受阻转向/达到距离消失，并过滤已移除实例）→ `physWorld.step()` → 箭矢/掉落/粒子/飘字 → 冥火/闪电/神器祝福 → 节点(摇晃/灌木再生/枯萎淡出) → 篝火动画 → 交互检测(E 提示) → 镜头(lerp+鼠标偏移+震动) → **世界事件**（`director.update(this, dtRaw, playTime)`：掷骰/驱动当前激活事件，见下「世界事件链」）→ 昼夜（`updateDayNight`：血月时染红夜幕 + 🩸 时钟，否则正常昼夜色调与时钟）→ 天气（`updateWeather`：晴/雨随机切换，`rainIntensity` 渐变驱动雨幕粒子/遮罩/雨声/玩家移速 -20%；**与世界事件并存**）→ 动物重生（血月夜提速 6→3s、死亡冷却 25→12s）→ HUD/小地图（每 0.35s `revealAround` 揭雾 + 重绘）/Boss 血条 → 浪花动画与区块裁剪。hitstop 通过缩放 dt 实现（`hitstopT`），暂停/菜单打开时整个 `updateWorld` 跳过（菜单开着时逃跑、灼烧/中毒等也不会结算——测试时注意）。

### 战斗与采集链

`Player.update` 检测左键 → `Player.attack` → 近战：`Game.meleeStrike`（伤害用 `player.weaponDmg(wd)`=基础×武器等级×篝火强化；遍历 `game.combatTargets()` 距离+扇形角判定。动物目标跳过 `meleeImmune`/`latched`，继续走灼烧、嗜血、掉落、重生与 Boss 结算；猴子目标只受直接伤害，击杀后返还本次偷走的物品，不触发动物掉落/重生）→ 资源节点每挥击只命中最近一个 → `harvestHit`（战斧 `chopBonus`/拾荒者加成）→ 耗尽 `destroyNode` 记入 `removedNodes`。远程：`Projectiles.fire` → 每帧遍历 `combatTargets()` 距离判定，爱心箭仅对动物调用 `makeLoved`。圣翼冲刺、冥火、天降闪电也统一从 `combatTargets()` 取目标。Boss 死亡 → `onAnimalKilled` 设 `bossDefeated` → 自动存档 + 胜利画面（注意会 `paused=true`）。

### 树上猴子链（运行时事件，不入存档）

`buildNodes` 为每棵存活树调用 [src/entities/monkey-logic.ts](src/entities/monkey-logic.ts) `hasHiddenMonkey(seed,nodeId)`，约 8% 的树显示猴尾 → `Game.updateTreeMonkeys` 检测玩家距树中心 ≤0.78 → 尾巴隐藏、该树本次运行标记 `monkeyTriggered` → `pickMonkeyTheft` 从玩家当前非零的基础资源和货币中随机选一种，偷走 `ceil(持有量×10%)`（至少 1）→ `Player.changeMonkeyItem` 立即扣除并刷新 HUD → 创建 [src/entities/monkey.ts](src/entities/monkey.ts) `Monkey`，以 10.5 世界单位/秒背离玩家逃跑。猴子跑满 18 世界单位后消失且赃物永久丢失；在此之前被任一战斗伤害源击杀则原额返还。猴子不攻击、不进入 `ANIMALS`/`spawnRecords`、不掉落普通战利品，也不参与存档。

### 世界事件链（EventDirector，运行时，不入存档）

`Game.director`（[src/world/events.ts](src/world/events.ts) `EventDirector`，构造时传 `WORLD_EVENTS`）在主循环镜头之后、昼夜之前每帧 `update(game, dtRaw, playTime)`：无激活事件时倒计时 `rollT`，到点从「年龄 ≥ `minAge` 且过冷却 `cooldown` 且 `canStart()`」的事件池按 `weight` 加权抽取（另有 35% 概率「留白」什么都不发生）→ `onStart`；有激活事件时每帧 `onTick`，`shouldEnd()` 为真则 `onEnd` 并记 `lastFired`。**同一时刻只激活一个世界事件**；天气(rain) 不在此列、与事件并存。当前唯一事件 `BloodMoon`（血月夜）：`canStart` = `game.isNight`，`onStart` 置 `game.bloodMoon=true`/`lootMult=2` + `hud.setBloodMoon(true)`(暗红夜幕 + 脉动血色 vignette) + `sfx.roar` + 震屏，`shouldEnd` = 已持续 >25s 且天亮，`onEnd` 复位标志 + `hud.setBloodMoon(false)`。战斗侧狂暴（仇恨/移速/伤害/被动转主动/染色）与掉落翻倍都由 [animals.ts](src/entities/animals.ts) 每帧读 `game.bloodMoon`/`die()` 读 `game.lootMult` 派生，**不烘进存档或实例数值**。新增事件：实现 `WorldEventDef` 加进 `WORLD_EVENTS`，世界/战斗侧效果尽量挂在 `game` 上的全局标志派生。

### 神器祝福链（运行时世界事件，不入存档）

`Game.updateBlessing`（主循环内，在动物 update 之后调用，可安全往 `animals` 推实例）：`blessing` 为空且仍有未拥有神器时倒计时 `blessingCd` → `spawnBlessing`（在随机岛陆地避开 Boss/篝火/洞口/玩家选点，建 `BlessingSite` 光柱 root 入 `objects`）→ `spawnBlessingGuardians`（6~9 只 `wolf/boar/tiger/snake/goat`，`new Animal(...,-1,G_ANIMAL,growthFactor,true)`，`spawnIdx=-1` 故 `onAnimalKilled` 不触发重生；push 进 `animals` 与 `blessingGuardians`）。玩家走入光柱（`updateInteraction` 内 `nearBless`）按 E → `startBlessing`（从尚未拥有的 5 件神器中随机一件，`menuKind='blessing'` 冻结世界，`hud.showBlessingCeremony` 跑揭晓动画）→ `acceptBlessing`（4 件神器武器进 `weapons[]` 并立即装备 + `buildHotbar`；翅膀挂件进 `relics`；移除光柱、`destroy` 残余守卫、设下次 `blessingCd`）。死亡 `regenerateAnimals` 会清 `blessingGuardians` 并对仍在的光柱重新布防（防白嫖）。神器集齐后神光不再降临。

### 冥火链（阿比努斯的权杖）

`Player.attack`（`wd.cast`）→ `Game.castNetherFire(castTx,castTy,...)`（落点已在 player.update 收束到 `castRange` 领域内）建 `NetherFire` → `updateNetherFires`：0.22s 法阵聚集 → 爆发，遍历 `combatTargets()`；动物仍跳过 `latched`/`meleeImmune` 并附加 `burnT`，猴子只承受直接伤害。

### 商店链

篝火菜单 `cf-shop` 按钮 → `Game.openShop()`（`menuKind='shop'`，世界冻结）→ [src/ui/hud.ts](src/ui/hud.ts) `renderShop(player, tab)` 以 innerHTML 渲染五个选项卡（武器/武器升级/天赋/皮肤/道具）→ [src/main.ts](src/main.ts) 在 `#shop-menu` 上做事件委托（`data-tab` / `data-act`+`data-id`）→ `Game.setShopTab` / `Game.shopAction`（`buy-weapon`/`upg-weapon`/`buy-talent`/`buy-skin`/`equip-skin`/`buy-gear`，余额校验 `Player.canAfford/pay`）。商品与价格数据全在 [src/defs.ts](src/defs.ts)（`WEAPONS[].price`、`WEAPON_UPG`、`TALENTS`、`SKINS`、`GEAR`、货币掉率 `COIN_TABLE`）。武器栏 `hud.buildHotbar` 按 `player.weapons` 动态生成（1~9 键）。神器武器不在商店出售（无 price、带 `artifact`），但神器武器仍可在「武器升级」选项卡升级。天赋效果分散在引用点：`sprinter/tough`（player.ts）、`vampire`（game.meleeStrike）、`scavenger`（game.harvestHit + animals.die）、`lucky`（animals.die）。道具效果：`boat` 在 player.update 的乘船判定中生效。

### 烹饪与进食链

篝火菜单 `cf-cook` 按钮 → `Game.openCook()`（`menuKind='cook'`，世界冻结，Esc 走 `closeCook`）→ [src/ui/hud.ts](src/ui/hud.ts) `renderCook(player)` 列 `FOODS` 配方/持有/增益 → [src/main.ts](src/main.ts) 在 `#cook-menu` 上事件委托（`data-cook`）→ `Game.cookAction(id)`：按 `def.recipe`（生鲜 + 1 木柴燃料）校验并扣资源、`player.food[id]++`、刷新 HUD。进食在 `Player.update`（世界内，菜单冻结时不触发）：`Q` 浆果类（熟食 `berryJerky` 优先，断粮才生浆果回 4）/`F` 肉类（熟食 `cookedMeat` 优先，断粮才生肉回 7 且 30% `applyFoodPoison`）/`R` 料理（`skewer`/`stew`，满血也可吃以触发增益）→ `consumeFood` 统一结算回血/回耐力/攻击 buff（写 `atkBuffMul`/`atkBuffT`，由 `dmgMul` getter 读取）/持续回血（`regenRate`/`regenT`）/解蛇毒 + 解食物中毒。生肉回血与中毒率、各熟食数值全在 [src/defs.ts](src/defs.ts)（生食回血硬编码在 `player.ts` 进食分支）。

### 岛屿小 Boss 链（精英守护者，一次性、可选支线）

`worldgen` 为每座非巨熊岛布 1 只小 Boss（`SpawnPoint.miniBoss` id），`Game.create` 把它带进 `spawnRecords[i].miniBoss` → `spawnAnimal` 用第 9 参传给 `new Animal(...,miniBossId)` 精英化。`spawnAllAnimals` 跳过 `miniBossesDefeated` 里的、`updateRespawns` 跳过所有 `miniBoss`（不重生，与巨熊同列）。Boss 血条（`updateHud`）改为遍历 `animals` 取**最近的在战巨熊或小 Boss**（aggro 或 15 格内），`hud.setBossBar(frac, name)` 显示其名。死亡走 `die→onAnimalKilled`：`a.def.boss` 触发胜利；`a.miniBoss` 改走 `onMiniBossKilled(id)` —— 加入 `miniBossesDefeated`、发专属战利品（`player.trophies.add` + `hud.setTrophies`，重复则掉 5 钻兜底）、`saveNow`，**不触发胜利**。小地图标记由 `liveMiniBosses()`（未击杀者）传入 `drawMinimap`。战利品 5 个被动在 player.ts/game.ts 各引用点派生，**不烘进存档数值**（避免读档重复叠加），玩家死亡不清 `trophies`。

### 伙伴/驯养链

丘比特箭命中普通动物 → `Animal.makeLoved`（巨熊/小 Boss 免疫）→ 玩家距目标 1.5 格内，`Game.updateInteraction` 排除 marine 与 `meleeImmune` 后显示 E 收服 → `recruitCompanion`（上限 2；设 `companion=true/loved=true`、脱离原 `spawnRecord`，原刷新点稍后正常补怪；加入 `Game.companions` 并刷新 `hud.setCompanions`）。`Animal.update` 对伙伴提前转入 `updateCompanion`：攻击力 >0 的伙伴用 `findEnemy` 在 12 格内找最近的敌对、非爱河、可近战陆生动物，命中后写 `enemy.foe=this` 让敌人转火；无攻击力伙伴只跟随，玩家在其 6 格内由 `Game.companionSpeedMul` 获得 1.12× 移速。敌人 AI 的坐标/死亡判定统一读 `foe ?? player`，普通攻击/冲锋打伙伴时走 `takeEnemyHit`（不附加毒/魅惑）→ 0 血 `fallAsCompanion` → `onCompanionDied` 从名册移除并立即 `saveNow`，无动物掉落/重生。玩家伤害源通过 `combatTargets()` 排除伙伴，Boss 血条聚合也排除伙伴。走近现有伙伴按 E → `dismissCompanion`，放归为爱河动物并清理所有指向它的 `foe`；收服/遣散本身要到下一次统一存档才持久化。读档及玩家死亡后的 `regenerateAnimals` 都按物种列表 `restoreCompanions`，在玩家身边生成满血新实例；进洞时伙伴原地待命，离玩家超过 26 格直接传送归队。

### 存档链

统一写入函数：`Game.saveNow()` → `writeSave`（[src/core/save.ts](src/core/save.ts)，key `island-survival-save-v1`，**version 4**）。调用点包括篝火休息、巨熊/小 Boss 击杀与伙伴阵亡；普通收服/遣散不立即写盘。字段含货币/武器库存（含神器武器）/武器等级/皮肤/天赋/道具 gear/**神器挂件 relics**/**随身熟食 food**/**小 Boss 战利品 trophies（player 内）+ 已杀小 Boss miniBossesDefeated（顶层）+ 伙伴物种 companions（顶层）**（均为可选字段，旧档缺省为空/缺省为零库存）/迷雾 explored（bit 打包 base64，`packExplored`/`unpackExplored`）/已开宝箱 `openedChests`（可选字段，旧 v4 档缺省为空）；洞穴水晶用 `removedNodes`（id ≥ 1_000_000）。**注意 `food`/`trophies`/`miniBossesDefeated`/`companions` 都是纯附加可选字段、不影响世界生成，故沿用 v4 不升版本（保住旧档）；只有改世界生成/地图尺寸/节点 id 语义才升版本。**小 Boss 布点由 isle/seed 决定且不消耗 rng，旧档世界一致。神器祝福光柱/守卫、树的 `monkeyTriggered` 状态和活动猴子都属于运行时事件，**不进存档**；读档会按相同 `seed+nodeId` 恢复哪些树藏猴子，但每棵树的触发状态重新开始。读档：`main.ts` `loadSave()`（版本 ≠4 直接判废返回 null）→ 传入 `Game.create`，用相同 `seed` 重生成世界后按 `removedNodes` id 列表跳过已采集节点 → `spawnAllAnimals` → `restoreCompanions(save.companions)` 在玩家附近满血归队。死亡 → `onPlayerDeath` → 死亡画面 → `Game.respawn()` 回到 `campfireId` 篝火、`clearStatuses()` 清全部状态并 `regenerateAnimals()`；重生同时清理活动猴子、重建普通动物和仍存活的伙伴。

## Important Paths

- 数值调参（武器/动物/升级/玩家手感）：全在 [src/defs.ts](src/defs.ts)，不要散落到逻辑里
- 烹饪/食物：配方与熟食数值/buff 在 [src/defs.ts](src/defs.ts) `FOODS`；**生浆果(4)/生肉(7) 回血与 30% 食物中毒率硬编码在 [src/entities/player.ts](src/entities/player.ts) `update` 进食分支与 `eatRawMeat`**（调平衡两处都要看）
- 猴子事件参数：隐藏概率/偷窃比例/逃跑距离在 [src/entities/monkey-logic.ts](src/entities/monkey-logic.ts)，移动速度与视觉在 [src/entities/monkey.ts](src/entities/monkey.ts)
- 小 Boss/战利品：精英倍率与所掉战利品在 [src/defs.ts](src/defs.ts) `MINIBOSSES`、被动文案在 `TROPHIES`；**被动数值（攻击 +12%/移速 +10%/受伤 -12%/击杀回血 +6）硬编码在各引用点（[player.ts](src/entities/player.ts) `dmgMul`/速度/`takeDamage`/`applyPoison`/`applyFoodPoison` 与 [game.ts](src/game.ts) `meleeStrike`），调数值要逐点改**；布点逻辑在 [worldgen.ts](src/world/worldgen.ts) 末尾 `findLand` 循环
- 地形生成参数（岛屿大小/生物群系阈值/分布概率）：[src/world/worldgen.ts](src/world/worldgen.ts) `generateWorld`
- 世界事件（血月夜等的解锁年龄/权重/冷却/持续/效果）：[src/world/events.ts](src/world/events.ts) `WORLD_EVENTS`；血月的战斗派生散在 [animals.ts](src/entities/animals.ts)（`update`/`finishUpdate`/`die`）与 [game.ts](src/game.ts)（`updateDayNight`/`updateRespawns`），视觉遮罩在 [src/style.css](src/style.css) `#night-overlay.bloodmoon`/`#bloodmoon-vignette` + [index.html](index.html)
- 端口：5188（[vite.config.ts](vite.config.ts) 与 [.claude/launch.json](.claude/launch.json) 保持一致）
- 面向玩家的操作说明 / 玩法文档：[README.md](README.md)（改按键或玩法机制时同步更新）
- 猴子逻辑测试：[src/entities/monkey-logic.test.ts](src/entities/monkey-logic.test.ts)、[src/entities/player-monkey.test.ts](src/entities/player-monkey.test.ts)
- `node_modules/`、`dist/`、`.codegraph/`：生成物，勿入提交/勿手改

## Build, Run, And Deploy

```bash
npm run dev      # Vite dev server, 端口 5188
npm run check    # tsc --noEmit —— 本仓库的标准验证手段
npm run test:monkey # Vitest：猴子隐藏判定、偷窃/返还与玩家库存
npm run build    # tsc + vite build（产物 dist/，base './' 可直接静态托管）
```

按用户规约：**改完代码跑 `npm run check` 静态编译即可**，不要求每次跑完整 build。

## Repo-Specific Conventions

- 新增代码文件顶部加 `// @author: zhjj` 注释（用户全局规约）。
- 游戏内文案与 UI 全部中文。
- Pixi v8 API 形态：`g.rect(...).fill(color)` 链式（先形状后填充）；Text 用对象参数构造；掉落物图标直接用 emoji `Text`。
- 输入用 `KeyboardEvent.code`（`KeyW`/`Digit1`/`Space`），不要用 `key`。
- Vitest 测试与被测实体同目录，文件名 `*.test.ts`；猴子测试使用最小 Player 原型桩，避免初始化 Pixi/Rapier。
- `Animal` 内部跨实例访问 private 成员（狼群联动 `startAggro`）是有意为之（TS 同类私有可见）。

## Editing Guardrails

- **存档兼容性**：资源节点 id 由 `generateWorld` 中的遍历顺序决定（即使节点被跳过 id 也递增）。改动节点生成的循环顺序/概率分支会让旧存档的 `removedNodes` 错位。**版本约定**：只有破坏旧档可用性的改动（世界生成/地图尺寸/节点 id 遍历）才递增 `version`（当前策略：版本不符返回 null 当新档）。**纯附加字段**（如 `relics`/`openedChests`/`food`）声明为可选、读档时缺省填默认值即可，**不要升版本**（否则白白清空所有旧档）。
- **确定性**：世界生成只能用 `mulberry32`/`Noise2D`（种子化），禁止在 worldgen 里用 `Math.random()`（运行时特效随机无妨）。
- **更新顺序**：实体先读 `body.translation()` 再 `setLinvel`，`physWorld.step()` 在所有实体 update 之后——新系统插入主循环时保持该顺序。
- **碰撞分组位**：`GROUPS`（defs.ts）5 个 membership 位（STATIC/PLAYER/ANIMAL/WATER/WALL）互相成对引用——乘船渡海（PLAYER_BOAT 不含 WATER 位）、圣翼冲刺穿障（PLAYER_PHASE 去 STATIC 位但保留 WALL 位 → 只穿树石不穿墙）、海洋动物自由游动（MARINE filter 只有 PLAYER 位）都依赖这些位。**树/石/水晶用 `STATIC`，洞穴岩壁与地图边界墙用 `WALL`**（buildWaterColliders / buildCaveScene），新增"可穿/不可穿"障碍时按此分流；改任何一组前先核对全部配对关系（含 ANIMAL filter 需含 WALL 位，否则陆地动物会穿墙）。玩家碰撞组只在 `Player.update` 末尾按 `colGroup` 集中切换（相位 > 乘船 > 常规），别处不要再 `setCollisionGroups`。
- **海洋动物没有物理围栏**：它们留在水里完全靠 AI 的 `isWater` 钳制（wander 目标校验 + 速度轴向滑动 + 冲锋前方检查）。给 marine 动物加新移动逻辑时必须带同样的检查。
- **海神踏浪与乘船互斥**：手持 `seaLord` 武器且脚下是水时，玩家走 `seaWalking` 分支（1.7×移速、不溺水、不自动上船，碰撞组过滤 WATER）；不要在其他位置重复切碰撞组，最终仍由 `Player.update` 末尾按当前状态集中同步。
- **新增玩家状态效果**走 [src/core/status.ts](src/core/status.ts)：在 `StatusKind`/`STATUS_INFO` 注册 → 来源处 `player.statuses.add()` → 伤害/效果结算留在来源处（不要塞进 Statuses）。维持型状态（如溺水）用短时长反复 add 续命。
- **战斗目标统一入口是 `Game.combatTargets()`**：当前返回动物 + 活动猴子，五个调用点是 `Game.meleeStrike`、`Projectiles.update`、`Game.updateNetherFires`、`Game.castLightning`、`Player.update` 圣翼冲刺。新增可受伤实体时实现 [src/entities/combat-target.ts](src/entities/combat-target.ts) `CombatTarget` 并加入该入口；`latched`/`meleeImmune`、爱心、灼烧等仍是动物专属分支，不要把猴子错误送入动物状态/掉落逻辑。
- **伙伴仍在 `animals[]`，但不是玩家战斗目标或刷新点**：`combatTargets()` 和 Boss 血条必须过滤 `companion`；伙伴攻击目标直接遍历 `game.animals`，要继续排除伙伴/爱河/海洋/近战免疫目标。收服时必须把原 `spawnRecord.animal` 置空并将伙伴 `spawnIdx=-1`，否则同一实例会被普通重生系统重复管理。敌人的 `foe` 引用在伙伴阵亡/遣散时必须全量清理；伙伴死亡只走 `onCompanionDied`，不能进入动物掉落、`onAnimalKilled` 或普通重生。
- **伙伴存档只存物种，不存实例运行态**：`SaveData.companions?: string[]` 读档/玩家复活时通过 `restoreCompanions` 生成满血实例，因此 hp、位置、仇恨、攻击冷却不持久化。伙伴阵亡立即存档以防读档复活；收服/遣散不会立即保存，修改这一时机时同步更新玩法文档与验证步骤。
- **树上猴子不是动物刷新点**：隐藏判定必须保持 `seed+nodeId` 的无状态确定性，不能消耗 `worldgen` RNG 或改变资源节点 id 遍历；猴子不进入 `ANIMALS`/`spawnRecords`，不调用 `onAnimalKilled`，逃脱不返还、击杀只返还赃物。当前 `monkeyTriggered` 与活动猴子不存档，修改这一策略才需要升级存档结构。
- **神器获取唯一入口是 `Game.acceptBlessing`**：武器走 `weapons[]`（会存档、可商店升级），挂件走 `relics`（`SaveData.relics`，旧档缺省空）。新增神器在 `defs.ts` `ARTIFACTS` 注册并按 `slot` 分流；新增神器武器同时在 `WEAPONS` 注册并带 `artifact:true`（不出现在商店武器列表）。
- **小 Boss 战利品被动是运行时派生，不烘进存档数值**：5 个被动各在引用点读 `player.hasTrophy(id)`（攻击/移速/减伤/免疫/击杀回血），切勿在获得时把加成写进 `maxHp`/`maxStam` 等持久字段（会读档重复叠加）——这也是当前刻意避开「+生命上限」类战利品的原因。小 Boss 布点必须保持「不消耗 worldgen rng、由 isle/seed 决定」，否则旧档世界漂移。小 Boss 走 `miniBoss` 字段而非 `def.boss`：**只有 `def.boss`（巨熊）触发胜利**，新增 Boss 别错设 `boss:true`。
- **`Animal.bodyScale` 不是摆设**：`animate` 每帧用 `bodyC.scale.x = flip * bodyScale` 做朝向翻转，放大体型（小 Boss 1.45）必须经 `bodyScale` 字段、不能只在构造里 `bodyC.scale.set`（会被翻转覆盖）。
- **世界事件（EventDirector）是运行时、单事件激活、不入存档**：新增事件实现 [src/world/events.ts](src/world/events.ts) `WorldEventDef` 并加进 `WORLD_EVENTS`；战斗/世界侧效果应挂在 `game` 上的全局标志（如 `bloodMoon`/`lootMult`）由各引用点每帧派生，**不要烘进实例数值或存档**（与小 Boss 战利品同理，避免读档/重生重复叠加）。**天气(rain) 刻意不归 director 管**，是独立的持续环境层、可与任意世界事件并存——不要把 rain 改造成「单事件激活」否则会与血月等互斥（退步）。`director.update` 在主循环镜头之后、昼夜之前调用，且需在 `updateDayNight` 之前置好 `bloodMoon` 标志（昼夜分支据此染红夜幕）。
- **神器祝福/守卫/冥火/活动猴子都是运行时对象**：不直接写入存档。祝福选点与守卫可用 `Math.random()`；树是否藏猴子必须稳定，触发后的偷窃种类可运行时随机。`spawnBlessing` 选点和 `spawnBlessingGuardians` 在主循环 `updateBlessing`（动物 update 之后）执行，往 `animals` 推实例是安全的；守卫 `spawnIdx=-1` 不触发重生。
- 不要升级 `vite` 到 5+ / 引入需 Node 18+ 的工具链（本机 Node 16）。
- `window.__game` 调试钩子（main.ts）供浏览器控制台/自动化测试使用，保留。

## Refresh Triggers

满足任一即应重跑 `/project-agents-md`：

- `src` 模块/目录、启动链、`Game.updateWorld` 顺序或 DOM/Pixi UI 分界重构
- `SaveData`、世界生成确定性、节点 id、小 Boss 布点或运行时对象持久化策略变更
- 新增/重构世界事件、装备/消耗品/永久被动、伙伴/AI 仇恨、Boss 聚合或 `CombatTarget` 体系
- 碰撞分组、渲染方案、地图/洞穴边界或玩家移动状态优先级变化
- Vite/Node 约束、构建产物、部署方式、后端/API/资源管线变化

## Verification

1. `npm run check` 零错误。
2. `npm run test:monkey` 通过 9 个猴子逻辑/库存测试。
3. `npm run dev` 后浏览器无 console 报错；标题画面可开新档。
4. 行为级冒烟（浏览器控制台，依赖 `window.__game`）：移动后 `__game.player` 坐标变化；`__game.nodes` 找树 `meleeStrike` 后 hp 递减；篝火 `campfireAction('rest')` 后 localStorage 出现 `island-survival-save-v1`（version 4）。神器祝福可 `__game.blessingCd=0.01` 后跑几帧触发光柱与守卫，走入按 E（`input.pressed.add('KeyE')`）跑仪式、`acceptBlessing()` 发放。
5. 猴子冒烟：把玩家资源/货币清零后仅设 `__game.player.res.wood=100`，找到 `__game.nodes.find(n=>n.monkeyHidden&&!n.monkeyTriggered)`，`__game.player.teleport(n.x+0.6,n.y)` 后手动 tick；应生成 1 只猴子且木材变 90。逃脱前执行 `__game.monkeys[0].damage(999,0,0,__game)`，木材应恢复 100。
6. 预览面板隐藏时 rAF 冻结、游戏循环停转——自动化测试用 `for(...) __game.tick(1/60)` 手动驱动帧，且先确认 `paused`/`menuOpen` 为 false（商店/胜利画面都会冻结世界）。
7. 烹饪冒烟：`__game.player.res.meat=9;__game.player.res.wood=9;__game.cookAction('cookedMeat')` 后 `__game.player.food.cookedMeat` 应 +1 且 meat/wood 各 -1。把 hp 扣到不满、`__game.input.pressed.add('KeyF')` 后手动 tick，应消耗 1 份烤肉并回血；清空熟食只留生肉时按 F 走生肉分支（回血弱、可能 `statuses.has('foodpoison')`）。`skewer` 食用后 `__game.player.dmgMul` 应高于基线（攻击 buff 生效）。
8. 小 Boss 冒烟：`__game.worldData.miniBosses` 非空（每座非巨熊岛 1 个）；`__game.animals.filter(a=>a.miniBoss)` 与之数量相符且各带金冠/放大。找一只 `mb=__game.animals.find(a=>a.miniBoss)`，`mb.damage(99999,0,0,__game)` 击杀后：`__game.miniBossesDefeated` 含其 id、`__game.player.trophies` 多一件、对应被动生效（如 tigerfang → `dmgMul` 升高）、localStorage 存档含 `miniBossesDefeated`/`trophies`，且不弹胜利画面。死亡重生后该小 Boss 不再 spawn。
9. 世界事件/血月冒烟（依赖 `window.__game`）：设 `__game.bloodMoon=true;__game.lootMult=2` 后手动 tick——`updateDayNight` 会据标志把时钟切 🩸 且加深夜幕；附近敌对动物仇恨范围明显扩大并染血色（`gfx.tint`）；击杀一只动物其资源/钱币掉落约为平时两倍。**注意：暗红夜幕(`#night-overlay.bloodmoon`)与脉动血色 vignette(`#bloodmoon-vignette.active`)由 `hud.setBloodMoon(true)` 切换、只在事件 `onStart` 调用**，单设标志不会出现——验证视觉时在控制台手动给这两个元素加类，或确认正式触发路径。复位标志后视觉/时钟恢复。（真实触发需世界满 3 分钟且夜晚，由 `director` 掷骰，不便等待，故用标志直驱验证。）
10. 伙伴冒烟：找一只普通非海洋/非蝙蝠动物 `a`，执行 `a.makeLoved(__game);__game.player.teleport(a.x,a.y);__game.input.pressed.add('KeyE')` 后手动 tick，应进入 `__game.companions`，且 `__game.combatTargets()` 不含它。战宠靠近敌人后应主动攻击并令敌人 `foe` 指向伙伴；无攻击力伙伴在玩家 6 格内时 `__game.companionSpeedMul(...)===1.12`。篝火保存后 localStorage 顶层含 `companions`；执行 `__game.onCompanionDied(a)` 后名册/HUD 清除且存档同步移除。玩家死亡重生或重载存档后，剩余伙伴应在玩家身边满血恢复。
