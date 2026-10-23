        // ── 首帧前预注册 companion 皮肤（插件补丁）───────────────────────────
    //
    // ## 问题
    //
    // CompanionPanel 首帧读 useSyncExternalStore(subscribeCompanionSkin,
    // getCompanionSkin)，而首帧时宿主三处状态都还是默认值：
    //
    //   companionSkinStore 初值 = DEFAULT_COMPANION_SKIN = 'deepy'
    //   COMPANION_SKIN_IDS  初值 = ['deepy','whaleGirl','whale']
    //   skins Map            初值 = 三个内置皮肤
    //
    // 插件行要到下面的 root.compose() 才加载，于是首帧必然画内置宠物，
    // 等插件 apply() 补完后才切过去 —— 表现为启动闪一下。
    //
    // ## 为什么只改 store 不够
    //
    //   applyCompanionSkin(x) 会过 normalizeCompanionSkin：白名单外 → 回落 deepy
    //   resolveCompanionSkin(x) 对注册表外的 id → 回落 DeepySkin
    //
    // 所以必须先让插件的皮肤注册进 skins Map 与白名单，再写 store。
    //
    // ## 怎么找到插件包
    //
    // 皮肤 id（如 elysia）与 npm 包名（如 dsh-tui-elysia-pet）不一定相同，
    // 无法由 id 推导包名。改为：遍历 profile 的 dsh.profile.bundles，
    // 对每个候选包尝试 import 并 apply —— 真正提供该 id 的那个会注册成功，
    // 其余不匹配的对其自身无害（它们的 apply 只是注册自己）。全部失败则
    // 退回原行为。
    //
    // apply 是幂等的（白名单与设置选项都用 includes/some 判断），
    // 后面 root.compose() 再跑一次不会重复注册。
    try {
        const { readFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        const { resolveDshHome } = await import('@deepseek-ai/dsh-home-paths');
        const { applyCompanionSkin, COMPANION_SKIN_IDS } = await import('../tuiDisplayPrefs.js');
        const home = process.env.DSH_HOME || resolveDshHome();
        const profileDir = join(home, 'profiles', profile);
        const patchPath = join(profileDir, 'cordis.patch.yml');

        // ── 读 profile 的 cordis.patch.yml，取 dsh-tui 行的 companion.skin
        let text = '';
        try { text = readFileSync(patchPath, 'utf8'); } catch { /* 无用户层 */ }
        let wanted;
        if (text) {
            const lines = text.split(/\r?\n/);
            let inRow = false, inCompanion = false;
            for (const raw of lines) {
                const line = raw.replace(/#.*$/, '').replace(/\s+$/, '');
                if (!line.trim()) continue;
                const indent = line.length - line.trimStart().length;
                if (indent === 0 && /^-\s+id:/.test(line)) {
                    inRow = /^-\s+id:\s*dsh-tui\s*$/.test(line);
                    inCompanion = false;
                    continue;
                }
                if (!inRow) continue;
                if (indent > 0 && /^\s+companion:\s*$/.test(line)) { inCompanion = true; continue; }
                if (inCompanion) {
                    const m = /^\s+skin:\s*(\S+)\s*$/.exec(line);
                    if (m) { wanted = m[1].replace(/^['"]|['"]$/g, ''); break; }
                    if (/^\s+\w+:\s*$/.test(line)) inCompanion = false;
                }
            }
        }

        // ── 白名单里没有该 id => 是插件皮肤，先把提供它的包加载进来
        if (wanted && !COMPANION_SKIN_IDS.includes(wanted)) {
            let pkgNames = [];
            try {
                const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
                pkgNames = manifest?.dsh?.profile?.bundles ?? [];
            } catch { /* 无 manifest */ }
            // 跳过宿主自身与已知内置，减少无谓 import
            const skip = new Set(['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui']);
            const quiet = { warn() {}, info() {}, error() {}, debug() {}, log() {} };
            for (const name of pkgNames) {
                if (skip.has(name) || COMPANION_SKIN_IDS.includes(wanted)) continue;
                try {
                    const url = new URL('node_modules/' + name + '/lib/index.js', 'file://' + profileDir + '/');
                    const mod = await import(url.href);
                    if (typeof mod.apply === 'function') {
                        await mod.apply({ logger: quiet }, { activateOnLoad: false });
                    }
                } catch { /* 该包不适用，继续 */ }
            }
        }

        // ── 最后写 store（此时白名单与注册表应已就绪）
        if (wanted) applyCompanionSkin(wanted);
    } catch { /* 预注册失败不影响启动 */ }

