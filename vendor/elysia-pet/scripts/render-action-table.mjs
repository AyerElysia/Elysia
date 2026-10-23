
import sharp from 'file:///E:/dsh-profiles/_core/node_modules/sharp/dist/index.mjs'
import { readFileSync } from 'node:fs'

const kit = JSON.parse(readFileSync('E:/dsh-dev/dsh-tui-elysia-pet/assets/letters.json', 'utf8'))
const rgb = (hex) => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
const PAL = {}
for (const [ch, hex] of Object.entries(kit.palette)) PAL[ch] = rgb(hex)
const GW = kit.size[0], GH = kit.size[1]

// 帧间差异（不同的格子数）
function diff(a, b) {
  let d = 0
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (a[y][x] !== b[y][x]) d++
  return d
}

// 最远点采样：先取彼此差异最大的一对，再逐步加入"离已选集合最远"的帧
function distinctFrames(anim, k = 4) {
  const n = anim.frames.length
  const rows = anim.frames.map(f => f.rows)
  if (n <= k) return rows.map((_, i) => i)
  // 找最远的一对
  let bi = 0, bj = 1, bd = -1
  for (let i = 0; i < n; i++) for (let j = i+1; j < n; j++) {
    const d = diff(rows[i], rows[j])
    if (d > bd) { bd = d; bi = i; bj = j }
  }
  const sel = [bi, bj]
  while (sel.length < k) {
    let best = -1, bestScore = -1
    for (let i = 0; i < n; i++) {
      if (sel.includes(i)) continue
      let score = Infinity
      for (const s of sel) score = Math.min(score, diff(rows[i], rows[s]))
      if (score > bestScore) { bestScore = score; best = i }
    }
    sel.push(best)
  }
  return sel.sort((a,b) => a-b)   // 按帧号排序，播放顺序才直观
}

// 生成帧条带
async function strip(anim, indices, scale) {
  const n = indices.length, gap = 2
  const W = n * GW + (n - 1) * gap
  const buf = Buffer.alloc(W * GH * 4)
  for (let i = 0; i < n; i++) {
    const rows = anim.frames[indices[i]].rows
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const ch = rows[y][x]
      if (ch === '.') continue
      const c = PAL[ch]
      if (c === undefined) continue
      const q = (y * W + i * (GW + gap) + x) * 4
      buf[q] = c[0]; buf[q+1] = c[1]; buf[q+2] = c[2]; buf[q+3] = 255
    }
  }
  return sharp(buf, { raw: { width: W, height: GH, channels: 4 } })
    .resize(W * scale, GH * scale, { kernel: 'nearest' }).png().toBuffer()
}

const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

// 宿主语义 → 我的键 的反查
const REACH = {
  idle: 'idle', 'idle-look': 'look / default / notice→idle-spout', 'idle-spout': 'notice',
  thinking: 'thinking / compacting', typing: 'typing', building: 'building / music / 并发工具>=2',
  conducting: 'conducting / music(有子代理)', error: 'error', happy: 'happy / success',
  'happy-2': 'happy（随机变体）', notification: 'notification / warning', sleeping: 'sleeping',
  waking: 'waking', drag: 'drag', tickle: 'tickle', poke: 'poke-left / poke-right',
  swim: 'carrying', 'smile-hearts': '（仅开屏 poke）', bonus: '（无）',
}
const INFO = {
  idle:        ['待机（常态）', '空闲', '★ 与 waking 内容完全相同（源文件字节一致）'],
  'idle-look': ['待机 · 张望', '指针在面板内移动；无色通知（含复制）', '★ 与 idle-spout 内容完全相同'],
  'idle-spout':['待机 · 喷水', '指针碰到宠物本体', '★ 与 idle-look 内容完全相同'],
  thinking:    ['思考中', '模型推理中；上下文压缩', '头顶的气泡是"思考"符号，已逐帧补好'],
  typing:      ['敲代码', '模型输出正文中', ''],
  building:    ['同时跑两个及以上工具', '3+ 会话；或并发工具 >= 2', '★ 与 bonus 内容完全相同'],
  conducting:  ['分身（子代理）', '>= 2 子代理；或 1 子代理', '来自 .ani（Windows 动画光标格式）'],
  error:       ['出错啦', '回合失败；有失败的子代理/后台任务', '带禁止标志'],
  happy:       ['任务完成 · 爱心', '回合完成庆祝', '★ 与 poke / tickle 内容完全相同'],
  'happy-2':   ['任务完成 · 张嘴', '同上，随机二选一', '每次庆祝和上面那张随机挑一个'],
  notification:['需要你确认', '等待批准 / 提问；警告通知', '带"..."对话框'],
  sleeping:    ['呼呼大睡', '60 秒无输入', '带 Z 字睡眠符号'],
  waking:      ['被吵醒', '睡眠中来信号 / 移动鼠标', '★ 与 idle 内容完全相同'],
  drag:        ['被拎起来', '拖动宠物；开屏稳态', '★ 与 swim 内容完全相同'],
  tickle:      ['被挠痒痒', '900ms 内连点 >= 3 次', '★ 与 happy-2 内容完全相同'],
  poke:        ['戳（左/右）', '点击宠物左半或右半', '★ 与 happy 内容完全相同'],
  swim:        ['游来游去', '顶箱子（git 分支变更）', '★ 与 drag 内容完全相同'],
  'smile-hearts':['流泪  ⚠ 侧栏收不到', '只有开屏 poke 后才发', '语义对不上：poke 发的是"爱心"'],
  bonus:       ['生气  ⚠ 无人指向', '宿主没有任何语义映射到它', '★ 与 building 内容完全相同'],
}

const SCALE = 3, ROW_H = 158, PAD = 22, HDR_H = 112
const STRIP_W = (4 * GW + 3 * 2) * SCALE
const LEFT_W = 205, STRIP_X = LEFT_W + PAD + 30
const RIGHT_X = STRIP_X + STRIP_W + 26
const TOTAL_W = RIGHT_X + 340
const keys = Object.keys(kit.animations).sort()
const TOTAL_H = PAD + HDR_H + keys.length * ROW_H + PAD

let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${TOTAL_W}" height="${TOTAL_H}">
<rect width="${TOTAL_W}" height="${TOTAL_H}" fill="#fcfbfd"/>
<text x="${PAD}" y="44" font-family="Microsoft YaHei, sans-serif" font-size="28" font-weight="bold" fill="#2a1f2e">爱莉桌宠 · 动作对应表</text>
<text x="${PAD}" y="70" font-family="Microsoft YaHei, sans-serif" font-size="13" fill="#8a7f8e">每行 4 帧 = 该动画中差异最大的 4 帧（最远点采样），按播放顺序排列</text>
<text x="${PAD}" y="90" font-family="Microsoft YaHei, sans-serif" font-size="12.5" fill="#b0486a">★ = 内容与其他动画完全相同（源 GIF 字节一致，是故意的重复）</text>
<line x1="${PAD}" y1="${PAD + HDR_H - 16}" x2="${TOTAL_W - PAD}" y2="${PAD + HDR_H - 16}" stroke="#e5dde9"/>`

for (let i = 0; i < keys.length; i++) {
  const k = keys[i], a = kit.animations[k]
  const info = INFO[k] ?? ['', '', '']
  const idxs = distinctFrames(a, 4)
  const y = PAD + HDR_H + i * ROW_H
  const b64 = (await strip(a, idxs, SCALE)).toString('base64')

  if (i % 2 === 1) svg += `<rect x="0" y="${y}" width="${TOTAL_W}" height="${ROW_H}" fill="#f5f1f7"/>`

  // 左：键 + 中文名
  svg += `<text x="${PAD}" y="${y + 42}" font-family="Consolas, monospace" font-size="17" font-weight="bold" fill="#3b2f40">${esc(k)}</text>`
  svg += `<text x="${PAD}" y="${y + 68}" font-family="Microsoft YaHei, sans-serif" font-size="14.5" fill="#6f5578">${esc(info[0])}</text>`
  // 中：帧条
  svg += `<rect x="${STRIP_X - 5}" y="${y + 22}" width="${STRIP_W + 10}" height="${GH*SCALE + 12}" rx="6" fill="#fff" stroke="#e9e1ed"/>`
  svg += `<image x="${STRIP_X}" y="${y + 28}" width="${STRIP_W}" height="${GH*SCALE}" xlink:href="data:image/png;base64,${b64}"/>`
  svg += `<text x="${STRIP_X}" y="${y + GH*SCALE + 34}" font-family="Consolas, monospace" font-size="11.5" fill="#b3a6ba">${esc(a.title)}   ${a.frames.length}帧 × 80ms = ${a.frames.length*80}ms   ·   帧号 ${idxs.join(', ')}</text>`
  // 右：触发
  svg += `<text x="${RIGHT_X}" y="${y + 36}" font-family="Microsoft YaHei, sans-serif" font-size="14" fill="#463b4c">${esc(info[1])}</text>`
  svg += `<text x="${RIGHT_X}" y="${y + 60}" font-family="Consolas, monospace" font-size="11.5" fill="#9b8aa4">${esc(REACH[k] ?? '')}</text>`
  if (info[2]) svg += `<text x="${RIGHT_X}" y="${y + 88}" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#c2586f">${esc(info[2])}</text>`
  if (info[3]) svg += `<text x="${RIGHT_X}" y="${y + 110}" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="#8a7f8e">${esc(info[3])}</text>`
}
svg += '</svg>'

await sharp(Buffer.from(svg)).png().toFile('E:/dsh-dev/_动作对应表.png')
console.log('✅ 出图 ' + TOTAL_W + 'x' + TOTAL_H)
process.exit(0)
