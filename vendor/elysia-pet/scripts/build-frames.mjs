#!/usr/bin/env node
/**
 * 把源 GIF 转成本插件运行期消费的帧包（assets/letters.json）。
 *
 * ## 这些素材是像素画，必须按原生网格 1:1 提取
 *
 * 源图 320x320，但相邻颜色变化点间距**恒为 10px** —— 它实际是 **32x32** 的
 * 像素画，每格 10x10。所以：
 *
 * - **不能用 resize 重采样**：放大缩小都会插值出源图没有的中间色，画面糊掉。
 * - **不能裁剪**：内容（含头顶的 "..." 气泡、禁止标志、卷发圈）占满整个
 *   0,0->31,31，逐帧独立裁剪会让角色在帧间位移（抖动）。
 * - 取每格**中心像素**（而非左上角），避免格间抗锯齿边缘的影响。
 *
 * ## 半块渲染与尺寸
 *
 * 宿主用半块字符一个字符编码上下两个像素，所以 32x32 的像素画输出
 * **32 列 x 16 行**（cells），视觉上是正方形（终端字符高约为宽的 2 倍）。
 * 帧包的 size 记的是**像素网格** [32, 32]，不是输出行数。
 *
 * 用法：
 *   node scripts/build-frames.mjs [源目录] [--grid=10] [--maxColors=48]
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * sharp 是构建期依赖（不随插件发布：运行期零依赖）。本地未装时回退到
 * dsh-tui 自带的那份 —— 它渲染终端图片本来就要 sharp，开发机无需 npm install。
 */
const sharp = await (async () => {
  try { return (await import('sharp')).default }
  catch {
    for (const c of [
      'E:/dsh-profiles/_core/node_modules/sharp/dist/index.mjs',
      new URL('../../../dsh-profiles/_core/node_modules/sharp/dist/index.mjs', import.meta.url).href,
    ]) {
      try { return (await import(c)).default } catch { /* 下一个 */ }
    }
    console.error('找不到 sharp。请在项目里 npm install sharp，或设置可用的回退路径。')
    process.exit(1)
  }
})()

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/**
 * 文件名 → 语义动画键。
 *
 * 用户已经把源 GIF 按动作命名，所以**按文件名精确映射**，不再靠排序猜。
 * 键名取自宿主的 CompanionDisplaySemantic（见 companion/mood.js）与
 * CompanionInteractionKind，内置 Deepy 用的就是这一套。
 *
 * 同一份动画可以被多个键共用（用户刻意做的重复文件，例如"游来游去"
 * 与"被拎起来"内容相同）—— 这里只需各自映射到自己的键。
 */
const FILE_KEY_MAP = {
  '待机眨眼': ['idle-look', 'idle-spout'],
  '东张西望': 'idle',
  // 开心喷水.gif 不用了（用户要求 idle-spout 改放待机眨眼.gif）。显式标成 null 表示跳过，
  // 否则它会退化成文件名键污染帧包。
  '开心喷水': null,
  '思考中': 'thinking',
  '敲代码': 'typing',
  '同时跑两个及以上工具': 'building',
  '派出任意数量子代理': 'conducting',
  '出错啦': 'error',
  '任务完成随机触发': 'happy',
  // 庆祝动作的第二个变体（用户把它和上一个都命名为「随机触发」，
  // 本就是同一动作的随机二选一；thumbs-up 那个键宿主的侧栏路径收不到）
  '任务完成随机触发 (2)': 'happy-2',
  // 用户重命名前的两个散落文件（内容：流泪 / 生气）。宿主没有对应语义，
  // 但鲸娘素材包在两个 bonus 键上有空位，接上让它们能用。
  '6C2D1D4141D9C7334BAF23E34383C063': 'smile-hearts',
  'F79D69106C17282F795B7C0BEF23E199': 'bonus',
  '需要你确认': 'notification',
  '呼呼大睡': 'sleeping',
  '被吵醒': 'waking',
  '游来游去': 'swim',
  '被拎起来': 'drag',
  '被挠痒痒': 'tickle',
  '戳左边、戳右边': 'poke',
}

/**
 * 没有独立动画的键 → 复用哪个键的帧。
 * 用户明确说过"其他没有对应的就是没有这个动作"，所以这里只做**必要的兜底**：
 * 宿主会给这些语义发信号，插件若不接就会掉回 idle，不如复用最接近的动作。
 */
const KEY_FALLBACK = {
  // 故意留空。
  //
  // 这里曾写过 carrying→swim / compacting→thinking / music→typing 之类的
  // "构建期改名"。问题是运行时 lib/animations.js 的 SEMANTIC_ALIAS 也有一份
  // 别名表，两份表**各写各的**，漏掉的键就静默失去动画：
  //   · 构建期 carrying 被改名成 swim，帧包里根本没有 'carrying' 这个键；
  //   · 运行时收到 'carrying' 查不到，SEMANTIC_ALIAS 里也没它 → 落 idle。
  // 表现就是「顶箱子 / 压缩上下文 这两个动作看不见」。
  //
  // 现在只保留运行时的 SEMANTIC_ALIAS 一份真相：构建期一律保留**真实键名**，
  // 由运行时的别名表决定落到哪个动画。
}



/**
 * 每个动画的**节奏倍率**：乘在源 GIF 的帧时长上（1 = 保持原速 80ms/帧）。
 *
 * 为什么要逐动画配：源素材全部是 12 帧 × 80ms = 960ms 一轮，但宿主给每个
 * 语义的**展示窗口**长短差很多（见 companion/mood.js 的 *_MS 常量）：
 *
 *   tickle   宿主窗口 900ms  ← 960ms 的动画**一轮都播不完**，看起来刚动就断
 *   poke     宿主窗口 1400ms ← 1.46 轮，合适
 *   waking   宿主窗口 1800ms ← 1.88 轮
 *   happy    宿主窗口 2500ms ← 2.60 轮
 *
 * 所以互动类要**按窗口反推节奏**：想让用户在窗口内看到 N 轮完整动画，
 * 就把单轮时长压到 window/N。
 *
 *   tickle: 900ms 窗口想播 2 轮 → 单轮 450ms → 倍率 450/960 ≈ 0.47
 *
 * 反过来，睡觉这类"长时间挂着"的动画要**放慢**才显得安稳（宿主 Deepy 的
 * sleeping 是 6 帧 / 1920ms，即 320ms/帧）。
 */
const ANIMATION_PACE = {
  // 全部 1.0 —— 源素材原速 80ms/帧（12.5 fps）。
  //
  // 这里**永远不该出现非 1 的值**。曾经做过两件错事：
  //
  //   1. 给 sleeping 加 1.6 倍"放慢"，想让睡觉显得安稳 —— 结果画面更新率
  //      掉到 7.8 fps，比待机的 12.5 fps 明显卡，用户一眼看出要求统一。
  //   2. 给 tickle/happy 加 0.45/0.62 倍"加速"，想让它们在宿主的固定窗口
  //      （900ms / 2500ms）里多播几轮 —— 结果动作飞快，用户指出：
  //      "让你播放两轮不是让你在固定时间内播放两轮，你不延长成双倍时间
  //       的话会很快的"。
  //
  // 正确做法见 lib/skin.js 的 REPEAT_ROUNDS：**保持原速**，把"这次要播几轮"
  // 换算成停留时长交给宿主。动画本身的节奏不参与任何缩放。
}







/**
 * 文件名 → 要挂到哪些动画键。值可以是字符串或字符串数组。
 *
 * 数组形式用于**同一个文件供多个键共用**（用户明确要求：待机眨眼.gif 同时
 * 供 idle-look 与 idle-spout 使用）。这样待机轮换时该动画会多出现几次。
 */
function keysForFile(base) {
  const v = FILE_KEY_MAP[base]
  if (v === undefined) return []
  if (v === null) return []
  return Array.isArray(v) ? v : [v]
}

/** 解析命令行：位置参数 = 源目录，--k=v 覆盖选项。 */
function parseArgs(argv) {
  const out = { src: process.env.ELYSIA_PET_SRC ?? join(ROOT, 'src-gif'), grid: 10, maxColors: 48 }
  for (const arg of argv) {
    const m = /^--([a-zA-Z]+)=(.*)$/u.exec(arg)
    if (m) out[m[1]] = Number.isNaN(Number(m[2])) ? m[2] : Number(m[2])
    else if (!arg.startsWith('--')) out.src = arg
  }
  return out
}


/**
 * 去掉"整段动画被重复播放"带来的冗余帧。
 *
 * ## 为什么需要
 *
 * 源素材里有些 GIF 是**半段动画播两遍**。实测呼呼大睡：12 帧里帧 1-6 与
 * 帧 7-12 的逐格指纹完全相同 —— 它其实只有 6 个画面。原样搬进帧包会白占
 * 一倍时长，观感上就是"帧数少、节奏拖"（用户反馈"睡觉帧数好低"）。
 *
 * ## 为什么用"周期检测"而不是"去掉连续重复帧"
 *
 * 朴素的"相邻相同就合并"会**误伤来回摆动**的动画（A→B→C→B→A 里第二个 B
 * 是节奏的一部分）。这里改成：找一个最小周期 p，使得
 *   frames[i] 与 frames[i % p] 全部相同
 * 只有整段确实是 p 帧的整数倍重复时才折叠。摆动类动画的周期等于它自身
 * （12 帧不构成 6 帧的重复），因此原样保留。
 *
 * 折叠时把被去掉帧的时长并入对应帧，**总时长不变** —— 播放观感完全一致，
 * 只是不再有冗余数据。
 *
 * @param {Array<Array<Array<[number,number,number]|null>>>} frames
 * @param {number[]} delays
 * @returns {{frames: typeof frames, delays: number[], removed: number, period: number}}
 */
function dedupeFrames(frames, delays) {
  const n = frames.length
  if (n < 2) return { frames, delays, removed: 0, period: n }

  /** 整帧指纹：逐格编码成字符串，直接比较。 */
  const fingerprint = (grid) => grid
    .map((row) => row.map((c) => (c === null || c === undefined ? '.' : c.join(','))).join('|'))
    .join('#')
  const fps = frames.map(fingerprint)

  // 找最小周期 p：p 必须整除 n，且所有帧都等于 frames[i % p]
  let period = n
  for (let p = 1; p < n; p++) {
    if (n % p !== 0) continue
    let ok = true
    for (let i = p; i < n; i++) if (fps[i] !== fps[i % p]) { ok = false; break }
    if (ok) { period = p; break }
  }
  if (period === n) return { frames, delays, removed: 0, period: n }

  // 折叠：每帧时长 = 该相位上所有重复帧的时长之和
  const outDelays = new Array(period).fill(0)
  for (let i = 0; i < n; i++) {
    const d = delays[i] > 0 ? delays[i] : 80
    outDelays[i % period] += d
  }
  return {
    frames: frames.slice(0, period),
    delays: outDelays,
    removed: n - period,
    period,
  }
}

/**
 * 去掉「思考中」头顶那块符号贴片。
 *
 * ## 它其实不是"三条线"，是一整块白色贴片
 *
 * 初看像三条黑线浮在头发上，实际逐格打印颜色后才发现是**一块 10×10 的
 * 白色矩形贴片**（rgb(244,245,244) 打底），三条深紫竖线（rgb(103,70,105)）
 * 嵌在里面。只擦线不擦底，就会留下一块纯白补丁 —— 看起来像"脑袋被挖空了"
 * （这就是第一版的 bug）。
 *
 * 这两个颜色在本素材集里**是贴片专属的**：扫过全部 18 个 GIF，只有
 * 「思考中」和「生气」出现，其余 16 个一次都没有。所以用颜色判定贴片
 * 非常可靠，不需要猜几何形状。
 *
 * 贴片逐帧上下浮动（包围盒 y 从 10 到 13 变化），所以**逐帧独立**找它，
 * 不能用固定的坐标框。
 *
 * ## 填充：从"同角色的其他动画"取同位置像素
 *
 * 全部 19 个动画都是同一个爱莉、同一个姿势，只有表情/符号不同。所以被贴片
 * 盖住的头发，在别的动画里**多半是可见的**：
 *
 *   1. 建立参考池 = 所有"不含贴片色"的动画的全部帧；
 *   2. 对「思考中」的每一帧，用**贴片以外的像素**和参考帧逐一比对，按
 *      平均色差排序（贴片区域不参与比对，否则会被贴片本身干扰）；
 *   3. 取色差最小的前 8 帧，对每个被盖住的格子取这 8 帧同位置的**中位数**。
 *
 * 取前 8 而不是"最优 1 帧"：单帧在中位数意义上不够稳；取全部 192 帧则会把
 * 头发逐帧摆动平均掉，显得糊。8 帧是"够稳且仍是相近姿势"的折中
 * （实测三者接缝能量相同，这是按视觉选的）。
 *
 * 不使用就地取色的 inpaint：贴片有 10 格宽，从边界向内扩散会把两侧的头发
 * 颜色拉成一片糊，而参考帧里那块头发本来就是清晰可见的。
 *
 * @param {Array<{key: string, frames: Array<Array<Array<[number,number,number]|null>>>}>} animations
 * @returns {{patched: number, filled: number}} 统计（供日志）
 */
function removeSymbolPatch(animations) {
  /** 贴片专用色：白色底 + 深紫线条。容差很小，避免误伤正常的粉/白头发。 */
  const isPatch = (c) => c !== null && c !== undefined && (
    (Math.abs(c[0] - 244) < 5 && Math.abs(c[1] - 245) < 5 && Math.abs(c[2] - 244) < 5) ||
    (Math.abs(c[0] - 103) < 6 && Math.abs(c[1] - 70) < 6 && Math.abs(c[2] - 105) < 6)
  )

  /** 某帧是否含贴片色。 */
  const hasPatch = (grid) => grid.some((row) => row.some(isPatch))

  // 要处理的动画：**任何含贴片的**都算。本素材集里是「思考中」和「生气」
  // 两个（都用了同一种白底+竖线的符号贴片），但这里不写死键名 ——
  // 以后换了素材、贴片出现在别的动画上，同一套逻辑照样生效。
  const targets = animations.filter((a) => a.frames.some(hasPatch))
  if (targets.length === 0) return { patched: 0, filled: 0 }

  // 参考池：只从**完全不含贴片**的动画里取，保证参考帧上那块头发是可见的
  const refs = []
  for (const anim of animations) {
    if (targets.includes(anim)) continue
    for (const grid of anim.frames) refs.push(grid)
  }
  if (refs.length === 0) return { patched: 0, filled: 0 }

  const rowsN = targets[0].frames[0].length
  const colsN = targets[0].frames[0][0].length
  const median = (nums) => {
    const s = [...nums].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }

  /** 两帧在"贴片以外"的平均色差；透明/不透明不一致按大惩罚计。 */
  const compareOutside = (a, b) => {
    let sum = 0
    let n = 0
    for (let y = 0; y < rowsN; y++) {
      for (let x = 0; x < colsN; x++) {
        if (isPatch(a[y][x])) continue
        const p = a[y][x]
        const q = b[y][x]
        if (p === null && q === null) continue
        if (p === null || q === null) { sum += 200; n++; continue }
        sum += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])
        n++
      }
    }
    return sum / Math.max(1, n)
  }

  let patched = 0
  let filled = 0
  for (const target of targets) for (const grid of target.frames) {
    // 该帧的贴片位置（逐帧浮动，每帧自己找）
    const holes = []
    for (let y = 0; y < rowsN; y++) {
      for (let x = 0; x < colsN; x++) if (isPatch(grid[y][x])) holes.push([x, y])
    }
    if (holes.length === 0) continue
    patched += holes.length

    // 按"贴片以外"的相似度排序，取前 8 帧作填充来源
    const ranked = refs
      .map((r) => ({ r, d: compareOutside(grid, r) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8)
      .map((o) => o.r)

    for (const [x, y] of holes) {
      const samples = []
      for (const r of ranked) {
        const c = r[y][x]
        if (c !== null && c !== undefined) samples.push(c)
      }
      if (samples.length === 0) { grid[y][x] = null; continue }
      // 中位数而非均值：均值会被个别离群帧（比如某帧头发正好翻到别处）带偏
      grid[y][x] = [0, 1, 2].map((k) => median(samples.map((c) => c[k])))
      filled++
    }
  }
  return { patched, filled }
}

/**
 * 解码 Windows .ani（RIFF/ACON）里的 8bpp 索引帧。
 *
 * 为什么不直接用 sharp：.ani 的每帧是**裸 DIB**（缺 BITMAPFILEHEADER），
 * 而且打包在 ICONDIR 之后；sharp 既不认裸 DIB，也不认 8bpp 索引位图。
 * 所以这里手写：解析 RIFF chunk → 取 ICONDIR → 手工展开调色板 + XOR 位图
 * + AND 掩码（AND 位 = 1 表示透明）。
 *
 * 高度字段是"真实高度 × 2"（下半是 AND 掩码），要注意减半。
 */
async function extractAni(src, gridPx) {
  const buf = readFileSync(src)
  if (buf.slice(0, 4).toString('latin1') !== 'RIFF' || buf.slice(8, 12).toString('latin1') !== 'ACON') {
    throw new Error('不是 RIFF/ACON .ani：' + src)
  }
  // 收集 icon chunk。注意：icon 不在 RIFF 顶层，而是嵌在
  //   LIST(4 字节 'fram') → icon × N
  // 这个容器里，所以要递归一层。
  const icons = []
  const walk = (from, to) => {
    let o = from
    while (o + 8 <= to) {
      const id = buf.slice(o, o + 4).toString('latin1')
      const size = buf.readUInt32LE(o + 4)
      if (id === 'icon') icons.push(buf.slice(o + 8, o + 8 + size))
      else if (id === 'LIST') walk(o + 12, o + 8 + size)   // 跳过 'LIST'+size+类型名
      o += 8 + size + (size % 2)
    }
  }
  walk(12, buf.length)
  if (icons.length === 0) throw new Error('.ani 里没有 icon 帧：' + src)

  /** 一个 icon chunk → { width, height, rgba }。 */
  const decodeIcon = (chunk) => {
    const dirCount = chunk.readUInt16LE(4)
    const dib = chunk.slice(6 + dirCount * 16)
    const biSize = dib.readUInt32LE(0)
    const width = dib.readInt32LE(4)
    const rawH = dib.readInt32LE(8)
    const bpp = dib.readUInt16LE(14)
    const clrUsed = dib.readUInt32LE(32)
    if (bpp !== 8) throw new Error('只支持 8bpp .ani，实得 ' + bpp)
    const palN = clrUsed > 0 ? clrUsed : 256
    const pal = []
    for (let i = 0; i < palN; i++) {
      const p = biSize + i * 4
      pal.push([dib[p + 2], dib[p + 1], dib[p]])   // BGRA → RGB
    }
    const height = rawH / 2                          // 下半是 AND 掩码
    const xorStride = Math.ceil(width * bpp / 32) * 4
    const xorOff = biSize + palN * 4
    const andStride = Math.ceil(width / 32) * 4
    const andOff = xorOff + xorStride * height
    const rgba = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) {
      const srcRow = xorOff + (height - 1 - y) * xorStride   // DIB 自底向上
      const andRow = andOff + (height - 1 - y) * andStride
      for (let x = 0; x < width; x++) {
        const idx = dib[srcRow + x]
        const andBit = (dib[andRow + (x >> 3)] >> (7 - (x & 7))) & 1
        const c = pal[idx] ?? [0, 0, 0]
        const j = (y * width + x) * 4
        rgba[j] = c[0]; rgba[j + 1] = c[1]; rgba[j + 2] = c[2]
        rgba[j + 3] = andBit === 1 ? 0 : 255
      }
    }
    return { width, height, rgba }
  }

  const first = decodeIcon(icons[0])
  // .ani 的帧本身就是像素画（1 格 = 1 像素），不像 GIF 那样每格放大 10 倍，
  // 所以**不按 gridPx 切**。
  //
  // 高度要多裁一行：DIB 的 H/2 = 33（含 AND 掩码的那半向上取整），比 GIF 的
  // 32 多 1 行。裁到 32 才能和 GIF 帧对齐 —— 多出来的那行是底部空白。
  const cols = first.width
  const rows = first.height - 1
  const frames = []
  const delays = []
  for (const icon of icons) {
    const { width, height, rgba } = decodeIcon(icon)
    const grid = []
    for (let gy = 0; gy < rows; gy++) {
      const row = []
      for (let gx = 0; gx < cols; gx++) {
        // 1:1 采样（.ani 没有放大倍数）
        const sx = Math.min(width - 1, gx)
        const sy = Math.min(height - 1, gy)
        const j = (sy * width + sx) * 4
        row.push(rgba[j + 3] < 128 ? null : [rgba[j], rgba[j + 1], rgba[j + 2]])
      }
      grid.push(row)
    }
    frames.push(grid)
    delays.push(80)
  }
  return { cols, rows, frames, delays }
}

/**
 * 按原生网格把一个 GIF 的全部帧抽成颜色网格。
 * 逐帧返回 grid[y][x] = [r,g,b] | null（null = 透明）。
 */
async function extractGif(src, gridPx) {
  const meta = await sharp(src, { animated: true }).metadata()
  const width = meta.width ?? 0
  const height = meta.pageHeight ?? meta.height ?? 0
  const pages = meta.pages ?? 1
  const delays = Array.isArray(meta.delay) ? meta.delay : []
  if (width === 0 || height === 0) throw new Error('读不到尺寸: ' + src)

  const cols = Math.round(width / gridPx)
  const rows = Math.round(height / gridPx)
  if (cols < 2 || rows < 2) throw new Error('网格推算失败（尺寸 ' + width + 'x' + height + '，格 ' + gridPx + '）: ' + src)

  const frames = []
  for (let page = 0; page < pages; page++) {
    // 必须 page + pages:1 —— 否则 sharp 把动画当竖排长图返回整幅。
    const { data, info } = await sharp(src, { page, pages: 1 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const g = []
    for (let gy = 0; gy < rows; gy++) {
      const row = []
      for (let gx = 0; gx < cols; gx++) {
        // 取格心：避开格与格之间可能存在的抗锯齿边缘
        const px = Math.min(info.width - 1, Math.floor(gx * gridPx + gridPx / 2))
        const py = Math.min(info.height - 1, Math.floor(gy * gridPx + gridPx / 2))
        const i = (py * info.width + px) * 4
        row.push(data[i + 3] < 8 ? null : [data[i], data[i + 1], data[i + 2]])
      }
      g.push(row)
    }
    frames.push(g)
  }
  return { cols, rows, frames, delays, pages }
}

/** 收集整包颜色做调色板：按出现频次取前 N，量化到 5 位/通道合并近似色。 */
function buildPalette(frames, maxColors) {
  const hist = new Map()
  for (const g of frames) {
    for (const row of g) {
      for (const px of row) {
        if (px === null) continue
        const k = ((px[0] >> 3) << 10) | ((px[1] >> 3) << 5) | (px[2] >> 3)
        const e = hist.get(k)
        if (e === undefined) hist.set(k, { n: 1, r: px[0], g: px[1], b: px[2] })
        else { e.n++; e.r += px[0]; e.g += px[1]; e.b += px[2] }
      }
    }
  }
  const entries = [...hist.values()].map((e) => [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n), e.n])
  entries.sort((a, b) => b[3] - a[3])
  return entries.slice(0, maxColors).map((e) => e.slice(0, 3))
}

/** 调色板字符集：避开点号（保留给透明）。 */
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+*#@%&$?!~^'.split('')
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!existsSync(opts.src)) {
    console.error('源目录不存在: ' + opts.src)
    console.error('用法: node scripts/build-frames.mjs <源GIF目录> [--grid=10] [--maxColors=48]')
    process.exit(1)
  }
  const files = readdirSync(opts.src).filter((f) => /\.(gif|ani)$/iu.test(f)).sort()
  if (files.length === 0) { console.error('目录里没有 .gif / .ani：' + opts.src); process.exit(1) }

  console.log('源目录: ' + opts.src)
  console.log('GIF ' + files.length + ' 个 · 原生网格 ' + opts.grid + 'px · 最多 ' + opts.maxColors + ' 色')

  const animations = []
  const allFrames = []
  let cols = 0
  let rows = 0

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const base = file.replace(/\.(gif|ani)$/iu, '')
    // .ani 走独立解码器（8bpp 索引 DIB，sharp 不认）
    const decoded = /\.ani$/iu.test(file)
      ? await extractAni(join(opts.src, file), opts.grid)
      : await extractGif(join(opts.src, file), opts.grid)
    const { cols: c, rows: r, frames, delays } = decoded
    // 表里显式写了 null 的素材直接跳过（不再使用）
    if (FILE_KEY_MAP[base] === null) {
      process.stdout.write('  [' + (i + 1) + '/' + files.length + '] ' + file.slice(0, 10).padEnd(10) + ' -> (skip, unused)' + String.fromCharCode(10))
      continue
    }
    const mapped = keysForFile(base)
    // 没在表里的文件（例如用户新加的）退化成文件名本身，至少不丢数据
    const keys = mapped.length > 0 ? mapped : [base]
    if (cols === 0) { cols = c; rows = r }
    if (c !== cols || r !== rows) {
      console.error('  尺寸不一致（期望 ' + cols + 'x' + rows + '，实得 ' + c + 'x' + r + '）：' + file)
      process.exit(1)
    }

    // 不做帧折叠：源素材的"半段播两遍"结构保留原样。
    //
    // 试过折叠（12 帧 → 6 帧、每帧时长翻倍，总时长不变）。数据上无损，
    // 但**观感更差** —— 画面更新率掉到 6.25fps，"睡觉"看起来一格一格卡。
    // 保留 12 帧 + 80ms 反而流畅（12.5fps）。
    const framesCopy0 = frames.map((g) => g.map((row) => row.slice()))
    // 节奏倍率按**第一个键**取（一个文件对多键时它们共用同一份时长）
    const pace = ANIMATION_PACE[keys[0]] ?? 1
    const delaysCopy0 = delays.map((d) => Math.max(20, Math.round((d > 0 ? d : 80) * pace)))

    // 同一个文件可以供多个键共用（映射值是数组时）
    for (const key of keys) {
      // 每个键拿独立的帧数组副本：后面 removeSymbolPatch 会原地改网格
      const fc = framesCopy0.map((g) => g.map((row) => row.slice()))
      for (const g of fc) allFrames.push(g)
      animations.push({ key, title: file, source: file, frames: fc, delays: delaysCopy0.slice() })
    }
    process.stdout.write('  [' + (i + 1) + '/' + files.length + '] ' + file.slice(0, 10).padEnd(10) +
      ' -> ' + keys.join(' + ').padEnd(22) + ' (' + String(framesCopy0.length).padStart(2) + ' 帧, ' +
      delaysCopy0[0] + 'ms/帧)' + '\n')
  }

  // 「思考中」头顶那块白色符号贴片（白底 + 三条深紫竖线）是漫画符号，
  // 用户要求去掉。在**网格层**处理而不是改源 GIF：源文件保持原样，
  // 也避开了重编码时的调色板量化损失。必须等所有动画都读完才能做 ——
  // 它要拿其他动画的帧当参考（见函数注释）。
  const patchStats = removeSymbolPatch(animations)
  if (patchStats.patched > 0) {
    console.log('  去符号贴片: 擦除 ' + patchStats.patched + ' 格，用参考帧填充 ' + patchStats.filled + ' 格')
  }

  const palette = buildPalette(allFrames, opts.maxColors)
  const charOf = palette.map((_, i) => CHARS[i])
  console.log('')
  console.log('像素网格 ' + cols + 'x' + rows + ' -> 输出 ' + cols + ' 列 x ' + Math.ceil(rows / 2) + ' 行（半块）')
  console.log('调色板: ' + palette.length + ' 色')

  /** 最近邻调色板索引（调色板很小，线性扫描足够）。 */
  const nearest = (r, g, b) => {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i]
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2
      if (d < bestD) { bestD = d; best = i }
    }
    return best
  }

  // 透明不写进 palette：宿主 renderCellRows 用像素值不等于 undefined 判定
  // 有没有像素，null 会被当成实色并走进 fg(null) 抛 TypeError（曾导致整屏紫色团块）。
  const out = {
    size: [cols, rows],
    palette: Object.fromEntries(palette.map((c, i) => [charOf[i], hex(c)])),
    animations: {},
  }
  for (const anim of animations) {
    out.animations[anim.key] = {
      key: anim.key,
      title: anim.title,
      source: anim.source,
      frames: anim.frames.map((g, fi) => ({
        dur: anim.delays[fi] > 0 ? anim.delays[fi] : 80,
        rows: g.map((row) => row.map((px) => (px === null ? '.' : charOf[nearest(px[0], px[1], px[2])])).join('')),
      })),
    }
  }

  const lettersPath = join(ROOT, 'assets', 'letters.json')
  mkdirSync(dirname(lettersPath), { recursive: true })
  writeFileSync(lettersPath, JSON.stringify(out), 'utf8')
  const bytes = readFileSync(lettersPath).length
  console.log('OK  ' + lettersPath + '  (' + (bytes / 1024).toFixed(1) + ' KB, ' + Object.keys(out.animations).length + ' 动画)')

  // 图像协议轨：按原生网格放大到整数倍导出（nearest），不插值。
  const imgRoot = join(ROOT, 'assets', 'img')
  if (existsSync(imgRoot)) rmSync(imgRoot, { recursive: true, force: true })
  const timings = {}
  let count = 0
  for (const anim of animations) {
    const dir = join(imgRoot, anim.key)
    mkdirSync(dir, { recursive: true })
    timings[anim.key] = []
    for (let p = 0; p < anim.frames.length; p++) {
      const name = String(p).padStart(2, '0') + '.png'
      // 从**已解码的网格**画出来，而不是回头再读源文件：
      //   · .ani 不是 sharp 认的格式，重读会直接失败；
      //   · 网格层去过线（thinking），重读源文件会把线又带回来。
      // 每格放大到 grid×grid 像素（nearest，不插值），与 GIF 原生尺寸一致。
      const grid = anim.frames[p]
      const W = cols * opts.grid
      const H = rows * opts.grid
      const rgba = Buffer.alloc(W * H * 4)
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const c = grid[gy]?.[gx] ?? null
          for (let dy = 0; dy < opts.grid; dy++) {
            for (let dx = 0; dx < opts.grid; dx++) {
              const i = ((gy * opts.grid + dy) * W + gx * opts.grid + dx) * 4
              if (c === null) { rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = 0 }
              else { rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255 }
            }
          }
        }
      }
      await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
        .png()
        .toFile(join(dir, name))
      timings[anim.key].push({ dur: anim.delays[p] > 0 ? anim.delays[p] : 80, file: name })
      count++
    }
  }
  writeFileSync(join(imgRoot, 'timings.json'), JSON.stringify(timings, null, 2), 'utf8')
  console.log('OK  ' + imgRoot + '  (' + count + ' 张 PNG)')
}

await main()
