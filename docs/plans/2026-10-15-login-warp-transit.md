# 登录转场特效（消散 → 曲率穿越 → 星体脱出）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把登录成功到首页的「干巴巴淡出」换成「消散 → 曲率穿越 → 星体脱出接管欢迎链」的特效转场，同时根除闪白/闪黑。

**Architecture:** 新增挂在 App.vue 的透明特效层 `WarpTransit.vue`（跨路由切换存活；天幕 div 保证穿越段全程暗场，canvas 走 `lighter` additive 渲染粒子/光丝/星体）。节奏由 Login.vue 驱动（`startTransit()`、路由 swap 后置 `transitSwapped`），特效层自走并在星体到达时 `transitReleased=true`，WelcomeChain 从等待 release 开始原有编排。设计文档：`docs/plans/2026-10-15-login-warp-transit-design.md`。

**Tech Stack:** Vue 3 `<script setup lang="ts">`、GSAP（`composables/motion.ts` 唯一动效入口）、Canvas 2D + `createFrameLoop`。

---

### Task 1: `welcome.ts` 转场状态扩展

**Files:**
- Modify: `keystone-vue/src/composables/welcome.ts`

**Step 1: 在 `handoffPhase` 声明后新增转场特效状态块**

```ts
/* ── 转场特效层（WarpTransit，挂在 App.vue 跨路由切换存活） ──
   Login 驱动节奏，特效层自走并在星体到达脱出点时 release 给欢迎链。 */
export const transitActive = ref(false)    // 特效层在场（含待命）
export const transitReleased = ref(false)  // 星体到达：WelcomeChain 起跑信号
export const transitSwapped = ref(false)   // 路由已切换：特效层可进入减速+脱出段
export const transitAbort = ref(false)     // 交接被撤回：特效层快速淡出

let signalTransitStart: () => void = () => undefined
/** 每次交接一份新的启动信号；WarpTransit onMounted 时读取（挂载由 transitActive 触发，晚于重建） */
export let transitBegin: Promise<void> = Promise.resolve()
```

**Step 2: `beginHandoff()` 内、置 `handoffPhase` 之前重建信号并置位**

```ts
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
```

**Step 3: 新增驱动函数（放在 `markArrived` 之后）**

```ts
/** 对勾收尾时调用：特效层从待命进入消散段 */
export function startTransit() { signalTransitStart() }
/** 路由切换成功后调用：特效层进入减速 + 星体脱出段 */
export function setTransitSwapped() { transitSwapped.value = true }
```

**Step 4: `finishHandoff()` 里加 `transitAbort.value = true`（首行），`ARRIVE_BUDGET` 3600 → 4200**

**Step 5: 验证** — Run: `npx vue-tsc --noEmit`，Expected: 无报错。

---

### Task 2: `motion.ts` — 用 `playLoginDissolve` 替换 `playLoginExit`

**Files:**
- Modify: `keystone-vue/src/composables/motion.ts:191-213`

**Step 1: 替换整个 `playLoginExit`（含注释）为：**

```ts
/** 登录页消散（停摆 Halt）：DOM 快速淡出上浮，轮廓交给 WarpTransit 的粒子接续——
 *  淡出要干脆（0.38s），慢了会跟粒子「双重曝光」。根底色不动：天幕负责暗场。 */
export function playLoginDissolve(root: HTMLElement, done: () => void): gsap.core.Timeline | null {
  if (skipMotion()) {
    done()
    return null
  }
  const canvas = root.querySelector('.login-canvas')
  const side = root.querySelector('.login-side')
  const card = root.querySelector('.login-card')
  const tl = gsap.timeline({ onComplete: done })
  if (canvas) tl.to(canvas, { opacity: 0, y: 18, duration: 0.38, ease: EASE.exit }, 0)
  if (card) tl.to(card, { opacity: 0, y: -12, scale: 0.99, duration: 0.34, ease: EASE.exit }, 0.04)
  if (side) tl.to(side, { opacity: 0, duration: 0.3, ease: 'power1.in' }, 0.1)
  return tl
}
```

**Step 2: `restoreLoginStage` 精简（根底色不再被改，只还原面板）**

```ts
/** 交接被撤回（导航失败 / 会话过期）时还原登录页：消散补间已把面板推到透明，
 *  清掉内联值退回 CSS 定义态，否则留在「看得见背景、摸不着面板」的空场 */
export function restoreLoginStage(root: HTMLElement | null) {
  if (!root) return
  gsap.set(root.querySelectorAll('.login-canvas, .login-side, .login-card'), { clearProps: 'all' })
}
```

**Step 3: 验证** — `npx vue-tsc --noEmit`；Grep 确认无 `playLoginExit` 残留引用（Login.vue 在 Task 5 才改，此步允许 Login.vue 暂时引用旧名——编译会报，故顺序上先改 Task 5 的 import 也可以；实际执行时 Task 2~6 一次性改完再跑 tsc）。

---

### Task 3: `WarpTransit.vue` 特效层（核心新组件）

**Files:**
- Create: `keystone-vue/src/components/welcome/WarpTransit.vue`

**Step 1: 完整实现**

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createFrameLoop, gsap, motionSkipped } from '@/composables/motion'
import { transitAbort, transitBegin, transitReleased, transitSwapped } from '@/composables/welcome'

/* ============================================================
   登录转场特效层：消散 → 曲率穿越 → 星体脱出
   挂在 App.vue（Login 切换时卸载，特效层必须跨切换存活），pointer-events: none。
   节奏由 Login 驱动（startTransit / setTransitSwapped / transitAbort），本层自走：
   待命(await transitBegin) → 消散采样 → 光丝加速 → 巡航等 swap（上限 2.5s）
   → 减速 → 脱出星弧线飞抵欢迎链星球起点 → transitReleased → 天幕抬起 → emit done。
   天幕是「银河本身」：穿越段全程暗场，防闪白/闪黑的根基；页面本体始终真实在场。
   ============================================================ */

const emit = defineEmits<{ (e: 'done'): void }>()
let settled = false
function finish() {
  if (settled) return
  settled = true
  emit('done')
}

const sky = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)

const wait = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms))
const played = (tl: gsap.core.Timeline) => new Promise<void>(r => tl.eventCallback('onComplete', r))

/* ── 消散粒子 / 曲率光丝 / 脱出星 ── */
interface Mote { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; color: string; tw: number }
interface Streak { x: number; y: number; z: number; pz: number; color: string; w: number }

const motes: Mote[] = []
const streaks: Streak[] = []
let pool: Array<{ x: number; y: number }> = []
let ctx: CanvasRenderingContext2D | null = null
let loop: ReturnType<typeof createFrameLoop> | null = null

const vw = window.innerWidth
const vh = window.innerHeight
const CX = vw / 2
const CY = vh / 2
const FOCAL = Math.max(vw, vh) * 0.62
const HERO_TO = { x: vw - 150, y: 116 } // 与 WelcomeChain 星球坠落起点（中心坐标）一致
const PALETTE = ['#ffffff', '#ffffff', '#b6f56a', '#b6f56a', '#9fc9ff']
const pick = () => PALETTE[(Math.random() * PALETTE.length) | 0]

const state = { speed: 0 }        // 光丝 z 推进速度，GSAP 时间轴驱动
let emitUntil = 0                 // 消散粒子发射截止（performance.now 毫秒）
let heroOn = false
const hero = { x: CX, y: CY, r: 2.5, a: 0 }
const heroTrail: Array<{ x: number; y: number; at: number }> = []

function seedStreak(s: Streak, initial = false) {
  s.x = (Math.random() * 2 - 1) * 1.15
  s.y = (Math.random() * 2 - 1) * 1.15
  s.z = initial ? 0.25 + Math.random() * 0.75 : 1
  s.pz = s.z
}

function spawnMote() {
  const p = pool[(Math.random() * pool.length) | 0]
  if (!p) return
  motes.push({
    x: p.x + (Math.random() - 0.5) * 14,
    y: p.y + (Math.random() - 0.5) * 14,
    vx: (Math.random() - 0.5) * 26,
    vy: -(40 + Math.random() * 60),
    life: 0,
    max: 0.9 + Math.random() * 0.8,
    r: 0.8 + Math.random() * 1.5,
    color: pick(),
    tw: Math.random() * Math.PI * 2,
  })
}

/* 消散采样：按登录页元素矩形撒网格点（粒子接续 DOM 轮廓），加一层全屏碎尘 */
function sampleLogin() {
  const pts: Array<{ x: number; y: number }> = []
  const SELECTOR = '.login-brand, .hero-line, .cap-item, .login-plate, .login-dial, .login-card, .login-foot'
  document.querySelectorAll<HTMLElement>(SELECTOR).forEach(el => {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    const step = 24
    for (let y = r.top + step / 2; y < r.bottom; y += step)
      for (let x = r.left + step / 2; x < r.right; x += step)
        if (Math.random() > 0.3) pts.push({ x, y })
  })
  for (let i = 0; i < 130; i++) pts.push({ x: Math.random() * vw, y: Math.random() * vh })
  return pts
}

function draw(dt: number, t: number) {
  if (!ctx) return
  ctx.clearRect(0, 0, vw, vh)
  const now = performance.now()

  if (now < emitUntil && motes.length < 520) for (let i = 0; i < 14; i++) spawnMote()
  for (let i = motes.length - 1; i >= 0; i--) {
    const m = motes[i]
    m.life += dt
    if (m.life >= m.max) { motes.splice(i, 1); continue }
    const damp = Math.max(0, 1 - 1.4 * dt)
    m.vx *= damp
    m.vy *= damp
    m.x += m.vx * dt
    m.y += m.vy * dt
  }

  ctx.globalCompositeOperation = 'lighter'

  for (const m of motes) {
    const k = m.life / m.max
    ctx.globalAlpha = (1 - k) * (1 - k) * (0.55 + 0.45 * Math.sin(t * 9 + m.tw))
    ctx.fillStyle = m.color
    ctx.beginPath()
    ctx.arc(m.x, m.y, Math.max(0.2, m.r * (1 - k * 0.4)), 0, Math.PI * 2)
    ctx.fill()
  }

  /* 曲率光丝：sx = CX + x/z*FOCAL，z 以 state.speed 推进，拖尾连接上一投影点 */
  if (state.speed > 0.001) {
    for (const s of streaks) {
      s.pz = s.z
      s.z -= state.speed * dt
      if (s.z <= 0.06) { seedStreak(s); continue }
      const near = 1 - s.z
      ctx.globalAlpha = Math.min(0.85, 0.14 + near * near)
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.w * (0.5 + near * 1.7)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(CX + (s.x / s.pz) * FOCAL, CY + (s.y / s.pz) * FOCAL)
      ctx.lineTo(CX + (s.x / s.z) * FOCAL, CY + (s.y / s.z) * FOCAL)
      ctx.stroke()
    }
  }

  /* 脱出星：亮核 + 径向光晕 + 短拖尾 */
  if (heroOn && hero.a > 0.01) {
    heroTrail.push({ x: hero.x, y: hero.y, at: now })
    if (heroTrail.length > 9) heroTrail.shift()
    for (let i = 1; i < heroTrail.length; i++) {
      const k = 1 - (now - heroTrail[i].at) / 1000 / 0.22
      if (k <= 0) continue
      ctx.globalAlpha = 0.5 * k * hero.a
      ctx.strokeStyle = '#d8ff9e'
      ctx.lineWidth = Math.max(0.6, hero.r * 1.6 * k)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(heroTrail[i - 1].x, heroTrail[i - 1].y)
      ctx.lineTo(heroTrail[i].x, heroTrail[i].y)
      ctx.stroke()
    }
    const glow = ctx.createRadialGradient(hero.x, hero.y, 0, hero.x, hero.y, hero.r * 7)
    glow.addColorStop(0, `rgba(255,255,255,${0.85 * hero.a})`)
    glow.addColorStop(0.35, `rgba(184,245,106,${0.5 * hero.a})`)
    glow.addColorStop(1, 'rgba(184,245,106,0)')
    ctx.globalAlpha = 1
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(hero.x, hero.y, hero.r * 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(hero.x, hero.y, hero.r, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

/** 星体到达脱出点：release 给欢迎链 → 天幕抬起 → 光丝停转 → 自卸 */
function arrive(skyEl: HTMLElement) {
  transitReleased.value = true
  const out = gsap.timeline({ onComplete: () => { cleanup(); finish() } })
  out.to(hero, { a: 0, r: 6, duration: 0.24, ease: 'power1.out' }, 0)
  out.to(state, { speed: 0, duration: 0.5, ease: 'power1.out' }, 0)
  out.to(skyEl, { opacity: 0, duration: 0.5, ease: 'power1.inOut' }, 0.1)
}

function cleanup() {
  loop?.stop()
  loop = null
  motes.length = 0
  streaks.length = 0
  heroTrail.length = 0
  if (ctx) ctx.clearRect(0, 0, vw, vh)
}

let guard = 0

onMounted(async () => {
  const cv = canvas.value
  const skyEl = sky.value
  if (!cv || !skyEl || motionSkipped()) return finish()
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.width = Math.round(vw * dpr)
  cv.height = Math.round(vh * dpr)
  ctx = cv.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  loop = createFrameLoop(draw)
  loop.start(cv)
  guard = window.setTimeout(() => { cleanup(); finish() }, 6000) // 安全阀：异常中断也不常驻

  // 交接被撤回：快速淡出退场（Login 已同时还原登录页面板）
  watch(transitAbort, async (abort) => {
    if (!abort || settled) return
    settled = true
    window.clearTimeout(guard)
    const tl = gsap.timeline({ onComplete: () => { cleanup(); emit('done') } })
    tl.to(skyEl, { opacity: 0, duration: 0.18, ease: 'power1.in' }, 0)
    tl.to(state, { speed: 0, duration: 0.18 }, 0)
  })

  await transitBegin // Login 对勾收尾 → startTransit()

  /* ① 消散：采样发射 0.45s，天幕同步淡入（Login 同时淡出 DOM，双重曝光要短） */
  pool = sampleLogin()
  emitUntil = performance.now() + 450
  await played(gsap.timeline().to(skyEl, { opacity: 1, duration: 0.32, ease: 'power1.out' }, 0))
  await wait(240) // 粒子飞尽

  /* ② 曲率穿越：光丝加速 0.55s → 巡航等 swap（上限 2.5s）→ 减速 0.3s + 脱出星起飞 */
  for (let i = 0; i < 200; i++) {
    const s = { x: 0, y: 0, z: 1, pz: 1, color: pick(), w: 0.8 + Math.random() * 1.3 }
    seedStreak(s, true)
    streaks.push(s)
  }
  await played(gsap.timeline().to(state, { speed: 1.5, duration: 0.55, ease: 'power2.in' }))
  const swapWait = performance.now()
  while (!transitSwapped.value && performance.now() - swapWait < 2500) await wait(50)

  heroOn = true
  hero.a = 1
  const h = { k: 0 }
  const mid = { x: (CX + HERO_TO.x) / 2, y: Math.min(CY, HERO_TO.y) - 120 }
  const flight = gsap.timeline()
  flight.to(state, { speed: 0.12, duration: 0.3, ease: 'power2.out' }, 0)
  flight.to(hero.r, { '2.5': 4, duration: 0.5, ease: 'power1.in' } as never, 0) // 半径渐长
  flight.to(h, {
    k: 1, duration: 0.5, ease: 'power2.inOut',
    onUpdate() {
      const k = h.k, ik = 1 - k
      hero.x = ik * ik * CX + 2 * ik * k * mid.x + k * k * HERO_TO.x
      hero.y = ik * ik * CY + 2 * ik * k * mid.y + k * k * HERO_TO.y
    },
  }, 0)
  flight.add(() => { window.clearTimeout(guard); arrive(skyEl) }, 0.52)
  await played(flight)
})

onBeforeUnmount(() => {
  window.clearTimeout(guard)
  cleanup()
})
</script>

<template>
  <Teleport to="body">
    <div class="transit-layer" aria-hidden="true">
      <div ref="sky" class="transit-sky" />
      <canvas ref="canvas" class="transit-canvas" />
    </div>
  </Teleport>
</template>
```

**Step 2: 样式（追加在组件末尾的 `<style>` 或 `styles/pages.css` 末尾——按项目惯例放 `pages.css`）**

```css
/* 登录转场特效层：天幕（银河底，穿越段全程暗场防闪）+ additive 画布。z-80 低于欢迎链 90 */
.transit-layer { position: fixed; inset: 0; z-index: 80; pointer-events: none; }
.transit-sky {
  position: absolute; inset: 0; opacity: 0;
  background:
    radial-gradient(60% 50% at 68% 38%, rgba(130, 221, 45, .12), transparent 70%),
    radial-gradient(50% 45% at 22% 78%, rgba(76, 141, 255, .1), transparent 70%),
    radial-gradient(120% 100% at 50% 50%, #10141a 0%, #07090d 68%, #040506 100%);
}
.transit-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
```

**注意**：`flight.to(hero.r, { '2.5': 4, ... } as never)` 这种写法不可靠，执行时改成对 `hero` 整体 tween：`flight.to(hero, { r: 4, duration: 0.5, ease: 'power1.in' }, 0)`（`hero.r` 是数字属性，直接 tween `hero` 的 `r` 即可）。

---

### Task 4: `App.vue` 挂载特效层

**Files:**
- Modify: `keystone-vue/src/App.vue`

```vue
<script setup lang="ts">
import ToastHost from '@/components/ui/ToastHost.vue'
import ConfirmHost from '@/components/ui/ConfirmHost.vue'
import WarpTransit from '@/components/welcome/WarpTransit.vue'
import { transitActive } from '@/composables/welcome'

function onTransitDone() { transitActive.value = false }
</script>

<template>
  <router-view />
  <ToastHost />
  <ConfirmHost />
  <WarpTransit v-if="transitActive" @done="onTransitDone" />
  <div class="grain-layer" aria-hidden="true" />
</template>
```

---

### Task 5: `Login.vue` — 压缩对勾 + 新转场流程

**Files:**
- Modify: `keystone-vue/src/views/Login.vue:83-98`（playSuccess）、`:134-157`（submit 流程）、import 行

**Step 1: `playSuccess` 砍掉回弹尾巴（描完即走，~0.94s）** — 删掉最后一句 `.to(orb, { scale: 1.06 ... }).to(orb, { scale: 1 ... })`，其余不动。

**Step 2: import 调整**：`playLoginExit` → `playLoginDissolve`；`@/composables/welcome` 增加 `abortTransit`（见 Step 3 用 `transitAbort` 直接赋值则不需）、`setTransitSwapped`、`startTransit`。

**Step 3: submit 的流程段（`await login(...)` 之后到 catch 之前）替换为**

```ts
    const warm = ensureRoutes().catch(() => false)
    // 落点页 chunk 预载（不 await）：对勾动画期间足够加载完，切路由不等网络
    warm.then(ok => { if (ok) preloadHome() })
    prefetchDashboard('24h', r => portalApi.dashboard.summary({ range: r }))
    beginHandoff() // 特效层挂载待命（standby），不挡对勾动画
    await playSuccess()
    startTransit() // 特效层进入消散段（异步自走）
    const dissolve = new Promise<void>(resolve => {
      const el = root.value
      if (!el) return resolve()
      playLoginDissolve(el, resolve)
    })
    await Promise.all([dissolve, warm])
    await wait(250) // 光丝加速段建立起速度再切换，切换全程暗场
    markArrived()
    const failure = await router.replace(redirect)
    if (failure || router.currentRoute.value.name === 'login') {
      succeeded.value = false
      finishHandoff() // 内含 transitAbort：特效层快速淡出
      restoreLoginStage(root.value)
    } else {
      setTransitSwapped() // 特效层进入减速 + 星体脱出段
    }
```

（`wait` 已在 Login.vue 无定义——顶部已有 `const wait = ...`？没有；Login.vue 现有 `waitForElement` 在别处。加 `const wait = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms))`，或用现有工具。执行时确认。）

**Step 4: 验证** — `npx vue-tsc --noEmit` 通过。

---

### Task 6: `WelcomeChain.vue` — 等 release 再起跑

**Files:**
- Modify: `keystone-vue/src/components/welcome/WelcomeChain.vue`（onMounted 开头）

在 `if (motionSkipped() || !plateEl ...) return finish()` 之后、星球坠落之前插入：

```ts
  // 曲率穿越特效的脱出星到达落点后才开始（直切/兜底 3s 后立即开始）；
  // 此时外壳入场早已落定，后续量标题的时序假设不变
  if (!transitReleased.value) {
    const t0 = performance.now()
    while (!transitReleased.value && performance.now() - t0 < 3000) await wait(50)
  }
```

import 增加 `transitReleased`（`@/composables/welcome`）。

---

### Task 7: 验证（真实环境 8090 + 5180）

**Step 1: 类型与构建** — `npx vue-tsc --noEmit && npx vite build`，Expected: 通过。

**Step 2: 亮度断言** — Run: `node scripts/shot-handoff-flash.mjs both`。Expected: 无「单帧亮度骤降」；人工核对亮度序列：切换窗口（暗→壳色）跨度 ≥6 帧渐变，穿越窗口（壳出现前 800ms）亮度 <70。

**Step 3: 结构回归** — Run: `node scripts/verify-welcome.mjs`。Expected: 全部 PASS（对勾压缩后「路由在退净后才切」仍成立；守卫/无幕断言不变）。若「深色画布淡出退场」的等待错过 0.38s 窄带导致截图取不到中间态，把该 waitFor 窗口调宽或接受截图缺失（断言不依赖截图）。

**Step 4: 目检** — 从 `scripts/handoff-flash-frames/` 抽取消散中段（粒子密度）、穿越中段（光丝拉丝感）、脱出到达帧与欢迎链首帧（星体坐标重合），逐张 Read 检查。

---

### Task 8: 文档与提交

**Files:**
- Modify: `changelog.md`（新增 2026-10-15 条目，替换当天「闪黑修复」条目中的过时描述——chunk 预取保留、根底色淡出回退）

提交（等用户确认，仓库约定不主动 commit）：

```bash
git add keystone-vue/src keystone-vue/scripts/shot-handoff-flash.mjs changelog.md docs/plans/2026-10-15-login-warp-transit-design.md docs/plans/2026-10-15-login-warp-transit.md
git commit -m "feat(login): 登录转场特效——消散、曲率穿越、星体脱出接管欢迎链"
```
