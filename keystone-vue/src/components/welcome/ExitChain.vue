<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { currentUser } from '@/composables/auth'
import { createFrameLoop, gsap, motionSkipped } from '@/composables/motion'
import { choreoExitDone, exitAbort, exitSwapped } from '@/composables/exit'
import { resolveIdentityAnchor } from '@/composables/welcome'

/* ============================================================
   退场编舞（收拢）：名字被抽回胶囊 → 胶囊接住并脉冲 → 页面收拢
   → 胶囊缩成光点 → 光点飞入中央、天幕铺满 → 登录页在暗场里浮现。
   与 WelcomeChain 相反但不同一套缓动：入场是「炸开」，退场是「收拢」，
   所以这里全部用 in 系（起手慢、末段快），不复制入场的 expo/back。
   ============================================================ */

const emit = defineEmits<{ (e: 'done'): void }>()
let settled = false
function finish() {
  if (settled) return
  settled = true
  emit('done')
}

const layer = ref<HTMLElement | null>(null)
const sky = ref<HTMLElement | null>(null)
const seed = ref<HTMLElement | null>(null)
const ring = ref<HTMLElement | null>(null)
const ring2 = ref<HTMLElement | null>(null)
/** 暗幕：抽名一开始就压上来，让整页「慢慢暗下去」——不是元素变透明（那会露白底，像掉色） */
const dim = ref<HTMLElement | null>(null)
const stars = ref<HTMLCanvasElement | null>(null)

const wait = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms))
const played = (tl: gsap.core.Timeline) => new Promise<void>(r => tl.eventCallback('onComplete', r))

let motes: HTMLElement[] = []

/* ── 入夜星野 ──────────────────────────────────────────────────
   不是「先有星空再变暗」，而是天幕铺开的同时星一颗颗亮起来：
   每颗星有自己的 born（出生时间偏后），出现时 0.34s 淡入再进入闪烁。
   于是画面从「纯黑」读成「天黑下来，然后是星星」。 */
interface ExitStar { x: number; y: number; r: number; phase: number; speed: number; born: number; a: number; lime: boolean }
const starList: ExitStar[] = []
let starLoop: ReturnType<typeof createFrameLoop> | null = null

function startStars() {
  const cv = stars.value
  if (!cv) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = window.innerWidth
  const h = window.innerHeight
  cv.width = Math.round(w * dpr)
  cv.height = Math.round(h * dpr)
  const ctx = cv.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (!ctx) return

  const n = Math.round(Math.min(180, Math.max(90, (w * h) / 15000)))
  const now = performance.now()
  starList.length = 0
  for (let i = 0; i < n; i++) {
    starList.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.7 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.6,
      // 幂次 < 1 让出生时间偏向末尾：前段零星几颗，后段才铺满
      born: now + Math.pow(Math.random(), 0.55) * 820,
      a: 0.4 + Math.random() * 0.5,
      lime: Math.random() > 0.84,
    })
  }

  starLoop = createFrameLoop((dt, t) => {
    const tNow = performance.now()
    ctx.clearRect(0, 0, w, h)
    for (const s of starList) {
      const age = (tNow - s.born) / 1000
      if (age < 0) continue
      const rise = Math.min(1, age / 0.34)
      const tw = 0.5 + 0.5 * Math.sin(t * s.speed * 2 + s.phase)
      ctx.globalAlpha = rise * s.a * tw
      ctx.fillStyle = s.lime ? '#b6f56a' : '#e6efff'
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  })
  starLoop.start(cv)
}

/** 沿二次贝塞尔飞出的光点：一次最多十几颗，DOM 足够，不必上 canvas */
function emitMotes(layerEl: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, n: number, dur: number, delayBase = 0) {
  for (let i = 0; i < n; i++) {
    const el = document.createElement('span')
    el.className = 'exit-mote'
    layerEl.appendChild(el)
    motes.push(el)
    const ctrl = {
      x: (from.x + to.x) / 2 + (Math.random() - 0.5) * 70,
      y: Math.min(from.y, to.y) - 70 - Math.random() * 60,
    }
    const k = { t: 0 }
    gsap.set(el, { x: from.x - 2, y: from.y - 2, scale: 0.5 + Math.random() * 0.9, opacity: 0 })
    gsap.to(k, {
      t: 1,
      duration: dur * (0.8 + Math.random() * 0.4),
      delay: delayBase + i * 0.012,
      ease: 'power2.in',
      onUpdate() {
        const t = k.t
        const it = 1 - t
        gsap.set(el, {
          x: it * it * from.x + 2 * it * t * ctrl.x + t * t * to.x - 2,
          y: it * it * from.y + 2 * it * t * ctrl.y + t * t * to.y - 2,
          opacity: t < 0.12 ? t / 0.12 : 1 - ((t - 0.12) / 0.88) * 0.25,
        })
      },
      onComplete() {
        el.remove()
        motes = motes.filter(m => m !== el)
      },
    })
  }
}

/* 标题不能直接改 DOM：Vue 的 vdom 里还是「{{ greeting }}，{{ name }}」，
   任何一次 patch 都会把拆好的 span 冲掉（实测 0.9s 后标题又变完整）。
   改成在标题位置盖一层克隆、把真实标题藏掉——克隆是我们自己的节点，Vue 不会碰。 */
function mountTitleCover(layerEl: HTMLElement, title: HTMLElement, name: string) {
  const full = title.textContent || ''
  const idx = name ? full.lastIndexOf(name) : -1
  if (idx <= 0) return null
  const r = title.getBoundingClientRect()
  const cs = getComputedStyle(title)
  const cover = document.createElement('div')
  cover.className = 'exit-title-cover'
  cover.style.left = `${r.left}px`
  cover.style.top = `${r.top}px`
  cover.style.fontSize = cs.fontSize
  cover.style.fontWeight = cs.fontWeight
  cover.style.letterSpacing = cs.letterSpacing
  cover.style.lineHeight = cs.lineHeight
  cover.style.color = cs.color
  cover.style.fontFamily = cs.fontFamily
  cover.append(document.createTextNode(full.slice(0, idx)))
  const tail = document.createElement('span')
  tail.textContent = full.slice(idx)
  cover.appendChild(tail)
  layerEl.appendChild(cover)
  gsap.set(title, { opacity: 0 })
  return { cover, tail }
}

onMounted(async () => {
  const layerEl = layer.value
  const skyEl = sky.value
  const seedEl = seed.value
  const ringEl = ring.value
  const ring2El = ring2.value
  const dimEl = dim.value
  if (!layerEl || !skyEl || !seedEl || !ringEl || !ring2El || !dimEl || motionSkipped()) {
    choreoExitDone()
    return finish()
  }

  const vw = window.innerWidth
  const vh = window.innerHeight
  const midX = vw / 2
  const midY = vh / 2
  const anchor = resolveIdentityAnchor() ?? { x: vw - 46, y: 50 }

  const chip = document.querySelector<HTMLElement>('.user-chip')
  const title = document.querySelector<HTMLElement>('.page-title')
  const rail = document.querySelector<HTMLElement>('.rail')
  const collapsible = [
    ...document.querySelectorAll<HTMLElement>('.nav-group'),
    ...document.querySelectorAll<HTMLElement>('.bento'),
  ]
  const name = currentUser.value?.nickname || currentUser.value?.username || ''
  const originalTitle = title?.textContent ?? null

  /* ── E0 停顿：胶囊上浮起一层呼吸光，宣告「要走了」 ── */
  gsap.set(ring2El, { x: anchor.x, y: anchor.y, scale: 0.5, opacity: 0 })
  gsap.to(ring2El, { opacity: 0.26, duration: 0.12, ease: 'power1.out' })
  gsap.to(ring2El, { scale: 0.72, opacity: 0, duration: 0.32, ease: 'power2.in', delay: 0.1 })

  /* 与抽名同一刻起暗：1.5s 线性偏缓地压到 0.55。
     用暗幕而不是把元素调透明——浅色主题下元素变透明会露出白底，读作「掉色」不是「天黑」。 */
  gsap.to(dimEl, { opacity: 0.55, duration: 1.5, ease: 'power1.in', delay: 0.12 })

  /* ── E1 抽名：招呼留在原地，名字被抽成一道光飞回胶囊 ── */
  if (title && name) {
    const parts = mountTitleCover(layerEl, title, name)
    if (parts) {
      const r = parts.tail.getBoundingClientRect()
      const cs = getComputedStyle(parts.tail)
      const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      const to = { x: anchor.x, y: anchor.y }

      const clone = document.createElement('span')
      clone.className = 'exit-name-fly'
      clone.textContent = name
      clone.style.color = 'var(--ink)'
      layerEl.appendChild(clone)
      gsap.set(clone, {
        left: r.left, top: r.top,
        fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        letterSpacing: cs.letterSpacing, fontFamily: cs.fontFamily, lineHeight: cs.lineHeight,
      })

      gsap.to(parts.tail, { opacity: 0, duration: 0.22, ease: 'power1.out', delay: 0.1 })
      emitMotes(layerEl, from, to, 18, 0.46)

      const ctrl = { x: (from.x + to.x) / 2 + 30, y: from.y - 130 }
      const k = { t: 0 }
      gsap.timeline({ delay: 0.1 }).to(k, {
        t: 1,
        duration: 0.46,
        ease: 'power2.in',
        onUpdate() {
          const t = k.t
          const it = 1 - t
          gsap.set(clone, {
            x: it * it * from.x + 2 * it * t * ctrl.x + t * t * to.x - from.x,
            y: it * it * from.y + 2 * it * t * ctrl.y + t * t * to.y - from.y,
            // 先被「吸出」（放大 14%）再收走：没有这一下，名字只是平移
            scale: 1.14 - 0.6 * t,
            opacity: 1 - Math.max(0, (t - 0.78) / 0.22),
          })
        },
        onComplete() { clone.remove() },
      })
    }
  }

  /* ── E2 接住：胶囊脉冲一圈光环 ── */
  gsap.set(ringEl, { x: anchor.x, y: anchor.y, scale: 0.35, opacity: 0 })
  gsap.to(ringEl, { opacity: 0.6, duration: 0.08, ease: 'power1.out', delay: 0.56 })
  gsap.to(ringEl, { scale: 1.5, opacity: 0, duration: 0.44, ease: 'power2.out', delay: 0.64 })
  if (chip) {
    gsap.to(chip, { scale: 1.12, duration: 0.16, ease: 'power2.out', delay: 0.54 })
    gsap.to(chip, { scale: 1, duration: 0.24, ease: 'power2.inOut', delay: 0.7 })
  }

  /* ── E3 收拢 + E4 成点：页面被吸住、亮度降下，胶囊收成光点 ── */
  /* 收拢：不是「盖一层灰」，是内容被抽走——
     卡片与导航淡出并向画面中心收 3%，同时从各处飞出一批碎屑被胶囊吸进去。
     brightness 那套读起来就是「加了个遮罩」，这是上一版最大的问题。 */
  const sources = [...document.querySelectorAll<HTMLElement>('.bento, .nav-group, .page-title')]
  sources.forEach((el, i) => {
    const r = el.getBoundingClientRect()
    if (!r.width) return
    emitMotes(
      layerEl,
      { x: r.left + Math.random() * r.width, y: r.top + Math.random() * r.height },
      anchor, 2, 0.52, 0.9 + i * 0.016,
    )
  })

  const settle = gsap.timeline()
  if (collapsible.length) {
    settle.to(collapsible, { opacity: 0.35, scale: 0.97, duration: 0.52, ease: 'power2.in' }, 0.9)
  }
  if (rail) settle.to(rail, { opacity: 0.3, duration: 0.52, ease: 'power2.in' }, 0.9)
  const coverEl = layerEl.querySelector<HTMLElement>('.exit-title-cover')
  if (coverEl) settle.to(coverEl, { opacity: 0.05, duration: 0.5, ease: 'power2.in' }, 0.92)
  if (chip) {
    settle.to(chip, { scale: 1.14, duration: 0.16, ease: 'power2.out' }, 1.24)
    settle.to(chip, {
      scale: 0.06, opacity: 0,
      transformOrigin: 'center center',
      duration: 0.3, ease: 'power3.in',
    }, 1.4)
  }
  settle.to({}, { duration: 0.3 }, 1.4)
  await played(settle)

  /* ── E5 起飞 + 暗场：光点飞到中央，天幕从它身下铺满 ── */
  gsap.set(seedEl, { x: anchor.x - 31, y: anchor.y - 31, scale: 0.62, opacity: 0, rotation: -12 })
  // 天幕不再整层淡入（那就是「盖遮罩」），改成从中央一个点炸开
  const R = Math.hypot(vw, vh) * 0.78
  gsap.set(skyEl, { opacity: 1, clipPath: 'circle(0px at 50% 50%)' })
  const lift = gsap.timeline()
  lift.to(seedEl, { opacity: 1, duration: 0.08, ease: 'power1.out' }, 0)
  lift.to(seedEl, {
    x: midX - 31, y: midY - 31, scale: 1.6, rotation: 18,
    duration: 0.34, ease: 'power2.in',
  }, 0)
  // 炸开：光点膨胀 + 黑夜从它身下铺满
  lift.to(seedEl, { scale: 3.4, duration: 0.4, ease: 'power2.out' }, 0.3)
  lift.to(skyEl, { clipPath: `circle(${R}px at 50% 50%)`, duration: 0.68, ease: 'power2.inOut' }, 0.28)
  lift.add(() => startStars(), 0.3)
  lift.to(seedEl, { scale: 4.2, opacity: 0, duration: 0.34, ease: 'power2.in' }, 0.62)
  await played(lift)

  // 让星空铺满一会儿再走：这段「满天」是退场唯一一次停顿，砍掉就只剩黑屏切页
  await wait(420)

  // 天幕铺满：放行 clearSession + 路由切换
  choreoExitDone()

  /* ── 等路由切到登录页，再抬天幕 ── */
  const t0 = performance.now()
  while (!exitSwapped.value && performance.now() - t0 < 2200) await wait(30)

  const starsEl = stars.value
  const outDone = new Promise<void>(resolve => {
    const tl = gsap.timeline({ onComplete: resolve })
    tl.to(skyEl, { opacity: 0, duration: 0.42, ease: 'power1.inOut' }, 0)
    tl.to(dimEl, { opacity: 0, duration: 0.42, ease: 'power1.inOut' }, 0)
    if (starsEl) tl.to(starsEl, { opacity: 0, duration: 0.42, ease: 'power1.inOut' }, 0)
  })
  await outDone

  gsap.set(seedEl, { opacity: 0 })
  starLoop?.stop()
  starLoop = null
  motes.forEach(el => el.remove())
  motes = []
  finish()
})

/** 异常中断：把动过的真实 DOM 还原，天幕快速淡出 */
function restore() {
  const chip = document.querySelector<HTMLElement>('.user-chip')
  if (chip) gsap.set(chip, { clearProps: 'transform,opacity' })
  const rail = document.querySelector<HTMLElement>('.rail')
  if (rail) gsap.set(rail, { clearProps: 'opacity' })
  document.querySelectorAll('.exit-title-cover').forEach(el => el.remove())
  const title = document.querySelector<HTMLElement>('.page-title')
  if (title) gsap.set(title, { clearProps: 'opacity' })
  document.querySelectorAll<HTMLElement>('.nav-group, .bento').forEach(el => el.style.removeProperty('filter'))
  document.querySelectorAll<HTMLElement>('.nav-group, .bento').forEach(el => el.style.removeProperty('opacity'))
  motes.forEach(el => el.remove())
  motes = []
}

watch(exitAbort, (abort) => {
  if (!abort || settled) return
  const skyEl = sky.value
  restore()
  starLoop?.stop()
  starLoop = null
  const dimEl = dim.value
  if (!skyEl) return finish()
  const tl = gsap.timeline({ onComplete: finish })
  tl.to(skyEl, { opacity: 0, duration: 0.18, ease: 'power1.in' }, 0)
  if (dimEl) tl.to(dimEl, { opacity: 0, duration: 0.18, ease: 'power1.in' }, 0)
})

onBeforeUnmount(() => {
  motes.forEach(el => el.remove())
  motes = []
  starLoop?.stop()
  starLoop = null
})
</script>

<template>
  <Teleport to="body">
    <div ref="layer" class="exit-layer" aria-hidden="true">
      <div ref="dim" class="exit-dim" />
      <div ref="sky" class="transit-sky exit-sky" />
      <canvas ref="stars" class="exit-stars" />
      <div ref="ring" class="welcome-shock" />
      <div ref="ring2" class="welcome-shock welcome-shock--thin" />
      <div ref="seed" class="welcome-orb exit-seed" />
    </div>
  </Teleport>
</template>
