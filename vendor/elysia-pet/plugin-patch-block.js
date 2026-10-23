    // ── 首帧前预注册 companion 皮肤（插件补丁）───────────────────────────
    //
    // ## 为什么必须插在这里
    //
    // 宿主的启动顺序：
    //
    //   host-entry.js
    //     const slot = createEntrySlot(...)
    //     await apply(ctx, config, ...)        ← **首帧在这里面就 render 了**
    //     await slot.firstFrameFlushed?.()
    //     await root.compose(...)              ← 插件到这才加载
    //
    // 即：首帧渲染发生在 apply() 内部的 render(tree) 调用（plugin.js），
    // 而插件行要到更后面的 root.compose() 才加载。所以补丁必须插在
    // apply() 里、render() 之前，插在 host-entry 的 firstFrameFlushed
    // 之前仍然太晚（那时首帧已经画出来了，会闪一帧内置宠物）。
    //
    // ## 要做的三件事
    //
    //   CompanionPanel 首帧读 useSyncExternalStore(subscribeCompanionSkin,
    //   getCompanionSkin)，而三处状态都还是默认值：
    //
    //     companionSkinStore 初值 = DEFAULT_COMPANION_SKIN = 'deepy'
    //     COMPANION_SKIN_IDS  初值 = ['deepy','whaleGirl','whale']
    //     skins Map            初值 = 三个内置皮肤
    //
    //   1. 读 profile 的 cordis.patch.yml，取 dsh-tui 行的 companion.skin
    //   2. 白名单里没有该 id → 遍历 profile 的 dsh.profile.bundles，
    //      逐个 import + apply（提供该皮肤的包会注册成功，其余无害、幂等）
    //   3. applyCompanionSkin(id) 写 store
    //
    // 只做第 3 步无效：applyCompanionSkin 会过 normalizeCompanionSkin
    // （白名单外回落 deepy），显示侧还会过 resolveCompanionSkin
    // （注册表外回落 DeepySkin）。必须先注册再写值。
    try {
        const { readFileSync: __petRead } = await import('node:fs');
        const { join: __petJoin } = await import('node:path');
        const { resolveDshHome: __petHome } = await import('@deepseek-ai/dsh-home-paths');
        const { applyCompanionSkin: __petApply, COMPANION_SKIN_IDS: __petIds } = await import('../tuiDisplayPrefs.js');
        const __petProfileName = resolveDshProfileName() ?? runtimeOptions.profile ?? 'dsh-tui';
        const __petHomeDir = process.env.DSH_HOME || __petHome();
        const __petProfileDir = __petJoin(__petHomeDir, 'profiles', __petProfileName);

        // ① 读用户层，取 companion.skin
        let __petWanted;
        try {
            const __petText = __petRead(__petJoin(__petProfileDir, 'cordis.patch.yml'), 'utf8');
            const __petLines = __petText.split(/\\r?\\n/);
            let __inRow = false, __inCompanion = false;
            for (const __raw of __petLines) {
                const __line = __raw.replace(/#.*$/, '').replace(/\\s+$/, '');
                if (!__line.trim()) continue;
                const __indent = __line.length - __line.trimStart().length;
                if (__indent === 0 && /^-\\s+id:/.test(__line)) {
                    __inRow = /^-\\s+id:\\s*dsh-tui\\s*$/.test(__line);
                    __inCompanion = false;
                    continue;
                }
                if (!__inRow) continue;
                if (__indent > 0 && /^\\s+companion:\\s*$/.test(__line)) { __inCompanion = true; continue; }
                if (__inCompanion) {
                    const __m = /^\\s+skin:\\s*(\\S+)\\s*$/.exec(__line);
                    if (__m) { __petWanted = __m[1].replace(/^['"]|['"]$/g, ''); break; }
                    if (/^\\s+\\w+:\\s*$/.test(__line)) __inCompanion = false;
                }
            }
        } catch { /* 无用户层 */ }

        // ② 白名单外 → 把提供它的插件包加载进来
        if (__petWanted && !__petIds.includes(__petWanted)) {
            let __petBundles = [];
            try {
                const __petManifest = JSON.parse(__petRead(__petJoin(__petProfileDir, 'package.json'), 'utf8'));
                __petBundles = __petManifest?.dsh?.profile?.bundles ?? [];
            } catch { /* 无 manifest */ }
            const __petSkip = new Set(['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui']);
            const __petQuiet = { warn() {}, info() {}, error() {}, debug() {}, log() {} };
            for (const __name of __petBundles) {
                if (__petSkip.has(__name) || __petIds.includes(__petWanted)) continue;
                try {
                    const __url = new URL('node_modules/' + __name + '/lib/index.js', 'file://' + __petProfileDir + '/');
                    const __mod = await import(__url.href);
                    if (typeof __mod.apply === 'function') await __mod.apply({ logger: __petQuiet }, { activateOnLoad: false });
                } catch { /* 该包不适用 */ }
            }
        }

        // ③ 写 store（此时白名单与注册表应已就绪）
        if (__petWanted) __petApply(__petWanted);
    } catch { /* 预注册失败不影响启动，退回原行为 */ }

