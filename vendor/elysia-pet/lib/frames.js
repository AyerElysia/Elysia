/**
 * 读取并缓存字母格帧包（assets/letters.json）。
 *
 * 校验即拒绝（与宿主内置 companion 素材同姿势）：尺寸不符 / 调色板值非法 /
 * 帧 dur 非正数，任一失败整份视为不可用，皮肤回退到内置占位，不渲染半成品。
 * @module dsh-tui-elysia-pet/frames
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** letters.json 相对 lib/ 的位置（发布包与源码树同构）。 */
const CANDIDATES = ['../assets/letters.json']
const cache = { kit: null, loaded: false }

const HEX = /^#[0-9a-fA-F]{6}$/u

/**
 * 解析并校验帧包。返回 undefined 表示不可用。
 * @param {unknown} raw
 */
export function parseKit(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const size = raw.size
  if (!Array.isArray(size) || size.length !== 2) return undefined
  const cols = size[0]
  const rows = size[1]
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 4 || rows < 2) return undefined
  if (raw.palette === null || typeof raw.palette !== 'object') return undefined
  // 透明必须映射成 undefined：宿主 Whale.js 的 renderCellRows 用
  // \`pixel(x, y) !== undefined\` 判定"这一格有没有像素"，null 会被当成有颜色
  // 而走进 fg(null) 抛 TypeError。JSON 里 "\." 键缺失时 Object.entries 看不到它，
  // 但显式写 null 的帧包（旧版构建产物）会把 null 带进来，所以两种都归一化成
  // undefined —— 只补 '\\.' 键不够。
  /** @type {Record<string, [number, number, number] | undefined>} */
  const palette = Object.create(null)
  palette['.'] = undefined
  for (const [key, value] of Object.entries(raw.palette)) {
    if (key === '.') continue
    if (key.length !== 1 || typeof value !== 'string' || !HEX.test(value)) return undefined
    palette[key] = [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
    ]
  }
  if (raw.animations === null || typeof raw.animations !== 'object') return undefined
  /** @type {Map<string, {key: string, title: string, frames: {dur: number, rows: string[]}[], totalMs: number}>} */
  const animations = new Map()
  for (const [key, anim] of Object.entries(raw.animations)) {
    if (anim === null || typeof anim !== 'object') return undefined
    if (!Array.isArray(anim.frames) || anim.frames.length === 0) return undefined
    /** @type {{dur: number, rows: string[]}[]} */
    const frames = []
    let totalMs = 0
    for (const frame of anim.frames) {
      if (frame === null || typeof frame !== 'object') return undefined
      if (typeof frame.dur !== 'number' || !Number.isFinite(frame.dur) || frame.dur <= 0) return undefined
      if (!Array.isArray(frame.rows) || frame.rows.length !== rows) return undefined
      for (const row of frame.rows) {
        if (typeof row !== 'string' || row.length !== cols) return undefined
      }
      frames.push({ dur: frame.dur, rows: frame.rows.slice() })
      totalMs += frame.dur
    }
    animations.set(key, {
      key,
      title: typeof anim.title === 'string' ? anim.title : key,
      frames,
      totalMs,
    })
  }
  if (animations.size === 0) return undefined
  return { cols, rows, palette, animations }
}

/**
 * 加载帧包（进程内缓存）。素材缺失或校验失败返回 undefined。
 */
export function loadKit() {
  if (cache.loaded) return cache.kit
  cache.loaded = true
  for (const candidate of CANDIDATES) {
    try {
      const url = new URL(candidate, import.meta.url)
      cache.kit = parseKit(JSON.parse(readFileSync(fileURLToPath(url), 'utf8')))
      if (cache.kit !== undefined) return cache.kit
    } catch {
      // 下一个候选路径
    }
  }
  cache.kit = undefined
  return undefined
}

/**
 * 按累计时长确定性选帧 —— 与墙钟无关，掉帧/卡顿后自动追上，
 * 多次渲染同一时刻得到同一帧（React 严格模式下安全）。
 * @param {{frames: {dur: number}[], totalMs: number}} anim
 * @param {number} elapsedMs
 */
export function frameAt(anim, elapsedMs, speed = 1) {
  // speed 是"每帧停留时长"的倍率：2 = 每帧停两倍久，整轮也就慢一倍。
  // 实现上把 elapsed 除以 speed 即可 —— 时间"走得更慢"，选帧逻辑不用动。
  const total = anim.totalMs
  if (!(total > 0)) return 0
  const scale = Number.isFinite(speed) && speed > 0 ? speed : 1
  let t = (elapsedMs / scale) % total
  if (t < 0) t += total
  for (let i = 0; i < anim.frames.length; i++) {
    t -= anim.frames[i].dur
    if (t < 0) return i
  }
  return anim.frames.length - 1
}
