/* 登录页全屏深色沉浸验证：三档宽度截图 + 表单交互（密码切换 / 错误抖动 / 登录成功）。
 * 用法：node scripts/verify-login-dark.mjs [base_url]
 * 产物：verify-login-dark-{2560,1440,390}.png、verify-login-dark-error.png、verify-login-dark-checks.json
 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9348
const BASE = process.argv[2] || 'http://127.0.0.1:5180'
const OUT = fileURLToPath(new URL('.', import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    const handlers = new Map()
    let id = 0
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(msg.error.message))
        else res(msg.result)
        return
      }
      handlers.get(msg.method)?.(msg.params)
    }
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const mid = ++id
          pending.set(mid, { res, rej })
          ws.send(JSON.stringify({ id: mid, method, params }))
        })
      },
      on(method, fn) { handlers.set(method, fn) },
      close: () => ws.close(),
    })
  })
}

async function probeVersion() {
  for (let i = 0; i < 80; i++) {
    for (const host of ['127.0.0.1', '[::1]']) {
      try {
        const res = await fetch(`http://${host}:${PORT}/json/version`)
        if (res.ok) return await res.json()
      } catch { /* 等待 */ }
    }
    await sleep(250)
  }
  throw new Error('Chromium CDP 未就绪')
}

async function evalJs(cdp, expression, awaitPromise = true) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate 失败')
  return r.result?.value
}

async function waitFor(cdp, expr, timeout = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await evalJs(cdp, expr)) return true } catch { /* 跳转中 */ }
    await sleep(100)
  }
  return false
}

async function shot(cdp, name) {
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name), Buffer.from(s.data, 'base64'))
  console.log('saved', name)
}

const CHECKS = `(() => {
  const cs = s => { const el = document.querySelector(s); return el ? getComputedStyle(el) : null }
  const root = cs('.login')
  const card = cs('.login-card')
  const box = cs('.captcha-box')
  const now = Date.now()
  return {
    loginBg: root?.backgroundColor,
    cardBg: card?.backgroundColor,
    cardBlur: card?.backdropFilter || card?.webkitBackdropFilter,
    cardRadius: card?.borderRadius,
    scrim: !!document.querySelector('.canvas-scrim'),
    dialNowTick: !!document.querySelector('.dial-tick.is-now'),
    captchaMergedRadius: box?.borderTopRightRadius,
    captchaLeftBorder: box?.borderLeftColor,
    glowLayer: !!document.querySelector('.login-card > .glow-layer'),
    platesColumns: cs('.cap-list')?.gridTemplateColumns?.split(' ').length,
    checkedAt: now,
  }
})()`

const TOGGLE_PW = `(async () => {
  const btn = document.querySelector('.input-affix')
  if (!btn) return 'no-affix'
  const input = document.querySelector("input[placeholder='请输入密码']")
  const t0 = input.type
  btn.click()
  await new Promise(r => setTimeout(r, 80))
  const t1 = input.type
  btn.click()
  await new Promise(r => setTimeout(r, 80))
  return { initial: t0, afterToggle: t1, restored: input.type }
})()`

const FAIL_LOGIN = `(async () => {
  const q = s => document.querySelector(s)
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  setVal(q("input[placeholder='请输入账号']"), 'admin')
  setVal(q("input[placeholder='请输入密码']"), 'admin123')
  setVal(q("input[placeholder='请输入右侧字符']"), 'zzzz')
  ;[...document.querySelectorAll('.login-card button')].find(b => /登录/.test(b.textContent))?.click()
  return 'submitted'
})()`

const OK_LOGIN = `(async () => {
  const q = s => document.querySelector(s)
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const code = q('.captcha-code')?.textContent.replace(/\\s+/g, '')
  if (!code) return 'no-captcha'
  setVal(q("input[placeholder='请输入账号']"), 'admin')
  setVal(q("input[placeholder='请输入密码']"), 'admin123')
  setVal(q("input[placeholder='请输入右侧字符']"), code)
  ;[...document.querySelectorAll('.login-card button')].find(b => /登录/.test(b.textContent))?.click()
  return 'ok:' + code
})()`

async function gotoLogin(cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: BASE + '/login' })
  await waitFor(cdp, `!!document.querySelector('.captcha-code')`)
  await sleep(2400) // 等开场编排落定（会话级快进也可，这里直接等）
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'ks-dark-'))
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    '--window-size=2560,1320', 'about:blank',
  ], { stdio: 'ignore' })
  const checks = {}

  try {
    await probeVersion()
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find(t => t.type === 'page')
    const cdp = await connect(page.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    // 场景 A：2560 超宽
    await gotoLogin(cdp, 2560, 1280)
    checks.w2560 = await evalJs(cdp, CHECKS)
    await shot(cdp, 'verify-login-dark-2560.png')

    // 场景 B：1440 笔记本（表盘仍在）
    await gotoLogin(cdp, 1440, 900)
    checks.w1440 = await evalJs(cdp, CHECKS)
    await shot(cdp, 'verify-login-dark-1440.png')

    // 交互：密码可见性切换
    checks.passwordToggle = await evalJs(cdp, TOGGLE_PW)

    // 交互：错误验证码 → 玻璃警示条 + 卡片抖动
    await evalJs(cdp, FAIL_LOGIN)
    await waitFor(cdp, `!!document.querySelector('.login-error')`, 10000)
    await sleep(120)
    checks.errorText = await evalJs(cdp, `document.querySelector('.login-error')?.textContent?.trim()`)
    const errShot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, 'verify-login-dark-error.png'), Buffer.from(errShot.data, 'base64'))
    console.log('saved verify-login-dark-error.png')

    // 交互：正确验证码 → 登录成功进工作台（验证无幕交接未被破坏）
    await sleep(600) // 等 refreshCaptcha 换新码
    checks.okLogin = await evalJs(cdp, OK_LOGIN)
    const landed = await waitFor(cdp, `location.pathname.includes('/dashboard')`, 25000)
    checks.landedDashboard = landed

    // 场景 C：390 窄屏（深色底 + 居中卡）。已登录会话会被守卫弹走，先清存储
    await evalJs(cdp, `localStorage.clear(); sessionStorage.clear(); 'cleared'`, false)
    await gotoLogin(cdp, 390, 844)
    checks.w390 = await evalJs(cdp, `(() => ({
      pathname: location.pathname,
      canvasHidden: getComputedStyle(document.querySelector('.login-canvas')).display === 'none',
      cardBg: getComputedStyle(document.querySelector('.login-card')).backgroundColor,
      loginBg: getComputedStyle(document.querySelector('.login')).backgroundColor,
    }))()`)
    await shot(cdp, 'verify-login-dark-390.png')

    writeFileSync(join(OUT, 'verify-login-dark-checks.json'), JSON.stringify(checks, null, 2))
    console.log(JSON.stringify(checks, null, 2))
    cdp.close()
  } finally {
    execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' })
    console.log('done')
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
