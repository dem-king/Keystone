/* 工牌三拍连拍：登录后等 `.welcome-idcard` 亮起，按 60ms 间隔连抓 14 帧，
 * 每帧同时记录几何（宽/高/圆角/亮边/星球透明度），用来看「展开 → 停留 → 收束」的形态是否连续。
 * 用法：node scripts/shot-idcard.mjs [base_url]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9347
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

const PROBE = `(() => {
  const q = s => document.querySelector(s)
  const idc = q('.welcome-idcard')
  const orb = q('.welcome-orb')
  const chars = document.querySelectorAll('.welcome-idcard-dept .dept-char')
  const lit = [...chars].filter(el => parseFloat(getComputedStyle(el).opacity) > 0.5).length
  if (!idc) return null
  const b = idc.getBoundingClientRect()
  const o = orb ? orb.getBoundingClientRect() : null
  return {
    w: Math.round(b.width), h: Math.round(b.height),
    l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top),
    rad: getComputedStyle(idc).borderTopLeftRadius,
    op: Math.round(parseFloat(getComputedStyle(idc).opacity) * 100) / 100,
    edge: 0,
    orbOp: orb ? Math.round(parseFloat(getComputedStyle(orb).opacity) * 100) / 100 : -1,
    orbW: o ? Math.round(o.width) : -1,
    lit,
  }
})()`

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'ks-idc-'))
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
    await cdp.send('Page.navigate', { url: BASE + '/login' })
    for (let i = 0; i < 120; i++) { if (await ev(cdp, `!!document.querySelector('.captcha-code')`)) break; await sleep(80) }

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

    // 等工牌首次可见
    for (let i = 0; i < 400; i++) {
      const p = await ev(cdp, PROBE)
      if (p && p.op > 0.2) break
      await sleep(30)
    }

    const rows = []
    for (let i = 0; i < 14; i++) {
      const p = await ev(cdp, PROBE)
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(join(OUT, `idc-${String(i).padStart(2, '0')}.png`), Buffer.from(r.data, 'base64'))
      rows.push({ i, ...p })
      await sleep(60)
    }
    console.log(JSON.stringify(rows, null, 0).replace(/\},\{/g, '},\n{'))
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    child.kill()
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}

main().catch(e => { console.error('连拍失败:', e.message); process.exitCode = 1 })
