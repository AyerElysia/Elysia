# =============================================================================
# 让 dsh-tui 启动页（开屏）支持插件宠物皮肤
# =============================================================================
#
# ## 背景
#
# 宿主 SplashMascot.js 里有两处硬编码：
#
#   1. useSplashMascotSkin 的白名单只认 'deepy' / 'whaleGirl'；
#   2. 渲染分发写成 skin === 'deepy' ? DeepySkin : WhaleGirlSkin。
#
# 于是选中插件皮肤（如 elysia）时，开屏仍画原来的分层鲸鱼。
#
# 宿主已提供插件皮肤的注册表 resolveCompanionSkin(id)（即
# registerCompanionSkin 写入的那个 Map）。本补丁只把两处硬编码改成查注册表 ——
# 不新增机制，只用宿主自己的接缝。
#
# ## 为什么不用正则
#
# PowerShell 里花括号与反斜杠的转义极易出错（曾因双引号里的 { 被当作表达式而
# 整脚本解析失败）。这里一律用**字符串定位 + 插入**，只在判断单行格式时用
# 简单的 -match。
#
# ## 幂等与升级
#
# - 已打好就跳过（三处特征都校验：白名单、分发、import）。
# - dsh-tui 升级会覆盖 node_modules；备份若与新版本不符则自动更新，
#   避免 -Restore 时把新版文件覆盖成旧版。
#
# 用法：
#   pwsh -File patch-splash-mascot.ps1            打补丁（幂等）
#   pwsh -File patch-splash-mascot.ps1 -Check     只看状态
#   pwsh -File patch-splash-mascot.ps1 -Restore   还原

param(
  [switch]$Restore,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'

$target    = 'E:\dsh-profiles\_core\node_modules\@deepseek-harness-tui\dsh-tui\lib\types\components\sidePanel\companion\SplashMascot.js'
$backupDir = 'E:\dsh-profiles\_patches'
$backup    = Join-Path $backupDir 'SplashMascot.js.orig'

if (-not (Test-Path $target)) {
  Write-Output "找不到目标文件：$target"
  Write-Output "（dsh-tui 未安装，或目录结构已变化）"
  exit 1
}

$content = Get-Content $target -Raw

# ── 判定是否已打补丁（三处都要在）────────────────────────────────────────────
$skinsImportLine = ($content -split "`n" | Where-Object { $_ -match 'skins\.js' -and $_ -match '^\s*import' } | Select-Object -First 1)

$hasWhitelistPatch = $content.Contains('resolveCompanionSkin(id)')
$hasDispatchPatch  = $content.Contains('children: resolveCompanionSkin(skin).render(input)')
$hasImportPatch    = $skinsImportLine -and ($skinsImportLine -match 'resolveCompanionSkin')
$isPatched = $hasWhitelistPatch -and $hasDispatchPatch -and $hasImportPatch

if ($Check) {
  Write-Output ("启动页补丁状态：" + $(if ($isPatched) { '已打' } else { '未打' }))
  Write-Output ("  白名单改写：" + $(if ($hasWhitelistPatch) { '有' } else { '无' }))
  Write-Output ("  分发改写：  " + $(if ($hasDispatchPatch) { '有' } else { '无' }))
  Write-Output ("  import 补全：" + $(if ($hasImportPatch) { '有' } else { '无' }))
  Write-Output ("备份文件：" + $(if (Test-Path $backup) { '存在' } else { '不存在' }))
  if (Test-Path $backup) {
    $b = Get-Content $backup -Raw
    $stale = $b.Length -lt ($content.Length * 0.9)
    Write-Output ("  备份与新版本相符：" + $(if ($stale) { '否（升级后需重打）' } else { '是' }))
  }
  exit 0
}

if ($Restore) {
  if (-not (Test-Path $backup)) {
    Write-Output "没有备份可还原：$backup"
    exit 1
  }
  $b = Get-Content $backup -Raw
  if ($b.Length -lt ($content.Length * 0.9)) {
    Write-Output "备份对应当前 dsh-tui 的旧版本，直接还原会破坏新版文件。"
    Write-Output "建议：删除 $backup 后重新运行本脚本（会重新备份当前版本）。"
    exit 1
  }
  Copy-Item $backup $target -Force
  Write-Output "已还原 SplashMascot.js（启动页恢复原鲸鱼行为）"
  exit 0
}

if ($isPatched) {
  Write-Output "已经是打过补丁的状态，跳过。"
  exit 0
}

# ── 备份（升级后旧备份会自动更新）───────────────────────────────────────────
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir -Force | Out-Null }

$backupStale = (Test-Path $backup) -and ((Get-Content $backup -Raw).Length -lt ($content.Length * 0.9))

if (-not (Test-Path $backup)) {
  Copy-Item $target $backup
  Write-Output "已备份原始文件：$backup"
} elseif ($backupStale) {
  Copy-Item $target $backup -Force
  Write-Output "备份对应旧版宿主，已更新为新版原始文件：$backup"
} else {
  Write-Output "备份已存在且与新版本相符，保留不动。"
}

# ── 补丁 1：import 里补上 resolveCompanionSkin ───────────────────────────────
if ($skinsImportLine -and ($skinsImportLine -notmatch 'resolveCompanionSkin')) {
  $close = $skinsImportLine.LastIndexOf('}')
  if ($close -gt 0) {
    $patchedLine = $skinsImportLine.Insert($close, ', resolveCompanionSkin')
    $content = $content.Replace($skinsImportLine, $patchedLine)
    Write-Output "补丁 1：import 已加入 resolveCompanionSkin"
  } else {
    Write-Output "警告：补丁 1 找不到 import 的右花括号，已跳过"
  }
}

# ── 补丁 2：白名单改查注册表 ─────────────────────────────────────────────────
$oldWhite = @'
    const id = pinned ?? setting;
    return id === 'deepy' || id === 'whaleGirl' ? id : undefined;
'@

$newWhite = @'
    const id = pinned ?? setting;
    if (id === 'deepy' || id === 'whaleGirl')
        return id;
    // 插件皮肤（经 registerCompanionSkin 注册）同样可以当启动页吉祥物：
    // resolveCompanionSkin 查注册表，命中且不是内置三个之一就认它。
    // 未知 id 会回落到 DeepySkin，所以要排除掉，否则任何非法值都会变成吉祥物。
    if (id !== undefined && id !== 'whale') {
        const skin = resolveCompanionSkin(id);
        if (skin !== undefined && skin.id === id)
            return id;
    }
    return undefined;
'@

if ($content.Contains($oldWhite)) {
  $content = $content.Replace($oldWhite, $newWhite)
  Write-Output "补丁 2：白名单已改为查注册表"
} else {
  Write-Output "警告：补丁 2 找不到预期代码（宿主可能已改实现）"
}

# ── 补丁 3：分发改查注册表 ───────────────────────────────────────────────────
$oldDispatch = "children: skin === 'deepy' ? DeepySkin.render(input) : WhaleGirlSkin.render(input) }) }));"
$newDispatch = "children: resolveCompanionSkin(skin).render(input) }) }));"

if ($content.Contains($oldDispatch)) {
  $content = $content.Replace($oldDispatch, $newDispatch)
  Write-Output "补丁 3：分发已改为查注册表"
} else {
  Write-Output "警告：补丁 3 找不到预期代码（宿主可能已改实现）"
}

Set-Content -Path $target -Value $content -NoNewline

# ── 校验 ─────────────────────────────────────────────────────────────────────
$after = Get-Content $target -Raw
$ok1 = $after.Contains('resolveCompanionSkin(id)')
$ok2 = $after.Contains('children: resolveCompanionSkin(skin).render(input)')
$imp = ($after -split "`n" | Where-Object { $_ -match 'skins\.js' -and $_ -match '^\s*import' } | Select-Object -First 1)
$ok3 = $imp -and ($imp -match 'resolveCompanionSkin')

if ($ok1 -and $ok2 -and $ok3) {
  Write-Output "启动页补丁已应用 —— 选中插件皮肤后开屏也会画它。"
} else {
  Write-Output "补丁写入后校验失败（白名单=$ok1 分发=$ok2 import=$ok3），请检查 $target"
  exit 1
}
