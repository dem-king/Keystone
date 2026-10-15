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
    glow.addColorStop(0, `rgba(255, 255, 255, ${0.85 * hero.a})`)
    glow.addColorStop(0.35, `rgba(184, 245, 106, ${0.5 * hero.a})`)
    glow.addColorStop(1, 'rgba(184, 245, 106, 0)')
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
  flight.to(hero, { r: 4, duration: 0.5, ease: 'power1.in' }, 0)
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
