/* 登录日志 IP 验证截图：登录 → 打开登录日志 → 读取最新记录 IP → 截图。
 * 用法：node scripts/shot-login-log-ip.mjs [base_url]
 * 产物：verify-login-log-ip.png（明细表特写）、verify-login-log-ip-rows.json（行数据）
 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9342
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

const ROWS = `(() => {
  const rows = [...document.querySelectorAll('.table-wrap tbody tr')].slice(0, 6)
  return rows.map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.trim().replace(/\\n+/g, ' / ')).join(' | '))
})()`

const TABLE_RECT = `(() => {
  const el = document.querySelector('.table-wrap')
  if (!el) return null
  el.scrollIntoView({ block: 'center' })
  return 'scrolled'
})()`

const READ_RECT = `(() => {
  const el = document.querySelector('.table-wrap')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    x: Math.max(Math.round(r.x) - 10, 0),
    y: Math.max(Math.round(r.y) - 10, 0),
    width: Math.round(r.width) + 20,
    height: Math.min(Math.round(r.height) + 20, 780),
  }
})()`

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'ks-logip-'))
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

    console.log('login:', await evalJs(cdp, LOGIN))
    await waitFor(cdp, `location.pathname.includes('/dashboard')`, 20000)
    // 等欢迎链清场后再导航，避免遮罩残留在截图里
    await waitFor(cdp, `!document.querySelector('.welcome-layer')`, 20000)

    await cdp.send('Page.navigate', { url: BASE + '/monitor/login-log' })
    await waitFor(cdp, `location.pathname.includes('/login-log')`, 15000)
    await waitFor(cdp, `document.querySelectorAll('.table-wrap tbody tr').length > 0`, 20000)
    await sleep(1200)

    const rows = await evalJs(cdp, ROWS)
    console.log('rows:')
    for (const row of rows) console.log('  ' + row)
    writeFileSync(join(OUT, 'verify-login-log-ip-rows.json'), JSON.stringify(rows, null, 2))

    await evalJs(cdp, TABLE_RECT)
    await sleep(500)
    const rect = await evalJs(cdp, READ_RECT)
    if (rect) {
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1.6 },
      })
      writeFileSync(join(OUT, 'verify-login-log-ip.png'), Buffer.from(shot.data, 'base64'))
      console.log('screenshot saved')
    } else {
      console.log('WARN: .table-wrap not found, screenshot skipped')
    }
    cdp.close()
  } finally {
    execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' })
    console.log('done')
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
