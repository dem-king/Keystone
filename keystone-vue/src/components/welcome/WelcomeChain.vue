<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { currentUser } from '@/composables/auth'
import { createFrameLoop, gsap, motionSkipped, typeOut } from '@/composables/motion'
import { abortWelcome, resolveIdentityAnchor, transitReleased, welcomeAbort } from '@/composables/welcome'
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
/* 身份工牌：星落到用户胶囊后向左展开，先亮「所属部门」 */
const idcard = ref<HTMLElement | null>(null)
const idcardBody = ref<HTMLElement | null>(null)
const idcardDept = ref<HTMLElement | null>(null)
const idcardGlow = ref<HTMLElement | null>(null)
/** 气泡的尖角：卡片自己 overflow:hidden（要在展开时裁内容），尾巴只能独立放置 */
const idcardTail = ref<HTMLElement | null>(null)
/* 名字要能一分为二：主份留在句子里归标题，副份飞回右上角胶囊 */
const leadEl = ref<HTMLElement | null>(null)
const nameEl = ref<HTMLElement | null>(null)
const nameGhost = ref<HTMLElement | null>(null)
/** 分裂瞬间从名字中心亮起的一道竖光：没有它，两份文字只是「挪开了一点」 */
const nameFlash = ref<HTMLElement | null>(null)

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
/** 工牌文案走响应式：手动写 textContent 会被后续重渲染（currentUser 刷新）清掉 */
const deptText = computed(() => {
  const user = currentUser.value
  return user?.deptName || (user?.username ? `@${user.username}` : '已登录')
})
const deptLabel = computed(() => (currentUser.value?.deptName ? '所属部门' : '当前账号'))
/** 逐字拆开：部门名要一个字一个字「落」进牌里，整行淡入读起来是贴图 */
const deptChars = computed(() => [...deptText.value])
const wait = (ms: number) => new Promise<void>(resolve => {
  if (aborted) return
  window.setTimeout(resolve, ms)
})

/* ── 可打断：用户一动手，这条链立刻收场 ────────────────────────────
   登录动画不是「必须看完的广告」。点菜单、点按钮、滚轮、按键都算操作，
   要求是「立刻」——不是把剩余段落快进，而是就地结束并把页面交还给用户。
   实现上只做三件事：① 不再开新的一段；② 杀掉所有在跑的补间与帧循环；
   ③ 把被本层借走的真实 UI（页头标题、右上角头像）还回去。
   注意 played / wait 在 aborted 之后**永不给 resolve**：链条会自然停在
   当前 await，后面任何一行都不会再执行——否则它会重新点亮刚被收掉的元素。 */
let aborted = false
const timelines: gsap.core.Timeline[] = []
let stopDust: (() => void) | null = null
let cancelType: (() => void) | null = null
let halo = 0
/** 被本层压成 opacity: 0 的真实标题：收场时必须还回去，否则整页没有标题 */
let hiddenTitle: HTMLElement | null = null
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'AltGraph'])

/** GSAP 时间轴结束的 Promise 化：时间轴是 thenable，包一层更直观。
 *  已打断时把新建的时间轴直接杀掉并挂起——双保险，漏一处 if 也不会再播。 */
const played = (tl: gsap.core.Timeline) => new Promise<void>(resolve => {
  if (aborted) { tl.kill(); return }
  timelines.push(tl)
  tl.eventCallback('onComplete', resolve)
})

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
  /** 被吸向一点：工牌收束成星时用，与 spray 的「向外」方向相反 */
  pull?: { x: number; y: number; k: number }
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
      if (p.pull) {
        const k = p.pull.k * dt
        p.vx += (p.pull.x - p.x) * k
        p.vy += (p.pull.y - p.y) * k
      }
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

/** 被吸向一点的粒子：工牌收束成星的一瞬，四周碎屑朝收束点汇聚。
 *  与 spray 方向相反，不能复用——那会让「收」读成「炸」。 */
function sprayIn(cx: number, cy: number, n: number, opt: { radius?: number; k?: number; r?: number; max?: number } = {}) {
  const radius = opt.radius ?? 110
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const d = radius * (0.45 + Math.random() * 0.85)
    particles.push({
      x: cx + Math.cos(a) * d,
      y: cy + Math.sin(a) * d * 0.55,
      vx: 0,
      vy: 0,
      life: 0,
      max: (opt.max ?? 0.52) * (0.8 + Math.random() * 0.5),
      r: opt.r ?? 2.2,
      drag: 0,
      grav: 0,
      color: palette[Math.floor(Math.random() * palette.length)],
      alpha: 0.9,
      pull: { x: cx, y: cy, k: opt.k ?? 9 },
    })
  }
  if (particles.length > 340) particles.splice(0, particles.length - 340)
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

/** 还原右上角胶囊：任何提前退出（量不到标题、异常、卸载）都必须摘掉 opacity 内联值，
 *  否则整条链一走神，用户就永远看不到自己的头像 */
function restoreChip() {
  const chip = document.querySelector<HTMLElement>('.user-chip')
  if (!chip) return
  gsap.set(chip, { clearProps: 'opacity' })
  // 头像在握手时被缩到 0.3 过冲回来，异常退出必须把 transform 摘掉
  const avatar = chip.querySelector<HTMLElement>('.avatar')
  if (avatar) gsap.set(avatar, { clearProps: 'transform' })
}

/** 立刻收场（停摆 Halt）：不播剩余段落，直接把手上的东西全部还回去。
 *  「立刻」的含义是同一个事件里就结束——不淡出、不快进，用户点完第一帧
 *  看到的就是正常页面（特效层残留由本层卸载带走）。 */
function stopNow() {
  aborted = true
  // 补间先杀：kill 不触发 onComplete，链条会停在当前 await，不会再往下走
  timelines.splice(0).forEach(tl => tl.kill())
  cancelType?.()
  cancelType = null
  window.clearInterval(halo)
  halo = 0
  stopDust?.()
  stopDust = null
  trailOn = false
  orbitOn = false

  const els = [
    plate.value, glass.value, orb.value, shock.value, shock2.value, flash.value,
    idcard.value, idcardGlow.value, idcardTail.value, nameGhost.value, nameFlash.value,
  ].filter((el): el is HTMLElement => Boolean(el))
  gsap.killTweensOf(els)
  plate.value?.classList.remove('is-typing', 'is-sheen')
  idcard.value?.classList.remove('is-sheen')
  // 本层随后会被卸载，但同一帧里不能再闪一下：先压回不可见
  if (els.length) gsap.set(els, { opacity: 0 })
  if (hiddenTitle?.isConnected) gsap.set(hiddenTitle, { clearProps: 'opacity' })
  restoreChip()
}

/** 用户操作 = 打断信号：点导航 / 点按钮 / 滚轮 / 按键（纯修饰键不算操作） */
function onGesture(event: Event) {
  if (event instanceof KeyboardEvent && MODIFIER_KEYS.has(event.key)) return
  abortWelcome()
}

watch(welcomeAbort, (value) => {
  if (!value || settled) return
  stopNow()
  finish()
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onGesture, true)
  window.removeEventListener('keydown', onGesture, true)
  window.removeEventListener('wheel', onGesture)
  stopNow()
})

onMounted(async () => {
  // 调试：带 #slow 打开时把全局时间轴放慢，便于逐帧核对（仅开发环境生效）
  if (import.meta.env.DEV && location.hash === '#slow') gsap.globalTimeline.timeScale(0.45)

  // 挂载前就已被打断（极端时序）：什么都不演，直接卸载
  if (welcomeAbort.value || motionSkipped()) { finish(); return }

  // 从挂载起就接收「用户要干别的」：欢迎层 pointer-events: none，事件会真实落到
  // 导航与页面上，这里只旁听、不拦截——点击照常生效，动画同时退场
  window.addEventListener('pointerdown', onGesture, { capture: true, passive: true })
  window.addEventListener('keydown', onGesture, { capture: true })
  window.addEventListener('wheel', onGesture, { passive: true })

  const plateEl = plate.value
  const glassEl = glass.value
  const orbEl = orb.value
  const shockEl = shock.value
  const shock2El = shock2.value
  const flashEl = flash.value
  const greetEl = plateText.value
  const idcardEl = idcard.value
  const idcardBodyEl = idcardBody.value
  const deptEl = idcardDept.value
  const idcardGlowEl = idcardGlow.value
  const tailEl = idcardTail.value
  const leadTextEl = leadEl.value
  const nameTextEl = nameEl.value
  const ghostEl = nameGhost.value
  const nameFlashEl = nameFlash.value
  if (motionSkipped() || !plateEl || !glassEl || !orbEl || !shockEl || !shock2El || !flashEl
    || !greetEl || !idcardEl || !idcardBodyEl || !deptEl || !idcardGlowEl
    || !leadTextEl || !nameTextEl || !ghostEl) return finish()

  // 窄屏整层被 CSS 隐藏（@media 760）：组件仍会挂载，链条若照跑，
  // 右上角胶囊会被藏将近 9 秒。这里直接收工，让 chip 保持可见。
  if (window.innerWidth < 760) { restoreChip(); return finish() }

  // 依赖 JS 量位的元素一律 CSS 默认隐藏，这里再兜一层：
  // 挂载到开播之间有「等脱出星」的窗口，不藏就会在左上角露出白块 / 绿球。
  gsap.set([plateEl, orbEl, shockEl, shock2El, flashEl, idcardEl, idcardGlowEl, ghostEl], { opacity: 0 })

  /* 右上角胶囊：整条链期间由这里接管——星先落到它身上，副份最后飞回它怀里，
     中途它必须是空的（playShellEntrance 已在交接期把它排除出 stagger 补间）。 */
  const chipEl = document.querySelector<HTMLElement>('.user-chip')
  if (chipEl) gsap.set(chipEl, { opacity: 0 })

  // 曲率穿越的脱出星到达后才开始（直切 / 兜底 3s 后立即开始）
  if (!transitReleased.value) {
    const t0 = performance.now()
    while (!transitReleased.value && !aborted && performance.now() - t0 < 3000) await wait(50)
    if (aborted) return
  }

  const title = await waitForElement<HTMLElement>('.page-title', 2000)
  if (aborted) return
  if (!title) { restoreChip(); return finish() }

  stopDust = startDust()
  orbitAnchor = plateEl

  // 浮牌期间真实标题让位：归位时两者文字位置完全重合，接上时看不出接缝
  hiddenTitle = title
  gsap.set(title, { opacity: 0 })

  const vw = window.innerWidth
  const vh = window.innerHeight
  const midX = vw / 2
  const midY = vh / 2
  const orbHalf = { x: 31, y: 31 }

  /* ── P1 星归：脱出星已经停在身份锚点（与 WarpTransit 共用量位函数），
     这里只做「原地长成身份核 + 绽一圈微光环」。
     这一段没有位移——飞行由穿越层完成，再接一次「飞过来」就会读成两颗星。
     落点尺寸取 0.78（≈48px）：胶囊高 40，球比它大一圈才像「压在上面」；
     给到 62 会把胶囊整个盖死，下一步「星缩成胶囊」就没有起手式。 ── */
  const anchor = resolveIdentityAnchor() ?? { x: vw - 150, y: 116 }
  gsap.set(orbEl, { x: anchor.x - orbHalf.x, y: anchor.y - orbHalf.y, scale: 0.18, rotation: -18, opacity: 0 })

  /* 撞击：星不是「停在」胶囊上，是**砸**上去——
     先压扁（scaleX 1.34 / scaleY 0.58），再 back.out 回弹；同时双冲击环 + 柔光 + 碎屑。
     没有压扁这一下，冲击环就只是「旁边冒了个圈」，跟星没关系。 */
  const IMPACT = 0.2
  const arrive = gsap.timeline()
  arrive.to(orbEl, { opacity: 1, duration: 0.1, ease: 'power1.out' }, 0)
  arrive.to(orbEl, { scale: 0.78, rotation: 0, duration: IMPACT, ease: 'power3.in' }, 0)
  arrive.to(orbEl, { scaleX: 1.34, scaleY: 0.56, duration: 0.07, ease: 'power2.in' }, IMPACT)
  arrive.to(orbEl, { scaleX: 0.78, scaleY: 0.78, duration: 0.44, ease: 'back.out(3.2)' }, IMPACT + 0.07)

  gsap.set(shockEl, { x: anchor.x, y: anchor.y, scale: 0.12, opacity: 0 })
  gsap.set(shock2El, { x: anchor.x, y: anchor.y, scale: 0.1, opacity: 0 })
  arrive.to(shockEl, { opacity: 0.95, duration: 0.06, ease: 'power1.out' }, IMPACT)
  arrive.to(shockEl, { scale: 4.2, opacity: 0, duration: 0.62, ease: 'power2.out' }, IMPACT + 0.03)
  arrive.to(shock2El, { opacity: 0.6, duration: 0.06, ease: 'power1.out' }, IMPACT + 0.05)
  arrive.to(shock2El, { scale: 3, opacity: 0, duration: 0.5, ease: 'power2.out' }, IMPACT + 0.09)
  gsap.set(flashEl, { x: anchor.x, y: anchor.y, scale: 0.12, opacity: 0 })
  arrive.to(flashEl, { opacity: 0.5, duration: 0.05, ease: 'power1.out' }, IMPACT)
  arrive.to(flashEl, { scale: 0.44, opacity: 0, duration: 0.52, ease: 'power2.out' }, IMPACT + 0.03)
  arrive.add(() => {
    spray(anchor.x, anchor.y, 26, { speed: 360, r: 2.4, max: 0.8, grav: 260, drag: 1.8, alpha: 0.95, jitter: 10 })
    starBoost = 0.9
  }, IMPACT)
  await played(arrive)
  if (aborted) return

  /* ── P2 身份气泡：星从头像上滑下来，一边滑一边摊开成一张部门气泡。
     挂在胶囊正下方（top = 胶囊底 + 14）、右边缘对齐胶囊——不压顶栏，
     纵向「垂落 + 摊开」比横向「变宽」有重量，也不会被读成顶栏变形。 ── */
  await nextTick()
  if (aborted) return
  gsap.set(idcardEl, { left: 0, top: 0, right: 'auto', x: 0, y: 0, width: 'auto', height: 'auto', borderRadius: 14, opacity: 0, filter: 'none' })
  await nextTick()
  if (aborted) return
  const naturalW = Math.ceil(idcardEl.getBoundingClientRect().width)
  const bubbleW = Math.min(236, Math.max(150, naturalW))
  const BUBBLE_H = 64

  const chipRect = chipEl?.getBoundingClientRect()
  const rightEdge = chipRect ? chipRect.right - 2 : vw - 12
  const bubbleLeft = rightEdge - bubbleW
  const bubbleTop = (chipRect ? chipRect.bottom : 70) + 10

  // 起点：48×48 正圆，与星球同尺寸同位——形状不跳，读作「同一颗东西在变形」
  const START = 48
  const startLeft = anchor.x - START / 2
  const startTop = anchor.y - START / 2

  const labelEl = idcardEl.querySelector<HTMLElement>('.welcome-idcard-label')
  const charEls = Array.from(idcardEl.querySelectorAll<HTMLElement>('.dept-char'))

  gsap.set(idcardEl, {
    left: startLeft, top: startTop,
    width: START, height: START, borderRadius: 999,
    opacity: 0, filter: 'blur(5px)',
  })
  gsap.set(labelEl, { opacity: 0 })
  gsap.set(charEls, { opacity: 0, y: 5 })
  gsap.set(tailEl, { left: bubbleLeft + 12, top: bubbleTop - 6, opacity: 0 })
  gsap.set(idcardGlowEl, { x: anchor.x, y: anchor.y, opacity: 0, scale: 0.5 })

  const open = gsap.timeline()
  // 星球缩进圆里：不是淡出，是被这颗圆「接管」
  open.to(orbEl, { scale: 0.28, opacity: 0, duration: 0.22, ease: 'power2.in' }, 0)
  // 圆 → 气泡：位置 / 宽 / 高 / 圆角四属性同一条补间，轨迹是往右下摊开
  open.to(idcardEl, { opacity: 1, duration: 0.16, ease: 'power1.out' }, 0.02)
  open.to(idcardEl, {
    left: bubbleLeft, top: bubbleTop,
    width: bubbleW, height: BUBBLE_H, borderRadius: 14,
    filter: 'blur(0px)',
    duration: 0.54, ease: 'power3.out',
  }, 0.02)
  open.to(idcardGlowEl, { opacity: 0.9, scale: 1, duration: 0.36, ease: 'power2.out' }, 0)
  open.to(idcardGlowEl, { opacity: 0, duration: 0.42, ease: 'power1.in' }, 0.5)
  // 尖角在气泡成形后补上「指向」：没有它，这张卡是孤立飘着的
  open.to(tailEl, { opacity: 1, duration: 0.2, ease: 'power2.out' }, 0.5)
  open.to(labelEl, { opacity: 1, duration: 0.24, ease: 'power2.out' }, 0.2)
  open.to(charEls, { opacity: 1, y: 0, duration: 0.26, ease: 'power2.out', stagger: 0.018 }, 0.26)
  open.add(() => idcardEl.classList.add('is-sheen'), 0.46)
  // 停留：静止读完（0.72s 是 8 个字的部门名的下限），只让光泽扫过一次
  open.to({}, { duration: 0.72 }, 0.56)
  await played(open)
  if (aborted) return

  /* ── P3 收束：气泡按原路收回成 48px 圆、升回头像位置，星从圆里弹出来。
     不用整块 scale 压扁——那会把字拉成一条，读作「被压坏」而不是「收回去」。 ── */
  const seedX = anchor.x
  const seedY = anchor.y
  gsap.set(orbEl, { x: seedX - orbHalf.x, y: seedY - orbHalf.y, scale: 0.3, rotation: -12, opacity: 0 })
  sprayIn(seedX, seedY, 16, { radius: 130, k: 8, r: 2, max: 0.5 })
  const collapse = gsap.timeline()
  collapse.to(charEls, { opacity: 0, duration: 0.14, ease: 'power1.in', stagger: { each: 0.02, from: 'end' } }, 0)
  collapse.to(labelEl, { opacity: 0, duration: 0.14, ease: 'power1.in' }, 0)
  collapse.to(tailEl, { opacity: 0, duration: 0.12, ease: 'power1.in' }, 0)
  collapse.to(idcardEl, {
    left: startLeft, top: startTop,
    width: START, height: START, borderRadius: 999,
    filter: 'blur(4px)',
    duration: 0.44, ease: 'power2.inOut',
  }, 0.06)
  // 星从圆里弹出来：先小后过冲，尺寸回到 P1 的 0.78
  collapse.to(orbEl, { opacity: 1, scale: 0.46, duration: 0.16, ease: 'power2.out' }, 0.3)
  collapse.to(orbEl, { scale: 0.78, duration: 0.28, ease: 'back.out(2.2)' }, 0.44)
  collapse.add(() => { starBoost = 0.4 }, 0.34)
  await played(collapse)
  if (aborted) return
  idcardEl.classList.remove('is-sheen')
  gsap.set(idcardEl, { opacity: 0 })

  /* ── P4 坠落：从工牌右缘抛向视口中央——先向外抬一点再内收，避免贴顶栏走 ── */
  trailOn = true
  const FALL = 0.92
  const fallen = gsap.timeline()
  fallen.to(orbEl, { x: seedX - orbHalf.x + 24, y: seedY - orbHalf.y + 34, scale: 0.92, rotation: -8, duration: 0.2, ease: 'power2.out' }, 0)
  fallen.to(orbEl, { x: midX - orbHalf.x, y: midY - orbHalf.y, rotation: 8, scale: 1.35, duration: FALL - 0.2, ease: 'power2.in' }, 0.2)
  fallen.to({}, {
    duration: FALL,
    onUpdate() {
      const c = centerOf(orbEl)
      const s = Number(gsap.getProperty(orbEl, 'scaleX')) || 1
      pushTrail(c.x, c.y, 31 * s * 0.55)
      spray(c.x, c.y, 2, { speed: 58, r: 2.8, max: 0.78, grav: -26, drag: 1.75, alpha: 0.9, jitter: 10 })
    },
  }, 0)
  await played(fallen)
  if (aborted) return

  /* ── 量标题：必须等坠落这段时间过去 ──
     pageEnter 把页面从 scale 0.994 拉到 1（x≈278 处差 4px），工作台还把页头从 y:8
     拉回 0（差 8px）。早量这几像素，归位后交叉淡化就是「文字跳了一下」。 */
  await nextTick()
  if (aborted) return
  const t0 = title.getBoundingClientRect()

  // 浮牌基准位置：让牌里的文字精确落在标题文字上（量两次补 padding 与舍入）
  gsap.set(plateEl, { left: 0, top: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 0 })
  leadTextEl.textContent = line.value
  nameTextEl.textContent = ''
  await nextTick()
  if (aborted) return
  let pr = plateEl.getBoundingClientRect()
  let tr = greetEl.getBoundingClientRect()
  let baseLeft = t0.left - (tr.left - pr.left)
  let baseTop = t0.top - (tr.top - pr.top)
  gsap.set(plateEl, { left: baseLeft, top: baseTop })
  await nextTick()
  if (aborted) return
  pr = plateEl.getBoundingClientRect()
  tr = greetEl.getBoundingClientRect()
  baseLeft += t0.left - tr.left
  baseTop += t0.top - tr.top
  gsap.set(plateEl, { left: baseLeft, top: baseTop })
  await nextTick()
  if (aborted) return

  // ── 位移换算：transform-origin 取中心，视觉中心 = 基准中心 + 位移 ──
  // 必须在**清空文本之前**量：清空后牌宽塌成 padding，baseCX 会小掉半个句宽，
  // 之后算出的归位位移就会比实际大几十像素——第一帧「向右甩一下」就是这么来的。
  const home = plateEl.getBoundingClientRect()
  const baseCX = home.left + home.width / 2
  const baseCY = home.top + home.height / 2
  leadTextEl.textContent = ''
  nameTextEl.textContent = ''
  const at = (cx: number, cy: number) => ({ x: cx - baseCX, y: cy - baseCY })
  const to = at(midX, midY)

  const rule = plateEl.querySelector<HTMLElement>('.welcome-rule')

  /* ── P5 迸溅：星球压扁蓄力 → 急剧膨胀消失；双冲击环 + 放射光束 + 柔光 + 星野照亮 ── */
  const blastAt = centerOf(orbEl)
  trailOn = false
  starBoost = 1
  burstRays(blastAt.x, blastAt.y, 14)
  spray(blastAt.x, blastAt.y, 56, { speed: 420, r: 3.4, max: 1.05, grav: 230, drag: 1.6, alpha: 1, jitter: 8 })
  spray(blastAt.x, blastAt.y, 26, { speed: 300, dir: -Math.PI / 2, spread: Math.PI * 0.95, r: 3, max: 1.3, grav: 160, drag: 1.2, alpha: 0.95, jitter: 12 })

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
  if (aborted) return
  gsap.set(orbEl, { opacity: 0 })

  /* ── P6 整句问候语逐字打出 ──
     打字期间牌宽一直在长，每写一个字都要重新居中；居中用短补间而不是 set，
     否则牌面是逐字跳半格。文本按名字边界写进两个 span，分裂时不必重排 DOM。 */
  await wait(120)
  if (aborted) return
  const recenter = () => {
    const r = plateEl.getBoundingClientRect()
    const want = midX - (r.left + r.width / 2)
    if (Math.abs(want) > 0.5) gsap.to(plateEl, { x: `+=${want}`, duration: 0.18, ease: 'power2.out', overwrite: 'auto' })
  }
  halo = window.setInterval(() => {
    const r = plateEl.getBoundingClientRect()
    spray(r.left + Math.random() * r.width, r.bottom - 4, 1, {
      speed: 32, dir: -Math.PI / 2, spread: Math.PI * 0.8, r: 2.1, max: 1.5, grav: -16, drag: 0.9, alpha: 0.8, jitter: 6,
    })
  }, 85)

  const chars = [...line.value]
  const nameChars = [...name.value]
  const boundary = chars.length - nameChars.length
  const draw = (value: string) => {
    const list = [...value]
    const cut = Math.min(list.length, boundary)
    leadTextEl.textContent = list.slice(0, cut).join('')
    nameTextEl.textContent = list.slice(cut).join('')
  }

  plateEl.classList.add('is-typing')
  await new Promise<void>(resolve => {
    // 取消句柄留给打断：typeOut 的补间在 stopNow 里被 kill，Promise 不再 resolve
    cancelType = typeOut(line.value, value => {
      if (aborted) return
      draw(value)
      recenter()
    }, resolve, { duration: 0.96, ease: 'power2.out' })
  })
  cancelType = null
  if (aborted) return

  /* ── P7 分裂：把名字拆成单字，先震一下、亮一道光缝，再逐字向右上拉出去。
     整段一起复制读作「多了一份」，逐字错开才是「裂开」。
     ghost 的字号 / 字重 / 字距从主份逐项复制、**不加 scale**——
     之前用 1.05 + 字距 .2em，两份看起来不一样大，是这段最刺眼的问题。 ── */
  if (rule) {
    gsap.fromTo(rule, { scaleX: 0, opacity: 0 }, { scaleX: 1, opacity: 1, duration: 0.3, ease: 'power2.out', yoyo: true, repeat: 1, repeatDelay: 0.08 })
  }

  const nr = nameTextEl.getBoundingClientRect()
  const gs = getComputedStyle(nameTextEl)
  const splitChars = [...name.value]

  // 主份拆成单字（打字已结束，此时改 DOM 不会再影响光标）
  nameTextEl.innerHTML = ''
  splitChars.forEach(ch => {
    const sp = document.createElement('span')
    sp.className = 'name-char'
    sp.textContent = ch
    nameTextEl.appendChild(sp)
  })
  const nameCharEls = Array.from(nameTextEl.querySelectorAll<HTMLElement>('.name-char'))

  // 副份同样拆字：逐字错开才拉得出斜向分离
  ghostEl.innerHTML = ''
  splitChars.forEach(ch => {
    const sp = document.createElement('span')
    sp.className = 'ghost-char'
    sp.textContent = ch
    ghostEl.appendChild(sp)
  })
  const ghostChars = Array.from(ghostEl.querySelectorAll<HTMLElement>('.ghost-char'))

  gsap.set(ghostEl, {
    left: nr.left, top: nr.top, x: 0, y: 0, scale: 1, rotation: 0, opacity: 0,
    fontSize: gs.fontSize, fontWeight: gs.fontWeight,
    // 字距用 em 而不是读 computed 的 px：-0.84px 会被浏览器舍成 -1px，两份就差一档
    letterSpacing: '-0.03em', fontFamily: gs.fontFamily, lineHeight: gs.lineHeight,
  })
  if (nameFlashEl) {
    gsap.set(nameFlashEl, {
      left: nr.left + nr.width / 2 - 1.5,
      top: nr.top - 3,
      // 光缝高度按字号算，不用 nameEl 的 rect（inline 盒会把 line-height 与负字距都算进去）
      height: Math.round(parseFloat(gs.fontSize) * 1.35),
      opacity: 0, scaleY: 0.12,
    })
  }

  const split = gsap.timeline()
  // ① 击中：奇偶交错上下一颤，读作「被劈了一下」
  split.to(nameCharEls, {
    y: (i: number) => (i % 2 === 0 ? -3.5 : 3.5),
    duration: 0.09, ease: 'power2.out', stagger: 0.014,
  }, 0)
  split.to(nameCharEls, {
    y: 0, duration: 0.26, ease: 'back.out(2.6)', stagger: 0.014,
  }, 0.11)
  // ② 光缝：名字中心亮起一道竖光，随即张开淡去
  if (nameFlashEl) {
    split.to(nameFlashEl, { opacity: 1, scaleY: 1, scaleX: 1.6, duration: 0.11, ease: 'power1.out' }, 0.03)
    split.to(nameFlashEl, { opacity: 0, scaleY: 1.3, scaleX: 2.4, duration: 0.28, ease: 'power2.in' }, 0.16)
  }
  // ③ 分离：副份自原位浮出，逐字向右上错开
  split.to(ghostEl, { opacity: 1, duration: 0.12, ease: 'power1.out' }, 0.07)
  split.to(ghostChars, {
    x: (i: number) => 3 + i * 4.5,
    y: (i: number) => -2 - i * 3,
    duration: 0.32, ease: 'back.out(1.7)', stagger: 0.035,
  }, 0.1)
  split.to(ghostEl, { rotation: -2.4, duration: 0.32, ease: 'power2.out' }, 0.1)
  // ④ 分裂点炸一小圈碎屑
  split.add(() => {
    spray(nr.left + nr.width / 2, nr.top + nr.height / 2, 14, {
      speed: 140, r: 1.9, max: 0.55, grav: 150, drag: 1.9, alpha: 0.75, jitter: Math.max(12, nr.width * 0.3),
    })
  }, 0.05)
  await played(split)
  if (aborted) return

  /* ── P8 双归宿：主份随问候语吸附回标题，副份飞回右上角胶囊。
     同帧起飞、副份晚 0.06s 建立主次；两段并行，总时长不叠加。 ── */
  /* 归位：一条二次贝塞尔同时走 x / y / scale / rotation。
     原来 x 用 expo.out、y 用「先 -40 再 0」的两段 keyframes——两条速度曲线不同，
     合成轨迹在中段会拐一个直角：前半秒「冲出去」，后半秒「慢慢漂」，读起来就是
     生硬地顿一下。改成单参数 t 驱动后，所有属性同进同退，末端仍然是 power3 的吸附。
     控制点压到标题上方，轨道先抬后落，掠过标题右上再落下。 */
  const homeFrom = { x: to.x, y: to.y }
  const homeCtrl = { x: to.x * 0.72, y: -to.y * 0.12 }
  const homeStartScale = CENTER_SCALE
  const k = { t: 0 }
  let prevAbs = { x: midX, y: midY }
  const fallHome = gsap.timeline()
  fallHome.to(k, {
    // inOut 而不是 out：归位的两端都是静止（打字刚停 / 即将落位），
    // out 曲线一上来就是 3 倍平均速度，读作「弹射」；inOut 才有起步与吸附。
    t: 1, duration: 1.0, ease: 'power3.inOut',
    onUpdate() {
      const t = k.t, it = 1 - t
      const x = it * it * homeFrom.x + 2 * it * t * homeCtrl.x
      const y = it * it * homeFrom.y + 2 * it * t * homeCtrl.y
      gsap.set(plateEl, {
        x, y,
        scale: homeStartScale + (1 - homeStartScale) * t,
        rotation: -3.2 * Math.sin(Math.PI * t),
      })
      // 拖尾沿运动反方向撒：固定朝上会读成「牌底在冒火花」，不是「飞过留下的痕」
      const ax = baseCX + x
      const ay = baseCY + y
      const dx = ax - prevAbs.x
      const dy = ay - prevAbs.y
      if (Math.hypot(dx, dy) > 1.5) {
        spray(ax + (Math.random() - 0.5) * 46, ay + 6, 1, {
          speed: 22, dir: Math.atan2(dy, dx) + Math.PI, spread: 0.7,
          r: 1.8, max: 0.9, grav: 34, drag: 1.2, alpha: 0.55, jitter: 9,
        })
      }
      prevAbs = { x: ax, y: ay }
    },
  }, 0)

  // 副份终点：胶囊里的昵称文字；窄屏 meta 被隐藏时回落到头像中心
  const targetEl = document.querySelector<HTMLElement>('.user-chip .user-name')
  const trg = targetEl?.getBoundingClientRect()
  const targetVisible = Boolean(trg && trg.width > 1 && trg.height > 1)
  const nameFont = parseFloat(getComputedStyle(nameTextEl).fontSize) || 28
  const targetFont = targetVisible && targetEl ? (parseFloat(getComputedStyle(targetEl).fontSize) || 12.5) : nameFont
  const endScale = targetVisible ? targetFont / nameFont : 0.3

  const gr = ghostEl.getBoundingClientRect()
  const gcx = gr.left + gr.width / 2
  const gcy = gr.top + gr.height / 2
  const tx = targetVisible && trg ? trg.left + trg.width / 2 : anchor.x
  const ty = targetVisible && trg ? trg.top + trg.height / 2 : anchor.y
  const curX = Number(gsap.getProperty(ghostEl, 'x')) || 0
  const curY = Number(gsap.getProperty(ghostEl, 'y')) || 0
  const dx = tx - gcx
  const dy = ty - gcy

  const fly = gsap.timeline()
  fly.to(ghostEl, {
    keyframes: [
      { x: curX + dx * 0.5, y: curY + dy * 0.28 - 96, scale: 0.86, rotation: -1, duration: 0.38, ease: 'power2.out' },
      { x: curX + dx, y: curY + dy, scale: endScale, rotation: 0, duration: 0.7, ease: 'expo.out' },
    ],
  }, 0)
  fly.to({}, {
    duration: 1.08,
    onUpdate() {
      const r = ghostEl.getBoundingClientRect()
      spray(r.left + r.width / 2, r.top + r.height / 2, 1, {
        speed: 46, dir: 4.2, spread: 0.7, r: 1.6, max: 0.66, drag: 1.5, alpha: 0.6, jitter: 5,
      })
    },
  }, 0)

  const both = gsap.timeline()
  both.add(fallHome, 0)
  both.add(fly, 0.06)
  await played(both)
  if (aborted) return

  /* ── P9 落定：主份「咔哒」回弹；副份与真实胶囊等量交叉（同一时长、同一线性，
     总亮度恒为 1），胶囊上再绽一圈小光环表示身份归位。 ── */
  const landed = plateEl.getBoundingClientRect()
  spray(landed.left + landed.width / 2, landed.top + landed.height / 2, 12, {
    speed: 130, r: 2.1, max: 0.66, grav: 210, drag: 1.7, alpha: 0.75, jitter: landed.width * 0.32,
  })
  const landPulse = gsap.timeline()
  landPulse.to(plateEl, { scale: 1.012, duration: 0.08, ease: 'power2.out' }, 0)
  landPulse.to(plateEl, { scale: 1, duration: 0.28, ease: 'back.out(2.2)' }, 0.08)

  /* 落点撞击：副份砸进胶囊的一瞬，双冲击环从胶囊扩散、碎屑四散；
     胶囊先亮起，头像再从 0.3 过冲到 1——「彗星撞地球」的余波最后落在人身上。 */
  const chipAvatar = chipEl?.querySelector<HTMLElement>('.avatar') ?? null
  if (chipAvatar) gsap.set(chipAvatar, { scaleX: 0.3, scaleY: 0.3, transformOrigin: 'center center' })
  gsap.set(shockEl, { x: anchor.x, y: anchor.y, scale: 0.1, opacity: 0 })
  gsap.set(shock2El, { x: anchor.x, y: anchor.y, scale: 0.08, opacity: 0 })
  const handoffChip = gsap.timeline()
  handoffChip.to(shockEl, { opacity: 0.9, duration: 0.06, ease: 'power1.out' }, 0)
  handoffChip.to(shockEl, { scale: 3.6, opacity: 0, duration: 0.64, ease: 'power2.out' }, 0.03)
  handoffChip.to(shock2El, { opacity: 0.55, duration: 0.06, ease: 'power1.out' }, 0.07)
  handoffChip.to(shock2El, { scale: 2.5, opacity: 0, duration: 0.48, ease: 'power2.out' }, 0.11)
  if (chipEl) handoffChip.to(chipEl, { opacity: 1, duration: 0.12, ease: 'none' }, 0)
  if (chipAvatar) handoffChip.to(chipAvatar, { scaleX: 1, scaleY: 1, duration: 0.48, ease: 'back.out(2.8)' }, 0.05)
  handoffChip.to(ghostEl, { opacity: 0, duration: 0.22, ease: 'none' }, 0.02)
  handoffChip.add(() => {
    spray(anchor.x, anchor.y, 26, { speed: 340, r: 2, max: 0.7, grav: 250, drag: 1.9, alpha: 0.85, jitter: 8 })
    starBoost = 0.7
  }, 0.02)
  await played(landPulse)
  if (aborted) return
  await played(handoffChip)
  if (aborted) return

  /* ── P10 交接：先把玻璃底化掉，再做等量交叉（同长、同线性，总亮度恒 1） ── */
  const handover = gsap.timeline()
  handover.to(glassEl, { opacity: 0, duration: 0.2, ease: 'power2.out' }, 0)
  handover.to(plateEl, { opacity: 0, duration: 0.24, ease: 'none' }, 0.16)
  handover.to(title, { opacity: 1, duration: 0.24, ease: 'none' }, 0.16)
  await played(handover)
  if (aborted) return

  gsap.set(title, { clearProps: 'opacity' })
  gsap.set(ghostEl, { opacity: 0 })
  restoreChip()
  await wait(260) // 让残余粒子自然落尽再撤层
  stopDust?.()
  stopDust = null
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
      <div ref="idcardGlow" class="welcome-idcard-glow" />
      <div ref="idcardTail" class="welcome-idcard-tail" />
      <div ref="idcard" class="welcome-idcard">
        <span class="welcome-idcard-glass" />
        <span ref="idcardBody" class="welcome-idcard-body">
          <span class="welcome-idcard-label">{{ deptLabel }}</span>
          <span ref="idcardDept" class="welcome-idcard-dept">
            <span v-for="(ch, i) in deptChars" :key="i" class="dept-char">{{ ch }}</span>
          </span>
        </span>
      </div>
      <div ref="orb" class="welcome-orb" />
      <div ref="plate" class="welcome-plate">
        <span ref="glass" class="welcome-glass" />
        <span class="welcome-line">
          <span ref="plateText" class="welcome-greet">
            <span ref="leadEl" class="greet-lead" />
            <span ref="nameEl" class="greet-name" />
          </span>
          <span class="welcome-caret" />
        </span>
        <span class="welcome-rule" />
      </div>
      <span ref="nameGhost" class="welcome-name-ghost" />
      <span ref="nameFlash" class="welcome-name-flash" />
    </div>
  </Teleport>
</template>