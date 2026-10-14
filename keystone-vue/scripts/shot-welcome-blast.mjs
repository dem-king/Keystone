/* 一次性：抓「炸开瞬间」帧——柔光闪 / 放射光束 / 双环可见的时刻。
 * 用法：node scripts/shot-welcome-blast.mjs [base_url] */
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
    let id = 0
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(msg.error.message))
        else res(msg.result)
      }
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

async function waitFor(cdp, expr, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    try { if (await evalJs(cdp, expr)) return true } catch { /* 跳转中 */ }
    await sleep(60)
  }
  return false
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `blast-${name}.png`), Buffer.from(r.data, 'base64'))
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

const STATE = `(() => {
  const q = s => document.querySelector(s)
  const op = el => el ? parseFloat(getComputedStyle(el).opacity) : -1
  const flash = q('.welcome-flash')
  const shock = q('.welcome-shock')
  const orb = q('.welcome-orb')
  const plate = q('.welcome-plate')
  return { flash: op(flash), shock: op(shock), orb: op(orb), plate: op(plate) }
})()`

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'ks-blast-'))
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    '--window-size=1600,980', 'about:blank',
  ], { stdio: 'ignore' })

  let cdp
  try {
    const version = await probeVersion()
    const boot = await connect(version.webSocketDebuggerUrl)
    const { targetId } = await boot.send('Target.createTarget', { url: 'about:blank' })
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    cdp = await connect(list.find(t => t.id === targetId).webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    await cdp.send('Page.navigate', { url: `${BASE}/login` })
    await waitFor(cdp, `!!document.querySelector('.captcha-code')`)
    console.log('登录：', await evalJs(cdp, LOGIN))
    await waitFor(cdp, `!!document.querySelector('.welcome-plate')`, 20000)

    let got = 0
    const deadline = Date.now() + 12000
    while (got < 2 && Date.now() < deadline) {
      const s = await evalJs(cdp, STATE)
      // 炸开瞬间：flash 刚亮起、星球还没完全消失
      if (got === 0 && s.flash > 0.15 && s.orb > 0.2) {
        await shot(cdp, '1-blast')
        console.log('1-blast：已抓', JSON.stringify(s))
        got++
      }
      // 双环扩散中段：主环还亮、浮牌刚冒头
      if (got === 1 && s.shock > 0.2 && s.plate > 0.05 && s.plate < 0.9) {
        await shot(cdp, '2-rings')
        console.log('2-rings：已抓', JSON.stringify(s))
        got++
      }
      await sleep(16)
    }
    if (!got) console.log('未捕获到炸开帧')
  } finally {
    cdp?.close()
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
}

main().catch(e => { console.error('截图脚本出错：', e.message); process.exit(1) })
