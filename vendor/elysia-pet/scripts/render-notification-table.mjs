
import sharp from 'file:///E:/dsh-profiles/_core/node_modules/sharp/dist/index.mjs'
import { readFileSync } from 'node:fs'

const kit = JSON.parse(readFileSync('E:/dsh-dev/dsh-tui-elysia-pet/assets/letters.json', 'utf8'))
const notices = JSON.parse(readFileSync('E:/dsh-dev/_notices.json', 'utf8'))
const rgb = (hex) => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)]
const PAL = {}
for (const [ch, hex] of Object.entries(kit.palette)) PAL[ch] = rgb(hex)
const GW = kit.size[0], GH = kit.size[1]

async function framePng(key, idx, scale) {
  const a = kit.animations[key]
  const i = ((idx % a.frames.length) + a.frames.length) % a.frames.length
  const rows = a.frames[i].rows
  const buf = Buffer.alloc(GW * GH * 4)
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const ch = rows[y][x]
    if (ch === '.') continue
    const c = PAL[ch]; if (c === undefined) continue
    const q = (y * GW + x) * 4
    buf[q]=c[0]; buf[q+1]=c[1]; buf[q+2]=c[2]; buf[q+3]=255
  }
  return sharp(buf, { raw: { width: GW, height: GH, channels: 4 } })
    .resize(GW*scale, GH*scale, { kernel: 'nearest' }).png().toBuffer()
}

const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

const GROUPS = [
  ['error',     'error',        2, '出错啦',     '#c04040'],
  ['warning',   'notification', 1, '需要你确认', '#c08020'],
  ['success',   'happy',        7, '任务完成',   '#2f9e5a'],
  ['null',      'idle-look',    1, '待机眨眼',   '#6a7a8a'],
]
const TITLE = {
  error: 'color = error  →  动画 error（出错啦）',
  warning: 'color = warning  →  动画 notification（需要你确认）',
  success: 'color = success  →  动画 happy（任务完成，随机变体）',
  null: 'color = 无（default 档）  →  动画 idle-look（待机眨眼）',
}
const SUB = {
  error: '64 处调用 / 45 个文案。全是真正的失败：命令不存在、分叉失败、模型切换失败、回合出错……',
  warning: '65 处调用 / 50 个文案。注意：这档**大多是用法提示/参数错误**，不是"需要你确认"',
  success: '9 处调用 / 6 个文案',
  null: '56 处调用 / 44 个文案。**「复制」在这里**（copied-chars）',
}

const PAD = 26, SCALE = 3
const IMG_W = GW * SCALE, IMG_H = GH * SCALE
const ROW_H = 22, HDR_H = 30, GRP_GAP = 26
const LEFT_X = PAD, KEY_X = PAD, ZH_X = PAD + 250
const FILE_X = PAD + 620
const TXT_W = 1520

// 先算总高
let H = 132
for (const [k] of GROUPS) H += HDR_H + notices[k].length * ROW_H + GRP_GAP
H += 90
const W = PAD*2 + TXT_W

let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">
<rect width="${W}" height="${H}" fill="#fcfbfd"/>
<text x="${PAD}" y="46" font-family="Microsoft YaHei, sans-serif" font-size="27" font-weight="bold" fill="#2a1f2e">宿主通知文案 → 动画绑定清单</text>
<text x="${PAD}" y="76" font-family="Microsoft YaHei, sans-serif" font-size="14" fill="#6f5578">dsh-tui 里所有 channel.notify() 调用，按 color 分组。color 是宿主**唯一**用于挑选动画的信号</text>
<text x="${PAD}" y="100" font-family="Microsoft YaHei, sans-serif" font-size="13" fill="#b0486a">⚠ 共 145 个不同文案，但只有 4 个动画可选 —— 同色文案彼此完全无法区分</text>
<text x="${PAD}" y="122" font-family="Microsoft YaHei, sans-serif" font-size="13" fill="#8a7f8e">「复制」不是特例：它和另外 43 个文案共用 idle-look</text>
<line x1="${PAD}" y1="134" x2="${W-PAD}" y2="134" stroke="#e5dde9"/>`

let y = 152
for (const [k, animKey, frameIdx, animName, color] of GROUPS) {
  const list = notices[k]
  // 组头
  svg += `<rect x="${PAD}" y="${y}" width="${W-PAD*2}" height="${HDR_H}" rx="6" fill="${color}" opacity="0.13"/>`
  svg += `<text x="${PAD+12}" y="${y+21}" font-family="Microsoft YaHei, sans-serif" font-size="15.5" font-weight="bold" fill="${color}">${esc(TITLE[k])}</text>`
  svg += `<text x="${PAD+12}" y="${y+HDR_H+21}" font-family="Microsoft YaHei, sans-serif" font-size="12.5" fill="#8a7f8e">${esc(SUB[k])}</text>`
  // 该组的动画帧（放右边）
  const b64 = (await framePng(animKey, frameIdx, SCALE)).toString('base64')
  svg += `<image x="${W-PAD-IMG_W-8}" y="${y+4}" width="${IMG_W}" height="${IMG_H}" xlink:href="data:image/png;base64,${b64}"/>`
  svg += `<text x="${W-PAD-IMG_W-8}" y="${y+HDR_H+IMG_H+18}" font-family="Consolas, monospace" font-size="11.5" fill="${color}">${esc(animKey)}</text>`

  y += HDR_H + 40
  for (const it of list) {
    svg += `<text x="${KEY_X}" y="${y+15}" font-family="Consolas, monospace" font-size="12.5" fill="#3b2f40">${esc(it.key)}</text>`
    svg += `<text x="${ZH_X}" y="${y+15}" font-family="Microsoft YaHei, sans-serif" font-size="12.5" fill="#4a3f50">${esc(it.zh.slice(0, 46))}</text>`
    svg += `<text x="${FILE_X}" y="${y+15}" font-family="Consolas, monospace" font-size="11" fill="#b3a6ba">${esc(it.file)}</text>`
    if (it.key === 'copied-chars') {
      svg += `<rect x="${KEY_X-6}" y="${y+1}" width="${W-PAD-KEY_X+4}" height="${ROW_H-3}" rx="4" fill="#ffe08a" opacity="0.55"/>`
      svg += `<text x="${W-PAD-140}" y="${y+15}" font-family="Microsoft YaHei, sans-serif" font-size="12" font-weight="bold" fill="#9a6a00">← 你说的「复制」</text>`
    }
    y += ROW_H
  }
  y += GRP_GAP
}

// 页脚结论
svg += `<line x1="${PAD}" y1="${y-6}" x2="${W-PAD}" y2="${y-6}" stroke="#e5dde9"/>`
svg += `<text x="${PAD}" y="${y+24}" font-family="Microsoft YaHei, sans-serif" font-size="15" font-weight="bold" fill="#2a1f2e">结论</text>`
const FOOT = [
  '1. color 只有 4 档（error / warning / success / 无），但文案有 145 个 —— 宿主不按文案挑动画。',
  '2. warning 档名不副实：50 个文案里大多是「用法：/xxx」「输入为空」「剪贴板为空」这类参数提示，不是"需要你确认"。',
  '3. 「复制」(copied-chars) 在 default 档，与另外 43 个文案共用 idle-look —— 所以看不见专属动作。',
  '4. 想给某个文案专属动作：皮肤能读到 channel.notifications 的 text，可按文案匹配。但要按 i18n key 而不是渲染后的文本（切语言会失效）。',
]
FOOT.forEach((t, i) => {
  svg += `<text x="${PAD}" y="${y+52+i*23}" font-family="Microsoft YaHei, sans-serif" font-size="13" fill="#4a3f50">${esc(t)}</text>`
})
svg += '</svg>'

await sharp(Buffer.from(svg)).png().toFile('E:/dsh-dev/_通知绑定表.png')
console.log('✅ 出图 ' + W + 'x' + H)
process.exit(0)
