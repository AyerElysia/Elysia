<#
.SYNOPSIS
给 dsh-tui 宿主打插件皮肤补丁。

.DESCRIPTION
两处补丁，缺一不可：

  A) SplashMascot.js —— 启动页吉祥物白名单写死 'deepy' / 'whaleGirl'，
     插件皮肤进不去。改为查 resolveCompanionSkin 注册表。

  B) plugin.js       —— 首帧预注册插件皮肤。

     宿主的启动顺序是 host-entry.js 里：

         const slot = createEntrySlot(...)
         await apply(ctx, config, ...)        <- 首帧在 apply() 内部就 render 了
         await slot.firstFrameFlushed?.()
         await root.compose(...)              <- 插件到这才加载

     首帧渲染发生在 apply() 里 render(tree) 那一步（在 plugin.js），而插件行
     要等更后面的 root.compose() 才加载。所以补丁必须插在 apply() 内部、
     render() 之前；插在 host-entry 的 firstFrameFlushed 之前仍然太晚，
     那时首帧已经画出来了，会闪一帧内置宠物。

     applyCompanionSkin(x) 会过 normalizeCompanionSkin 白名单，白名单外直接
     回落到 deepy；resolveCompanionSkin(x) 对注册表外的 id 回落到 DeepySkin。
     所以必须先把皮肤注册进 skins Map 与白名单，再写 store。

dsh-tui 升级会覆盖 node_modules，两个补丁都会失效，重跑本脚本即可。
脚本按字符串锚点定位；宿主改了实现会明确报「找不到锚点」，不会写坏文件。

.PARAMETER Root
dsh-tui 包根。省略时按 profile 与常见安装位置自动探测。

.PARAMETER Check
只报告状态，不修改任何文件。

.PARAMETER Restore
从备份还原两个文件。

.EXAMPLE
pwsh -File patch-dsh-tui-host.ps1 -Check
pwsh -File patch-dsh-tui-host.ps1
pwsh -File patch-dsh-tui-host.ps1 -Restore
#>
[CmdletBinding()]
param(
    [string] $Root = '',
    [switch] $Check,
    [switch] $Restore
)

$ErrorActionPreference = 'Stop'

$SPLASH_MARKER = 'resolveCompanionSkin(id)'
$PLUGIN_MARKER = '首帧前预注册 companion 皮肤'
$BLOCK = Join-Path $PSScriptRoot 'plugin-patch-block.js'

function Resolve-TuiRoot {
    param([string] $Explicit)

    $candidates = @()
    if ($Explicit) { $candidates += $Explicit }

    if ($env:DSH_HOME) {
        $candidates += Join-Path $env:DSH_HOME 'profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui'
        $candidates += Join-Path $env:DSH_HOME 'profiles/_core/node_modules/@deepseek-harness-tui/dsh-tui'
    }
    $candidates += Join-Path $HOME '.dsh-tui-runtime/node_modules/@deepseek-harness-tui/dsh-tui'
    $candidates += 'E:\dsh-profiles\_core/node_modules/@deepseek-harness-tui/dsh-tui'
    $candidates += 'E:\nodejs\node_modules/@deepseek-harness-tui/dsh-tui'

    foreach ($c in $candidates) {
        if ($c -and (Test-Path (Join-Path $c 'lib/types/dsh-adapter/plugin.js'))) {
            return (Resolve-Path $c).Path
        }
    }
    return $null
}

$tuiRoot = Resolve-TuiRoot -Explicit $Root
if (-not $tuiRoot) {
    Write-Output '找不到 dsh-tui 包根，请用 -Root 指定'
    exit 1
}
Write-Output ('dsh-tui 包根：' + $tuiRoot)

$splash = Join-Path $tuiRoot 'lib/types/components/sidePanel/companion/SplashMascot.js'
$plugin = Join-Path $tuiRoot 'lib/types/dsh-adapter/plugin.js'
$entry  = Join-Path $tuiRoot 'lib/types/dsh-adapter/host-entry.js'
$bakDir = Join-Path (Split-Path $tuiRoot -Parent) '.dsh-tui-pet-patches'

foreach ($f in @($splash, $plugin)) {
    if (-not (Test-Path $f)) { Write-Output ('缺少文件：' + $f); exit 1 }
}

$splashDone = (Get-Content $splash -Raw).Contains($SPLASH_MARKER)
$pluginDone = (Get-Content $plugin -Raw).Contains($PLUGIN_MARKER)

if ($Check) {
    Write-Output ''
    Write-Output ('  补丁 A（启动页）：' + $(if ($splashDone) { '已打' } else { '未打' }))
    Write-Output ('  补丁 B（首帧）  ：' + $(if ($pluginDone) { '已打' } else { '未打' }))
    Write-Output ('  备份目录：' + $(if (Test-Path $bakDir) { $bakDir } else { '不存在' }))
    exit 0
}

if ($Restore) {
    if (-not (Test-Path $bakDir)) { Write-Output '没有备份可还原'; exit 1 }
    foreach ($pair in @(@('SplashMascot.orig', $splash), @('plugin.orig', $plugin))) {
        $src = Join-Path $bakDir $pair[0]
        if (Test-Path $src) {
            Copy-Item $src $pair[1] -Force
            Write-Output ('  已还原：' + (Split-Path $pair[1] -Leaf))
        }
    }
    exit 0
}

New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

# ── 补丁 A：SplashMascot.js ────────────────────────────────────────────────
if ($splashDone) {
    Write-Output '  补丁 A：已打过'
}
else {
    $bak = Join-Path $bakDir 'SplashMascot.orig'
    if (-not (Test-Path $bak)) { Copy-Item $splash $bak }

    $s = Get-Content $splash -Raw

    # import 里补上 resolveCompanionSkin
    $importLine = ($s -split "`n" | Where-Object { $_ -match 'skins\.js' -and $_ -match '^\s*import' } | Select-Object -First 1)
    if ($importLine -and $importLine -notmatch 'resolveCompanionSkin') {
        $close = $importLine.LastIndexOf('}')
        if ($close -gt 0) {
            $patched = $importLine.Insert($close, ', resolveCompanionSkin')
            $s = $s.Replace($importLine, $patched)
        }
    }

    # 白名单改查注册表
    $oldWhite = "    const id = pinned ?? setting;`r`n    return id === 'deepy' || id === 'whaleGirl' ? id : undefined;"
    $newWhite = "    const id = pinned ?? setting;`r`n    if (id === 'deepy' || id === 'whaleGirl')`r`n        return id;`r`n    if (id !== undefined && id !== 'whale') {`r`n        const skin = resolveCompanionSkin(id);`r`n        if (skin !== undefined && skin.id === id)`r`n            return id;`r`n    }`r`n    return undefined;"
    if ($s.Contains($oldWhite)) {
        $s = $s.Replace($oldWhite, $newWhite)
    }
    else {
        $oldLf = $oldWhite.Replace("`r`n", "`n")
        $newLf = $newWhite.Replace("`r`n", "`n")
        if ($s.Contains($oldLf)) { $s = $s.Replace($oldLf, $newLf) }
        else { Write-Output '  补丁 A：找不到白名单锚点，跳过' }
    }

    # 分发改查注册表
    $oldDispatch = "children: skin === 'deepy' ? DeepySkin.render(input) : WhaleGirlSkin.render(input) }) }));"
    $newDispatch = "children: resolveCompanionSkin(skin).render(input) }) }));"
    if ($s.Contains($oldDispatch)) { $s = $s.Replace($oldDispatch, $newDispatch) }

    Set-Content -Path $splash -Value $s -NoNewline
    Write-Output '  补丁 A：已应用'
}

# ── 补丁 B：plugin.js（render 之前）───────────────────────────────────────
if ($pluginDone) {
    Write-Output '  补丁 B：已打过'
}
elseif (-not (Test-Path $BLOCK)) {
    Write-Output ('  补丁 B：缺少补丁块 ' + $BLOCK)
}
else {
    $bak = Join-Path $bakDir 'plugin.orig'
    if (-not (Test-Path $bak)) { Copy-Item $plugin $bak }

    $p = Get-Content $plugin -Raw
    $block = (Get-Content $BLOCK -Raw).TrimEnd()

    # 清掉早期版本留在 host-entry.js 里的补丁（插入点太晚，会闪一帧）
    if (Test-Path $entry) {
        $e = Get-Content $entry -Raw
        $legacy = '首帧前预注册 companion 皮肤（插件补丁 · host-entry 版）'
        if ($e.Contains($legacy)) {
            $start = $e.IndexOf('        // ── ' + $legacy)
            $anchorIdx = $e.IndexOf('        await apply(ctx, config, ctx, {')
            if ($start -ge 0 -and $anchorIdx -gt $start) {
                $e = $e.Remove($start, $anchorIdx - $start)
                Set-Content -Path $entry -Value $e -NoNewline
                Write-Output '  补丁 B：已清除 host-entry.js 里的旧位置残留'
            }
        }
    }

    $anchor = '    const tree = buildTree();'
    if (-not $p.Contains($anchor)) {
        Write-Output '  补丁 B：找不到 buildTree 锚点，跳过'
    }
    else {
        $p = $p.Replace($anchor, $block + "`r`n" + $anchor)
        Set-Content -Path $plugin -Value $p -NoNewline
        Write-Output '  补丁 B：已插入 plugin.js（render 之前）'
    }
}

Write-Output ''
Write-Output '完成。'
