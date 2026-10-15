<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { currentUser } from '@/composables/auth'
import { createFrameLoop, gsap, motionSkipped, typeOut } from '@/composables/motion'
import { transitReleased } from '@/composables/welcome'
import { greetingOf } from '@/utils/greeting'

/* ============================================================
   欢迎链：星野常亮作底 → 星球自视口右上角坠落（彗星缎带尾）
        → 到中央蓄力压扁、炸开（放射光束 + 双冲击环 + 柔光闪 + 星野照亮）
        → 浮牌同点浮现（玻璃扫过一道光泽）→ 整句问候语逐字打出
        （打字光标 + 环绕轨道与双卫星巡航 + 牌底粒子上浮）
        → 青柠刻度线展开收窄 → 浮牌划弧回落页头标题、落定回弹「咔哒」
        → 牌淡去、真实标题接上

   几个刻意的选择：
   1. 飞行物是实体（先是星球，后是浮牌），不是线条——用户明确否定「一条线在飞」。
   2. 每段位移都写在「一条时间轴内」，x / y / scale / rotation 并行推进。
      分段 await 会让每段结束都停死一次，读起来就是刻板僵硬。
   3. **整句问候语都走打字机**，不预渲染「下午好，」。预渲染会让问候语一直亮着，
      只有名字在打字，看着像「这几个字没经过打字效果」。
   4. 天空元素（星野 / 拖尾 / 光束 / 轨道 / 粒子）全走 canvas：
      DOM 一多就掉帧，且需要 lighter 叠加做发光。
   5. 大屏幕上单靠一颗球太单薄——星野密度随视口面积走，
      光束与轨道负责把「炸开」和「停留」两段的空间撑满。

   几何：浮牌的 CSS 位置钉在标题位置（基准），位移走 transform 的
   x / y / scale / rotation，transform-origin 取中心——于是
   「视觉中心 = 基准中心 + 位移」，且 x=y=0、scale=1 时必然精确落回标题。
   ============================================================ */

const plate = ref<HTMLElement | null>(null)
const plateText = ref<HTMLElement | null>(null)
const glass = ref<HTMLElement | null>(null)
const orb = ref<HTMLElement | null>(null)
const shock = ref<HTMLElement | null>(null)
const shock2 = ref<HTMLElement | null>(null)
const flash = ref<HTMLElement | null>(null)
const dust = ref<HTMLCanvasElement | null>(null)

/** 播完即通知父级卸载本层。安全阀只兜「中途被打断」，
 *  不用固定时长猜——猜短了会把飞行中的东西掐掉。 */
const emit = defineEmits<{ (e: 'done'): void }>()
let settled = false
function finish() {
  if (settled) return
  settled = true
  emit('done')
}

const greeting = greetingOf()
const name = computed(() => currentUser.value?.nickname || currentUser.value?.username || '')
/** 完整问候语：整句交给打字机，从第一个字起就是「打」出来的 */
const line = computed(() => `${greeting}，${name.value}`)
const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))
/** GSAP 时间轴结束的 Promise 化：时间轴是 thenable，包一层更直观 */
const played = (tl: gsap.core.Timeline) => new Promise<void>(resolve => tl.eventCallback('onComplete', resolve))

/* ── 粒子层 ──────────────────────────────────────────────────────
   canvas 覆盖整个视口，是整条欢迎链的「天空」：
   星野常亮（微星各自闪烁，炸开瞬间整体照亮）、坠落时彗星缎带尾、
   炸开时放射光束、打字期间画环绕轨道与卫星、粒子负责火花与上浮。
   用 lighter 叠加做发光，浅色主题下改用常规合成——
   白底上 lighter 会把亮色洗成白色，等于看不见。 */
interface Particle {
  x: number; y: number; vx: number; vy: number
  life: number; max: number; r: number
  drag: number; grav: number; color: string; alpha: number
}

/* 彗星拖尾：坠落途中每帧记一个轨迹点，相邻点连成线宽递减的线段，
   整体是一条连续收窄的缎带尾——散点粒子是「火花」，缎带才是「流星」。 */
interface TrailDot { x: number; y: number; at: number; r: number }
/* 星野：相位与速率各异，正弦呼吸闪烁 */
interface Star { x: number; y: number; r: number; phase: number; speed: number; lime: boolean }
/* 放射光束：炸开瞬间自爆点射出的光线，快速伸长、平方衰减 */
interface Ray { ox: number; oy: number; a: number; len: number; max: number; life: number; ttl: number; w: number }

const particles: Particle[] = []
const trail: TrailDot[] = []
const stars: Star[] = []
const rays: Ray[] = []
let trailOn = false
let starBoost = 0
let orbitOn = false
let orbitAlpha = 0
let orbitAnchor: HTMLElement | null = null
let ctx: CanvasRenderingContext2D | null = null
let loop: ReturnType<typeof createFrameLoop> | null = null
let palette: string[] = ['#82dd2d']
let blend: GlobalCompositeOperation = 'lighter'
let starColor = '#8aa0b4'
let starAlpha = 0.2

function pushTrail(x: number, y: number, r: number) {
  if (!trailOn) return
  trail.push({ x, y, at: performance.now(), r })
  if (trail.length > 46) trail.shift()
}

/** 星野密度随视口面积走：大屏幕星更多，但不设上限地堆——110 封顶 */
function seedStars(w: number, h: number) {
  stars.length = 0
  const n = Math.round(Math.min(110, Math.max(60, (w * h) / 24000)))
  for (let i = 0; i < n; i++) {
    stars.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.8 + Math.random() * 1.6,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.7,
      lime: Math.random() > 0.78,
    })
  }
}

/** 炸开瞬间的放射光束：方向均布带抖动，长度随机 */
function burstRays(x: number, y: number, n: number) {
  for (let i = 0; i < n; i++) {
    rays.push({
      ox: x, oy: y,
      a: (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
      len: 12,
      max: 90 + Math.random() * 150,
      life: 0,
      ttl: 0.45 + Math.random() * 0.3,
      w: 1 + Math.random() * 1.4,
    })
  }
}

function startDust() {
  const cv = dust.value
  if (!cv) return () => {}
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = window.innerWidth
  const h = window.innerHeight
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  ctx = cv.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)

  const dark = document.documentElement.dataset.theme === 'dark'
  palette = dark ? ['#b6f56a', '#b6f56a', '#9fc9ff'] : ['#5cb316', '#7ccf2e', '#2f77e0']
  blend = dark ? 'lighter' : 'source-over'
  starColor = dark ? '#d6e7ff' : '#75879b'
  starAlpha = dark ? 0.5 : 0.38
  seedStars(w, h)

  loop = createFrameLoop((dt, t) => {
    if (!ctx) return
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]
      p.life += dt
      if (p.life >= p.max) { particles.splice(i, 1); continue }
      p.vy += p.grav * dt
      const damp = Math.max(0, 1 - p.drag * dt)
      p.vx *= damp
      p.vy *= damp
      p.x += p.vx * dt
      p.y += p.vy * dt
    }
    ctx.clearRect(0, 0, w, h)

    /* 星野：源合成作背景，不参与发光叠加。炸开瞬间 starBoost 顶到 1，
       全部星星一齐提亮再缓缓暗下——爆点的光照亮整片天。
       衰减放慢到 1.0/s（约 1 秒见底），让「照亮 → 暗下」的呼吸可读。 */
    starBoost = Math.max(0, starBoost - dt * 1.0)
    ctx.globalCompositeOperation = 'source-over'
    for (const s of stars) {
      const tw = 0.28 + 0.72 * (0.5 + 0.5 * Math.sin(t * s.speed * 2 + s.phase))
      ctx.globalAlpha = Math.min(1, (s.lime ? starAlpha * 1.7 : starAlpha) * tw * (1 + starBoost * 2.4))
      ctx.fillStyle = s.lime ? palette[1] ?? palette[0] : starColor
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalCompositeOperation = blend

    /* 彗星缎带尾：相邻轨迹点连成线宽递减的线段——一条连续收窄的尾巴，
       看得到的是「光带」，不是一串颗粒。 */
    const now = performance.now()
    for (let i = trail.length - 1; i >= 0; i--) {
      if ((now - trail[i].at) / 1000 > 0.34) trail.splice(i, 1)
    }
    ctx.strokeStyle = palette[0]
    ctx.lineCap = 'round'
    for (let i = 1; i < trail.length; i++) {
      const d = trail[i]
      const k = 1 - (now - d.at) / 1000 / 0.34
      ctx.globalAlpha = 0.42 * k * k
      ctx.lineWidth = Math.max(0.5, d.r * 2 * (0.15 + 0.85 * k))
      ctx.beginPath()
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y)
      ctx.lineTo(d.x, d.y)
      ctx.stroke()
    }

    /* 放射光束：快速伸长（趋近 max），亮度平方衰减 */
    for (let i = rays.length - 1; i >= 0; i--) {
      const r = rays[i]
      r.life += dt
      if (r.life >= r.ttl) { rays.splice(i, 1); continue }
      r.len += (r.max - r.len) * Math.min(1, dt * 9)
      const k = 1 - r.life / r.ttl
      ctx.globalAlpha = 0.55 * k * k
      ctx.strokeStyle = palette[0]
      ctx.lineWidth = r.w
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(r.ox + Math.cos(r.a) * 10, r.oy + Math.sin(r.a) * 10)
      ctx.lineTo(r.ox + Math.cos(r.a) * r.len, r.oy + Math.sin(r.a) * r.len)
      ctx.stroke()
    }

    for (const p of particles) {
      const t2 = p.life / p.max
      const rise = t2 < 0.1 ? t2 / 0.1 : 1
      ctx.globalAlpha = p.alpha * rise * (1 - t2) * (1 - t2)
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(0.2, p.r * (1 - t2 * 0.45)), 0, Math.PI * 2)
      ctx.fill()
    }

    /* 环绕轨道：打字期间一条细椭圆轨道绕浮牌运行，两颗卫星对角巡航。
       alpha 双向缓坡——归位开始时收场，不会硬切没。 */
    orbitAlpha += ((orbitOn ? 1 : 0) - orbitAlpha) * Math.min(1, dt * 3.2)
    if (orbitAnchor && orbitAlpha > 0.01) {
      const r = orbitAnchor.getBoundingClientRect()
      if (r.width) {
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const rx = r.width / 2 + 46
        const ry = rx * 0.3
        ctx.globalAlpha = 0.24 * orbitAlpha
        ctx.strokeStyle = palette[0]
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
        ctx.stroke()
        for (const [ang, rad] of [[t * 1.35, 3], [t * 1.35 + Math.PI, 2.1]] as const) {
          const sx = cx + Math.cos(ang) * rx
          const sy = cy + Math.sin(ang) * ry
          ctx.globalAlpha = 0.28 * orbitAlpha
          ctx.fillStyle = palette[0]
          ctx.beginPath()
          ctx.arc(sx, sy, rad * 2.6, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 0.9 * orbitAlpha
          ctx.beginPath()
          ctx.arc(sx, sy, rad, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  })
  loop.start(cv)

  return () => {
    loop?.stop()
    loop = null
    particles.length = 0
    trail.length = 0
    rays.length = 0
    stars.length = 0
    trailOn = false
    orbitOn = false
    orbitAlpha = 0
    orbitAnchor = null
    if (ctx) ctx.clearRect(0, 0, w, h)
  }
}

interface EmitOptions {
  speed: number
  spread?: number
  /** 发射方向（弧度）。不给则向四周均布撒开 */
  dir?: number
  r?: number
  max?: number
  grav?: number
  drag?: number
  alpha?: number
  jitter?: number
}

function spray(x: number, y: number, n: number, opt: EmitOptions) {
  for (let i = 0; i < n; i++) {
    const ang = opt.dir === undefined
      ? Math.random() * Math.PI * 2
      : opt.dir + (Math.random() - 0.5) * (opt.spread ?? Math.PI / 3)
    const sp = opt.speed * (0.55 + Math.random() * 0.9)
    const j = opt.jitter ?? 0
    particles.push({
      x: x + (Math.random() - 0.5) * j,
      y: y + (Math.random() - 0.5) * j,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life: 0,
      max: (opt.max ?? 0.9) * (0.7 + Math.random() * 0.6),
      r: (opt.r ?? 2) * (0.6 + Math.random() * 0.8),
      drag: opt.drag ?? 1.2,
      grav: opt.grav ?? 0,
      color: palette[Math.floor(Math.random() * palette.length)],
      alpha: opt.alpha ?? 0.9,
    })
  }
  // 上限兜底：极端情况下也不让粒子无限堆积
  if (particles.length > 340) particles.splice(0, particles.length - 340)
}

/** 取元素当前的视觉中心（含 transform），粒子要跟着它走 */
function centerOf(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** 等落点页把页头标题挂上。外壳比路由内容先挂载，这里必须轮询等一小会儿，
 *  量不到就只能放弃——宁可少播一次，也不要把浮牌定位到错误位置。 */
async function waitForElement<T extends Element>(selector: string, timeout = 2000): Promise<T | null> {
  const t0 = performance.now()
  while (performance.now() - t0 < timeout) {
    const el = document.querySelector<T>(selector)
    if (el && el.getBoundingClientRect().width) return el
    await wait(50)
  }
  return null
}

/** 居中态的放大倍率：小屏收敛，避免浮牌越出视口 */
const CENTER_SCALE = typeof window !== 'undefined' && window.innerWidth < 760 ? 1.2 : 1.42

onMounted(async () => {
  const plateEl = plate.value
  const textEl = plateText.value
  const glassEl = glass.value
  const orbEl = orb.value
  const shockEl = shock.value
  const shock2El = shock2.value
  const flashEl = flash.value
  if (motionSkipped() || !plateEl || !textEl || !glassEl || !orbEl || !shockEl || !shock2El || !flashEl) return finish()

  // 浮牌与星球必须第一帧就藏：它们的基准位置要到坠落之后才量，之前停在 (0,0)。
  // 「等脱出星到达」让挂载到开播之间多了至多 ~1s 的等待窗口，不先藏就会露出
  // 左上角的白块（浮牌）/ 绿球（星球）。CSS 已有默认 opacity:0，这里是双保险。
  gsap.set([plateEl, orbEl, shockEl, shock2El, flashEl], { opacity: 0 })

  // 曲率穿越特效的脱出星到达落点后才开始（直切/兜底 3s 后立即开始）；
  // 此时外壳入场早已落定，后续量标题的时序假设不变
  if (!transitReleased.value) {
    const t0 = performance.now()
    while (!transitReleased.value && performance.now() - t0 < 3000) await wait(50)
  }

  const title = await waitForElement<HTMLElement>('.page-title', 2000)
  if (!title) return finish()

  const stopDust = startDust()
  orbitAnchor = plateEl

  // 浮牌期间真实标题让位：归位时两者文字位置完全重合，接上时看不出接缝。
  gsap.set(title, { opacity: 0 })

  // ── 先让星球坠落，这一步不依赖标题位置 ──
  const vw = window.innerWidth
  const vh = window.innerHeight
  const midX = vw / 2
  const midY = vh / 2
  const orbHalf = { x: 31, y: 31 }

  /* 星球坠落：加速下坠 + 翻滚，**途中由小变大**，到中央炸开。
     起点只有一丁点大、越落越大——像一颗正冲过来的天体，距离越近视角越大，
     比「大小不变地掉下来」符合直觉。下坠与长大共用一段补间并行推进。
     坠落同时点火 canvas 彗星缎带尾（连续收窄，不是离散点）。 */
  gsap.set(orbEl, {
    x: vw - 150 - orbHalf.x,
    y: 116 - orbHalf.y,
    scale: 0.08,
    rotation: -34,
    opacity: 0,
  })
  trailOn = true
  const fall = gsap.timeline()
  const FALL = 1.06
  fall.to(orbEl, { opacity: 1, duration: 0.16, ease: 'power1.out' }, 0)
  fall.to(orbEl, {
    x: midX - orbHalf.x, y: midY - orbHalf.y,
    rotation: 10, scale: 1.5,
    duration: FALL, ease: 'power2.in',
  }, 0)
  // 尾迹：每帧从星球位置抛出粒子并记录缎带点，星球在长大，尾迹也随之变宽
  fall.to({}, {
    duration: FALL,
    onUpdate() {
      const c = centerOf(orbEl)
      const s = Number(gsap.getProperty(orbEl, 'scaleX')) || 1
      pushTrail(c.x, c.y, 31 * s * 0.55)
      spray(c.x, c.y, 2, { speed: 58, r: 2.8, max: 0.78, grav: -26, drag: 1.75, alpha: 0.9, jitter: 10 })
    },
  }, 0)
  await played(fall)

  /* ── 量标题：必须等坠落这段时间过去 ──
     落点页的入场还没跑完时量不到最终位置：pageEnter 会把页面从 scale 0.994
     拉到 1（在 x≈278 处正好差 4px），工作台自己还会把页头从 y:8 拉回 0（正好差 8px）。
     早量这几像素，归位后交叉淡化看起来就是「文字跳了一下」。
     坠落耗时 1.06s > 入场总时长，此时量到的就是定稿位置。 */
  await nextTick()
  const t0 = title.getBoundingClientRect()

  // ── 浮牌基准位置：让牌里的文字精确落在标题文字上 ──
  // 量两次：先用完整文本量一次（空文本量不到真实排版），设置 left/top；
  // 再复测补掉 padding 与亚像素舍入留下的残余偏差。
  gsap.set(plateEl, { left: 0, top: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 0 })
  textEl.textContent = line.value
  await nextTick()
  let pr = plateEl.getBoundingClientRect()
  let tr = textEl.getBoundingClientRect()
  let baseLeft = t0.left - (tr.left - pr.left)
  let baseTop = t0.top - (tr.top - pr.top)
  gsap.set(plateEl, { left: baseLeft, top: baseTop })
  await nextTick()
  pr = plateEl.getBoundingClientRect()
  tr = textEl.getBoundingClientRect()
  baseLeft += t0.left - tr.left
  baseTop += t0.top - tr.top
  gsap.set(plateEl, { left: baseLeft, top: baseTop })
  await nextTick()
  textEl.textContent = ''

  // ── 位移换算：transform-origin 取中心，视觉中心 = 基准中心 + 位移 ──
  const home = plateEl.getBoundingClientRect()
  const baseCX = home.left + home.width / 2
  const baseCY = home.top + home.height / 2
  const at = (cx: number, cy: number) => ({ x: cx - baseCX, y: cy - baseCY })
  const to = at(midX, midY)

  const rule = plateEl.querySelector<HTMLElement>('.welcome-rule')

  /* ── ① 炸开：星球先压扁蓄力（anticipation），再急剧膨胀消失——
     冲击波双环扩散、放射光束四射、柔光闪一下、星野被「照亮」，
     粒子四散。没有蓄力那 90ms，爆炸读起来就是「球没了」而不是「炸开」。 ── */
  const blastAt = centerOf(orbEl)
  trailOn = false
  starBoost = 1
  burstRays(blastAt.x, blastAt.y, 14)
  spray(blastAt.x, blastAt.y, 56, { speed: 420, r: 3.4, max: 1.05, grav: 230, drag: 1.6, alpha: 1, jitter: 8 })
  spray(blastAt.x, blastAt.y, 26, { speed: 300, dir: -Math.PI / 2, spread: Math.PI * 0.95, r: 3, max: 1.3, grav: 160, drag: 1.2, alpha: 0.95, jitter: 12 })

  /* ── ② 冲击波 + 浮牌自炸点长出来 ──
     主环粗亮、副环细淡慢半拍；柔光闪铺光量；玻璃牌浮现时扫过一道光泽。 */
  const burst = gsap.timeline()
  gsap.set(shockEl, { x: blastAt.x, y: blastAt.y, scale: 0.35, opacity: 0 })
  gsap.set(shock2El, { x: blastAt.x, y: blastAt.y, scale: 0.28, opacity: 0 })
  gsap.set(flashEl, { x: blastAt.x, y: blastAt.y, scale: 0.3, opacity: 0 })
  burst.to(orbEl, { scaleX: 1.74, scaleY: 1.3, duration: 0.09, ease: 'power2.in' }, 0)
  burst.to(orbEl, { scaleX: 3.3, scaleY: 3.3, opacity: 0, duration: 0.3, ease: 'power3.out' }, 0.09)
  burst.to(flashEl, { opacity: 0.6, duration: 0.07, ease: 'power1.out' }, 0.09)
  burst.to(flashEl, { scale: 1.55, opacity: 0, duration: 0.66, ease: 'power2.out' }, 0.16)
  burst.to(shockEl, { opacity: 0.9, duration: 0.08, ease: 'power1.out' }, 0.09)
  burst.to(shockEl, { scale: 3.8, opacity: 0, duration: 0.6, ease: 'power2.out' }, 0.17)
  burst.to(shock2El, { opacity: 0.55, duration: 0.08, ease: 'power1.out' }, 0.2)
  burst.to(shock2El, { scale: 2.6, opacity: 0, duration: 0.5, ease: 'power2.out' }, 0.28)
  burst.to(plateEl, {
    opacity: 1, scale: CENTER_SCALE, x: to.x, y: to.y, rotation: 0,
    duration: 0.5, ease: 'back.out(1.6)',
  }, 0.18)
  burst.add(() => plateEl.classList.add('is-sheen'), 0.22)
  orbitOn = true
  await played(burst)
  gsap.set(orbEl, { opacity: 0 })

  /* ── ③ 整句问候语逐字打出 ──
     打字期间牌宽一直在长，必须每写一个字就把牌重新居中，
     否则文字会从左往右单向撑开、整体偏右。居中用短补间而不是 set——
     set 是逐字跳半格，补间才是「牌面跟着字长」的连续手感。 */
  await wait(120)
  const recenter = () => {
    const r = plateEl.getBoundingClientRect()
    const want = midX - (r.left + r.width / 2)
    if (Math.abs(want) > 0.5) gsap.to(plateEl, { x: `+=${want}`, duration: 0.18, ease: 'power2.out', overwrite: 'auto' })
  }
  // 打字期间自牌底上浮的粒子：给中央的停留一点生气
  const halo = window.setInterval(() => {
    const r = plateEl.getBoundingClientRect()
    spray(r.left + Math.random() * r.width, r.bottom - 4, 1, {
      speed: 32, dir: -Math.PI / 2, spread: Math.PI * 0.8, r: 2.1, max: 1.5, grav: -16, drag: 0.9, alpha: 0.8, jitter: 6,
    })
  }, 85)

  plateEl.classList.add('is-typing')
  await new Promise<void>(resolve => {
    typeOut(line.value, value => {
      textEl.textContent = value
      recenter()
    }, resolve, { duration: 1.0, ease: 'power2.out' })
  })

  /* ── ④ 青柠刻度线展开再收窄：给「读完了」一个落定信号。
     收窄到一半时浮牌就起飞——刻度的尾声叠进归位的开头，两段之间没有死拍。 */
  if (rule) {
    gsap.fromTo(rule, { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.3, ease: 'power2.out', yoyo: true, repeat: 1, repeatDelay: 0.08 })
  }
  await wait(260)
  window.clearInterval(halo)
  plateEl.classList.remove('is-typing')
  plateEl.classList.remove('is-sheen')
  orbitOn = false

  /* ── ⑤ 回落归位：末端「吸附」落定 ──
     缓动用 expo.out——起步极快、末段极慢地被目标吸住，
     这是「归位」手感的关键；用 power2.inOut 会在末尾留一段刹车感。
     y 仍先掠过标题上方一点再落下，保住「落」的意味但不弹跳。 */
  const fallHome = gsap.timeline()
  fallHome.to(plateEl, { x: 0, duration: 1.0, ease: 'expo.out' }, 0)
  fallHome.to(plateEl, {
    keyframes: [
      { y: -40, duration: 0.34, ease: 'power2.out' },
      { y: 0, duration: 0.66, ease: 'expo.out' },
    ],
  }, 0)
  fallHome.to(plateEl, { scale: 1, duration: 0.72, ease: 'power3.out' }, 0.1)
  fallHome.to(plateEl, { rotation: -4, duration: 0.3, ease: 'power2.out' }, 0)
  fallHome.to(plateEl, { rotation: 0, duration: 0.5, ease: 'power3.out' }, 0.34)
  // 归位沿途继续掉一点粒子，把路径「画」出来
  fallHome.to({}, {
    duration: 1.0,
    onUpdate() {
      const r = plateEl.getBoundingClientRect()
      spray(r.left + Math.random() * r.width, r.bottom - 6, 1, {
        speed: 26, dir: -Math.PI / 2, spread: Math.PI * 0.7, r: 1.9, max: 1.15, grav: -14, drag: 0.9, alpha: 0.68, jitter: 9,
      })
    },
  }, 0)
  await played(fallHome)

  /* ── ⑤b 落定确认：归位的一瞬轻轻「咔哒」一下——一次小幅回弹，
     落点随牌宽散开一撮慢粒子。没有这个确认，浮牌是「漂到」而不是「落到」。 ── */
  const landed = plateEl.getBoundingClientRect()
  spray(landed.left + landed.width / 2, landed.top + landed.height / 2, 12, {
    speed: 130, r: 2.1, max: 0.66, grav: 210, drag: 1.7, alpha: 0.75, jitter: landed.width * 0.32,
  })
  const landPulse = gsap.timeline()
  landPulse.to(plateEl, { scale: 1.03, duration: 0.1, ease: 'power2.out' }, 0)
  landPulse.to(plateEl, { scale: 1, duration: 0.36, ease: 'back.out(2.6)' }, 0.1)
  await played(landPulse)

  /* ── ⑥ 交接：先把玻璃底化掉，再做一次「等量交叉」──
     玻璃底消失后只剩文字，而文字与真实标题已经逐像素对齐（基准位置测了两次），
     所以两个不透明度用同一时长、同一线性缓动同时走：
     总亮度恒为 1，屏幕上没有任何一帧看得出换了主体。 */
  const handover = gsap.timeline()
  handover.to(glassEl, { opacity: 0, duration: 0.26, ease: 'power2.out' }, 0)
  handover.to(plateEl, { opacity: 0, duration: 0.28, ease: 'none' }, 0.2)
  handover.to(title, { opacity: 1, duration: 0.28, ease: 'none' }, 0.2)
  await played(handover)

  gsap.set(title, { clearProps: 'opacity' })
  await wait(260) // 让残余粒子自然落尽再撤层
  stopDust()
  finish()
})
</script>

<template>
  <Teleport to="body">
    <div class="welcome-layer" aria-hidden="true">
      <canvas ref="dust" class="welcome-dust" />
      <div ref="flash" class="welcome-flash" />
      <div ref="shock" class="welcome-shock" />
      <div ref="shock2" class="welcome-shock welcome-shock--thin" />
      <div ref="orb" class="welcome-orb" />
      <div ref="plate" class="welcome-plate">
        <span ref="glass" class="welcome-glass" />
        <span class="welcome-line">
          <span ref="plateText" class="welcome-greet" />
          <span class="welcome-caret" />
        </span>
        <span class="welcome-rule" />
      </div>
    </div>
  </Teleport>
</template>