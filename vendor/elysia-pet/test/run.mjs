#!/usr/bin/env node
/**
 * 无框架测试：直接跑断言，失败即退出码 1。
 *   node test/run.mjs
 */
import { loadKit, parseKit, frameAt } from '../lib/frames.js'
import { resolveConfig, DEFAULT_SKIN_ID } from '../lib/config.js'
import { createResolver } from '../lib/animations.js'

let pass = 0
let fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; return }
  fail++
  console.error('  ✗ ' + name + (extra === undefined ? '' : '  → ' + extra))
}
function eq(name, actual, expected) {
  ok(name, Object.is(actual, expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected))
}

console.log('frames.js')
const kit = loadKit()
ok('素材可加载', kit !== undefined)
if (kit === undefined) { console.error('素材缺失，后续测试跳过'); process.exit(1) }

// 透明必须归一成 undefined：宿主 renderCellRows 用 !== undefined 判定有没有
// 像素，null 会被当成实色并走进 fg(null) 抛 TypeError（曾导致整屏紫色团块）。
ok('调色板透明键为 undefined', kit.palette['.'] === undefined)
ok('调色板无 null 值', Object.values(kit.palette).every((v) => v === undefined || Array.isArray(v)))
ok('尺寸合理', kit.cols >= 8 && kit.rows >= 4, kit.cols + 'x' + kit.rows)
ok('至少一个动画', kit.animations.size > 0, String(kit.animations.size))
for (const [key, anim] of kit.animations) {
  ok('动画 ' + key + ' 行结构', anim.frames.every((f) => f.rows.length === kit.rows && f.rows.every((r) => r.length === kit.cols)))
  ok('动画 ' + key + ' 时长为正', anim.totalMs > 0, String(anim.totalMs))
  ok('动画 ' + key + ' 每帧 dur 为正', anim.frames.every((f) => f.dur > 0))
}
ok('校验拒绝 null', parseKit(null) === undefined)
ok('校验拒绝空对象', parseKit({}) === undefined)
ok('校验拒绝坏尺寸', parseKit({ size: [0, 0], palette: {}, animations: {} }) === undefined)
ok('校验拒绝坏颜色', parseKit({ size: [32, 16], palette: { A: 'red' }, animations: {} }) === undefined)
ok('校验拒绝零时长', parseKit({ size: [32, 16], palette: { A: '#aabbcc' }, animations: { x: { frames: [{ dur: 0, rows: Array(16).fill('A'.repeat(32)) }] } } }) === undefined)
ok('校验拒绝行数不符', parseKit({ size: [32, 16], palette: { A: '#aabbcc' }, animations: { x: { frames: [{ dur: 10, rows: Array(8).fill('A'.repeat(32)) }] } } }) === undefined)
ok('校验拒绝行宽不符', parseKit({ size: [32, 16], palette: { A: '#aabbcc' }, animations: { x: { frames: [{ dur: 10, rows: Array(16).fill('A'.repeat(20)) }] } } }) === undefined)

const anim0 = kit.animations.get('idle') ?? [...kit.animations.values()][0]
eq('frameAt(0) = 0', frameAt(anim0, 0), 0)
eq('frameAt 整轮回绕', frameAt(anim0, anim0.totalMs), 0)
ok('frameAt 负值安全', frameAt(anim0, -100) >= 0)
const mid = frameAt(anim0, anim0.totalMs / 2)
ok('frameAt 中点在范围内', mid >= 0 && mid < anim0.frames.length, String(mid))
ok('frameAt 巨大值不越界', frameAt(anim0, 1e12) < anim0.frames.length)

console.log('config.js')
const d = resolveConfig(undefined)
eq('默认 skinId', d.skinId, DEFAULT_SKIN_ID)
eq('默认 title（非中文界面显示）', d.title, 'Elysia')
  eq('默认 description（中文界面显示）', d.description, '爱莉')
// activateOnLoad 默认 true —— 见 config.js 的说明：宿主 applyCompanionSkin
  // 会把不认识的白名单外 id 静默回落到 deepy，默认开启才能在任何加载顺序下自愈。
  eq('默认 activateOnLoad', d.activateOnLoad, true)
  eq('activateOnLoad 可显式关闭', resolveConfig({ activateOnLoad: false }).activateOnLoad, false)
eq('默认 idleAnimation', d.idleAnimation, 'idle')

eq('非法 skinId 回落', resolveConfig({ skinId: 'Bad Id!' }).skinId, DEFAULT_SKIN_ID)
eq('空字符串回落', resolveConfig({ skinId: '' }).skinId, DEFAULT_SKIN_ID)
eq('字符串 body 不炸', resolveConfig('nope').skinId, DEFAULT_SKIN_ID)
eq('数组 body 不炸', resolveConfig([1, 2]).skinId, DEFAULT_SKIN_ID)
eq('null 不炸', resolveConfig(null).skinId, DEFAULT_SKIN_ID)
eq('title 空串回落', resolveConfig({ title: '   ' }).title, 'Elysia')

console.log('animations.js')
const r = createResolver(kit.animations, d)
ok('resolve(idle) 有结果', r.resolve('idle') !== undefined)
const fallback = r.resolve('no-such-animation')
ok('未知键有兜底', fallback !== undefined)
ok('兜底落在素材内', kit.animations.has(fallback))
for (const mood of ['idle', 'working', 'thinking', 'sleeping', 'celebrate', 'error', 'unknown-mood']) {
  const k = r.forMood(mood, undefined, 0)
  ok('forMood(' + mood + ') 有效', k !== undefined && kit.animations.has(k), String(k))
}

// 待机轮换：不同 elapsed 应该给出不同变体（至少覆盖 2 个）
const seen = new Set()
for (let i = 0; i < 8; i++) seen.add(r.forMood('idle', undefined, i * 12000))
ok('待机池有多个变体', r.idlePool.length >= 2, String(r.idlePool.length))
ok('待机随 elapsed 轮换', seen.size >= 2, [...seen].join(','))
ok('轮换值都在素材内', [...seen].every((k) => kit.animations.has(k)))
ok('elapsed=0 用池首选', r.forMood('idle', undefined, 0) === r.idlePool[0])

// 边界：负数 elapsed 与巨大 elapsed 不得越界
ok('负 elapsed 安全', kit.animations.has(r.forMood('idle', undefined, -5000)))
ok('巨大 elapsed 安全', kit.animations.has(r.forMood('idle', undefined, 1e12)))
for (const semantic of ['thinking', 'working', 'typing', 'no-such-semantic']) {
  const k = r.forMood('idle', semantic, 0)
  ok('forMood(idle, ' + semantic + ') 有效', k !== undefined && kit.animations.has(k), String(k))
}
const r2 = createResolver(kit.animations, resolveConfig({ idleAnimation: 'missing-key' }))
ok('配置指向缺失键仍可解析', r2.resolve('idle') !== undefined)
ok('配置指向缺失键时 forMood 不返回空', r2.forMood('idle', undefined, 0) !== undefined)

console.log('素材完整性')
// 这 13 个 GIF 的分析结论：内容是 32x32 像素画（每格 10px），半块渲染后
// 输出 32 列 x 16 行。尺寸变了说明构建脚本的网格推算被改坏了。
eq('网格宽 32', kit.cols, 32)
eq('网格高 32', kit.rows, 32)
ok('动画数 >= 13', kit.animations.size >= 13, String(kit.animations.size))
ok('有明显不同的表情（thinking/error/happy）', ['thinking', 'error', 'happy'].every((k) => kit.animations.has(k)))
ok('每帧时长都为正', [...kit.animations.values()].every((a) => a.frames.every((f) => f.dur > 0)))

console.log('动作覆盖与续播')
// ── 1. 宿主**每一个**可能发出的事件都必须有动画落点 ──────────────────
//
// 这张清单是宿主侧的完整枚举（deepy.js 的语义表 + 通知 reaction + 悬停 +
// idle 轮换池）。曾经漏掉 carrying / compacting：构建脚本把它们改名成了
// swim / thinking（KEY_FALLBACK），运行时别名表却没有它们 → 静默落 idle。
// 用户就是从"有些动作比如复制，没有绑定动画"发现的。
{
  const deepy = await import('file:///E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/components/sidePanel/companion/deepy.js')
  const { createResolver } = await import('../lib/animations.js')
  const { resolveConfig } = await import('../lib/config.js')
  const resol = createResolver(kit.animations, resolveConfig({}))

  const HOST_EVENTS = [
    'idle', 'sleeping', 'thinking', 'typing', 'notification', 'error', 'happy',
    'music', 'conducting', 'building', 'compacting', 'carrying',
    'waking', 'poke-left', 'poke-right', 'tickle', 'drag',
    'default', 'warning', 'success', 'look', 'notice',
    'idle-look', 'idle-spout', 'swim',
  ]
  const missing = []
  for (const ev of HOST_EVENTS) {
    const received = deepy.deepyAnimationFor(ev)
    const landed = resol.forMood('idle', received, 0, 0)
    if (!kit.animations.has(landed)) missing.push(ev + '→' + received + '→' + landed)
  }
  ok('宿主所有事件都有动画落点', missing.length === 0, missing.join(', '))

  // 单独锁住曾经丢掉的两个
  ok('carrying 有落点（顶箱子）', kit.animations.has(resol.forMood('idle', 'carrying', 0, 0)),
    String(resol.forMood('idle', 'carrying', 0, 0)))
  ok('compacting 有落点（压缩上下文）', kit.animations.has(resol.forMood('idle', 'compacting', 0, 0)),
    String(resol.forMood('idle', 'compacting', 0, 0)))
  // music 的**兜底**别名（拿不到 channel 时用）。
  //
  // 这条断言的期望值改过一次：最初是 conducting（为了"只开 1 个子代理就看到
  // 分身"），但那会让任何 sessions=2 的场景都显示分身，用户看到"调用两个以上
  // 工具却在放子代理动画"。现在主路径由 skin.js 的 withDisambiguation 读
  // channel 明细消歧，兜底改指 building —— 宁可偏向"并发干活"也不复现旧症状。
  ok('music 兜底落到 building（不是分身）',
    resol.forMood('idle', 'music', 0, 0) === 'building',
    String(resol.forMood('idle', 'music', 0, 0)))

  // 构建脚本的 KEY_FALLBACK 必须保持为空 —— 别名只留运行时一份，两处会打架
  const buildSrc = (await import('node:fs')).readFileSync(new URL('../scripts/build-frames.mjs', import.meta.url), 'utf8')
  const kf = /const KEY_FALLBACK = \{([\s\S]*?)\n\}/.exec(buildSrc)
  const body = kf === null ? '' : kf[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').trim()
  ok('构建期别名表为空（单一真相）', body === '', body.slice(0, 60))
}

// ── 2. 互动"原速播 N 轮"：延长停留，不压缩节奏 ────────────────────────
{
  const { createSkin, setHostDeps } = await import('../lib/skin.js')
  const { createResolver } = await import('../lib/animations.js')
  const { resolveConfig } = await import('../lib/config.js')
  const { pathToFileURL } = await import('node:url')
  const { join } = await import('node:path')
  const types = 'E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types'
  const React = (await import('file:///E:/dsh-profiles/_core/node_modules/react/index.js')).default
  const ui = await import(pathToFileURL(join(types, 'ui.js')).href)
  const whale = await import(pathToFileURL(join(types, 'components', 'Whale.js')).href)
  setHostDeps({ Box: ui.Box, Text: ui.Text, Image: ui.Image, renderSpriteRows: whale.renderSpriteRows, useTerminalImages: () => false, useTerminalImageProtocol: () => 'none' })

  const config = resolveConfig({})
  const skin = createSkin({ React, kit, resolver: createResolver(kit.animations, config), config })
  const W = kit.cols
  const call = (since, now, sem) => {
    const r = skin.__pickForTest({ pose: { mood: 'idle', heart: false }, moodSince: since, now, width: W, animationSemantic: sem })
    return r === undefined ? undefined : r
  }

  const t0 = 1_700_000_000_000
  const tickleTotal = kit.animations.get('tickle').totalMs

  // 宿主窗口只有 900ms，但我们应把 tickle 续到 2 轮（1920ms）
  let held = 0
  const frames = []
  for (let t = 0; t <= 2400; t += 80) {
    const inWindow = t < 900
    const r = call(inWindow ? t0 : t0 + 900, t0 + t, inWindow ? 'tickle' : 'idle')
    if (r !== undefined && r.key === 'tickle') { held += 80; frames.push(r.index) }
  }
  ok('tickle 续播到约 2 轮时长', Math.abs(held - tickleTotal * 2) <= 240, held + 'ms vs ' + tickleTotal * 2 + 'ms')
  // 帧号必须推进并回绕 —— 证明是"原速播两轮"而不是"卡在第 0 帧"
  ok('续播期间帧号在推进', new Set(frames).size > 3, new Set(frames).size + ' 个不同帧')
  let wrapped = false
  for (let i = 1; i < frames.length; i++) if (frames[i] < frames[i - 1]) wrapped = true
  ok('续播期间发生了回绕（真的播了第二轮）', wrapped, frames.join(','))

  // 其他互动必须能立刻打断续播
  {
    const s2 = createSkin({ React, kit, resolver: createResolver(kit.animations, config), config })
    const c2 = (since, now, sem) => {
      const r = s2.__pickForTest({ pose: { mood: 'idle', heart: false }, moodSince: since, now, width: W, animationSemantic: sem })
      return r === undefined ? undefined : r.key
    }
    c2(t0, t0, 'tickle')
    ok('续播可被 poke 打断', c2(t0 + 200, t0 + 200, 'poke-left') === 'poke')
    const s3 = createSkin({ React, kit, resolver: createResolver(kit.animations, config), config })
    const c3 = (since, now, sem) => {
      const r = s3.__pickForTest({ pose: { mood: 'idle', heart: false }, moodSince: since, now, width: W, animationSemantic: sem })
      return r === undefined ? undefined : r.key
    }
    c3(t0, t0, 'tickle')
    ok('续播可被 drag 打断', c3(t0 + 200, t0 + 200, 'drag') === 'drag')
  }
}

console.log('music 消歧')
// 宿主的 music 语义**同时代表两类场景**（mood.js 的 deriveCompanionContext）：
//   a) runningSubagents >= 1                     → 用户要「分身」
//   b) sessions >= 2 且无子代理（如 1 个后台任务） → 用户要「同时跑两个及以上工具」
// 宿主只发语义名，所以皮肤读实时 channel 的 subagents 明细来分。
//
// 回归背景：曾把 music 一刀切映射到 conducting，导致**任何 sessions=2 的场景
// 都显示分身** —— 用户看到「调用两个以上工具却在放子代理动画」。
{
  const { createSkin, setHostDeps } = await import('../lib/skin.js')
  const { createResolver } = await import('../lib/animations.js')
  const { resolveConfig } = await import('../lib/config.js')
  const { pathToFileURL } = await import('node:url')
  const { join } = await import('node:path')
  const types = 'E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types'
  const React = (await import('file:///E:/dsh-profiles/_core/node_modules/react/index.js')).default
  const ui = await import(pathToFileURL(join(types, 'ui.js')).href)
  const whale = await import(pathToFileURL(join(types, 'components', 'Whale.js')).href)

  const mk = () => {
    const config = resolveConfig({})
    return createSkin({ React, kit, resolver: createResolver(kit.animations, config), config })
  }
  // 直接走测试缝（支持传 channel）
  const at = (channel, sem = 'music') => {
    const r = mk().__pickForTest(
      { pose: { mood: 'idle', heart: false }, moodSince: 0, now: 0, width: kit.cols, animationSemantic: sem },
      channel,
    )
    return r === undefined ? undefined : r.key
  }

  const running = [{ status: 'running' }]
  const done = [{ status: 'done' }]
  const job = [{ status: 'running' }]

  // (a) 有子代理 → 分身
  ok('1 个子代理 → 分身', at({ subagents: running, backgroundJobs: [] }) === 'conducting', String(at({ subagents: running, backgroundJobs: [] })))
  ok('2 个子代理 → 分身', at({ subagents: [running[0], running[0]], backgroundJobs: [] }) === 'conducting')
  ok('子代理 starting 也算在跑', at({ subagents: [{ status: 'starting' }], backgroundJobs: [] }) === 'conducting')

  // (b) 无子代理（纯后台任务等）→ 同时跑两个及以上工具
  const b1 = at({ subagents: [], backgroundJobs: [job[0]] })
  ok('1 个后台任务（无子代理）→ 同时跑工具', b1 === 'building', String(b1))
  const b2 = at({ subagents: [], backgroundJobs: [job[0], job[0]] })
  ok('2 个后台任务（无子代理）→ 同时跑工具', b2 === 'building', String(b2))
  const b3 = at({ subagents: [done[0]], backgroundJobs: [job[0]] })
  ok('子代理已结束 + 后台任务 → 同时跑工具', b3 === 'building', String(b3))

  // 这条最关键：music 的兜底别名**不能**是 conducting，否则拿不到 channel 时
  // 会复现"调用两个以上工具却在放分身"的旧症状。
  {
    const { createResolver } = await import('../lib/animations.js')
    const { resolveConfig } = await import('../lib/config.js')
    const resol = createResolver(kit.animations, resolveConfig({}))
    ok('music 的兜底别名不是分身', resol.forMood('idle', 'music', 0, 0) !== 'conducting',
      String(resol.forMood('idle', 'music', 0, 0)))
  }

  // 其他语义不受消歧影响
  for (const sem of ['idle', 'typing', 'building', 'conducting']) {
    ok(sem + ' 不受消歧影响', at({ subagents: running, backgroundJobs: [] }, sem) === sem,
      String(at({ subagents: running, backgroundJobs: [] }, sem)))
  }

  // channel 缺失时安全（开屏路径不在 PanelHost 下，hook 会抛错）
  ok('channel 为 undefined 时不抛错', at(undefined) !== undefined, String(at(undefined)))

  // 消歧要一路传到字母轨：RasterSkin 回退 LetterSkin 时必须传消歧后的 input
  {
    const src = (await import('node:fs')).readFileSync(new URL('../lib/skin.js', import.meta.url), 'utf8')
    ok('消歧结果传给字母轨', /React\.createElement\(LetterSkin, resolved\)/.test(src))
    ok('channel hook 有 try/catch 兜底', /function safeChannel/.test(src) && /catch \{/.test(src))
  }
}

console.log('并发工具检测')
// 宿主**从不读** channel.activeToolCount（CompanionPanel 的 deriveCompanionContext
// 只看 working/subagents/backgroundJobs/compaction），所以「同一回合并发调 2 个以上
// 工具」在宿主眼里只是普通的 typing。皮肤补上这条。
{
  const { createSkin, setHostDeps } = await import('../lib/skin.js')
  const { createResolver } = await import('../lib/animations.js')
  const { resolveConfig } = await import('../lib/config.js')
  const { pathToFileURL } = await import('node:url')
  const { join } = await import('node:path')
  const types = 'E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types'
  const React = (await import('file:///E:/dsh-profiles/_core/node_modules/react/index.js')).default
  const ui = await import(pathToFileURL(join(types, 'ui.js')).href)
  const whale = await import(pathToFileURL(join(types, 'components', 'Whale.js')).href)
  setHostDeps({ Box: ui.Box, Text: ui.Text, Image: ui.Image, renderSpriteRows: whale.renderSpriteRows, useTerminalImages: () => false, useTerminalImageProtocol: () => 'none' })

  const config = resolveConfig({})
  const at = (sem, ch) => {
    const s = createSkin({ React, kit, resolver: createResolver(kit.animations, config), config })
    const r = s.__pickForTest({ pose: { mood: 'idle', heart: false }, moodSince: 0, now: 0, width: kit.cols, animationSemantic: sem }, ch)
    return r === undefined ? undefined : r.key
  }

  // 1 个工具仍是敲代码，2 个以上才换
  ok('typing + 1 个工具仍是 typing', at('typing', { activeToolCount: 1 }) === 'typing', String(at('typing', { activeToolCount: 1 })))
  ok('typing + 2 个工具 → 同时跑工具', at('typing', { activeToolCount: 2 }) === 'building', String(at('typing', { activeToolCount: 2 })))
  ok('typing + 5 个工具 → 同时跑工具', at('typing', { activeToolCount: 5 }) === 'building', String(at('typing', { activeToolCount: 5 })))
  // 不能误伤别的语义
  for (const sem of ['notification', 'error', 'idle', 'thinking', 'drag']) {
    ok(sem + ' 不受并发工具影响', at(sem, { activeToolCount: 9 }) === sem, String(at(sem, { activeToolCount: 9 })))
  }
  ok('无 channel 时 typing 正常', at('typing', undefined) === 'typing')
}

console.log('睡觉节拍')
// 宿主为省电在睡觉时把面板重渲染压到 1000ms 一次：
//   const tickMs = display.semantic === 'sleeping' && 无覆盖 && 无悬停
//     ? TICK_MS_SLEEPING (1000) : TICK_MS (160)
// 而 render 收到的 now 来自 useAnimationFrame(1000) —— 它自己节流到 1000ms。
// 所以皮肤每秒只被调用一次，**1 fps 是硬上限**。
//
// 素材是 12 帧 × 80ms（12.5 fps），若按 frameAt 原速选帧，每 tick 会跨
// 12.5 帧 —— 表现成"一格一格地跳"（用户反馈的"睡觉帧数好低"）。
// 修法：睡觉直接按 tick 数选帧，每 tick 前进一帧。
{
  const { createSkin, setHostDeps } = await import('../lib/skin.js')
  const { createResolver } = await import('../lib/animations.js')
  const { resolveConfig } = await import('../lib/config.js')
  const { pathToFileURL } = await import('node:url')
  const { join } = await import('node:path')
  const types = 'E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types'
  const React = (await import('file:///E:/dsh-profiles/_core/node_modules/react/index.js')).default
  const ui = await import(pathToFileURL(join(types, 'ui.js')).href)
  const whale = await import(pathToFileURL(join(types, 'components', 'Whale.js')).href)
  setHostDeps({ Box: ui.Box, Text: ui.Text, Image: ui.Image, renderSpriteRows: whale.renderSpriteRows, useTerminalImages: () => false, useTerminalImageProtocol: () => 'none' })

  const config = resolveConfig({})
  const s = createSkin({ React, kit, resolver: createResolver(kit.animations, config), config })
  const n = kit.animations.get('sleeping').frames.length
  const T0 = 1_700_000_000_000
  const frameAtTick = (t) => {
    const r = s.__pickForTest({ pose: { mood: 'idle', heart: false }, moodSince: T0, now: T0 + t * 1000, width: kit.cols, animationSemantic: 'sleeping' }, null)
    return r === undefined ? undefined : r.index
  }

  // 每 tick 前进一帧，且完整覆盖所有帧
  const seq = Array.from({ length: n + 1 }, (_, t) => frameAtTick(t))
  const expected = Array.from({ length: n + 1 }, (_, t) => t % n)
  ok('睡觉每 tick 前进一帧', seq.join(',') === expected.join(','), seq.join(','))
  ok('睡觉覆盖全部帧（没有跳帧）', new Set(seq).size === n, new Set(seq).size + '/' + n)
  ok('睡觉一轮 = 帧数秒', frameAtTick(n) === frameAtTick(0), String(frameAtTick(n)))

  // 对照：其他语义仍走 frameAt（240ms 时约第 3 帧）
  for (const sem of ['idle', 'thinking', 'typing', 'tickle']) {
    const r = s.__pickForTest({ pose: { mood: 'idle', heart: false }, moodSince: T0, now: T0 + 240, width: kit.cols, animationSemantic: sem }, null)
    ok(sem + ' 仍按真实时间选帧', r !== undefined && r.index === 3, String(r && r.index))
  }
}

console.log('一次性动作')
// 宿主的 conducting 是**状态**（countRunningSubagents 数 starting/running，
// 只要子代理还在跑就一直成立），但素材「派出任意数量子代理」是**一次性动作**
// （派出去那一下）。两者语义不匹配：子代理跑两分钟，动画就播两分钟，看起来
// 像卡住、点什么都不换。
//
// 对照内置鲸娘：它的 conducting 素材叫「小鲸鱼分身」，本身就是状态，所以
// 一直播没问题。我们只有"派出"的动作图，所以在皮肤层做「播满 N 轮就让位」。
{
  const { createSkin, setHostDeps } = await import('../lib/skin.js')
  const { createResolver } = await import('../lib/animations.js')
  const { resolveConfig } = await import('../lib/config.js')
  const { pathToFileURL } = await import('node:url')
  const { join } = await import('node:path')
  const types = 'E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types'
  const React = (await import('file:///E:/dsh-profiles/_core/node_modules/react/index.js')).default
  const ui = await import(pathToFileURL(join(types, 'ui.js')).href)
  const whale = await import(pathToFileURL(join(types, 'components', 'Whale.js')).href)
  setHostDeps({ Box: ui.Box, Text: ui.Text, Image: ui.Image, renderSpriteRows: whale.renderSpriteRows, useTerminalImages: () => false, useTerminalImageProtocol: () => 'none' })

  const config = resolveConfig({})

  // 皮肤在"1 个子代理"场景实际收到的语义 —— 从宿主链路推导，不硬编码猜测
  const moodMod = await import('file:///E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/components/sidePanel/companion/mood.js')
  const deepyMod = await import('file:///E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/components/sidePanel/companion/deepy.js')
  const HOST_CTX = moodMod.deriveCompanionContext({ working: true, subagents: [{ status: 'running' }], backgroundJobs: [], compaction: undefined })
  const HOST_KEY_FOR_ONE_SUBAGENT = deepyMod.deepyAnimationFor(moodMod.resolveTargetSemantic('working', HOST_CTX))

  const s = createSkin({ React, kit, resolver: createResolver(kit.animations, config), config })
  const T0 = 1_700_000_000_000
  const at = (off, sem = HOST_KEY_FOR_ONE_SUBAGENT, since = T0, ch) => {
    const r = s.__pickForTest({ pose: { mood: 'working', heart: false }, moodSince: since, now: since + off, width: kit.cols, animationSemantic: sem }, ch)
    return r === undefined ? undefined : r.key
  }
  const ch = { activeToolCount: 0, subagents: [{ status: 'running' }], backgroundJobs: [], notifications: [] }
  const total = kit.animations.get('conducting').totalMs

  // ⚠️ 语义必须用**宿主实际发出的那个**，不能用消歧后的结果。
  //
  // 第一版这里传的是 'conducting'，测试全绿 —— 但宿主永远不发 conducting
  // 给"1 个子代理"的场景，它发的是 'music'。而当时一次性检查跑在消歧**之前**，
  // 查表查 'music' 查不到就跳过了，规则压根没生效。用户重启后仍然"分身一直播"
  // 就是这个原因。现在用真实值 + 真实 channel 复现整条链路。
  const musicCh = { activeToolCount: 0, subagents: [{ status: 'running' }], backgroundJobs: [], notifications: [] }

  ok('（前置）1 子代理时宿主发的是 music 而非 conducting',
    HOST_KEY_FOR_ONE_SUBAGENT === 'music', String(HOST_KEY_FOR_ONE_SUBAGENT))

  // 前两轮内保持分身
  ok('子代理派出后立刻播分身', at(0, HOST_KEY_FOR_ONE_SUBAGENT, T0, musicCh) === 'conducting',
    String(at(0, HOST_KEY_FOR_ONE_SUBAGENT, T0, musicCh)))
  ok('第 1 轮中段仍在播', at(Math.round(total * 0.6), HOST_KEY_FOR_ONE_SUBAGENT, T0, musicCh) === 'conducting')
  ok('第 2 轮中段仍在播', at(Math.round(total * 1.6), HOST_KEY_FOR_ONE_SUBAGENT, T0, musicCh) === 'conducting')

  // 两轮之后让位 —— 这是本次修复的核心
  ok('播满 2 轮后让位', at(total * 2 + 1, HOST_KEY_FOR_ONE_SUBAGENT, T0, musicCh) === 'typing',
    String(at(total * 2 + 1, HOST_KEY_FOR_ONE_SUBAGENT, T0, musicCh)))
  ok('30 秒后仍是让位状态（不会一直播）', at(30_000, HOST_KEY_FOR_ONE_SUBAGENT, T0, musicCh) === 'typing')
  ok('120 秒后仍是让位状态', at(120_000, HOST_KEY_FOR_ONE_SUBAGENT, T0, musicCh) === 'typing')

  // 换一批子代理（语义先离开再回来，超出宽限期）要重新播
  {
    const s2 = createSkin({ React, kit, resolver: createResolver(kit.animations, config), config })
    const call2 = (off, sem, since = T0) => {
      const r = s2.__pickForTest({ pose: { mood: 'working', heart: false }, moodSince: since, now: since + off, width: kit.cols, animationSemantic: sem }, musicCh)
      return r === undefined ? undefined : r.key
    }
    call2(0, HOST_KEY_FOR_ONE_SUBAGENT)
    // 先离开足够久（超过 ONE_SHOT_REGRACE_MS）
    call2(0, 'idle', T0 + 20_000)
    ok('新一批子代理会重新播', call2(10, HOST_KEY_FOR_ONE_SUBAGENT, T0 + 30_000) === 'conducting',
      String(call2(10, HOST_KEY_FOR_ONE_SUBAGENT, T0 + 30_000)))
  }

  // 短暂打断（通知抢占）不该重新计时
  {
    const s3 = createSkin({ React, kit, resolver: createResolver(kit.animations, config), config })
    const call3 = (off, sem, chx = musicCh) => {
      const r = s3.__pickForTest({ pose: { mood: 'working', heart: false }, moodSince: T0, now: T0 + off, width: kit.cols, animationSemantic: sem }, chx)
      return r === undefined ? undefined : r.key
    }
    call3(0, HOST_KEY_FOR_ONE_SUBAGENT)
    call3(1900, HOST_KEY_FOR_ONE_SUBAGENT)
    // 通知抢占（皮肤收到 idle + 有新通知）
    call3(2000, 'idle', { ...musicCh, notifications: [{ id: 1, text: 'x' }] })
    ok('短暂打断后回来不重新计时', call3(2100, HOST_KEY_FOR_ONE_SUBAGENT) === 'typing',
      String(call3(2100, HOST_KEY_FOR_ONE_SUBAGENT)))
  }

  // 不能误伤其他语义
  for (const sem of ['thinking', 'typing', 'building', 'error', 'happy', 'tickle', 'drag', 'sleeping', 'notification']) {
    ok(sem + ' 不受一次性规则影响', at(30_000, sem, T0, musicCh) === sem, String(at(30_000, sem, T0, musicCh)))
  }
}

console.log('宿主丢失语义的补偿')
// 宿主的 deepyAnimationFor 是 DEEPY_SEMANTIC_ANIMATION[s] ?? 'idle'，
// 而 idle-look / idle-spout / swim 三个键**不在那个表的键里**（只作为值出现），
// 于是它们统统被压成 'idle'。后果：
//   a) 待机轮换失效（DEEPY_IDLE_ROTATION 四个槽全变 idle）
//   b) 通知 default 档丢失（「复制」等 44 个无色文案 = 普通待机）
//   c) 悬停追踪 look / 碰到本体的 notice 全变 idle
// 皮肤在收到 idle 时按上下文把这些还原回来。
{
  const { createSkin, setHostDeps } = await import('../lib/skin.js')
  const { createResolver } = await import('../lib/animations.js')
  const { resolveConfig } = await import('../lib/config.js')
  const { pathToFileURL } = await import('node:url')
  const { join } = await import('node:path')
  const types = 'E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types'
  const React = (await import('file:///E:/dsh-profiles/_core/node_modules/react/index.js')).default
  const ui = await import(pathToFileURL(join(types, 'ui.js')).href)
  const whale = await import(pathToFileURL(join(types, 'components', 'Whale.js')).href)
  const deepy = await import('file:///E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/components/sidePanel/companion/deepy.js')
  const mood = await import('file:///E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types/components/sidePanel/companion/mood.js')
  setHostDeps({ Box: ui.Box, Text: ui.Text, Image: ui.Image, renderSpriteRows: whale.renderSpriteRows, useTerminalImages: () => false, useTerminalImageProtocol: () => 'none' })

  // 先确认这个 bug 真的存在（宿主行为，不是我们的假设）
  ok('宿主确实把 idle-look 压成 idle', deepy.deepyAnimationFor('idle-look') === 'idle', deepy.deepyAnimationFor('idle-look'))
  ok('宿主确实把 swim 压成 idle', deepy.deepyAnimationFor('swim') === 'idle', deepy.deepyAnimationFor('swim'))
  ok('待机池成员全部被压成 idle',
    deepy.DEEPY_IDLE_ROTATION.every((k) => deepy.deepyAnimationFor(k) === 'idle'),
    deepy.DEEPY_IDLE_ROTATION.map((k) => k + '→' + deepy.deepyAnimationFor(k)).join(','))

  const mk = (raw) => {
    const config = resolveConfig(raw)
    return createSkin({ React, kit, resolver: createResolver(kit.animations, config), config })
  }
  const call = (s, { now, since = 0, ch, sem = 'idle' }) => {
    const r = s.__pickForTest({ pose: { mood: 'idle', heart: false }, moodSince: since, now, width: kit.cols, animationSemantic: sem }, ch)
    return r === undefined ? undefined : r.key
  }
  const T0 = 1_700_000_000_000

  // ── 复刻宿主在 idle 期间的计算（含 animSince 的向前跳变）
  const hostIdle = (displaySince, now) => {
    const idx = mood.idleRotationIndex(displaySince, now, deepy.DEEPY_IDLE_ROTATION.length)
    const sem = deepy.DEEPY_IDLE_ROTATION[idx] ?? 'idle'
    const animSince = displaySince + Math.max(0, Math.floor((now - displaySince) / 8000)) * 8000
    return { animSince, animationKey: deepy.deepyAnimationFor(sem) }
  }

  // ── a) 默认不轮换：常态恒为 idle（用户要的「常态待机眨眼=东张西望」）
  {
    const s = mk({})
    const got = [0, 8000, 16000, 24000, 32000].map((off) => {
      const h = hostIdle(T0, T0 + off)
      return call(s, { now: T0 + off, since: h.animSince, ch: { notifications: [] }, sem: h.animationKey })
    })
    ok('默认常态恒定 idle（不被轮换稀释）', new Set(got).size === 1 && got[0] === 'idle', got.join(','))
  }

  // ── b) 开轮换后真的会换
  {
    const s = mk({ idleRotation: true })
    const got = [0, 8000, 16000, 24000, 32000].map((off) => {
      const h = hostIdle(T0, T0 + off)
      return call(s, { now: T0 + off, since: h.animSince, ch: { notifications: [] }, sem: h.animationKey })
    })
    ok('开启 idleRotation 后待机会轮换', new Set(got).size > 1, got.join(','))
  }

  // ── c) 通知 default 档：整个展示期都要保持，不能只闪一帧
  //
  // 这条最容易写错：上一版只在新通知到达那一帧返回 idle-look，之后 5 秒的
  // 展示期里又变回 idle —— 表现成"通知刚弹出就闪回待机"。
  {
    const s = mk({})
    const ch = { notifications: [{ id: 1, text: '已复制 42 个字符' }] }
    const at = (off) => call(s, { now: T0 + off, since: T0, ch })
    const held = [0, 500, 1000, 2000, 3000, 4000, 4900].map(at)
    ok('通知展示期内全程保持待机眨眼', held.every((k) => k === 'idle-look'), held.join(','))
    ok('通知过期后回到待机', at(5100) === 'idle', String(at(5100)))
    // 同一条通知重复渲染不该反复触发
    ok('同一条通知不重复触发', at(1000) === 'idle-look' && at(1000) === 'idle-look')
  }

  // ── d) 不能误伤别的语义
  {
    const s = mk({ idleRotation: true })
    for (const sem of ['thinking', 'typing', 'error', 'notification', 'happy', 'drag', 'tickle', 'sleeping', 'building', 'conducting']) {
      const got = call(s, { now: T0, ch: { notifications: [{ id: 99 }] }, sem })
      ok(sem + ' 不受补偿影响', got !== undefined && got !== 'idle-look', String(got))
    }
  }
}

console.log('开屏分流')
// 开屏（启动页吉祥物）与侧栏共用同一个皮肤对象，靠 **width** 区分：
// 侧栏传 skin.cells.columns（32），开屏传 SPLASH_MASCOT_COLUMNS（42）。
// 配置项 splashAnimation 只换开屏的**稳态**动画，且绝不能吃掉互动反应。
{
  const { createSkin, setHostDeps } = await import('../lib/skin.js')
  const { createResolver } = await import('../lib/animations.js')
  const { resolveConfig } = await import('../lib/config.js')
  const { pathToFileURL } = await import('node:url')
  const { join } = await import('node:path')
  const types = 'E:/dsh-profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui/lib/types'
  const React = (await import('file:///E:/dsh-profiles/_core/node_modules/react/index.js')).default
  const ui = await import(pathToFileURL(join(types, 'ui.js')).href)
  const whale = await import(pathToFileURL(join(types, 'components', 'Whale.js')).href)
  setHostDeps({ Box: ui.Box, Text: ui.Text, Image: ui.Image, renderSpriteRows: whale.renderSpriteRows, useTerminalImages: () => false, useTerminalImageProtocol: () => 'none' })

  const SIDE = kit.cols, SPLASH = 42
  const mk = (raw) => {
    const config = resolveConfig(raw)
    return createSkin({ React, kit, resolver: createResolver(kit.animations, config), config })
  }
  const pick = (s, w, sem, el = 0) => {
    const r = s.__pickForTest({ pose: { mood: 'idle', heart: false }, moodSince: 0, now: el, width: w, animationSemantic: sem })
    return r === undefined ? undefined : r.key
  }

  // 分流判据本身
  ok('侧栏宽 = 皮肤列数', SIDE === kit.cols, String(SIDE))
  ok('开屏宽与侧栏宽不同（分流判据成立）', SPLASH !== SIDE, SPLASH + ' vs ' + SIDE)

  // 默认：开屏跟随侧栏
  {
    const s = mk({})
    ok('默认开屏 = 侧栏待机', pick(s, SPLASH, 'idle') === pick(s, SIDE, 'idle'))
  }
  // 配了就用配置的
  {
    const s = mk({ splashAnimation: 'swim' })
    ok('开屏换成配置的键', pick(s, SPLASH, 'idle') === 'swim', String(pick(s, SPLASH, 'idle')))
    ok('侧栏不受影响', pick(s, SIDE, 'idle') === 'idle', String(pick(s, SIDE, 'idle')))
  }
  // 互动语义必须保留 —— 这是最容易被"开屏换动画"误伤的地方
  {
    const s = mk({ splashAnimation: 'swim' })
    ok('开屏 poke 仍是 poke', pick(s, SPLASH, 'poke-left') === 'poke')
    ok('开屏 tickle 仍是 tickle', pick(s, SPLASH, 'tickle') === 'tickle')
    ok('开屏 notification 仍是 notification', pick(s, SPLASH, 'notification') === 'notification')
    ok('开屏 happy 未被顶掉', ['happy', 'happy-2'].includes(pick(s, SPLASH, 'happy')), String(pick(s, SPLASH, 'happy')))
  }
  // 不存在的键安全回落
  {
    const s = mk({ splashAnimation: '根本没这个键' })
    ok('不存在的开屏键安全回落', pick(s, SPLASH, 'idle') === 'idle', String(pick(s, SPLASH, 'idle')))
  }
  // 宿主自己会算 idle 轮换索引并把 idle-look / idle-spout 当语义传下来，
  // 皮肤必须照做，不能二次轮换。
  {
    const s = mk({ splashAnimation: 'conducting' })
    ok('宿主传 idle-look 时照做', pick(s, SIDE, 'idle-look') === 'idle-look')
    ok('宿主传 idle-spout 时照做', pick(s, SIDE, 'idle-spout') === 'idle-spout')
    ok('开屏不做轮换、固定用配置键', pick(s, SPLASH, 'idle', 12000) === 'conducting')
  }
}

console.log('节奏与变体')
// 回归：两个庆祝动画（happy / happy-2）是**随机二选一**。
// 用户把两个文件都命名为「随机触发」——意图就是每次庆祝随机挑一个。
// 关键约束：选择必须由 moodSince 派生（确定性），不能用 Math.random() ——
// 宿主每帧都调 render，真随机会导致每帧换动画（闪烁）。
{
  const { createResolver } = await import('../lib/animations.js')
  const { resolveConfig } = await import('../lib/config.js')
  const resol = createResolver(kit.animations, resolveConfig({}))

  // 两个变体都存在
  ok('happy 变体存在', kit.animations.has('happy'))
  ok('happy-2 变体存在', kit.animations.has('happy-2'))

  // 不同 moodSince → 两个变体都出现（不能永远同一个）
  const picks = []
  const base = 1_700_000_000_000
  for (let i = 0; i < 12; i++) picks.push(resol.forMood('idle', 'happy', 0, base + i * 60_000))
  ok('庆祝变体会随机切换', new Set(picks).size === 2, picks.join(','))

  // 同一 moodSince 内恒定 —— 否则每帧渲染都换动画，画面会闪
  let stable = true
  const since = base
  let prev
  for (let el = 0; el < 3000; el += 80) {
    const k = resol.forMood('idle', 'happy', el, since)
    if (prev !== undefined && k !== prev) stable = false
    prev = k
  }
  ok('单次庆祝内动画恒定', stable)

  // 待机轮换仍由 elapsed 驱动（不能因为加种子把轮换搞坏）
  const idleSeq = [0, 12000, 24000, 36000].map((el) => resol.forMood('idle', undefined, el, 0))
  ok('待机仍会轮换', new Set(idleSeq).size > 1, idleSeq.join(','))

  // 节奏：**全部原速**（80ms/帧），不许有任何缩放。
  //
  // 这里曾经断言"tickle 在 900ms 窗口内可播 ≥2 轮" —— 那是把两轮**压缩**进
  // 固定窗口（432ms/轮），动作飞快。用户明确指出：
  //   "让你播放两轮不是让你在固定时间内播放两轮，你不延长成双倍时间的话会很快的"
  // 正确做法是保持原速、延长停留（见 skin.js 的 REPEAT_ROUNDS），所以现在
  // 断言的是"每个动画都是原速"。
  const perOf = (key) => {
    const a = kit.animations.get(key)
    return a.frames.reduce((s, f) => s + f.dur, 0) / a.frames.length
  }
  const baseline = perOf('idle')
  const offSpeed = []
  for (const [k] of kit.animations) {
    if (perOf(k) !== baseline) offSpeed.push(k + '(' + perOf(k) + 'ms)')
  }
  ok('全部动画都是原速 80ms/帧（无缩放）', offSpeed.length === 0, offSpeed.join(','))
  ok('tickle 未被加速', perOf('tickle') === baseline, perOf('tickle') + 'ms')
  ok('happy 未被加速', perOf('happy') === baseline, perOf('happy') + 'ms')

  // 帧率必须**统一**：除互动加速外，所有动画都该是源素材原速 80ms/帧。
  //
  // 教训：曾给 sleeping 加 1.6 倍放慢（想让它显得安稳），结果画面更新率
  // 掉到 7.8 fps，比待机的 12.5 fps 明显卡顿，用户一眼看出并要求统一。
  // 这里锁死「不许出现 > 1 的节奏倍率」。
  const perFrame = (key) => {
    const a = kit.animations.get(key)
    return a.frames.reduce((s, f) => s + f.dur, 0) / a.frames.length
  }
  const idlesPer = perFrame('idle')
  ok('睡觉节奏与待机一致', perFrame('sleeping') === idlesPer, perFrame('sleeping') + ' vs ' + idlesPer)
  ok('游动节奏与待机一致', perFrame('swim') === idlesPer, perFrame('swim') + ' vs ' + idlesPer)
  // 睡觉保留完整 12 帧（折叠成 6 帧也会让画面更新率减半）
  ok('睡觉保留完整帧数', kit.animations.get('sleeping').frames.length >= 12,
    kit.animations.get('sleeping').frames.length + ' 帧')
  // 没有任何动画比待机更慢（防回归：不许再加放慢）
  const slower = []
  for (const [k, a] of kit.animations) {
    const per = a.frames.reduce((s, f) => s + f.dur, 0) / a.frames.length
    if (per > idlesPer) slower.push(k + '(' + per + 'ms)')
  }
  ok('没有比待机更慢的动画', slower.length === 0, slower.join(','))
}

console.log('符号贴片')
// 回归：「思考中」和「生气」的源图头顶有一块**白底 + 三条深紫竖线**的符号
// 贴片。第一版只擦掉了三条线、没擦白底，结果留下一块纯白补丁 —— 用户看到的
// 是"脑袋被挖空了"。现在的做法是整块擦除（白底+线一起），再从其他动画的
// 同位置像素填充。
//
// 贴片专用色：白底 #f4f5f4、线条 #674669。这两个色在其余 16 个源 GIF 里
// 一次都不出现，所以是可靠的识别特征。
const kitJson = JSON.parse((await import('node:fs')).readFileSync(new URL('../assets/letters.json', import.meta.url), 'utf8'))
const isPatchHex = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (Math.abs(r - 244) < 5 && Math.abs(g - 245) < 5 && Math.abs(b - 244) < 5)
      || (Math.abs(r - 103) < 6 && Math.abs(g - 70) < 6 && Math.abs(b - 105) < 6)
}
// 逐帧统计：只要某帧里贴片色超过 60 格，就是"整块贴片还在"（散点量化
// artifact 每帧最多 3~4 格，区分度很大）
let worstFrame = 0
let worstKey = ''
for (const [key, anim] of Object.entries(kitJson.animations)) {
  for (const frame of anim.frames) {
    let n = 0
    for (const row of frame.rows) for (const ch of row) {
      if (ch === '.') continue
      if (isPatchHex(kitJson.palette[ch])) n++
    }
    if (n > worstFrame) { worstFrame = n; worstKey = key }
  }
}
ok('thinking 无残留贴片', worstFrame <= 60, worstKey + ' 单帧 ' + worstFrame + ' 格')
ok('帧包里没有整块白底贴片', worstFrame <= 60)
// 填充后不该出现"整片纯白"（那正是挖空的症状）：统计 thinking 里
// 贴片区内的白色像素占比
const think = kitJson.animations.thinking
let whiteish = 0
let zoneTotal = 0
for (const frame of think.frames) {
  for (let y = 10; y <= 22; y++) for (let x = 16; x <= 26; x++) {
    const ch = frame.rows[y][x]
    zoneTotal++
    if (ch === '.') continue
    const n = Number.parseInt(kitJson.palette[ch].slice(1), 16)
    if (((n >> 16) & 255) > 235 && ((n >> 8) & 255) > 235 && (n & 255) > 235) whiteish++
  }
}
ok('贴片区未被填成一片纯白', whiteish / zoneTotal < 0.5, (whiteish / zoneTotal * 100).toFixed(0) + '% 偏白')

console.log('渲染编码')
// 字母格轨必须与内置宠物走**完全相同**的路径：宿主 renderSpriteRows 的原始
// 输出直接交给 Text，不做任何后处理。
//
// 回归背景：曾经为了修"黑杠"把透明区填成主题面板色，结果宠物周围糊出一块
// 纯色矩形（更难看）且黑杠一条没少。真正原因是终端侧的
// adjustIndistinguishableColors（自动调整无法区分的文本亮度），与渲染无关。
// 所以这里要盯死："不许再加任何背景填充"。
const skinSrc = (await import('node:fs')).readFileSync(new URL('../lib/skin.js', import.meta.url), 'utf8')
const code = skinSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n')
ok('渲染走宿主 renderSpriteRows', code.includes('host.renderSpriteRows('))
ok('不替换 49m 背景码', !/split\('\\u001b\[49m'\)/.test(code))
ok('不注入主题色', !/getActiveTheme|toolCardBackground/.test(code))
ok('不给 Box 刷背景色', !/backgroundColor/.test(code))
ok('不用 OSC 11 的终端背景', !/useTerminalBackground/.test(code))
ok('不设 backfill 填充', !/backfill/.test(code))
ok('不设 terminalBg 填充', !/terminalBg/.test(code))
ok('不再自造半块编码器', !/function renderHalfBlockRows/.test(code))

console.log('模块完整性')
// 回归：曾经因为手工编辑漏掉 parseHex 的定义，渲染期抛 ReferenceError，被宿主
// 判定为「面板渲染出错」并隔离整个伙伴面板。这里静态扫描 skin.js，确保每个
// 被调用的本地函数都有定义 —— 这类错误语法检查查不出来。
// 先剥掉注释再扫描：文档里会举例提到宿主的 _jsx 等符号，不该算作"被调用"。
const rawSrc = (await import('node:fs')).readFileSync(new URL('../lib/skin.js', import.meta.url), 'utf8')
const src = rawSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1'))
  .join('\n')
const defined = new Set([
  [...src.matchAll(/^\s*(?:export\s+)?function\s+(\w+)/gm)].map((m) => m[1]),
  // 对象字面量的方法简写：`name(args) {` / `async name(args) {` / `get name() {`
  [...src.matchAll(/^\s*(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*\{/gm)].map((m) => m[1]),
].flat())
const called = new Set([...src.matchAll(/(?<![.\w])(\w+)\s*\(/g)].map((m) => m[1]))
const builtins = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'Number', 'String', 'Object', 'Array', 'Map', 'Set', 'Math', 'JSON', 'Promise', 'React', 'require', 'import', 'parseInt', 'parseFloat', 'isNaN', 'Boolean', 'Error', 'Symbol', 'RegExp', 'Date', 'preheat'])
// 对象字面量里的方法简写也算定义
const missing = [...called].filter((n) => !defined.has(n) && !builtins.has(n) && !new RegExp('(?:const|let|var|class)\\s+' + n + '\\b').test(src) && !new RegExp('(?:import|,)\\s*\\{?[^}\\n]*\\b' + n + '\\b').test(src))
ok('skin.js 无未定义符号', missing.length === 0, missing.join(','))

console.log('')
console.log(pass + ' 通过, ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
