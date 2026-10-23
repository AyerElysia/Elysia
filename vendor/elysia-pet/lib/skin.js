/**
 * 皮肤实现：把帧包接到宿主的 companion 皮肤接口。
 *
 * ## 皮肤契约（宿主 skins.js）
 *
 *   { id, title, cells, graphics, semanticMap?, render(input) }
 *
 * 关键约束：**render() 必须是普通同步函数，不能调用 hooks**。宿主的做法是
 * render() 返回一个组件元素（`_jsx(WhaleGirlImageSkin, input)`），让 React 去
 * 执行组件内的 hooks。直接在 render() 里调 useState/useContext 会抛异常，而
 * 宿主把它当渲染失败静默吞掉 —— 表现为「改了代码但画面完全没变」。
 *
 * ## 双轨渲染
 *
 * **图像协议轨（优先）**：kitty / sixel 终端下把帧当原生 RGBA 位图贴上去。
 * 完全不碰字符与背景色，像素画的正确画法。
 *
 * **字母格轨（回退）**：无协议终端用半块字符，数据与内置 Deepy / 鲸娘同格式，
 * 走同一条宿主 renderSpriteRows 路径。透明区交给终端自己的默认背景 ——
 * 与内置宠物表现完全一致。
 *
 * ## 已知陷阱
 *
 * 现象：Windows Terminal 下每个半格露出黑条。
 *
 * 曾误判为宿主渲染或 BG_DEFAULT 的问题，并尝试在插件里把透明区填充为面板
 * 色。该方案无效：宠物周围会出现一块明显的纯色矩形，且黑条数量并未减少，
 * 因为根因不在此处。
 *
 * 实际根因是终端侧的一个显示开关：Windows Terminal 的
 * `adjustIndistinguishableColors`（设置项名称为"始终自动调整无法区分的
 * 文本的亮度"）。该开关会逐格改写前景色到它认为可读的亮度，像素画的每一格
 * 颜色因此都被修改，表现为黑块、黑杠、颜色错乱。VS Code 终端没有此行为，
 * 同一份数据在其下显示正常。
 *
 * 关闭该开关（或为其单独建立一个不做亮度调整的 profile）即可解决。与插件的
 * 数据处理和渲染无关 —— 内置宠物在同一终端下受同样影响。
 *
 * **结论：遇到显示异常时，先确认终端侧的显示开关，再排查插件。**
 *
 * @module dsh-tui-elysia-pet/skin
 */
import { frameAt } from './frames.js'

/** 宿主注入的依赖，apply() 时填好。 */
let host = {
  Box: undefined,
  Text: undefined,
  Image: undefined,
  renderSpriteRows: undefined,
  useTerminalImages: undefined,
  useTerminalImageProtocol: undefined,
  /**
   * 宿主侧栏运行时上下文 hook（SidePanelRuntimeContext.js）。
   *
   * 用来消解宿主的 music 歧义：那个语义同时代表「1 个子代理」和
   * 「2 个会话（主回合 + 1 个后台任务）」，宿主只发一个名字，皮肤无法从
   * animationSemantic 分辨。但 channel 上有 subagents / backgroundJobs 明细。
   * 拿不到时（开屏路径、测试环境）返回 undefined，退化为不消歧。
   */
  useSidePanelChannel: undefined,
}

/** apply() 注入宿主 UI 与渲染函数。全部必须来自宿主包本体。 */

export function setHostDeps(deps) {
  host = { ...host, ...deps }
}

/** 图像轨缓存："键@倍率" → RGBA 源数组（undefined = 不可用）。 */
const imageCache = new Map()

/** apply() 注入：动画键 → 每帧 PNG 路径。 */
let animationResolver = () => undefined
export function setAnimationResolver(fn) { animationResolver = fn }
const animationOf = (key) => animationResolver(key)

/** apply() 注入：用宿主的 sharp 解码 PNG。 */
let decodePng = undefined
export function setPngDecoder(fn) { decodePng = fn }

/**
 * 把一个动画的全部帧解成 Image 能吃的 RGBA 源。
 * @param {string} key 动画键
 * @param {number} scale 放大倍率（像素画必须最近邻）
 */
export async function decodeAnimation(key, scale) {
  const cacheKey = key + '@' + scale
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey)
  const anim = animationOf(key)
  if (anim === undefined || decodePng === undefined) { imageCache.set(cacheKey, undefined); return undefined }
  const out = []
  for (const frame of anim.frames) {
    try {
      const src = await decodePng(frame.file, scale)
      // 宿主 isTerminalImageSource 的校验：Uint8Array、长度严格 w*h*4、
      // 边长 <= 1024。任一不满足 Image 整帧拒绝，桌宠直接不显示。
      if (!(src?.data instanceof Uint8Array)) { imageCache.set(cacheKey, undefined); return undefined }
      if (src.data.byteLength !== src.width * src.height * 4) { imageCache.set(cacheKey, undefined); return undefined }
      if (src.width > 1024 || src.height > 1024) { imageCache.set(cacheKey, undefined); return undefined }
      out.push({ data: src.data, width: src.width, height: src.height })
    } catch {
      imageCache.set(cacheKey, undefined)
      return undefined
    }
  }
  imageCache.set(cacheKey, out)
  return out
}

/** 最近一次渲染异常，供诊断。 */
let lastError = undefined

/**
 * 兜底皮肤：渲染失败时画一个最小的文字提示，绝不抛异常。
 * 它只依赖 React 与 Text，不碰调色板/主题/图像协议。
 */
function FallbackSkin() {
  return React.createElement(
    host.Box !== undefined ? host.Box : 'Box',
    { flexDirection: 'column', alignItems: 'center' },
    React.createElement(host.Text !== undefined ? host.Text : 'Text', null, '爱莉'),
  )
}

/**
 * 造一个 companion 皮肤对象。
 * @param {object} deps
 * @param {any} deps.React
 * @param {ReturnType<import('./frames.js').loadKit>} deps.kit
 * @param {{forMood: Function, has: Function}} deps.resolver
 * @param {{skinId: string, title: string, imageScale: number, idleSpeed?: number}} deps.config
 */
/** 待机族动画键：只有这些受 idleSpeed 影响（见 config.js 的说明）。 */
const IDLE_KEYS = new Set(['idle', 'idle-look', 'idle-spout', 'swim', 'sleeping'])

export function createSkin({ React, kit, resolver, config }) {
  const idleSpeed = typeof config.idleSpeed === 'number' && config.idleSpeed > 0 ? config.idleSpeed : 1
  /**
   * 互动动作要**原速播几轮**（不是"塞进固定窗口"）。
   *
   * 语义是"多播一轮"：每帧仍停 80ms，整体播两遍 —— 停留时长因此变为
   * 2 × 960 = 1920ms。而宿主的窗口（TICKLE_WINDOW_MS = 900ms）短于此，
   * 所以皮肤需要**主动延长这次互动**，否则会在播完前被切走。
   *
   * 两种做法的区别：
   *   错误：把动画压缩到 432ms/轮，在 900ms 窗口里塞两轮 —— 动作明显加快
   *   正确：保持 960ms/轮，把停留延长到 1920ms —— 原速播放两遍
   *
   * 延长手段是 hook：render 里不能调用 hook，所以由 RepeatSkin 组件在渲染期
   * 用一个 tick 自己续命（见下）。这里只声明"这个键要播几轮"。
   */
  const REPEAT_ROUNDS = {
    // 被挠痒痒：原窗口 900ms 连一轮 960ms 都装不下，播两轮 → 1920ms
    tickle: 2,
    // 任务完成（庆祝）：窗口 2500ms 本来够 2.6 轮，明确播满两轮
    happy: 2,
    'happy-2': 2,
  }

  /** 待机轮换池（resolver 按素材实际存在的键过滤后的）。 */
  const idlePool = Array.isArray(resolver?.idlePool) ? resolver.idlePool : []
  /** 待机轮换节奏。与宿主的 IDLE_ROTATE_MS 一致（8 秒）。 */
  const IDLE_ROTATE_MS = 8000
  /**
   * 宿主在睡觉时的重渲染节拍（CompanionPanel 的 TICK_MS_SLEEPING）。
   *
   * **这是"睡觉帧数低"的真正原因，不在帧数据里。**
   *
   * 宿主为省电在睡觉时把面板的重渲染压到 1000ms 一次：
   *
   *   const tickMs = display.semantic === 'sleeping' && 无覆盖 && 无悬停
   *     ? TICK_MS_SLEEPING   // 1000ms
   *     : TICK_MS;           // 160ms
   *
   * 而 render 收到的 now 就来自那个每 1000ms 推进一次的共享时钟。于是皮肤
   * 每秒只被调用一次 —— 我们那 12 帧 × 80ms（12.5 fps）的素材，在 1 fps 的
   * 通道里每 tick 会跨过整整一轮（1000 / 80 = 12.5 帧），看起来就是"一格
   * 一格地跳"。
   *
   * 对照内置鲸娘：它的 sleeping 是 6 帧 × 330ms = 1980ms，每 tick 跨 3 帧，
   * 观感是"慢动作"而不是"跳帧"。它的素材本来就是按慢节奏设计的。
   *
   * 修法：把睡觉的**选帧速度**放慢到与该节拍匹配 —— 让每个 tick 刚好前进
   * 一帧。这样 12 帧会在 12 秒内依次画完，动作连贯且每帧都看得见。
   */
  const SLEEP_TICK_MS = 1000

  /** 是否真的轮换（默认关，见 config.idleRotation 的说明）。 */
  const idleRotationOn = config.idleRotation === true

  /**
   * **一次性动作**：只在进入该语义时播 N 轮，播完让位给 fallback。
   *
   * 为什么需要它：宿主的动作分两类
   *
   *   状态类（持续，语义不变就一直成立）：thinking / typing / music /
   *     conducting / building / compacting
   *   一次性（宿主自带 until 窗口）：waking / carrying / poke / tickle /
   *     drag / happy / notification
   *
   * 但**素材的语义不一定和宿主对齐**。最典型的是 conducting：
   * 素材叫「派出任意数量子代理」——那是"派出去那一下"的动作；而宿主的
   * conducting 是"子代理在跑"的状态（countRunningSubagents 数
   * starting/running，只要还在跑就一直是 conducting）。子代理跑两分钟，
   * 该动作就会循环两分钟，表现为画面停滞、对交互无响应。
   *
   * 所以在这里把这种"素材是一次性、宿主当状态用"的键标出来：
   * 进入时播 N 轮，之后交给 fallback。
   *
   * 进入时刻用 input.moodSince —— 宿主切换语义时会把它重置成 now，语义
   * 不变则保持原值，所以它正好等于"这一段 conducting 的开始时刻"。
   */
  /** 离开一次性语义后，多久内回来算同一次（不重新计时）。 */
  const ONE_SHOT_REGRACE_MS = 8000

  /** 一次性动作的进行状态：{ key, scope, startedAt, leftAt }。 */
  let oneShotState

  const ONE_SHOT_ROUNDS = {
    // 派出子代理：播 2 轮（2 × 960ms ≈ 1.9 秒），之后回到"干活"动画。
    // 子代理还在跑，主回合通常也在干活，所以 fallback 用 typing。
    conducting: { rounds: 2, fallback: 'typing' },
  }

  /** 开屏专用动画键（空串 = 与侧栏一致）。 */
  const splashKey = typeof config.splashAnimation === 'string' ? config.splashAnimation.trim() : ''
  /** 图像轨解码结果：动画键 → (RGBA 源数组 | undefined)。 */
  const raster = new Map()
  /** 字母格轨缓存：动画键 → 每帧的 ANSI 行数组。 */
  const letters = new Map()

  /**
   * 这次调用是不是**开屏**（而不是侧栏宠物）？
   *
   * 宿主两条路径用同一个皮肤对象，唯一可区分的输入是 width：
   *   · CompanionPanel 传 width = skin.cells.columns（= 32，正好等于我们的列数）
   *   · SplashMascot   传 width = SPLASH_MASCOT_COLUMNS（= 42）
   * 所以"宽度不等于自身列数"就是开屏。cells 是固定常量，这个判据不会漂。
   */
  function isSplash(input) {
    const w = input?.width
    return typeof w === 'number' && w !== columns
  }

  /**
   * 调宿主的 channel hook，失败时返回 undefined。
   *
   * 这个 hook 依赖 SidePanelRuntimeContext（PanelHost 才提供）。开屏路径不在
   * PanelHost 下，直接调会抛错 —— 那时本来就无需消歧（开屏稳态固定播
   * splashAnimation），静默返回 undefined 即可。
   */
  function safeChannel() {
    try {
      return host.useSidePanelChannel()
    } catch {
      return undefined
    }
  }

  /**
   * 宿主的待机轮换被它自己吃掉了（见 withDisambiguation 注释 a），这里自己轮。
   *
   * 池子用 resolver 的 idlePool（会按素材实际存在的键过滤），节奏用宿主的
   * IDLE_ROTATE_MS —— 和宿主**本意**一致，只是绕开那层失效的映射。
   *
   * elapsed 取 now - moodSince：宿主在 idle 期间 moodSince 保持不动，所以
   * elapsed 会稳定增长，轮换点可预测（不会因重渲染抖动）。
   */
  function idleRotate(input) {
    // 用**绝对时钟** now 分槽，不能用 elapsed(now - moodSince)。
    //
    // 宿主在 idle 期间每个轮换点都会把 animSince 向前推：
    //   animSince = display.since + floor((now - display.since) / 8000) * 8000
    // 所以 elapsed 会在每个 8 秒边界归零，floor(elapsed / 8000) 恒为 0 ——
    // 用它分槽等于永远停在第一槽（这正是宿主自己的轮换失效之外，我第一版
    // 补偿代码也失效的原因；当时的手工测试传了假的 moodSince 才没暴露）。
    //
    // now 是墙钟，单调递增，不受宿主改写 since 的影响，分槽稳定。
    const now = Math.max(0, input?.now ?? 0)
    const step = Math.floor(now / IDLE_ROTATE_MS)
    return idlePool[step % idlePool.length] ?? idlePool[0]
  }

  /**
   * 通知 default 档的持续期。
   *
   * 和宿主的 NOTIFICATION_BUBBLE_MS（5000ms）对齐 —— 宿主给 default 档设的
   * override 就是这个长度，我们的补丁要覆盖同样的时间窗，否则通知刚弹出就
   * 闪回待机。
   */
  const NOTIFICATION_HOLD_MS = 5000

  /** 最近一次"新通知"到达的时刻（0 = 没有正在展示的通知）。 */
  let noticeShownAt = 0
  /** 上一次见过的最大通知 id —— 用来判断"来了新的"。 */
  let lastNoticeId = -1

  /**
   * 这次收到的 idle 是不是"通知 default 档"造成的？
   *
   * 宿主把 default 档压成了 idle（见 withDisambiguation 注释 b），语义上无从
   * 分辨。旁证只有 channel.notifications：
   *
   *  · 条目结构是 { id, text, color, timeoutMs }（dsh-adapter/channel/
   *    notifications.js），**没有时间戳**，所以"多新"只能靠 id 是否递增。
   *  · id 是模块内自增的 sequence，单调递增，用它判"来了新通知"是可靠的。
   *  · 判定为"新"之后要保持 NOTIFICATION_HOLD_MS，不能只返回一帧 ——
   *    否则 5 秒的通知展示期里只有第一帧是待机眨眼。
   *
   * 宁可漏判（显示成普通待机）也不要误判（空闲时莫名眨眼）。
   */
  function isNotificationContext(channel, nowRaw) {
    const now = Math.max(0, nowRaw ?? 0)
    const list = Array.isArray(channel.notifications) ? channel.notifications : undefined
    if (list !== undefined && list.length > 0) {
      const newest = list[list.length - 1]
      const id = typeof newest?.id === 'number' ? newest.id : -1
      if (id >= 0 && id > lastNoticeId) {
        lastNoticeId = id
        noticeShownAt = now
      }
    }
    return noticeShownAt > 0 && now - noticeShownAt < NOTIFICATION_HOLD_MS
  }

  /**
   * 消解宿主 music 语义的歧义，返回给 pick 用的输入副本。
   *
   * 宿主的上下文判定（mood.js 的 deriveCompanionContext）把两类不同场景都
   * 映射成 music：
   *   a) runningSubagents >= 1        —— 有子代理在跑
   *   b) sessions >= 2（子代理为 0）   —— 例如主回合 + 1 个后台任务
   * 用户对 (a) 的期望是「分身」，对 (b) 的期望是「同时跑两个及以上工具」。
   * 宿主只发语义名，所以只能自己看 channel 上的明细来分。
   *
   * 注意 backgroundJobs 只装后台任务（channel/activity.js：前台工具走自己的
   * tool card，不进 jobs），所以「同一回合并发调 2 个前台工具」宿主不计数
   * —— 那种情况给的是无 context 的 typing，不在本函数处理范围。
   */
  function withDisambiguation(input, channel) {
    // 两步走：先把宿主语义改写成本地键，再统一处理"一次性动作"。
    //
    // 顺序很关键 —— 曾经把一次性检查放在第一步**中间**，而那时 semantics
    // 还是宿主的 'music'（不是消歧后的 'conducting'），查表查不到就跳过了，
    // 规则从来没生效过（用户重启后仍然"分身动作一直播"就是这个原因）。
    const base = resolveBase(input, channel)
    const final = applyOneShot(base, input)
    return final === input?.animationSemantic ? input : { ...input, animationSemantic: final }
  }

  /**
   * 宿主语义 → 本地键。把所有改写集中在这里，最终只吐一个字符串。
   *
   * 改写分四类（详见各段注释）：
   *   a) 宿主把 idle-look / idle-spout / swim 三个键吃掉了，收到 idle 时按
   *      上下文还原（通知 default 档 / 待机轮换）
   *   b) 宿主从不读 channel.activeToolCount，并发工具 >= 2 时补成 building
   *   c) 宿主的 music 混了两类场景（1 子代理 / 2 会话），按 subagents 明细分
   */
  function resolveBase(input, channel) {
    const semantic = input?.animationSemantic

    // ── a) 宿主把 idle-look / idle-spout / swim 三个键"吃掉"了 ────────
    //
    // 宿主 CompanionPanel 对所有皮肤都这么做：
    //
    //   animationKey = deepyAnimationFor(animationSemantic)
    //   deepyAnimationFor = DEEPY_SEMANTIC_ANIMATION[s] ?? 'idle'
    //
    // 而 DEEPY_SEMANTIC_ANIMATION 的**键**里没有 idle-look / idle-spout /
    // swim（它们只作为**值**出现在 DEEPY_IDLE_ROTATION 里）。于是这三个语义
    // 一进来就回落成 'idle'，皮肤永远收不到。
    //
    // 影响面：
    //   1) 待机轮换彻底失效 —— 宿主池子的 4 个槽位全画 idle
    //   2) 通知 default 档丢失 —— 「复制」等 44 个无色文案 = 普通待机
    //   3) 指针悬停追踪（look）/ 碰到本体（notice）全变 idle
    if (semantic === 'idle') {
      // 通知：有**新**通知到达 → 按 default 档走 idle-look
      if (channel !== undefined && channel !== null && isNotificationContext(channel, input?.now)) {
        return 'idle-look'
      }
      // 待机轮换（默认关，见 config.idleRotation）
      if (idleRotationOn && idlePool.length > 1) return idleRotate(input)
      return semantic
    }

    if (channel === undefined || channel === null) return semantic

    // ── b) 并发工具数：宿主**完全没用**这个信号 ──────────────────────
    //
    // channel.activeToolCount 是当前活跃的工具调用数（channel/projection.js
    // 里工具开始 +1、结束 -1），但 CompanionPanel 的 deriveCompanionContext
    // 只看 working / subagents / backgroundJobs / compaction，从没读过它。
    // 所以「同一回合并发调 2 个以上工具」在宿主眼里就是普通的 typing。
    if (semantic === 'typing') {
      const tools = typeof channel.activeToolCount === 'number' ? channel.activeToolCount : 0
      return tools >= 2 ? 'building' : semantic
    }

    // ── c) music 的歧义 ─────────────────────────────────────────────
    //
    // 宿主把两类不同场景都叫 music：
    //   1) runningSubagents >= 1                    有子代理在跑
    //   2) sessions >= 2 且子代理为 0                 例：主回合 + 1 个后台任务
    // 用户对 (1) 要「分身」、对 (2) 要「同时跑两个及以上工具」。
    if (semantic === 'music') {
      const subagents = Array.isArray(channel.subagents) ? channel.subagents : undefined
      if (subagents === undefined) return semantic
      const running = subagents.filter((s) => s?.status === 'starting' || s?.status === 'running').length
      return running >= 1 ? 'conducting' : 'building'
    }

    return semantic
  }

  /**
   * 一次性动作：进入后只播 N 轮，播满让位给 fallback。
   *
   * 为什么需要：宿主的动作分两类
   *
   *   状态类（语义不变就一直成立）：thinking / typing / music / conducting /
   *     building / compacting
   *   一次性（宿主自带 until 窗口）：waking / carrying / poke / tickle /
   *     drag / happy / notification
   *
   * 但**素材的语义不一定和宿主对齐**。最典型的是 conducting：素材叫
   * 「派出任意数量子代理」—— 那是"派出去那一下"的动作；而宿主的 conducting
   * 是"子代理在跑"的状态（countRunningSubagents 数 starting/running，只要
   * 仍在运行就一直是 conducting）。子代理运行两分钟，该动作就会循环两分钟，
   * 表现为画面停滞、对交互无响应。
   *
   * 对照内置鲸娘：它的 conducting 素材叫「小鲸鱼分身」，本身就是状态图，
   * 一直播没问题。我们只有"派出"的动作图，所以在皮肤层补这个边沿语义。
   *
   * ## 为什么用自己的记忆而不是宿主的 moodSince
   *
   * 第一版用 input.moodSince 算 elapsed，理由是"宿主切换语义时会重置它"。
   * 实测不可靠：宿主还有 realign（面板隐藏→显示时把 since 重置成 now）等
   * 路径，而且我无法在真实 TUI 里逐步验证。改成自己记进入时刻，全程只依赖
   * input.now（墙钟）和语义的进出，可完全离线复现。
   */
  function applyOneShot(semantic, input) {
    const now = Math.max(0, input?.now ?? 0)
    // 侧栏和开屏共用同一个皮肤对象，状态按来源隔离
    const scope = isSplash(input) ? 'splash' : 'side'
    const spec = ONE_SHOT_ROUNDS[semantic]

    if (spec === undefined) {
      // 离开该语义：标记离开时刻，宽限期内回来算"同一次"，不重新计时。
      // 宽限是为了让通知/错误这类**抢占式覆盖**不打断计数 —— 它们会短暂
      // 顶掉 conducting，但子代理仍在运行，不应重新计时。
      if (oneShotState !== undefined && oneShotState.scope === scope) {
        if (oneShotState.leftAt === undefined) oneShotState.leftAt = now
        if (now - oneShotState.leftAt >= ONE_SHOT_REGRACE_MS) oneShotState = undefined
      }
      return semantic
    }

    const anim = kit.animations.get(semantic)
    if (anim === undefined || !(anim.totalMs > 0)) return semantic

    // 判定"是不是同一次"：
    //
    //   · 连续停留（leftAt 一直是 undefined）—— **是**同一次，保持 startedAt
    //   · 离开又回来，且在宽限期内 —— 也算同一次（不重新计时）
    //   · 换了语义 / 换了来源 / 超出宽限期 —— 全新一次，重新计时
    //
    // 条件必须涵盖"连续停留"（leftAt 为 undefined）这一常见情形。
    // 若写成要求 leftAt !== undefined，连续停留期间"同一次"永远判不成立，
    // 每次渲染都会重建 startedAt，played 恒为 0，动画永不结束。
    const sameRun = oneShotState !== undefined
      && oneShotState.key === semantic
      && oneShotState.scope === scope
      && (oneShotState.leftAt === undefined || now - oneShotState.leftAt < ONE_SHOT_REGRACE_MS)

    if (!sameRun) {
      // 全新一次进入 → 重新计时
      oneShotState = { key: semantic, scope, startedAt: now, leftAt: undefined }
    } else {
      // 同一次：保持 startedAt，清掉"已离开"标记
      oneShotState.leftAt = undefined
    }

    const played = now - oneShotState.startedAt
    return played >= spec.rounds * anim.totalMs ? spec.fallback : semantic
  }

  /** 正在"续播"的互动：{ key, since, until }；到点或被别的互动打断就清空。 */
  let sticky

  /** 由输入算出本帧要画的动画键与帧号（纯函数，图像轨与字母轨共用）。 */
  function pick(input) {
    const mood = typeof input?.pose?.mood === 'string' ? input.pose.mood : 'idle'
    const semantic = typeof input?.animationSemantic === 'string' && input.animationSemantic !== ''
      ? input.animationSemantic
      : undefined
    const moodSince = input?.moodSince ?? 0
    const elapsed = Math.max(0, (input?.now ?? 0) - moodSince)
    // 第三个参数是 elapsed（待机轮换要它），但**变体选择要的是 moodSince**：
    // elapsed 每次都从 0 开始增长，拿它当种子会导致每次庆祝都选中同一个
    // 变体。moodSince 是"这次语义开始的绝对时刻"，每次进入都不同。
    let key = resolver.forMood(mood, semantic, elapsed, moodSince)
    if (key === undefined) return undefined

    // ── 互动动作"原速多播几轮" ────────────────────────────────────────
    //
    // 宿主给 tickle 的窗口只有 900ms，比一轮 960ms 还短，所以它会在播到一半
    // 时把语义切回 idle。我们**不改动画节奏**（改了就是飞快），而是自己把
    // 这次互动"续"到足够的时长：记住进入时刻，播满 rounds 轮再放手。
    //
    // now 来自宿主，是墙钟；moodSince 是这次语义的起始时刻，用它算截止点，
    // 这样 React 重复渲染/掉帧都不会改变结果。
    const now = input?.now ?? 0
    // 侧栏和开屏**共用同一个皮肤对象**（宿主两条路径都调这个 render），
    // 所以续播状态必须按来源隔离 —— 否则在侧栏挠一下会连带改掉开屏。
    const scope = isSplash(input) ? 'splash' : 'side'
    if (sticky !== undefined && (sticky.scope !== scope || now >= sticky.until)) sticky = undefined

    // 进入一个"要重复"的键时登记一次（同一个 moodSince 只登记一次）
    if (semantic !== undefined && REPEAT_ROUNDS[semantic] !== undefined) {
      const anim = kit.animations.get(semantic)
      if (anim !== undefined && anim.totalMs > 0) {
        if (sticky === undefined || sticky.key !== semantic || sticky.since !== moodSince) {
          sticky = {
            scope,
            key: semantic,
            since: moodSince,
            until: moodSince + REPEAT_ROUNDS[semantic] * anim.totalMs,
          }
        }
      }
    }

    // 续播期间保持该键。但**其他互动要能立刻打断**（戳一下、拖走、来通知
    // 都该马上反应），所以只在宿主已回到待机或仍停在同一个键时才续。
    if (sticky !== undefined && now < sticky.until) {
      if (semantic === undefined || semantic === 'idle' || semantic === sticky.key) {
        key = sticky.key
      } else {
        sticky = undefined
      }
    }
    // 开屏稳态换成配置指定的动画（若配了且素材里存在）
    // 只在**稳态**时换成开屏专用动画。
    //
    // 必须排除互动覆盖（poke / tickle / happy / notification ...）：那些是
    // 用户戳她、挠她时的即时反应，换成待机动画会让开屏变得毫无反应。
    // 宿主给开屏发的稳态语义是 'idle'（见 SplashMascot：override?.semantic ?? 'idle'），
    // undefined 是宿主没传语义时的兜底，同样按稳态处理。
    const steady = semantic === undefined || semantic === 'idle'
    if (steady && splashKey !== '' && isSplash(input) && kit.animations.has(splashKey)) key = splashKey
    const anim = kit.animations.get(key)
    if (anim === undefined) return undefined
    const speed = IDLE_KEYS.has(key) ? idleSpeed : 1
    // 帧号用哪个时间基准：
    //   · 续播中 → **必须**用 sticky.since。宿主把语义切回 idle 时 moodSince
    //     会跟着变，elapsed 归零，动画从第 0 帧重新开始 —— 表现为停在
    //     第一帧循环。改用登记时刻计算，续播才能接续推进。
    //   · 平时   → 用 elapsed（宿主给的时间基准）。
    const basis = sticky !== undefined && key === sticky.key ? Math.max(0, now - sticky.since) : elapsed

    // 睡觉：**直接按宿主 tick 数选帧**，不走 frameAt。
    //
    // 原因见 SLEEP_TICK_MS 的注释 —— 宿主睡觉时只在每 1000ms 推进一次 now，
    // 所以皮肤每秒只有一次画画的机会，1 fps 是硬上限。要让这唯一的一次机会
    // 每次都有变化，就让帧号跟着 tick 数走：每 tick 前进一帧。
    //
    // 不用 frameAt(speed=节拍/每帧时长) 的原因：那个折算假设帧时长均匀
    // （素材现在是 12×80ms，成立），但换素材后若时长不均就会算歪。直接用
    // tick 数取模，任何素材都保证"每 tick 一帧、12 帧 12 秒一轮"。
    if (key === 'sleeping' && anim.frames.length > 1) {
      const tick = Math.floor(basis / SLEEP_TICK_MS)
      return { key, index: tick % anim.frames.length }
    }

    return { key, index: frameAt(anim, basis, speed) }
  }

  const columns = kit.cols
  const rows = Math.ceil(kit.rows / 2)

  /** 图像轨组件：hooks 在这里（组件内）执行。 */
  function RasterSkin(input) {
    const requested = host.useTerminalImages(true)
    const protocol = host.useTerminalImageProtocol()
    // 读实时 channel 消解 music 歧义（详见 withDisambiguation 的注释）。
    // hook 必须在组件里调，所以放在这层；pick() 只收普通数据。
    const channel = typeof host.useSidePanelChannel === 'function' ? safeChannel() : undefined
    // 消歧后的输入要**一路传下去**：RasterSkin 会按协议回退到 LetterSkin，
    // 如果那里收到原始 input，字母轨就会走没消歧的分支 —— 同一台机器上
    // 支持/不支持图像协议时表现不一致，很难查。
    const resolved = withDisambiguation(input, channel)
    const picked = pick(resolved)
    if (picked === undefined) return null
    const usable = requested && (protocol === 'kitty' || protocol === 'sixel')
    const frames = usable ? raster.get(picked.key) : undefined
    const src = frames?.[picked.index]
    if (src === undefined) return React.createElement(LetterSkin, resolved)
    return React.createElement(
      host.Box,
      { flexDirection: 'column', flexShrink: 0, width: columns, height: rows, alignItems: 'center', justifyContent: 'center' },
      React.createElement(host.Image, { source: src, width: columns, height: rows, transparent: true, alt: '' }),
    )
  }

  /**
   * 字母格轨组件：**完全走宿主原生路径**，与内置 Deepy / 鲸娘一致。
   *
   * 早先试过"把透明区填成面板色"——那会在宠物周围糊一块粉色底，已撤销。
   * 现在只做一件事：把宿主 renderSpriteRows 的输出原样交给 Text。
   */
  function LetterSkin(input) {
    const picked = pick(input)
    if (picked === undefined) return null
    let frame = letters.get(picked.key)
    if (frame === undefined) {
      const anim = kit.animations.get(picked.key)
      if (anim === undefined) return null
      frame = anim.frames.map((f) => host.renderSpriteRows(f.rows, kit.palette))
      letters.set(picked.key, frame)
    }
    const lines = frame[picked.index] ?? frame[0]
    if (lines === undefined) return null
    return React.createElement(
      host.Box,
      { flexDirection: 'column', flexShrink: 0, width: columns },
      ...lines.map((line, i) => React.createElement(
        host.Text,
        { key: i, wrap: 'truncate-end' },
        line,
      )),
    )
  }

  return {
    id: config.skinId,
    title: config.title,
    // 半块轨下 32 行像素 = 16 行字符；图像轨贴同样大小的盒子，保证两种
    // 渲染占位一致（协议切换不跳版）。
    cells: { columns, rows },
    graphics: 'optional',
    render(input) {
      // 只返回组件元素 —— hooks 必须由 React 在组件内执行。
      //
      // 最外层兜底：渲染期抛异常会被宿主判定为「面板渲染出错」并**隔离整个
      // 伙伴面板**（用户看到的是一块错误文案，聊天虽不受影响但桌宠没了）。
      // 宁可退回内置皮肤，也不能让一个笔误毁掉面板。
      try {
        return React.createElement(RasterSkin, input)
      } catch (error) {
        lastError = error
        return React.createElement(FallbackSkin, input)
      }
    },
    /** 最近一次渲染失败的原因（诊断用，宿主不读）。 */
    get lastError() { return lastError },
    /**
     * 测试缝：给定输入，返回本帧选中的动画键。
     *
     * 为什么需要它：素材里有 5 组源 GIF **字节完全相同**（用户确认是故意的），
     * 例如 happy = poke、idle = waking、swim = drag。所以断言"渲染出来的像素
     * 是不是某个动画"无法区分它们 —— 只能直接问"选中了哪个键"。
     * 宿主不读这个字段，仅供回归测试使用。
     */
    __pickForTest(input, channel) {
      return pick(withDisambiguation(input, channel))
    },
    /** 预热：把常用动画解成位图，避免首帧等解码。 */
    async preheat(keys) {
      for (const key of keys) {
        if (raster.has(key)) continue
        raster.set(key, await decodeAnimation(key, config.imageScale))
      }
    },
    /** 供 apply() 的日志读取预热结果。 */
    __raster: raster,
  }
}

