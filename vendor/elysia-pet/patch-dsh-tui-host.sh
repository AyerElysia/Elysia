#!/usr/bin/env bash
# Linux 版 dsh-tui 宿主补丁（等价于 Windows 的 patch-dsh-tui-host.ps1）
#
# 两处补丁：
#   A) SplashMascot.js —— 启动页吉祥物白名单改查 resolveCompanionSkin
#   B) plugin.js      —— 首帧前预注册插件皮肤（必须插在 render 之前）
#
# dsh-tui 升级覆盖 node_modules 后，重跑本脚本。
set -euo pipefail

TUI_ROOT="${1:-}"
if [ -z "$TUI_ROOT" ]; then
  for c in \
    "${DSH_HOME:-}/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui" \
    "$HOME/Elysia/Elysium/Elysia-Harness/homes/tui/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui"; do
    [ -f "$c/lib/types/dsh-adapter/plugin.js" ] && { TUI_ROOT="$c"; break; }
  done
fi
[ -n "$TUI_ROOT" ] || { echo "找不到 dsh-tui 包根，请作为第一个参数传入"; exit 1; }
echo "dsh-tui 包根：$TUI_ROOT"

SPLASH="$TUI_ROOT/lib/types/components/sidePanel/companion/SplashMascot.js"
PLUGIN="$TUI_ROOT/lib/types/dsh-adapter/plugin.js"
ENTRY="$TUI_ROOT/lib/types/dsh-adapter/host-entry.js"
BAK_DIR="$(dirname "$TUI_ROOT")/.dsh-tui-pet-patches"
BLOCK="$(dirname "$0")/plugin-patch-block.js"
mkdir -p "$BAK_DIR"

# ── 补丁 A ─────────────────────────────────────────────────────────────
if grep -q 'resolveCompanionSkin(id)' "$SPLASH"; then
  echo "  补丁 A：已打过"
else
  [ -f "$BAK_DIR/SplashMascot.orig" ] || cp "$SPLASH" "$BAK_DIR/SplashMascot.orig"
  python3 - "$SPLASH" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
imp = [l for l in s.split('\n') if 'skins.js' in l and l.lstrip().startswith('import')]
if imp and 'resolveCompanionSkin' not in imp[0]:
    l = imp[0]; k = l.rfind('}')
    if k > 0: s = s.replace(l, l[:k] + ', resolveCompanionSkin' + l[k:], 1)
old = "    const id = pinned ?? setting;\n    return id === 'deepy' || id === 'whaleGirl' ? id : undefined;\n"
new = ("    const id = pinned ?? setting;\n"
       "    if (id === 'deepy' || id === 'whaleGirl')\n"
       "        return id;\n"
       "    if (id !== undefined && id !== 'whale') {\n"
       "        const skin = resolveCompanionSkin(id);\n"
       "        if (skin !== undefined && skin.id === id)\n"
       "            return id;\n"
       "    }\n"
       "    return undefined;\n")
if old in s: s = s.replace(old, new, 1)
od = "children: skin === 'deepy' ? DeepySkin.render(input) : WhaleGirlSkin.render(input) }) }));"
nd = "children: resolveCompanionSkin(skin).render(input) }) }));"
if od in s: s = s.replace(od, nd, 1)
open(p, 'w', encoding='utf-8').write(s)
print("  补丁 A：已应用")
PYEOF
fi

# ── 补丁 B（plugin.js，render 之前）────────────────────────────────────
if grep -q '首帧前预注册 companion 皮肤' "$PLUGIN"; then
  echo "  补丁 B：已打过"
else
  [ -f "$BAK_DIR/plugin.orig" ] || cp "$PLUGIN" "$BAK_DIR/plugin.orig"
  python3 - "$PLUGIN" "$BLOCK" "$ENTRY" <<'PYEOF'
import sys
target, blockfile, entry = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(target, encoding='utf-8').read()
block = open(blockfile, encoding='utf-8').read()

# 先清掉 host-entry.js 里的旧位置残留
try:
    e = open(entry, encoding='utf-8').read()
    MARK = '首帧前预注册 companion 皮肤（插件补丁）'
    if MARK in e:
        st = e.find('    // ── ' + MARK)
        an = '    await slot.firstFrameFlushed?.();'
        en = e.find(an)
        if st >= 0 and en > st:
            open(entry, 'w', encoding='utf-8').write(e[:st] + e[en:])
            print("  补丁 B：已清除 host-entry.js 旧位置残留")
except FileNotFoundError:
    pass

anchor = '    const tree = buildTree();'
if anchor not in s:
    print("  补丁 B：找不到 buildTree 锚点，跳过"); sys.exit(0)
s = s.replace(anchor, block + anchor, 1)
open(target, 'w', encoding='utf-8').write(s)
print("  补丁 B：已插入 plugin.js（render 之前）")
PYEOF
fi

echo "完成。"
