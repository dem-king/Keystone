import { ref } from 'vue'
import { sessionVersion } from './auth'
import { motionSkipped } from './motion'

/* ============================================================
   登录转场（无幕交接）：没有任何全屏覆盖层——
   登录页在舞台上退场（深色画布先沉走、登录卡殿后），路由切到工作台后，
   框体自舞台浮现、导航滑入、卡片从中心飞出落位。
   状态机：idle → leaving（登录页退场，等预热与退场动画）
               → arriving（工作台组装，按预算收尾）→ idle
   各段动画在不同处播放，这里只持有状态与全局守卫：
   - Login 侧：beginHandoff → 退场播完 + 预热完成 → markArrived → push
   - 外壳 / 落点页：读 handoffPhase 决定入场编排（arriving 时用增强版）
   - arriving 按 ARRIVE_BUDGET 收尾并解除点击拦截（组装时长是本地常量，
     可直接作预算，不逐信号汇聚）
   ============================================================ */

export type HandoffPhase = 'idle' | 'leaving' | 'arriving'

/** 转场进行中（leaving 或 arriving）：页面在动，点击与全局快捷键让位 */
export const handoffActive = ref(false)
export const handoffPhase = ref<HandoffPhase>('idle')

/* ── 转场特效层（WarpTransit，挂在 App.vue 跨路由切换存活） ──
   Login 驱动节奏，特效层自走并在星体到达脱出点时 release 给欢迎链。 */
export const transitActive = ref(false)    // 特效层在场（含待命）
export const transitReleased = ref(false)  // 星体到达：WelcomeChain 起跑信号
export const transitSwapped = ref(false)   // 路由已切换：特效层可进入减速+脱出段
export const transitAbort = ref(false)     // 交接被撤回：特效层快速淡出

let signalTransitStart: () => void = () => undefined
/** 每次交接一份新的启动信号；WarpTransit onMounted 时读取（挂载由 transitActive 触发，晚于重建） */
export let transitBegin: Promise<void> = Promise.resolve()

/** arriving 的总预算：外壳滑入 + 欢迎链前段（铭牌 → 打字 → 抽线 → 亮点起飞）
 *  的全部时长，到点收尾。欢迎链尾段（亮点飞行后半 + 抵达 + 退场）不阻塞点击，
 *  欢迎层本身 pointer-events: none，用户此时点导航不影响它自己淡出。 */
const ARRIVE_BUDGET = 4200
let arriveTimer = 0

/** 登录成功、开始退场前调用。减少动态效果或页面在后台时不激活，登录页直接切换 */
export function beginHandoff() {
  if (handoffActive.value || motionSkipped()) return
  transitBegin = new Promise<void>(resolve => { signalTransitStart = resolve })
  transitActive.value = true
  transitReleased.value = false
  transitSwapped.value = false
  transitAbort.value = false
  handoffActive.value = true
  handoffPhase.value = 'leaving'
  installGuards()
}

/** 对勾收尾时调用：特效层从待命进入消散段 */
export function startTransit() { signalTransitStart() }

/** 路由切换成功后调用：特效层进入减速 + 星体脱出段 */
export function setTransitSwapped() { transitSwapped.value = true }

/** 路由切换之前调用（push 前一行）：进入组装阶段，按预算收尾 */
export function markArrived() {
  if (!handoffActive.value) return
  handoffPhase.value = 'arriving'
  window.clearTimeout(arriveTimer)
  arriveTimer = window.setTimeout(finishHandoff, ARRIVE_BUDGET)
}

/** 收尾（正常到点或异常中断同用）：解除守卫。导航失败、外壳卸载时也要调用 */
export function finishHandoff() {
  transitAbort.value = true
  if (arriveTimer) {
    window.clearTimeout(arriveTimer)
    arriveTimer = 0
  }
  handoffActive.value = false
  handoffPhase.value = 'idle'
  removeGuards()
}

/* ── 工作台数据预热 ──────────────────────────────────────────────
   登录退场的那 0.5 秒本来就在等网络，顺手把工作台首屏要的数据打了。
   落点页挂载时先取预热结果同步渲染，首帧就是真内容，连淡入都省了。
   预热失败不阻塞：落点页照常走「骨架 → 真实数据」。 */

type Prefetched = { range: string; data: unknown }

let warmed: Prefetched | null = null
let warming: Promise<void> | null = null

/** 预热工作台概览。同一时间只发一次，重复调用复用同一个请求 */
export function prefetchDashboard(range: string, fetcher: (r: string) => Promise<unknown>) {
  if (warmed) return Promise.resolve()
  if (warming) return warming
  const version = sessionVersion.value
  warming = fetcher(range)
    .then(data => { if (version === sessionVersion.value) warmed = { range, data } })
    .catch(() => undefined)
    .then(() => { warming = null })
  return warming
}

/** 落点页取预热结果：命中且区间一致才给，否则返回 null 走正常加载 */
export function takeWarmedDashboard<T>(range: string): T | null {
  if (!warmed || warmed.range !== range) return null
  return warmed.data as T
}

/** 区间变了 / 登出：预热结果作废 */
export function clearWarmedDashboard() {
  warmed = null
  warming = null
}

/* ── 点击拦截：转场期间页面在动，连点不能漏给（退场中的登录页 / 组装中的工作台） ── */
function blockThrough(event: Event) {
  if (!handoffActive.value) return
  event.preventDefault()
  event.stopPropagation()
}

let guardsInstalled = false
function installGuards() {
  if (guardsInstalled) return
  guardsInstalled = true
  document.addEventListener('pointerdown', blockThrough, { capture: true })
  document.addEventListener('click', blockThrough, { capture: true })
}
function removeGuards() {
  if (!guardsInstalled) return
  guardsInstalled = false
  document.removeEventListener('pointerdown', blockThrough, { capture: true })
  document.removeEventListener('click', blockThrough, { capture: true })
}
