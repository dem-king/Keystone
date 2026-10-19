/* 慢放抓帧：带 #slow 打开（全局 timeScale 0.45），在分裂段连抓 6 帧，看清「震颤 → 光缝 → 逐字分离」。
 * 用法：node scripts/shot-split-slow.mjs [base_url]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9353
const BASE = process.argv[2] || 'http://127.0.0.1:5180'
const OUT = fileURLToPath(new URL('.', import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map(); const handlers = new Map(); let id = 0
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id); pending.delete(msg.id)
        if (msg.error) rej(new Error(msg.error.message)); else res(msg.result)
        return
      }
      handlers.get(msg.method)?.(msg.params)
    }
    ws.onerror = () => reject(new Error('ws fail'))
    ws.onopen = () => resolve({
      send(method, params = {}) { return new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params })) }) },
      on(m, f) { handlers.set(m, f) },
      close: () => ws.close(),
    })
  })
}

async function probe() {
  for (let i = 0; i < 80; i++) {
    for (const host of ['127.0.0.1', '[::1]']) {
      try { const r = await fetch(`http://${host}:${PORT}/json/version`); if (r.ok) return await r.json() } catch { /* wait */ }
    }
    await sleep(250)
  }
  throw new Error('cdp not ready')
}

const ev = async (cdp, expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval fail')
  return r.result?.value
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'ks-splitslow-'))
  const child = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, '--window-size=1600,980', 'about:blank'], { stdio: 'ignore' })
  let cdp
  try {
    const v = await probe()
    const boot = await connect(v.webSocketDebuggerUrl)
    const { targetId } = await boot.send('Target.createTarget', { url: 'about:blank' })
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    cdp = await connect(list.find(t => t.id === targetId).webSocketDebuggerUrl)
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 980, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.navigate', { url: BASE + '/login#slow' })
    for (let i = 0; i < 200; i++) { if (await ev(cdp, `!!document.querySelector('.captcha-code')`)) break; await sleep(80) }

    await ev(cdp, `(async () => {
      const q = s => document.querySelector(s)
      const setVal = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
      const c = q('.captcha-code')
      setVal(q("input[placeholder='请输入账号']"), 'admin')
      setVal(q("input[placeholder='请输入密码']"), 'admin123')
      setVal(q("input[placeholder='请输入右侧字符']"), c.textContent.replace(/\\s+/g, ''))
      ;[...document.querySelectorAll('.login-card button')].find(b => /登录/.test(b.textContent))?.click()
      return 'ok'
    })()`)

    // 慢放后整链 ~28s，等分裂副份出现
    let ready = false
    for (let i = 0; i < 2400; i++) {
      const g = await ev(cdp, `(() => { const el = document.querySelector('.welcome-name-ghost'); return el ? parseFloat(getComputedStyle(el).opacity) : 0 })()`)
      if (g > 0.3) { ready = true; break }
      await sleep(25)
    }
    if (!ready) throw new Error('未等到分裂')

    for (let i = 0; i < 6; i++) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(OUT, `split-slow-${i}.png`), Buffer.from(r.data, 'base64'))
      await sleep(140)
    }
    console.log('已抓 6 帧：split-slow-0.png ~ split-slow-5.png')
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    child.kill()
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}

main().catch(e => { console.error('抓帧失败:', e.message); process.exitCode = 1 })
