# dsh-tui-elysia-pet — 开发者须知

爱莉像素桌宠：注册为 dsh-TUI 的 companion 皮肤，与内置宠物并列（不覆盖）。

## 架构

```
lib/index.js       定位宿主包根 → 动态 import 宿主模块 → registerCompanionSkin()
lib/skin.js        皮肤对象 + 宿主语义补偿（本项目的主要复杂度所在）
lib/frames.js      帧包加载 + 校验即拒绝 + frameAt 确定性选帧
lib/animations.js  宿主语义 → 动画键，逐级回退
lib/config.js      行配置归一化
scripts/build-frames.mjs              源 GIF → assets/letters.json + assets/img/
scripts/render-action-table.mjs       渲染动作对应表
scripts/render-notification-table.mjs 渲染通知绑定表
```

## 硬性约束

- **不新增面板。** 曾通过 `tuiPanels` 注册独立面板，导致连续崩溃并被宿主熔断。根因是宿主为插件提供的收窄 UI 将 `useAnimationFrame(intervalMs)[1]` 截断为仅保留时间值，丢弃了必须挂载到元素的 `ref`，导致可见性跟踪失效、时间不再更新、每帧重建整棵树。**皮肤接缝没有该问题**：时间由宿主经 `render({ now, moodSince })` 传入。
- **不 import react，也不 import 宿主 ui.js 顶层。** React 通过 `createRequire(宿主 package.json)` 解析；UI 组件动态 import 后经 `setHostDeps` 注入。插件物理路径未必在宿主的 node_modules 链上（junction 安装时 realpath 会跳出 profile 目录）。
- **每格只输出 1 个字符宽。** `cells.columns` 是宿主的盒宽契约，一格输出两个字符会溢出侧栏。
- **`render` 必须是纯函数，且对非法输入不抛错。** 已覆盖的边界：`input` 为 `undefined`、`pose` 缺失、`mood` 非字符串、`now < moodSince`、`now` 为 `1e15`。
- **零运行期依赖**：`dependencies` 保持为空对象。
- **软失败**：找不到宿主模块、接缝或素材时仅 `logger.warn` 并返回，不得让 boot 失败。
- **保持 ESM 契约**：`.js` 后缀写全、导出 `name`/`inject`/`apply`、不使用 default export。
- **插件代码仅在 TUI 启动时加载**，`/reload` 不会重载。修改后必须重启 TUI 才能验证。

## 宿主行为中的已知问题

以下均为宿主侧的实际行为，本插件在皮肤层做了补偿。修改相关代码前请先阅读对应实现。

### 1. `deepyAnimationFor` 会丢弃三个键

```js
deepyAnimationFor = DEEPY_SEMANTIC_ANIMATION[s] ?? 'idle'
```

`idle-look` / `idle-spout` / `swim` 不在该表的**键**中（仅作为值出现），因此全部被回落为 `idle`。影响：

- 待机轮换失效：`DEEPY_IDLE_ROTATION` 的四个槽位全部变为 `idle`
- 通知 default 档丢失：「复制」等 44 个无色通知与普通待机无法区分
- 悬停追踪 `look`、碰到本体 `notice` 全部变为 `idle`

补偿位置：`skin.js` 的 `resolveBase()`。

### 2. `music` 语义存在歧义

`子代理 >= 1` 与 `sessions >= 2`（无子代理）均返回 `music`。前者对应「分身」，后者对应「同时跑两个及以上工具」。需读取 `channel.subagents` 明细加以区分。

### 3. 宿主不读取 `activeToolCount`

`channel.activeToolCount` 表示当前并发工具数（`channel/projection.js` 中 +1/-1），但 `deriveCompanionContext` 只读取 working / subagents / backgroundJobs / compaction。「同一回合并发调用 2 个以上工具」在宿主侧等同于 `typing`。

**注意**：只有**只读工具**（grep/read/glob）会并发执行；会改变状态的工具（pwsh 等）一律串行，因此不会产生 `activeToolCount >= 2`。编写测试时不要用 pwsh 模拟并发工具。

### 4. `conducting` 是状态，而素材是动作

宿主的 `countRunningSubagents` 统计 starting/running，子代理运行期间 `conducting` 持续成立。但素材「派出任意数量子代理」表达的是**一次性动作**。因此使用 `ONE_SHOT_ROUNDS` 在播放 N 轮后切换至 fallback。

对照：内置鲸娘的 conducting 素材名为「小鲸鱼分身」，本身就是状态图，持续播放是正确的。

### 5. 动作切换存在闸门

`stepCompanionDisplay`：仅 `notification`/`error`/`happy` 为即时抢占，其余切换需同时满足 `MIN_MOOD_DWELL_MS`（1000ms）与 `LEAVE_WORKING_SETTLE_MS`（1500ms）。**并发工具的窗口通常只有 1–4 秒，可能不足以触发切换** —— 验证时需构造足够长的窗口。

### 6. 睡觉时宿主将重渲染降至 1000ms

`CompanionPanel` 在 `display.semantic === 'sleeping'` 且无覆盖、无悬停时使用 `TICK_MS_SLEEPING`（1000ms）而非 `TICK_MS`（160ms）。`render` 收到的 `now` 来自 `useAnimationFrame(1000)`，该 hook 自行节流至 1000ms。因此睡觉期间皮肤每秒仅被调用一次，**1 fps 是上限**。

故睡觉动画改为按 tick 数选帧（`tick % frames.length`），保证每次渲染都有变化。若沿用 `frameAt` 原速选帧，每 tick 会跨越 12.5 帧（整整一轮），表现为跳帧。

### 7. 皮肤 id 的白名单时序

`companionSkinStore` 的 `apply` 会过 `normalizeCompanionSkin`：不在 `COMPANION_SKIN_IDS` 里就静默回落 `deepy`。本插件的 id 由 `appendSkinId` 在 `apply()` 里追加，所以**插件必须在 `@deepseek-harness-tui/dsh-tui` 之前加载**，否则宿主先应用 `companion.skin` 时白名单尚未包含本 id，会先画出内置宠物再切过来（可见闪烁）。

实测确认两边解析到的是**同一个 ESM 模块实例**（路径完全相同），所以先加载的修改对后加载者立即可见。

`activateOnLoad` 默认 `true` 是为了在错误顺序下也能自愈，但设计上仍应把插件排在前面。

### 8. 测试必须使用宿主实际发出的值

以 `__pickForTest(..., 'conducting')` 测试「1 个子代理」场景是**错误**的 —— 宿主在该场景发出的是 `music`。一次性动作规则最初正是因此未被测试覆盖（检查逻辑位于消歧之前，查询 `music` 无结果后静默跳过）。

回归中已锁定该前提：`ok('（前置）1 子代理时宿主发的是 music 而非 conducting', ...)`。

## 依赖的内部路径（技术债）

`registerCompanionSkin` 位于 `lib/types/components/sidePanel/companion/skins.js`，而 dsh-tui 的 `package.json exports` **未暴露该子路径**。本插件通过「定位宿主包根 → 拼接内部路径 → 动态 import」访问。宿主调整目录结构会导致失效（已实现软失败）。

此外，开屏吉祥物（`SplashMascot.js`）的白名单硬编码为 `'deepy' || 'whaleGirl'`，插件皮肤无法进入，需要通过 `patch-splash-mascot.ps1` 打补丁。

## 素材与版权

**源 GIF 不入库，`assets/img/` 与 `docs/*.png` 同样不入库**（`.gitignore` 已覆盖）。

`assets/letters.json` 是唯一入库的素材，为**纯数据**（调色板色值 + 字符索引网格），不含图片，运行期必需。

重建素材：`node scripts/build-frames.mjs <你的GIF目录>`，映射表见 `FILE_KEY_MAP`（按文件名匹配）。

## 验证

```sh
node test/run.mjs                         # 224 项断言
node scripts/build-frames.mjs <源目录>     # 重建素材
```

修改后须执行一次真实 boot，确认无 warn：

```powershell
& 'E:\dsh-profiles\_core\node_modules\.bin\dsh.cmd' --profile dsh-tui --dump-config
# 启动 TUI 后检查 stderr 中是否有 dsh-tui-elysia-pet 的 warn
```

**注意**：真实启动的 TUI 进程会与用户正在使用的实例相互影响，测试应使用一次性进程（`Start-Process node.exe` + 定时 Kill），不要复用用户的 TUI。

## dsh-tui 升级后检查清单

升级会覆盖 `node_modules`，以下都要复查一遍：

1. **开屏补丁失效** —— 运行 `pwsh -File patch-splash-mascot.ps1 -Check`，未打则重打。
2. **补丁脚本自身可能过期** —— 它按字符串匹配宿主代码。0.16.1 就给 `import` 加了 `loadWhaleGirlImageKit`，导致旧脚本的精确匹配静默失效（只剩分发处引用该符号却没导入 → ReferenceError）。所以脚本已改为「定位 import 行 + 判断 + 插入」，不再依赖精确字符串。若宿主改动更大，仍需人工检查。
3. **备份世代** —— 脚本会检测备份是否对应旧版（按文件长度粗判），是则自动更新，防止 `-Restore` 把新版覆盖成旧版。
4. **关键 API 仍在** —— `registerCompanionSkin` / `resolveCompanionSkin` / `renderSpriteRows` / `DEEPY_SEMANTIC_ANIMATION` / `deriveCompanionContext` / `notificationReactionKind` / `channel.activeToolCount` / `subagents`。跑 `node test/run.mjs` 能覆盖大部分。
5. **跑真实启动**，确认无 warn。

```powershell
pwsh -File patch-splash-mascot.ps1 -Check
node test/run.mjs
& 'E:\dsh-profiles\_core\node_modules\.bin\dsh.cmd' --profile dsh-tui --dump-config
```

## 禁止事项

- 未经明确要求，不要提交、打 tag 或发布。
- 不要将源 GIF 或任何图片文件提交进仓库。
- 不要在测试中硬编码宿主语义值 —— 应从 `mood.js` / `deepy.js` 推导（见「已知问题」第 7 条）。
