/**
 * 把皮肤接进宿主的两处注册表。
 *
 * 宿主没有"插件皮肤"的正式接缝（skins.js 的注释写明描述符校验规则随
 * Phase 7 落地），但两处注册表都是**普通可变数组**，实测可以在运行时追加：
 *
 * 1. \`skins.js\` 的皮肤 Map —— 通过 \`registerCompanionSkin\` 写入（这是作者
 *    注释里点明的「用户自定义 / 插件皮肤的进入点」）。
 * 2. \`tuiDisplayPrefs.js\` 的 \`COMPANION_SKIN_IDS\` 与 \`settings/definitions.js\`
 *    的 \`companion.skin.options\` —— 前者是 \`normalizeCompanionSkin\` 的白名单
 *    （不在里面会被静默回落成 deepy），后者决定 /settings 里列出哪些项。
 *    两个都要追加，否则要么选项不出现、要么选了不生效。
 *
 * 全部做成幂等 + 软失败：宿主改结构时只 warn，不影响 boot。
 * @module dsh-tui-elysia-pet/register
 */

/**
 * 往 \`COMPANION_SKIN_IDS\` 白名单追加 id。
 * @returns {'added'|'already'|'unsupported'}
 */
export function appendSkinId(prefs, id) {
  const ids = prefs?.COMPANION_SKIN_IDS
  if (!Array.isArray(ids)) return 'unsupported'
  if (ids.includes(id)) return 'already'
  ids.push(id)
  return 'added'
}

/**
 * 往 `settings/definitions.js` 的 companion.skin 选项表追加一项。
 *
 * 字段命名**对齐宿主内置的三项**（设置界面按同一套规则渲染）：
 *
 *   { value: 'deepy',     label: 'Deepy',      descriptions: { zh: 'Deepy 小鲸鱼' } }
 *   { value: 'whaleGirl', label: 'Whale girl', descriptions: { zh: '鲸娘' } }
 *   { value: 'whale',     label: 'Whale',      descriptions: { zh: '像素鲸鱼' } }
 *
 * 界面用 `pick(text, descriptions) = descriptions?.[lang] ?? text` 渲染
 * （screens/Settings.js）：中文界面显示 `descriptions.zh`，其他语言回落
 * `label`。所以 label 放英文名、descriptions.zh 放中文短名，两边都好看，
 * 也与内置项在列表里对齐。
 *
 * @param {object} definitions 宿主的 SETTING_DEFINITIONS
 * @param {string} id          皮肤 id（value）
 * @param {string} label       英文名（非中文界面显示这个）
 * @param {string} zhName      中文短名（中文界面显示这个）
 * @returns {'added'|'already'|'unsupported'}
 */
export function appendSettingOption(definitions, id, label, zhName) {
  const field = definitions?.['companion.skin']
  const options = field?.options
  if (!Array.isArray(options)) return 'unsupported'
  if (options.some((option) => option?.value === id)) return 'already'
  options.push({ value: id, label, descriptions: { zh: zhName } })
  return 'added'
}

/**
 * 按配置在启动时即选中该皮肤（写入 live setting）。
 * @returns {boolean} 是否写入
 */
export function activateSkin(prefs, id) {
  if (typeof prefs?.applyCompanionSkin !== 'function') return false
  try {
    prefs.applyCompanionSkin(id)
    return true
  } catch {
    return false
  }
}
