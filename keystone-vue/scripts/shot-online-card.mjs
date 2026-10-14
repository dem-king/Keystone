/* 在线用户卡片验证截图：登录 → 工作台 → 截取「在线用户」卡片，核对去重后的在线人数。
 * 用法：node scripts/shot-online-card.mjs [base_url]
 * 产物：scripts/verify-online-card.png（整屏）、scripts/verify-online-card-zoom.png（卡片特写）
 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9341
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

const LOGIN = `(async () => {
  const q = s => document.querySelector(s)
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const codeEl = q('.captcha-code')
  if (!codeEl) return 'no-captcha'
  setVal(q("input[placeholder='请输入账号']"), 'admin')
  setVal(q("input[placeholder='请输入密码']"), 'admin123')
  setVal(q("input[placeholder='请输入右侧字符']"), codeEl.textContent.replace(/\\s+/g, ''))
  ;[...document.querySelectorAll('.login-card button')].find(b => /登录/.test(b.textContent))?.click()
  return 'ok'
})()`

const CARD = `(() => {
  const card = [...document.querySelectorAll('section.bento-side')].find(s => s.textContent.includes('在线用户'))
  if (!card) return null
  const r = card.getBoundingClientRect()
  return {
    text: card.innerText.replace(/\\n+/g, ' | '),
    rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
  }
})()`

const LOGOUT = `(async () => {
  const token = sessionStorage.getItem('keystone.token') || localStorage.getItem('keystone.token')
  if (!token) return 'no-token'
  await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(() => {})
  return 'ok'
})()`

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'ks-online-'))
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' })

  try {
    await probeVersion()
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find(t => t.type === 'page')
    const cdp = await connect(page.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

    await cdp.send('Page.navigate', { url: BASE + '/login' })
    await waitFor(cdp, `!!document.querySelector('.captcha-code')`)
    await sleep(400)

    const loginRes = await evalJs(cdp, LOGIN)
    console.log('login:', loginRes)

    await waitFor(cdp, `location.pathname.includes('/dashboard')`, 20000)
    // 等欢迎链（约 2-4s）与数据落定、Metric 数字出现
    await waitFor(cdp, `!!document.querySelector('section.bento-side')`, 15000)
    await sleep(4500)

    const card = await evalJs(cdp, CARD)
    console.log('card:', JSON.stringify(card, null, 2))

    const full = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, 'verify-online-card.png'), Buffer.from(full.data, 'base64'))

    if (card?.rect) {
      const clip = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: card.rect.x - 8, y: card.rect.y - 8, width: card.rect.width + 16, height: card.rect.height + 16, scale: 2 },
      })
      writeFileSync(join(OUT, 'verify-online-card-zoom.png'), Buffer.from(clip.data, 'base64'))
    }

    const logoutRes = await evalJs(cdp, LOGOUT)
    console.log('logout:', logoutRes)
    cdp.close()
  } finally {
    execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' })
    console.log('done')
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
