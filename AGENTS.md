# AGENTS.md — Island Survival（孤岛求生）

## Refresh Metadata

- Last refreshed: 2026-06-13（refresh pass：神器祝福系统（天降光柱 + 狂暴守卫 + 祝福仪式）、神器武器（丘比特的弓/阿比努斯的权杖）、神器挂件（大天使的翅膀）、坠入爱河 / 狂暴动物态落地后核对；存档新增 relics、`Animal` 构造签名变更已 grep 源码验证）
- Refresh basis: 全量代码（本文件与全部源码同批演进，逐文件可追溯）
- Confidence: high

## Project Overview

类 Hades 俯视角**群岛**生存动作游戏。纯前端单页应用，无后端、无静态素材：所有图形用 PixiJS Graphics/Text(emoji) 程序化绘制，音效用 WebAudio 合成，存档写 localStorage。玩法主轴：采集/狩猎 → 钱币 → 商店（武器/天赋/皮肤/小木舟）→ 乘船跨岛 → 击败随机岛屿山顶的 Boss 巨熊。额外世界事件：随机岛屿天降**神器祝福**光柱（被狂暴守卫环绕），按 E 举行仪式随机获得 3 件神器之一（神器不在商店出售）。

- 技术栈：TypeScript + Vite 4 + PixiJS 8 + `@dimforge/rapier2d-compat`（2D 物理）
- ⚠️ 本机 Node 为 **16.20**，因此 Vite 锁定在 ^4（Vite 5+ 需 Node 18+）。升级依赖前先确认 Node 版本约束。

## Architecture

双坐标系约定（全仓库最重要的不变量）：

- **世界单位**：1 单位 = 1 地图格。物理（Rapier）、AI、逻辑距离全部用世界单位。
- **像素**：渲染时乘 `SCALE`（= 32，定义于 [src/defs.ts](src/defs.ts)）。精灵尺寸直接以像素绘制，位置用 `pos * SCALE` 设置；舞台容器不缩放。
- 屏幕→世界换算只有一处：`Game.screenToWorld()`（[src/game.ts](src/game.ts)）。

UI 分两层：游戏画面是 Pixi canvas（`#app`）；HUD/菜单/标题画面全部是 **HTML/CSS DOM**（[index.html](index.html) + [src/style.css](src/style.css)），由 [src/ui/hud.ts](src/ui/hud.ts) 以 `getElementById` 操作。新增 UI 时遵守这个分界：世界内的视觉进 Pixi，叠加层 UI 进 DOM。

物理用法刻意保持最小 API 面（兼容性考虑）：仅 `World`、`RigidBodyDesc`、`ColliderDesc`、`setLinvel`、`translation`、`setCollisionGroups`、`step`。攻击判定/拾取/箭矢命中均为手写距离+角度计算（在 `Game.meleeStrike` / `Projectiles.update` / `Drops.update`），**不要**改成 Rapier 查询管线。碰撞分组统一定义在 [src/defs.ts](src/defs.ts) `GROUPS`（`(membership<<16)|filter`）：深水屏障是独立的 `WATER` 组，玩家乘船时切到 `PLAYER_BOAT`（filter 不含 WATER）实现渡海；海洋动物 `MARINE` 组只与玩家碰撞，靠 AI 的 `isWater` 检查留在水里。战争迷雾：`Game.explored`（Uint8Array）+ [src/ui/hud.ts](src/ui/hud.ts) 迷雾 canvas，存档时按位打包（save.ts `packExplored`）。

## Internal Modules

| 模块 | 职责 | 关键导出 | 下游依赖 |
| --- | --- | --- | --- |
| [src/main.ts](src/main.ts) | 入口：标题画面、按钮接线、商店事件委托（`#shop-menu` 上的 `data-tab`/`data-act`）、`window.__game` 调试钩子 | — | game, save, hud, audio |
| [src/game.ts](src/game.ts) | **中枢**：Pixi/Rapier 初始化、主循环、战斗/采集结算、篝火与存档、商店动作（`shopAction`）、战争迷雾（`explored`+`revealAround`）、**洞穴**（`buildCaves`/`enterCave`/`exitCave`/宝箱/水晶，内部空间放在地图边界外的世界坐标，独立 rng `seed^0xcafe17` 不扰动世界生成确定性；洞窟大小随机 → 宝箱 1~3 个；18% 概率为**宝藏洞穴**：无守卫、宝箱 5~6 个且钻石必出；普通洞穴守卫 = 吸血蝙蝠×3 + 妖狐×2；玩家在洞内时 `inCave` 非空，player.update 据此把脚下强制视为岩地、免雨免溺水；进出洞穴会 `unlatch` 所有吸附蝙蝠）、**神器祝福**（`updateBlessing`/`spawnBlessing` 在随机岛陆地降下光柱 `BlessingSite` + `spawnBlessingGuardians` 生成 6~9 只狂暴守卫；`startBlessing`/`acceptBlessing` 跑仪式并发放神器、驱散残余守卫；运行时事件，不入存档）、**冥火**（`castNetherFire`/`updateNetherFires`：权杖在落点的 `NetherFire` 范围灼烧）、昼夜、天气、镜头、动物重生 | `Game`, `WNode` | 几乎全部模块 |
| [src/defs.ts](src/defs.ts) | 数据定义（所有数值调参入口）：`SCALE/MAP(320)/Tile/GROUPS`、武器 `WEAPONS`(+price，神器武器带 `artifact`/`loveChance`/`cast`/`castRange`/`aoeR`)、神器 `ARTIFACTS`/`ArtifactDef`（`slot:'weapon'|'relic'`，仅祝福获得）、动物 `ANIMALS`、货币 `CURRENCY`/掉率 `COIN_TABLE`、升级 `UPGRADES`/`WEAPON_UPG`、天赋 `TALENTS`、皮肤 `SKINS`、道具 `GEAR`、玩家 `PLAYER` | 同左 | 无 |
| [src/world/worldgen.ts](src/world/worldgen.ts) | 程序化**群岛**（320×320）：随机 1 主岛 + 4~6 小岛、Boss 随机落在某岛山顶、陆地连通域标记（剔除碎礁）、篝火（10 个）随机起点 + 最远点采样、陆地/海洋动物分布 | `generateWorld`, `WorldData`, `Isle` | noise, defs |
| [src/world/worldrender.ts](src/world/worldrender.ts) | 地形渲染：16×16 格区块 Graphics、海岸浪花动画、视野裁剪 | `WorldRenderer` | defs, noise |
| [src/entities/player.ts](src/entities/player.ts) | 玩家：移动/翻滚(无敌帧)/武器库存(`weapons[]`+`weaponIdx`,1~9 键)/`weaponDmg`(基础×武器等级×篝火强化)/进食(解毒)/**状态效果**（`statuses: Statuses`——`applyPoison`/`applyCharm`(WASD 反向)/`drainBlood`(蝙蝠吸血,无视无敌帧)/溺水维持态/`clearStatuses`,图标同步在 update 末尾按 `statusKey` 变更触发）/乘船(`sailing`,自动上下船+碰撞组切换)/皮肤粒子光效（`SkinDef.fx`：攻击迸发 + 0.45s 待机微光）/钱币 `coins`/天赋 `talents`/道具 `gear`/**神器挂件 `relics`**（`hasRelic`）；**神器手感**：`wd.cast`（权杖）→ 手持时画施法领域环 `rangeG`+落点 `castG`、攻击调 `game.castNetherFire`；`wd.loveChance`（丘比特弓）→ `fire` 传 love；`relics.has('wings')`（大天使翅膀）→ 翻滚改圣翼冲刺（更快、无敌帧更长、`dashHits` 去重撞伤路径生物、`drawWings` 背后羽翼） | `Player` | defs, animals(type), hud, audio, status |
| [src/entities/animals.ts](src/entities/animals.ts) | 动物 AI 状态机（idle/wander/chase/windup/charge/flee/latch/dying），行为差异全部由 `AnimalDef` 可选标志驱动：`boss`/`charge`(+`chargeSpeed/Dur/Min/Max`)/`poison`(蛇)/`charm`(妖狐,WASD 反向)/`retaliate`(山羊/海龟)/`flying`(海鸥/蝙蝠)/`marine`(鱼/龟/鲨,水域约束)/`latcher`+`meleeImmune`(吸血蝙蝠：latch 状态挂玩家头顶 `drainBlood`，吸满 20 点 `vanish`，近战与吸附中均不可被攻击)；运行时态：`loved`（丘比特弓 `makeLoved`：粉心环绕、不再仇恨、被打心碎清醒、Boss 免疫）、`enraged`（神器守卫：红身 + 血气光环、速度/伤害/攻速强化、`startAggro` 主动扑击；构造参数 `enraged`）；灼烧 `burnT`、死亡时钱币掉落（`COIN_TABLE`+幸运天赋） | `Animal` | defs, audio |
| [src/entities/drops.ts](src/entities/drops.ts) | 掉落物：资源 emoji Text + 货币彩色符号，散落→吸附→拾取（货币走 `addCoin`，资源走 `addRes`） | `Drops`, `DropKind` | defs |
| [src/entities/projectiles.ts](src/entities/projectiles.ts) | 箭矢：手动飞行、命中动物/钉树；`fire(...love=0)` 支持爱心箭（粉色外观 + 尾迹，命中按 love 概率 `makeLoved`） | `Projectiles` | defs |
| [src/ui/hud.ts](src/ui/hud.ts) | 全部 DOM 操作：血条/资源/货币/动态武器栏(`buildHotbar`)/小地图 canvas + **战争迷雾层**(`initMinimap`/`revealFog`，`drawMinimap` 第 5 参 blessing → 画无视迷雾的 ✦ 标记)/界面切换/篝火菜单/商店渲染(`renderShop`，五选项卡 innerHTML)/**神器祝福仪式**(`showBlessingCeremony` 图标轮换→揭晓动画 + `hideBlessing`) | 函数集合, `ShopTab` | defs |
| [src/core/](src/core) | `input.ts`（键鼠，`e.code` 体系）、`audio.ts`（合成音效单例 `sfx`）、`status.ts`（玩家状态效果统一管理 `Statuses`：poison/bleed/charm/drown——只管存在与时长并驱动 HUD 图标，伤害结算留在各来源处；新增状态在 `STATUS_INFO` 注册即可）、`save.ts`（localStorage，`SaveData` **v4**：货币/武器/皮肤/天赋/道具 gear/**神器挂件 relics（可选字段，旧 v4 档缺省）**/迷雾 explored（bit 打包 base64）/宝箱 openedChests；神器武器随 `weapons[]` 持久化；地图尺寸或世界生成变更时递增版本，旧版本档直接判废返回 null） | — | — |
| [src/fx.ts](src/fx.ts) | 粒子与伤害飘字对象池 | `Particles`, `FloatTexts` | defs |
| [src/utils/noise.ts](src/utils/noise.ts) | 值噪声 FBM、`mulberry32`、`tileJitter` | — | 无 |

## Key Flows

### 启动链

`index.html` → [src/main.ts](src/main.ts) `init()` 绑定按钮 → 点击新游戏/继续 → `startGame()` → `Game.create(save)`（[src/game.ts](src/game.ts)）→ `RAPIER.init()` + `Application.init()` → `generateWorld(seed)`（群岛布局/Boss 岛/篝火都由种子决定）→ `WorldRenderer.build` → `buildWaterColliders`（深水边界 cuboid=WATER 组 + 地图四周外墙=STATIC 组）→ `buildNodes`（跳过 `removedNodes`）→ `buildCampfires` → `new Player`（读档时恢复武器/货币/天赋/道具/迷雾）→ `spawnAllAnimals` → `initMinimap(world, explored)` + 首次 `revealAround` → `app.ticker.add(tick)`。

### 帧循环（`Game.tick` → `updateWorld`）

顺序固定且有依赖：`player.update`（读上一帧物理位置 → 魅惑反向 → 乘船/溺水判定 → 设置 `setLinvel`，攻击入口；末尾做中毒掉血、状态倒计时与 HUD 图标同步）→ 各 `animal.update`（AI → 海洋动物水域钳制 → `setLinvel`，仅更新玩家 55 单位内）→ `physWorld.step()` → 箭矢/掉落/粒子/飘字 → 节点(摇晃/灌木再生/枯萎淡出) → 篝火动画 → 交互检测(E 提示) → 镜头(lerp+鼠标偏移+震动) → 昼夜 → 天气（`updateWeather`：晴/雨随机切换，`rainIntensity` 渐变驱动雨幕粒子/遮罩/雨声/玩家移速 -20%）→ 动物重生 → HUD/小地图（每 0.35s `revealAround` 揭雾 + 重绘）/Boss 血条 → 浪花动画与区块裁剪。hitstop 通过缩放 dt 实现（`hitstopT`），暂停/菜单打开时整个 `updateWorld` 跳过（菜单开着时灼烧/中毒等也不会结算——测试时注意）。

### 战斗与采集链

`Player.update` 检测左键 → `Player.attack` → 近战：`Game.meleeStrike`（伤害用 `player.weaponDmg(wd)`=基础×武器等级×篝火强化；遍历 `game.animals` 距离+扇形角判定，**跳过 `meleeImmune` 与 `latched`**（吸血蝙蝠只能在未吸附时被弓弩命中，projectiles.update 同样跳过 latched） → `Animal.damage` → 烈焰剑挂 `burnT` 灼烧、击杀触发嗜血天赋回血、死亡时 `drops.spawn` 资源+钱币 + `Game.onAnimalKilled`；资源节点每挥击只命中最近一个 → `harvestHit`（战斧 `chopBonus`/拾荒者加成）→ 耗尽 `destroyNode` 记入 `removedNodes`）；远程：`Projectiles.fire` → 每帧距离判定。Boss 死亡 → `onAnimalKilled` 设 `bossDefeated` → 自动存档 + 胜利画面（注意会 `paused=true`）。

### 神器祝福链（运行时世界事件，不入存档）

`Game.updateBlessing`（主循环内，在动物 update 之后调用，可安全往 `animals` 推实例）：`blessing` 为空且仍有未拥有神器时倒计时 `blessingCd` → `spawnBlessing`（在随机岛陆地避开 Boss/篝火/洞口/玩家选点，建 `BlessingSite` 光柱 root 入 `objects`）→ `spawnBlessingGuardians`（6~9 只 `wolf/boar/tiger/snake/goat`，`new Animal(...,-1,G_ANIMAL,growthFactor,true)`，`spawnIdx=-1` 故 `onAnimalKilled` 不触发重生；push 进 `animals` 与 `blessingGuardians`）。玩家走入光柱（`updateInteraction` 内 `nearBless`）按 E → `startBlessing`（随机一件 `remainingArtifacts()`，`menuKind='blessing'` 冻结世界，`hud.showBlessingCeremony` 跑揭晓动画）→ `acceptBlessing`（武器进 `weapons[]` 并立即装备 + `buildHotbar`；挂件进 `relics`；移除光柱、`destroy` 残余守卫、设下次 `blessingCd`）。死亡 `regenerateAnimals` 会清 `blessingGuardians` 并对仍在的光柱重新布防（防白嫖）。神器集齐后神光不再降临。

### 冥火链（阿比努斯的权杖）

`Player.attack`（`wd.cast`）→ `Game.castNetherFire(castTx,castTy,...)`（落点已在 player.update 收束到 `castRange` 领域内）建 `NetherFire` → `updateNetherFires`：0.22s 法阵聚集 → 爆发，遍历 `animals` 对 `aoeR` 内非 `latched`/`meleeImmune` 目标 `damage` + `burnT`（与近战免伤过滤一致）。

### 商店链

篝火菜单 `cf-shop` 按钮 → `Game.openShop()`（`menuKind='shop'`，世界冻结）→ [src/ui/hud.ts](src/ui/hud.ts) `renderShop(player, tab)` 以 innerHTML 渲染五个选项卡（武器/武器升级/天赋/皮肤/道具）→ [src/main.ts](src/main.ts) 在 `#shop-menu` 上做事件委托（`data-tab` / `data-act`+`data-id`）→ `Game.setShopTab` / `Game.shopAction`（`buy-weapon`/`upg-weapon`/`buy-talent`/`buy-skin`/`equip-skin`/`buy-gear`，余额校验 `Player.canAfford/pay`）。商品与价格数据全在 [src/defs.ts](src/defs.ts)（`WEAPONS[].price`、`WEAPON_UPG`、`TALENTS`、`SKINS`、`GEAR`、货币掉率 `COIN_TABLE`）。武器栏 `hud.buildHotbar` 按 `player.weapons` 动态生成（1~9 键）。神器武器不在商店出售（无 price、带 `artifact`），但神器武器仍可在「武器升级」选项卡升级。天赋效果分散在引用点：`sprinter/tough`（player.ts）、`vampire`（game.meleeStrike）、`scavenger`（game.harvestHit + animals.die）、`lucky`（animals.die）。道具效果：`boat` 在 player.update 的乘船判定中生效。

### 存档链

唯一写入点：篝火菜单休息 `Game.campfireAction('rest')` → `saveNow()` → `writeSave`（[src/core/save.ts](src/core/save.ts)，key `island-survival-save-v1`，**version 4**；地图尺寸/世界生成变更时递增版本）。Boss 击杀也会 `saveNow`。字段含货币/武器库存（含神器武器）/武器等级/皮肤/天赋/道具 gear/**神器挂件 relics**（可选字段，旧 v4 档缺省为空）/迷雾 explored（bit 打包 base64，`packExplored`/`unpackExplored`）/已开宝箱 `openedChests`（可选字段，旧 v4 档缺省为空）；洞穴水晶用 `removedNodes`（id ≥ 1_000_000）。神器祝福光柱/守卫是运行时事件，**不进存档**（读档后按 `blessingCd` 重新降临）。读档：`main.ts` `loadSave()`（版本 ≠4 直接判废返回 null）→ 传入 `Game.create`，用相同 `seed` 重生成世界后按 `removedNodes` id 列表跳过已采集节点。死亡 → `onPlayerDeath` → 死亡画面 → `Game.respawn()` 回到 `campfireId` 篝火、`clearStatuses()` 清全部状态并 `regenerateAnimals()`。

## Important Paths

- 数值调参（武器/动物/升级/玩家手感）：全在 [src/defs.ts](src/defs.ts)，不要散落到逻辑里
- 地形生成参数（岛屿大小/生物群系阈值/分布概率）：[src/world/worldgen.ts](src/world/worldgen.ts) `generateWorld`
- 端口：5188（[vite.config.ts](vite.config.ts) 与 [.claude/launch.json](.claude/launch.json) 保持一致）
- 面向玩家的操作说明 / 玩法文档：[README.md](README.md)（改按键或玩法机制时同步更新）
- `node_modules/`、`dist/`、`.codegraph/`：生成物，勿入提交/勿手改

## Build, Run, And Deploy

```bash
npm run dev      # Vite dev server, 端口 5188
npm run check    # tsc --noEmit —— 本仓库的标准验证手段
npm run build    # tsc + vite build（产物 dist/，base './' 可直接静态托管）
```

按用户规约：**改完代码跑 `npm run check` 静态编译即可**，不要求每次跑完整 build。

## Repo-Specific Conventions

- 新增代码文件顶部加 `// @author: zhjj` 注释（用户全局规约）。
- 游戏内文案与 UI 全部中文。
- Pixi v8 API 形态：`g.rect(...).fill(color)` 链式（先形状后填充）；Text 用对象参数构造；掉落物图标直接用 emoji `Text`。
- 输入用 `KeyboardEvent.code`（`KeyW`/`Digit1`/`Space`），不要用 `key`。
- `Animal` 内部跨实例访问 private 成员（狼群联动 `startAggro`）是有意为之（TS 同类私有可见）。

## Editing Guardrails

- **存档兼容性**：资源节点 id 由 `generateWorld` 中的遍历顺序决定（即使节点被跳过 id 也递增）。改动节点生成的循环顺序/概率分支会让旧存档的 `removedNodes` 错位。改 `SaveData` 结构时必须递增 `version` 并处理旧档（当前策略：版本不符返回 null 当新档）。
- **确定性**：世界生成只能用 `mulberry32`/`Noise2D`（种子化），禁止在 worldgen 里用 `Math.random()`（运行时特效随机无妨）。
- **更新顺序**：实体先读 `body.translation()` 再 `setLinvel`，`physWorld.step()` 在所有实体 update 之后——新系统插入主循环时保持该顺序。
- **碰撞分组位**：`GROUPS`（defs.ts）各组的 membership/filter 位互相成对引用——乘船渡海（PLAYER_BOAT 不含 WATER 位）和海洋动物自由游动（MARINE filter 只有 PLAYER 位）都依赖这些位。改任何一组前先核对全部配对关系。
- **海洋动物没有物理围栏**：它们留在水里完全靠 AI 的 `isWater` 钳制（wander 目标校验 + 速度轴向滑动 + 冲锋前方检查）。给 marine 动物加新移动逻辑时必须带同样的检查。
- **新增玩家状态效果**走 [src/core/status.ts](src/core/status.ts)：在 `StatusKind`/`STATUS_INFO` 注册 → 来源处 `player.statuses.add()` → 伤害/效果结算留在来源处（不要塞进 Statuses）。维持型状态（如溺水）用短时长反复 add 续命。
- **不可被攻击的目标过滤现有四处**，加新伤害源时同步检查：`Game.meleeStrike`（`meleeImmune`/`latched`）、`Projectiles.update`（`latched`）、`Game.updateNetherFires`（冥火，跳过 `latched`/`meleeImmune`）、`Player.update` 圣翼冲刺撞伤（跳过 `latched`/`meleeImmune`）。
- **神器获取唯一入口是 `Game.acceptBlessing`**：武器走 `weapons[]`（会存档、可商店升级），挂件走 `relics`（`SaveData.relics`，旧档缺省空）。新增神器在 `defs.ts` `ARTIFACTS` 注册并按 `slot` 分流；新增神器武器同时在 `WEAPONS` 注册并带 `artifact:true`（不出现在商店武器列表）。
- **神器祝福/守卫/冥火都是运行时事件**：不入存档、不参与世界生成确定性，可用 `Math.random()`。`spawnBlessing` 选点和 `spawnBlessingGuardians` 在主循环 `updateBlessing`（动物 update 之后）执行，往 `animals` 推实例是安全的；守卫 `spawnIdx=-1` 不触发重生。
- 不要升级 `vite` 到 5+ / 引入需 Node 18+ 的工具链（本机 Node 16）。
- `window.__game` 调试钩子（main.ts）供浏览器控制台/自动化测试使用，保留。

## Refresh Triggers

满足任一即应重跑 `/project-agents-md`：

- src 下模块/目录重组，或 `Game` 主循环拆分重构
- 存档格式（`SaveData`）或世界生成确定性策略变更
- 渲染方案变更（如区块 Graphics 改 RenderTexture、DOM HUD 迁入 Pixi）
- 构建/部署变化（Vite 大版本、新增后端或资源管线）
- 新增世界事件 / 装备体系（如神器祝福、挂件 `relics`、新的运行时刷怪入口或免伤过滤点）

## Verification

1. `npm run check` 零错误。
2. `npm run dev` 后浏览器无 console 报错；标题画面可开新档。
3. 行为级冒烟（浏览器控制台，依赖 `window.__game`）：移动后 `__game.player` 坐标变化；`__game.nodes` 找树 `meleeStrike` 后 hp 递减；篝火 `campfireAction('rest')` 后 localStorage 出现 `island-survival-save-v1`（version 4）。神器祝福可 `__game.blessingCd=0.01` 后跑几帧触发光柱与守卫，走入按 E（`input.pressed.add('KeyE')`）跑仪式、`acceptBlessing()` 发放。
4. 预览面板隐藏时 rAF 冻结、游戏循环停转——自动化测试用 `for(...) __game.tick(1/60)` 手动驱动帧，且先确认 `paused`/`menuOpen` 为 false（商店/胜利画面都会冻结世界）。
