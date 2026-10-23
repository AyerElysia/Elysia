/**
 * 插件行配置（cordis.patch.yml 的 config 块）。
 *
 * 零依赖：不引入 schemastery —— 每个键都有默认值，非法值就地归一化而不是
 * 拒绝整行，这样一行写错的配置不会让桌宠整个消失。
 * @module dsh-tui-elysia-pet/config
 */

/** 新皮肤在宿主设置里的 id。必须匹配 /^[a-z][a-z0-9_-]*$/。 */
export const DEFAULT_SKIN_ID = 'elysia'

/**
 * 归一化行配置。未知键忽略，非法值回落到默认值。
 * @param {unknown} raw
 */
export function resolveConfig(raw) {
  const v = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const str = (x, dflt) => (typeof x === 'string' && x.trim() !== '' ? x.trim() : dflt)
  const num = (x, lo, hi, dflt) => {
    const n = typeof x === 'number' && Number.isFinite(x) ? x : dflt
    return Math.min(hi, Math.max(lo, Math.round(n)))
  }
  const idRaw = str(v.skinId, DEFAULT_SKIN_ID)
  return {
    skinId: /^[a-z][a-z0-9_-]*$/u.test(idRaw) ? idRaw : DEFAULT_SKIN_ID,
    title: str(v.title, 'Elysia'),
    description: str(v.description, '爱莉'),
    idleAnimation: str(v.idleAnimation, 'idle'),
    workingAnimation: str(v.workingAnimation, 'working'),
    thinkingAnimation: str(v.thinkingAnimation, 'thinking'),
    happyAnimation: str(v.happyAnimation, 'happy'),
    sleepingAnimation: str(v.sleepingAnimation, 'sleeping'),
    /**
     * 待机时是否轮换动画（默认 **false**）。
     *
     * 宿主的轮换本来该由它自己做：DEEPY_IDLE_ROTATION =
     * ['idle','idle-look','idle-spout','swim']，但那个池子的成员会被
     * deepyAnimationFor 吃掉（它查的是语义表，表里没有这三个键），
     * 结果 4 个槽位全退回 idle —— 待机永远一个样。
     *
     * 皮肤可以自己补这个轮换，但默认**不开**：
     * idle-look 和 idle-spout 在素材里是同一个文件（待机眨眼.gif），
     * 开了轮换等于 3 个槽里有 2 个放待机眨眼，把"常态=东张西望"稀释了。
     *
     * 想让待机有变化就设 true（或者把 idle-look / idle-spout 换成别的素材）。
     */
    idleRotation: v.idleRotation === true,
    /**
     * 开屏（启动页吉祥物）稳态播哪个动画键。留空 = 和侧栏待机一致。
     *
     * 开屏与侧栏共用同一个皮肤对象，稳态都会发 idle 语义；这个键让开屏
     * 可以单独换一个更"门面"的动作，且不影响侧栏。
     *
     * 分流依据是调用时传的 **width**：侧栏传 skin.cells.columns（32），
     * 开屏传 SPLASH_MASCOT_COLUMNS（42）—— 不相等即开屏。
     *
     * 值必须是帧包里存在的键（如 conducting / swim / typing）；写了不存在的
     * 键会被忽略（回落成待机），不会报错。
     */
    splashAnimation: str(v.splashAnimation, ''),
    /**
     * 待机类动画的播放倍率（1 = 原始 80ms/帧）。>1 变慢。
     *
     * 只作用于**待机族**（idle / idle-look / idle-spout / swim / sleeping），
     * 因为这些是长时间循环播放的，原速（960ms 一轮）看起来太急躁；
     * 干活时的动画（typing / thinking 等）保持原速，节奏感反而更好。
     */
    idleSpeed: num(v.idleSpeed, 1, 8, 1),
    /**
     * 庆祝动画是否在两个变体间随机（默认 true）。
     *
     * 素材里有两个"任务完成随机触发"表情（微笑冒爱心 / 张嘴举红心），
     * 用户把两个都命名成"随机触发"——意图就是每次庆祝随机挑一个。
     * 关掉则固定用第一个。
     */
    celebrationVariants: v.celebrationVariants !== false,
    /** 启动时自动切到爱莉（false = 只加入列表，由用户在设置里选）。 */
    activateOnLoad: v.activateOnLoad === true,
    /**
     * 图像轨的放大倍率上限。源 PNG 是 320x320（= 网格 32 × 每格 10px），
     * 宿主的图像源上限是边长 1024 / 4MiB，所以实际最大 3 倍；解码器会再按
     * 这两个约束自行钳制，这里只是上限。
     */
    imageScale: num(v.imageScale, 1, 8, 3),
  }
}
