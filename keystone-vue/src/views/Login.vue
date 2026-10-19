<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import TextInput from '@/components/ui/TextInput.vue'
import Checkbox from '@/components/ui/Checkbox.vue'
import { ApiError, authApi, portalApi } from '@/api'
import NeuralNet from '@/components/NeuralNet.vue'
import { login } from '@/composables/auth'
import { beginHandoff, finishHandoff, markArrived, prefetchDashboard, setTransitSwapped, startTransit, transitIgnited } from '@/composables/welcome'
import { exitActive } from '@/composables/exit'
import { EASE, afterTwoFrames, gsap, motionSkipped, playLoginDissolve, prefersReducedMotion, restoreLoginStage, trackGlow } from '@/composables/motion'
import { ensureRoutes, preloadHome } from '@/router'
import { required, validate } from '@/utils/validate'
import { APP } from '@/data'

const router = useRouter()
const route = useRoute()

const form = reactive({ username: '', password: '', captcha: '' })
const errors = ref<Partial<Record<keyof typeof form, string>>>({})
const remember = ref(true)
const submitting = ref(false)
const showPassword = ref(false)
const formError = ref('')
const captchaCode = ref('')
const captchaUuid = ref('')
const captchaLoading = ref(false)
const root = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
const succeeded = ref(false)
const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

/** 等转场特效层点火（光丝加速已建立）再补一小段余量；减少动效时直接放行 */
async function waitIgnited(extra: number) {
  if (motionSkipped()) return
  const t0 = performance.now()
  while (!transitIgnited.value && performance.now() - t0 < 2000) await wait(50)
  await wait(extra)
}

/* ── 左侧仪表：实时时钟（秒针刻度逐格推进）与服务健康 ── */
const now = ref(new Date())
const health = ref<{ ok: boolean; latency: number | null }>({ ok: false, latency: null })
const clock = computed(() => now.value.toTimeString().slice(0, 8))
const dateLine = computed(() => {
  const d = now.value
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} · ${'SUN MON TUE WED THU FRI SAT'.split(' ')[d.getDay()]}`
})
const TICKS = Array.from({ length: 60 }, (_, i) => {
  const a = (i / 60) * Math.PI * 2 - Math.PI / 2
  const major = i % 5 === 0
  return { i, x1: 50 + Math.cos(a) * (major ? 40 : 43), y1: 50 + Math.sin(a) * (major ? 40 : 43), x2: 50 + Math.cos(a) * 47, y2: 50 + Math.sin(a) * 47, major }
})
let clockTimer = 0

async function probeHealth() {
  const start = performance.now()
  try {
    const res = await portalApi.health()
    health.value = { ok: res.status === 'UP', latency: Math.round(performance.now() - start) }
  } catch {
    health.value = { ok: false, latency: null }
  }
}

/* ── 登录卡随指针轻倾（≤ 4°），离开回正；只在可悬停设备上启用 ── */
let tiltX: ((v: number) => void) | null = null
let tiltY: ((v: number) => void) | null = null
function onTilt(event: PointerEvent) {
  if (!card.value || !tiltX || !tiltY || motionSkipped()) return
  const r = card.value.getBoundingClientRect()
  const px = (event.clientX - r.left) / r.width - 0.5
  const py = (event.clientY - r.top) / r.height - 0.5
  tiltY(Math.max(-1, Math.min(1, px * 2)) * 4)
  tiltX(Math.max(-1, Math.min(1, py * 2)) * -3)
}
function resetTilt() {
  tiltX?.(0)
  tiltY?.(0)
}

/* 登录失败：登录卡轻微水平抖动（错峰回位），与指针倾斜互不干扰（x / rotation 分轴） */
function shakeCard() {
  if (!card.value || motionSkipped()) return
  gsap.to(card.value, { keyframes: [{ x: -7 }, { x: 6 }, { x: -4 }, { x: 2 }, { x: 0 }], duration: 0.42, ease: 'power1.out' })
}

/* ── 登录成功四拍：按钮收拢成圆（放）→ 对勾圆环描出（结）→ 化星（放）
      → 进入外壳。第四拍是给转场用的：圆不随页面淡出，它变成一颗星球，
      由 WarpTransit 在同一坐标接走——否则「按钮演完了，然后另起一段」。 ── */
const netBurst = ref(0)
const morphing = ref(false)
async function playSuccess() {
  succeeded.value = true
  netBurst.value += 1
  await nextTick()
  const orb = card.value?.querySelector<HTMLElement>('.success-orb')
  if (!orb || motionSkipped()) return
  const ring = orb.querySelector<SVGCircleElement>('circle')
  const check = orb.querySelector<SVGPathElement>('path')
  const shell = orb.querySelector<HTMLElement>('.orb-shell')
  const body = orb.querySelector<HTMLElement>('.orb-body')
  await new Promise<void>((resolve) => {
    const tl = gsap.timeline({ onComplete: resolve })
    tl.fromTo(orb, { width: orb.parentElement!.clientWidth }, { width: 46, duration: 0.42, ease: EASE.swap })
    if (ring) tl.fromTo(ring, { strokeDashoffset: 126 }, { strokeDashoffset: 0, duration: 0.5, ease: EASE.reveal }, '-=0.08')
    if (check) tl.fromTo(check, { strokeDashoffset: 24 }, { strokeDashoffset: 0, duration: 0.32, ease: EASE.settle }, '-=0.22')
  })
  /* 化星：对勾是燃料不是残留——缩成光点被吸入圆心，圆环向外扩一圈散掉；
     同时蓝壳褪去、星体长出。外壳与体用两层 opacity 交叉，渐变不可补间。 */
  if (morphing.value) return
  morphing.value = true
  await new Promise<void>((resolve) => {
    const tl = gsap.timeline({ onComplete: resolve })
    if (check) tl.to(check, { scale: 0, opacity: 0, transformOrigin: '23px 23px', duration: 0.16, ease: 'power2.in' }, 0.02)
    if (ring) tl.to(ring, { scale: 1.4, opacity: 0, transformOrigin: '23px 23px', duration: 0.34, ease: 'power2.out' }, 0.02)
    if (shell) tl.to(shell, { opacity: 0, duration: 0.22, ease: 'power1.inOut' }, 0.06)
    if (body) {
      tl.to(body, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.5)' }, 0.06)
      tl.fromTo(body, { scale: 0.82 }, { scale: 1, duration: 0.34, ease: 'back.out(1.7)' }, 0.06)
    }
  })
}

const CAPABILITIES = [
  { icon: 'role', title: '角色授权', desc: '菜单、按钮两级控制，前后端共用一套权限码' },
  { icon: 'layers', title: '数据权限', desc: '全部 / 本部门及下级 / 本部门 / 本人，四档范围' },
  { icon: 'log', title: '操作审计', desc: '登录与关键操作自动留痕，支持回溯' },
  { icon: 'code', title: '代码生成', desc: '导入数据表，产出模块开发骨架' },
]

async function refreshCaptcha() {
  captchaLoading.value = true
  try {
    const res = await authApi.captcha()
    captchaUuid.value = res.uuid
    captchaCode.value = res.code
  } catch {
    captchaUuid.value = ''
    captchaCode.value = ''
    formError.value = '无法连接服务，请确认服务已启动后重试'
  } finally {
    captchaLoading.value = false
  }
  form.captcha = ''
}

async function submit() {
  formError.value = ''
  errors.value = validate(form, {
    username: [required('请输入账号')],
    password: [required('请输入密码')],
    captcha: [required('请输入验证码')],
  })
  if (Object.keys(errors.value).length) return
  submitting.value = true
  try {
    await login({ username: form.username.trim(), password: form.password, captcha: form.captcha.trim(), captchaUuid: captchaUuid.value }, remember.value)
    // 消散 → 曲率穿越转场：先并行预热菜单与权限（路由守卫据此直接放行），
    // 特效层挂载待命（不挡对勾动画）；对勾收尾 → 消散段 → 光丝加速 → 切路由（全程暗场）→ 星体脱出 → 欢迎链接管。
    // 工作台首屏数据也在这段等待里一并打了，落点页挂载即可同步渲染。
    const warm = ensureRoutes().catch(() => false)
    // 落点页 chunk 预载（不 await）：对勾动画期间足够加载完，切路由不等网络
    warm.then(ok => { if (ok) preloadHome() })
    prefetchDashboard('24h', r => portalApi.dashboard.summary({ range: r }))
    beginHandoff()
    await playSuccess()
    startTransit() // 特效层进入消散段（异步自走）
    const dissolve = new Promise<void>(resolve => {
      const el = root.value
      if (!el) return resolve()
      playLoginDissolve(el, resolve)
    })
    await Promise.all([dissolve, warm])
    // 光丝加速段建立起速度再切路由（切换全程暗场）。原来是固定 wait(250)，
    // 「按钮 → 星球」前置段加进来之后它会变成「星球还在飞就切页」；
    // 改等特效层的点火信号，超时 2s 兜底，信号丢失也不卡死。
    await waitIgnited(250)
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/'
    // 切换前进入 arriving：工作台侧的框体浮现、导航滑入、卡片飞出从这一刻起算
    markArrived()
    const failure = await router.replace(redirect)
    // 进入外壳的导航被取消（如菜单加载期间会话过期）时仍停在登录页：恢复登录按钮、撤回交接。
    // 消散补间已播完，面板在透明态，必须还原；finishHandoff 内含 transitAbort，特效层随之快速淡出
    if (failure || router.currentRoute.value.name === 'login') {
      succeeded.value = false
      finishHandoff()
      restoreLoginStage(root.value)
    } else {
      setTransitSwapped() // 特效层进入减速 + 星体脱出段
    }
  } catch (error) {
    succeeded.value = false
    finishHandoff()
    formError.value = error instanceof ApiError ? error.message : '登录失败，请稍后重试'
    shakeCard()
    await refreshCaptcha()
  } finally {
    submitting.value = false
  }
}

/* ── 一次性开场：本次会话只播一次；任意点击或按键快进而不是硬切 ── */
const INTRO_KEY = 'keystone.login-intro'
let intro: gsap.core.Timeline | null = null
const fastForward = () => intro?.timeScale(6)

function playIntro() {
  const el = root.value
  if (!el) return
  let seen = false
  try { seen = sessionStorage.getItem(INTRO_KEY) === '1' } catch { /* 忽略 */ }
  if (prefersReducedMotion() || document.hidden) {
    el.classList.add('is-entrance-ready')
    return
  }
  const q = (s: string) => el.querySelectorAll(s)
  intro = gsap.timeline({ paused: true, onComplete: () => { intro = null } })
  intro.set(['.login-brand', '.hero-line', '.cap-item', '.login-card', '.login-plate', '.login-dial'].flatMap(s => [...q(s)]), { opacity: 0, y: 16 })
  intro.set(q('.dial-tick'), { opacity: 0.15 })
  intro.add(() => el.classList.add('is-entrance-ready'))
  // 先对焦品牌 → 标题逐行落定 → 能力逐条接通 → 登录卡交付
  intro.to(q('.login-brand'), { opacity: 1, y: 0, duration: 0.7, ease: EASE.reveal }, 0)
  intro.to(q('.hero-line'), { opacity: 1, y: 0, duration: 0.9, ease: EASE.reveal, stagger: 0.08 }, 0.12)
  intro.to(q('.login-dial'), { opacity: 1, y: 0, duration: 0.9, ease: EASE.reveal }, 0.2)
  intro.to(q('.dial-tick'), { opacity: 1, duration: 0.3, ease: 'power1.out', stagger: { each: 0.008, from: 'start' } }, 0.3)
  intro.to(q('.cap-item'), { opacity: 1, y: 0, duration: 0.7, ease: EASE.reveal, stagger: { each: 0.06, from: 'start' } }, 0.36)
  intro.to(q('.login-plate'), { opacity: 1, y: 0, duration: 0.7, ease: EASE.reveal, stagger: 0.08 }, 0.5)
  intro.to(q('.login-card'), { opacity: 1, y: 0, duration: 0.8, ease: EASE.glide }, 0.22)
  intro.add(() => gsap.set(el.querySelectorAll('.login-brand, .hero-line, .cap-item, .login-plate, .login-dial'), { clearProps: 'transform' }))
  if (seen) intro.timeScale(2.4)
  try { sessionStorage.setItem(INTRO_KEY, '1') } catch { /* 忽略 */ }
  afterTwoFrames(() => intro?.play(0))
}

// 页面被切到后台时直接走完编排，避免停在隐藏帧
function onVisibility() {
  if (document.hidden && intro) intro.progress(1, false)
}

/** 从退场的暗场里浮现：面板依次从下方归位，不再播整套 intro（否则像「退出了两次」） */
function playExitArrive() {
  const el = root.value
  if (!el) return
  el.classList.add('is-entrance-ready')
  if (motionSkipped()) return
  const panels = el.querySelectorAll('.login-canvas, .login-side, .login-card')
  gsap.fromTo(panels, { opacity: 0, y: 18 }, {
    opacity: 1, y: 0, duration: 0.52, ease: EASE.reveal, stagger: 0.07, delay: 0.04, clearProps: 'transform',
  })
}

onMounted(() => {
  refreshCaptcha()
  probeHealth()
  clockTimer = window.setInterval(() => { if (!document.hidden) now.value = new Date() }, 1000)
  if (card.value && window.matchMedia('(hover: hover)').matches) {
    tiltX = gsap.quickTo(card.value, 'rotationX', { duration: 0.6, ease: 'power3.out' })
    tiltY = gsap.quickTo(card.value, 'rotationY', { duration: 0.6, ease: 'power3.out' })
  }
  if (exitActive.value) playExitArrive()
  else playIntro()
  window.addEventListener('pointerdown', fastForward, { once: true })
  window.addEventListener('keydown', fastForward, { once: true })
  document.addEventListener('visibilitychange', onVisibility)
})
onBeforeUnmount(() => {
  window.clearInterval(clockTimer)
  window.removeEventListener('pointerdown', fastForward)
  window.removeEventListener('keydown', fastForward)
  document.removeEventListener('visibilitychange', onVisibility)
  intro?.kill()
})
</script>

<template>
  <div ref="root" class="login">
    <!-- 左：全幅深色画布 + 浮动玻璃面板 -->
    <section class="login-canvas" aria-label="系统介绍">
      <div class="canvas-grid" aria-hidden="true" />
      <div class="canvas-glow" aria-hidden="true" />
      <NeuralNet :burst-key="netBurst" />
      <div class="canvas-scrim" aria-hidden="true" />
      <div class="login-brand">
        <span class="brand-mark"><span class="brand-dot" /></span>
        <div>
          <div class="brand-name">{{ APP.name }}</div>
          <div class="brand-sub">{{ APP.subtitle }}</div>
        </div>
      </div>

      <div class="canvas-main">
        <div class="canvas-copy">
          <span class="eyebrow hero-line">内部管理平台 · {{ APP.version }}</span>
          <h1 class="login-title">
            <span class="hero-line">底座一次搭好，</span>
            <span class="hero-line">只写你的业务。</span>
          </h1>
          <p class="login-lead hero-line">用户、角色、菜单、部门、字典、审计与代码生成开箱即用；接入新模块时，只需定义字段与流程。</p>
        </div>

        <!-- 实时时钟：秒针对应的刻度点亮，逐秒推进（导 Conduct） -->
        <div class="login-dial" aria-hidden="true">
          <svg viewBox="0 0 100 100">
            <line
              v-for="t in TICKS"
              :key="t.i"
              :class="['dial-tick', { 'is-major': t.major, 'is-on': t.i <= now.getSeconds(), 'is-now': t.i === now.getSeconds() }]"
              :x1="t.x1" :y1="t.y1" :x2="t.x2" :y2="t.y2"
            />
          </svg>
          <div class="dial-center">
            <span class="dial-time tnum">{{ clock }}</span>
            <span class="dial-date">{{ dateLine }}</span>
          </div>
        </div>
      </div>

      <div class="canvas-plates">
        <div class="login-plate is-health">
          <span class="eyebrow">服务健康</span>
          <span :class="['health-dot', { 'is-ok': health.ok }]" aria-hidden="true" />
          <b>{{ health.ok ? '运行正常' : health.latency === null ? '连接中断' : '状态异常' }}</b>
          <span class="tnum plate-sub">{{ health.latency === null ? '—' : `${health.latency} ms` }}</span>
        </div>
        <ul class="login-plate cap-list">
          <li v-for="cap in CAPABILITIES" :key="cap.title" class="cap-item">
            <span class="cap-ico"><Icon :name="cap.icon" :size="16" /></span>
            <span>
              <span class="cap-title">{{ cap.title }}</span>
              <span class="cap-desc">{{ cap.desc }}</span>
            </span>
          </li>
        </ul>
      </div>
      <div class="login-foot">{{ APP.copyright }}</div>
    </section>

    <!-- 右：深色玻璃登录卡，浮在画布之上 -->
    <section class="login-side" @pointermove="onTilt" @pointerleave="resetTilt">
      <div ref="card" class="login-card m-glow" role="region" aria-labelledby="login-heading" @pointermove="trackGlow">
        <span class="glow-layer" aria-hidden="true" />
        <div class="login-card-inner">
          <span class="eyebrow">欢迎回来</span>
          <h2 id="login-heading" class="login-card-title">账号登录</h2>
          <p class="login-card-sub">请使用管理员分配的账号进入系统</p>

          <form class="login-form" novalidate @submit.prevent="submit">
            <Field label="账号" :error="errors.username">
              <TextInput v-model="form.username" icon="user" placeholder="请输入账号" autocomplete="username" :invalid="!!errors.username" />
            </Field>
            <Field label="密码" :error="errors.password">
              <TextInput
                v-model="form.password"
                :type="showPassword ? 'text' : 'password'"
                icon="lock"
                placeholder="请输入密码"
                autocomplete="current-password"
                :invalid="!!errors.password"
              >
                <template #trailing>
                  <button
                    type="button"
                    class="input-affix"
                    :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                    :aria-pressed="showPassword"
                    @click="showPassword = !showPassword"
                  >
                    <Icon :name="showPassword ? 'eyeOff' : 'eye'" :size="15" />
                  </button>
                </template>
              </TextInput>
            </Field>
            <Field label="验证码" :error="errors.captcha">
              <div class="captcha-group">
                <TextInput v-model="form.captcha" icon="shield" placeholder="请输入右侧字符" :maxlength="6" autocomplete="off" :invalid="!!errors.captcha" />
                <button type="button" class="captcha-box" :disabled="captchaLoading" aria-label="看不清，换一张" title="看不清，换一张" @click="refreshCaptcha">
                  <span v-if="captchaCode" class="captcha-code" aria-hidden="true">
                    <span v-for="(ch, i) in captchaCode.split('')" :key="i" :style="{ rotate: `${(i % 2 ? 1 : -1) * (6 + i * 3)}deg` }">{{ ch }}</span>
                  </span>
                  <Icon v-else name="refresh" :size="16" />
                </button>
              </div>
            </Field>
            <div class="login-options">
              <Checkbox v-model="remember" label="记住登录状态" />
            </div>
            <p v-if="formError" class="login-error" role="alert"><Icon name="alert" :size="15" />{{ formError }}</p>
            <div class="login-submit-slot">
              <Button v-if="!succeeded" type="submit" variant="primary" block :loading="submitting" class="login-submit">登录</Button>
              <div v-else class="success-orb" role="status" aria-label="登录成功，正在进入">
                <span class="orb-shell" aria-hidden="true" />
                <span class="orb-body" aria-hidden="true" />
                <svg width="30" height="30" viewBox="0 0 46 46" aria-hidden="true">
                  <circle cx="23" cy="23" r="20" stroke-dasharray="126" />
                  <path d="m15 23.5 5.5 5.5L31.5 18" stroke-dasharray="24" />
                </svg>
              </div>
            </div>
          </form>
        </div>
      </div>
    </section>
  </div>
</template>
