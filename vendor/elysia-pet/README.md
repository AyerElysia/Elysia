# dsh-tui-elysia-pet

**爱莉（Elysia）像素桌宠** —— 常驻 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 侧栏的动画宠物，跟着 Agent 的工作状态换表情，也会对鼠标有反应。

简体中文 · MIT · 零运行期依赖

> ⚠️ **素材未随仓库分发。** 本插件的像素动画来自第三方作者的 GIF，作者正在联系中。仓库只包含代码与调色板索引数据，不含任何图片文件。想在本机重建请见「换素材」一节。

## 这是什么

dsh-TUI 侧栏有一只常驻的 companion 宠物（默认 deepy 小鲸鱼），皮肤可选 `deepy` / `whaleGirl` / `whale`，在 **`/settings → 外观与布局 → 宠物皮肤`** 里切换。

本插件通过宿主的 `registerCompanionSkin` 接缝**注册一个名为「爱莉」的新皮肤**，与内置宠物并列，不覆盖任何一个。

选中后：

- 侧栏画的是爱莉，跟着 Agent 状态换动作
- 鼠标悬停、点击、连点、拖动都有对应反应
- 切回内置皮肤随时可对比，互不影响
- 升级 dsh-TUI 不会丢（不改宿主任何文件）

## 安装

```sh
dsh plugin --profile dsh-tui add -w dsh-tui-elysia-pet
```

本地开发安装（junction，改代码即时生效）：

```powershell
cmd /c mklink /J "$env:DSH_HOME\profiles\dsh-tui\node_modules\dsh-tui-elysia-pet" "E:\dsh-dev\dsh-tui-elysia-pet"
```

然后在 profile 的 `cordis.patch.yml` 里挂上行：

```yaml
- id: dsh-tui-elysia-pet
  config:
    splashAnimation: drag   # 开屏稳态播哪个动作，留空 = 跟侧栏一致
```

**重启 dsh-TUI 生效**（`/reload` 不重载插件代码）。

## 加载顺序（重要）

**把本插件排在 `@deepseek-harness-tui/dsh-tui` 之前**，否则启动瞬间会先画出内置宠物再切过来。

在 profile 的 `package.json` 里：

```json
"dsh": {
  "profile": {
    "bundles": [
      "@deepseek-ai/dsh-base",
      "dsh-tui-elysia-pet",              // ← 在 dsh-tui 之前
      "@deepseek-harness-tui/dsh-tui",
      "..."
    ]
  }
}
```

### 为什么

宿主的 skin 存储在 `settings.json` 没有该键时回落 `DEFAULT_COMPANION_SKIN = 'deepy'`，而 `applyCompanionSkin` 会过一层白名单 `normalizeCompanionSkin`：

```js
if (COMPANION_SKIN_IDS.includes(value)) return value;
return DEFAULT_COMPANION_SKIN;          // 白名单外 → 静默回落 deepy
```

\`elysia\` 只有在**本插件的 `apply()` 跑过之后**才进白名单（由 `appendSkinId` 追加）。所以：

| 顺序 | 启动画面 |
|---|---|
| 插件在前 | 白名单已就绪 → `applyCompanionSkin('elysia')` 直接生效 → **首帧即爱莉** |
| 插件在后 | `applyCompanionSkin('elysia')` 时白名单还没有该 id → 回落 deepy → 画内置宠物 → 插件再激活 → **能看到一次闪烁** |

两种顺序最终都能正确显示（`activateOnLoad` 默认 `true` 会自愈），但**只有前者没有闪烁**。

### 同时配置 profile 的 companion.skin

在 profile 的 `cordis.patch.yml` 里给 `dsh-tui` 行加：

```yaml
- id: dsh-tui
  config:
    companion:
      skin: elysia
```

这样即使 `settings.json` 被清空（新机器、重置设置），启动也会落到爱莉而不是内置宠物。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `skinId` | `elysia` | 皮肤 id，出现在设置白名单里 |
| `title` | `Elysia` | 非中文界面显示的英文名 |
| `description` | `爱莉` | 中文界面显示的短名 |
| `activateOnLoad` | `true` | 启动时自动切到本皮肤（见「加载顺序」）|
| `splashAnimation` | 空 | 开屏吉祥物稳态播哪个动画键，空 = 跟侧栏一致 |
| `idleRotation` | `false` | 待机时是否轮换动画（见下）|
| `idleSpeed` | `1` | 待机族播放倍率，**大于 1 会变慢** |
| `celebrationVariants` | `true` | 庆祝动画是否在两个变体间随机 |
| `imageScale` | `3` | 图像协议轨的放大倍率上限 |

### 关于 idleRotation

宿主的待机轮换是**坏的**。它自己维护了一个池子：

```js
DEEPY_IDLE_ROTATION = ['idle', 'idle-look', 'idle-spout', 'swim']
```

注释写着「成员本身就是 kit 键，不需要映射」，但代码还是过了一遍 `deepyAnimationFor`（查的是**语义表**，那三个键不在表里）→ 全部回落成 `idle` → 四个槽位画同一个动画，**待机永远一个样**。

皮肤可以自己补这个轮换（读 `channel` 与 `now` 分槽），但**默认关**：本素材里 `idle-look` 和 `idle-spout` 是同一个文件，开轮换等于 3 个槽里 2 个放同一张图，反而把「常态 = 东张西望」稀释了。

## 状态对应动画

宿主 companion 面板自己维护状态机，皮肤只管画。宿主发出的语义经过一层 `deepyAnimationFor` 才到皮肤，中间会**丢掉三个键**（`idle-look` / `idle-spout` / `swim` 不在语义表里，全被压成 `idle`）。本插件在皮肤层做了补偿。

| 宿主语义 | 皮肤收到 | 落到动画 | 触发条件 |
|---|---|---|---|
| `thinking` | `thinking` | 思考中 | 模型推理中；上下文压缩也落这里 |
| `typing` | `typing` | 敲代码 | 模型输出正文中 |
| `building` | `building` | 同时跑两个及以上工具 | 3+ 会话；**或**并发工具 ≥ 2 |
| `conducting` | `conducting` | 分身 | ≥2 子代理；**或** 1 子代理（皮肤消歧）|
| `music` | `music` | 同时跑两个及以上工具 | 见下「music 歧义」|
| `error` | `error` | 出错啦 | 回合失败 / 有失败的后台任务 |
| `happy` / `success` | `happy` | 任务完成（随机二选一）| 回合完成庆祝 |
| `notification` / `warning` | `notification` | 需要你确认 | 等待批准 / 提问 |
| `sleeping` | `sleeping` | 呼呼大睡 | 60 秒无输入 |
| `waking` | `waking` | 被吵醒 | 睡眠中来信号 |
| `drag` | `drag` | 被拎起来 | 拖动宠物 |
| `tickle` | `tickle` | 被挠痒痒 | 900ms 内连点 ≥3 次 |
| `poke-left/right` | `poke-left/right` | 戳 | 点击宠物左/右半 |
| `carrying` | `carrying` | 游来游去 | git 分支变更闪现 |
| `compacting` | `compacting` | 思考中 | 上下文压缩中 |
| `look` | `idle-look` | 待机眨眼 | 指针在面板内移动 |
| `notice` | `idle-spout` | 待机眨眼 | 指针碰到宠物本体 |
| 无颜色通知 | `idle` → 补回 | 待机眨眼 | 含「复制」在内的 44 个文案 |

素材缺某个键时会**逐级回退**（别名表 → 内置表 → 回退序 → 第一个可用动画），永不抛错。只提供几个 GIF 也能用。

### music 歧义

宿主的 `deriveCompanionContext` 把**两类不同场景**都叫 `music`：

```js
sessions = (working ? 1 : 0) + 子代理数 + 后台任务数
if (子代理 >= 2)                   return 'conducting';
if (sessions >= 3)                 return 'building';
if (子代理 >= 1 || sessions >= 2)  return 'music';   // ← 两类都落这
```

皮肤读 `channel.subagents` 的明细来分：有子代理 → 分身，没有 → 同时跑工具。

### 并发工具

宿主**从不读** `channel.activeToolCount`（它只数会话，不数工具），所以「同一回合并发调 2 个以上工具」在宿主眼里就是普通的 `typing`。皮肤补了这条：`typing` + `activeToolCount >= 2` → 同时跑工具。

注意区分两条路：**前台工具**走 `activeToolCount`；**后台任务**走 `backgroundJobs`（宿主的 `channel/activity.js`：`if (!event.background) return`）。

### 一次性动作

宿主的 `conducting` 是**状态**（子代理在跑就一直是它），但素材「派出任意数量子代理」是**动作**（派出去那一下）—— 一直播会看着像卡住。皮肤在进入后只播 2 轮（约 1.9 秒），然后让位给「敲代码」。

对照内置鲸娘：它的 conducting 素材叫「小鲸鱼分身」，本身就是状态图，所以一直播没问题。

## 换素材

源 GIF 按**文件名**映射到动画键，映射表在 `scripts/build-frames.mjs` 的 `FILE_KEY_MAP`。

```sh
node scripts/build-frames.mjs <你的GIF目录>
```

产出：

| 路径 | 内容 | 是否入库 |
|---|---|---|
| `assets/letters.json` | 调色板 + 逐帧字符网格（**纯数据**）| 是 |
| `assets/img/` | 图像协议轨用的逐帧 PNG | 否（.gitignore）|
| `docs/*.png` | 动作对应表渲染图 | 否 |
| `docs/动作对应表.md` | 文字版对应表 | 是 |

**注意**：`letters.json` 是运行期唯一必需素材，它不含图片（只有调色板色值和字符索引）。仓库能正常分发与安装，只是没有 PNG 预览。

其他脚本：

```sh
node scripts/render-action-table.mjs          # 重画动作对应表（需要 letters.json）
node scripts/render-notification-table.mjs    # 重画通知绑定表（需要宿主源码）
```

## 开发

```sh
node test/run.mjs     # 217 项断言
```

## 技术债

- **依靠宿主内部路径**：`registerCompanionSkin` 住在 `lib/types/components/sidePanel/companion/skins.js`，而 dsh-tui 的 `package.json exports` **没有暴露这个子路径**。本插件靠「找宿主包根 → 拼内部路径 → 动态 import」访问。宿主改目录结构会失效（已做软失败：只 warn，不影响 boot）。
- **开屏吉祥物需要打补丁**：宿主的 `SplashMascot.js` 里白名单写死 `'deepy' || 'whaleGirl'`，插件皮肤进不去。见下方「开屏支持」。

### 开屏支持

宿主的启动页把吉祥物皮肤写死在 `SplashMascot.js` 里（白名单只有 `deepy`/`whaleGirl`，分发改成三元表达式），插件皮肤进不去。让启动页也显示爱莉需要给宿主打补丁：

| 补丁 | 文件 | 作用 |
|---|---|---|
| A | `lib/types/components/sidePanel/companion/SplashMascot.js` | 白名单与分发改查 `resolveCompanionSkin` 注册表 |
| B | `lib/types/dsh-adapter/plugin.js` | 在 `buildTree()` 之前预注册皮肤，让首帧就画对 |

补丁 B 是必要的：`dst` 的启动链是 `bin/dsh-tui.js → startEntrySession → apply() 内部 render() 画首帧 → root.compose() 才加载插件行`。首帧读到的 `companionSkinStore` 还是默认值，所以不打补丁会先画约一秒的鲸鱼，等插件补齐后才切过去。

**Windows**：

```powershell
pwsh -File patch-dsh-tui-host.ps1 -Check     # 看状态
pwsh -File patch-dsh-tui-host.ps1            # 打补丁（幂等）
pwsh -File patch-dsh-tui-host.ps1 -Restore   # 还原
```

**Linux / macOS**：

```sh
bash patch-dsh-tui-host.sh                                            # 自动探测包根
bash patch-dsh-tui-host.sh /path/to/@deepseek-harness-tui/dsh-tui    # 显式指定
```

补丁块放在 `plugin-patch-block.js`，由脚本插进宿主。`host-entry-patch.js` 是早期版本（插在 `host-entry.js` 的 `apply()` 之前），首帧仍会闪一下，保留仅作参考。

**不打也能用** —— 侧栏宠物正常显示，只是启动页画原来的鲸鱼。

**dsh-tui 升级后必须重打。** 升级会覆盖 `node_modules`，两个补丁都会失效。脚本按字符串锚点定位，宿主改了实现会明确报「找不到锚点」而不是写坏文件。

已验证的宿主版本：0.15.x（仅补丁 A 生效）、**0.16.1**（A + B）。

## 许可

MIT（代码部分）。**像素素材版权归原作者，未随本仓库分发。**

## 致谢

- [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) —— 宿主，提供了 companion 皮肤接缝
- 像素爱莉素材作者 —— 请联系仓库所有者确认授权
