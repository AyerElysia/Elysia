/**
 * 动画注册表：把「宿主语义」映射到帧包里的动画键。
 *
 * ## 键体系
 *
 * 键名直接采用**宿主素材包的规范键词汇表**（内置 Deepy / 鲸娘用的那 22 个，
 * 见 companion/skins.d.ts：'typing' / 'poke-left' / 'tickle' / 'idle-look' …），
 * 不做二次命名。这样 CompanionPanel 裁出的 animationSemantic 可以**同名直通**，
 * 不需要额外翻译层。
 *
 *   idle 待机眨眼      idle-look 东张西望    idle-spout 开心喷水
 *   swim 游来游去      sleeping 呼呼大睡     waking 被吵醒
 *   thinking 思考中    typing 敲代码        building 施工中
 *   conducting 小鲸鱼分身  music 戴耳机听歌   compacting 上下文清理
 *   carrying 抱书搬运  error 出错啦         happy 任务完成
 *   notification 需要你确认  poke-left/right 戳左右脸
 *   tickle 被挠痒痒    drag 被拎起来        smile-hearts / thumbs-up 彩蛋
 *
 * ## mood 层
 *
 * mood 是比语义更粗的一层（宿主在裁不出语义时用）。它映射到上面的键。
 * 各别名（happy / celebrate / attention）指向同一动画，是宿主语义重叠所致。
 *
 * ## 回退
 *
 * 任何键缺失都逐级回退，最终落到素材里实际存在的第一个动画，永不抛错 ——
 * 用户只提供几个 GIF 时也能用。
 * @module dsh-tui-elysia-pet/animations
 */

/** 宿主 mood → 动画键。 */
export const MOOD_ANIMATION = {
  idle: 'idle',
  waiting: 'thinking',
  thinking: 'thinking',
  working: 'typing',
  responding: 'typing',
  attention: 'notification',
  celebrate: 'happy',
  error: 'error',
  sleeping: 'sleeping',
}

/**
 * 待机轮换池：idle 时按时间在这些键之间循环，让待机动画不只一个表情。
 * 只有素材里真实存在的键会被用上（见 createResolver 的 pool()）。
 */
export const IDLE_POOL = ['idle', 'idle-look', 'idle-spout']

/** 每个待机变体停留多久（毫秒）。 */
export const IDLE_ROTATE_MS = 12_000

/** 兜底顺序：任何键都缺失时最终落到这里，都没有就取第一个可用动画。 */
export const FALLBACK_ORDER = ['idle', 'idle-look', 'happy', 'typing', 'thinking']

/**
 * 语义键 → 实际有素材的键。
 *
 * 只列**确有复用**的项；宿主发来而这里没有的键会走 FALLBACK_ORDER 那条链。
 * 用户的决定：
 *   · music（戴耳机听歌）复用 building 的图 —— 没有专门的戴耳机素材；
 *   · compacting（上下文清理）没有合适的图，故意不列，让它自然退化。
 */
/**
 * 同一语义的**多个随机变体**：每次进入该语义时随机挑一个。
 *
 * 用户把两个庆祝动画都命名为「随机触发」——意图就是二选一。宿主只给一个
 * happy 语义，所以随机性在我们这层实现。
 *
 * 选择必须是**确定性**的（按 moodSince 派生），不能真用 Math.random() ：
 * 宿主每帧都会调用 render，用随机数会导致每次渲染都换动画（闪烁）。
 * 用 moodSince 做种子 → 同一次庆祝期间恒定选中同一个变体。
 */
export const SEMANTIC_VARIANTS = {
  happy: ['happy', 'happy-2'],
}

export const SEMANTIC_ALIAS = {
  // 戴耳机听歌 —— 宿主把**两类不同场景**都叫这个名字（mood.js 的
  // deriveCompanionContext，阈值全硬编码）：
  //   a) runningSubagents >= 1                     有子代理在跑
  //   b) sessions >= 2 且子代理为 0                 例：主回合 + 1 个后台任务
  // 用户对 (a) 要「分身」、对 (b) 要「同时跑两个及以上工具」。
  //
  // 主路径是 lib/skin.js 的 withDisambiguation：它读实时 channel 上的
  // subagents 明细，把 music 改写成 conducting 或 building 之后再进来，
  // 所以正常情况下不会执行到这一行。
  //
  // 这里留 building 而不是 conducting —— 只在拿不到 channel 时兜底。
  // 曾经写的是 conducting（为了"只开 1 个子代理就看到分身"），但那会让
  // **任何一个 sessions=2 的场景都显示分身**，用户看到的就是
  // 「调用两个以上工具却在放子代理动画」。兜底宁可偏向"并发干活"，
  // 也不要复现那个症状。
  music: 'building',
  // 左右戳共用同一段动画（源素材只有一个"戳左边、戳右边"文件）
  'poke-left': 'poke',
  'poke-right': 'poke',
  // ── 宿主语义 → 素材键的同义映射 ────────────────────────────────────
  //
  // 这张表是**唯一**的别名真相。构建脚本的 KEY_FALLBACK 已清空：曾经两处
  // 各写一份，漏掉的键就静默失去动画（carrying / compacting 就这么丢的）。
  celebrate: 'happy',
  attention: 'notification',
  waiting: 'thinking',
  responding: 'typing',
  // 顶箱子（gitBranch 变更闪现）。素材没有对应动作，用游动代替 —— 都是
  // "带着东西移动"的感觉。
  carrying: 'swim',
  // 压缩上下文。素材没有对应动作，用思考代替（同样是"在整理信息"）。
  compacting: 'thinking',
}

/** 兜底顺序：任何键都缺失时最终落到这里，都没有就取第一个可用动画。 */
export function createResolver(animations, config, options = {}) {
  // 庆祝变体开关（默认开）。关掉时 pickVariant 直接返回第一个可用变体。
  const variantsOn = config?.celebrationVariants !== false
  const has = (key) => typeof key === 'string' && animations.has(key)
  const idleRotateMs = options.idleRotateMs ?? IDLE_ROTATE_MS

  /** 用户配置的键优先于内置表 —— 配置里写了但素材没有时静默跳过。 */
  const overrides = {
    idle: config.idleAnimation,
    working: config.workingAnimation,
    thinking: config.thinkingAnimation,
    happy: config.happyAnimation,
    celebrate: config.happyAnimation,
    sleeping: config.sleepingAnimation,
  }

  /** 素材里实际可用的待机池（按 IDLE_POOL 顺序，用户配置的 idle 排最前）。 */
  const idlePool = (() => {
    const wanted = [overrides.idle, ...IDLE_POOL].filter((k, i, a) => has(k) && a.indexOf(k) === i)
    return wanted.length > 0 ? wanted : FALLBACK_ORDER.filter(has).slice(0, 1)
  })()

  /**
   * 从变体表里确定性地挑一个（同一次语义期间结果稳定）。
   * @param {string} key
   * @param {number} seed 通常传 moodSince —— 每次进入该语义都会变
   */
  function pickVariant(key, seed) {
    const list = variantsOn ? SEMANTIC_VARIANTS[key] : undefined
    if (list === undefined) return key
    const usable = list.filter(has)
    if (usable.length === 0) return key
    if (usable.length === 1) return usable[0]
    // 种子混匀后再取模。
    //
    // 不能直接 seed % n：种子是 elapsed（毫秒），值域很小且**总是从小往大
    // 增长**，直接取模会让"每次庆祝都选中第一个"（实测 20 个种子全落 happy）。
    // 这里跑一轮 xorshift 把低位打散 —— 相邻的种子也能落到不同变体上，
    // 同时保持"同一种子结果恒定"（不引入真随机，否则每帧渲染都会换动画）。
    let x = (Math.abs(Math.floor(seed)) | 0) || 0x9e3779b9
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    return usable[(x >>> 0) % usable.length]
  }

  /** 解析一个键到实际动画。逐级回退，永不抛错。 */
  function resolve(wanted) {
    if (has(wanted)) return wanted
    // 别名：宿主语义 → 我们实际有素材的键
    if (has(SEMANTIC_ALIAS[wanted])) return SEMANTIC_ALIAS[wanted]
    if (has(overrides[wanted])) return overrides[wanted]
    for (const candidate of FALLBACK_ORDER) if (has(candidate)) return candidate
    const first = animations.keys().next()
    return first.done ? undefined : first.value
  }

  /**
   * mood（含语义覆盖）→ 动画键。
   * @param {string} mood
   * @param {string|undefined} semantic
   * @param {number} [elapsedMs] 当前 mood 已持续多久 —— 待机时用来轮换变体
   * @param {number} [seedMs] 变体选择的种子（传 moodSince）。缺省回落到 elapsed。
   */
  function forMood(mood, semantic, elapsedMs = 0, seedMs = elapsedMs) {
    if (has(semantic)) return pickVariant(semantic, seedMs)
    if (has(SEMANTIC_ALIAS[semantic])) return pickVariant(SEMANTIC_ALIAS[semantic], seedMs)
    if (has(overrides[semantic])) return overrides[semantic]
    if (mood === 'idle' && idlePool.length > 1) {
      // Math.floor 对负数给出负索引，取模后仍是负的 —— 先归一化到 [0, n)。
      const step = Math.floor(Math.max(0, elapsedMs) / idleRotateMs)
      return idlePool[step % idlePool.length]
    }
    const mapped = MOOD_ANIMATION[mood]
    if (has(mapped)) return mapped
    return resolve(mapped ?? mood)
  }

  return { resolve, forMood, has, idlePool }
}
