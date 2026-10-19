import { ref } from 'vue'
import { motionSkipped } from './motion'

/* ============================================================
   退出登录（收拢式退场）：与 welcome.ts 的 handoff 完全独立。
   顺序是铁律：
     confirm → beginExit() →（ExitChain 播到暗场铺满）→ clearSession()
             → router.replace('/login') → markExitSwapped() → 登录页挂载 → finishExit()

   为什么不能提前清会话：`router.beforeEach` 里有一条「目标 public + authed 仍为 true
   + 去 login」→ 重定向回 `/`，token 未清就跳不过去。
   为什么不能更早清：`clearSession()` 会清空 navGroups / dynamicRoutes，侧边栏立刻变空。
   所以退场动画必须恰好夹在这两者之间。
   ============================================================ */

export const exitActive = ref(false)   // 退场进行中（Login 据此跳过 intro、App 据此挂层）
export const exitSwapped = ref(false)  // 路由已切到登录页：可以抬天幕
export const exitAbort = ref(false)    // 被中断（会话失效 / 导航失败）：快速收场

let choreoDone: (() => void) | null = null
let choreo: Promise<void> = Promise.resolve()

/** 开始退场，返回「暗场已铺满、可以切路由」的 Promise。减少动效时立即 resolve */
export function beginExit(): Promise<void> {
  if (exitActive.value) return choreo
  if (motionSkipped()) return Promise.resolve()
  exitActive.value = true
  exitSwapped.value = false
  exitAbort.value = false
  choreo = new Promise<void>(resolve => { choreoDone = resolve })
  return choreo
}

/** ExitChain 播到天幕铺满时调用：放行 clearSession + 路由切换 */
export function choreoExitDone() {
  choreoDone?.()
  choreoDone = null
}

export function markExitSwapped() {
  exitSwapped.value = true
}

/** 收尾：卸层、解拦截。正常结束与异常中断同用 */
export function finishExit() {
  exitActive.value = false
  exitSwapped.value = false
  exitAbort.value = false
  choreoDone = null
  choreo = Promise.resolve()
}
