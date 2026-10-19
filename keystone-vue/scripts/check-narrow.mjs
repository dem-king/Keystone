/* 窄屏降级检查：<760 时欢迎层被 CSS 隐藏，链条必须直接收工、胶囊立刻可见 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9345
const BASE = process.argv[2] || 'http://127.0.0.1:5180'
const W = Number(process.argv[3] || 700)
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
  const profile = mkdtempSync(join(tmpdir(), 'ks-narrow-'))
  const child = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, `--window-size=${W},900`, 'about:blank'], { stdio: 'ignore' })
  let cdp
  try {
    const v = await probe()
    const boot = await connect(v.webSocketDebuggerUrl)
    const { targetId } = await boot.send('Target.createTarget', { url: 'about:blank' })
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    cdp = await connect(list.find(t => t.id === targetId).webSocketDebuggerUrl)
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable')
    await cdp.send('Page.navigate', { url: BASE + '/login' })
    for (let i = 0; i < 120; i++) { if (await ev(cdp, `!!document.querySelector('.captcha-code')`)) break; await sleep(80) }

    const ok = await ev(cdp, `(async () => {
      const q = s => document.querySelector(s)
      const setVal = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
      const c = q('.captcha-code')
      if (!c) return 'no-captcha'
      setVal(q("input[placeholder='请输入账号']"), 'admin')
      setVal(q("input[placeholder='请输入密码']"), 'admin123')
      setVal(q("input[placeholder='请输入右侧字符']"), c.textContent.replace(/\\s+/g, ''))
      ;[...document.querySelectorAll('.login-card button')].find(b => /登录/.test(b.textContent))?.click()
      return 'ok'
    })()`)
    if (ok !== 'ok') throw new Error('login: ' + ok)

    let last = null
    for (let i = 0; i < 16; i++) {
      await sleep(400)
      last = await ev(cdp, `(() => {
        const q = s => document.querySelector(s)
        const chip = q('.user-chip')
        return {
          vw: innerWidth,
          layer: !!q('.welcome-layer'),
          chipOp: chip ? Math.round(parseFloat(getComputedStyle(chip).opacity) * 100) / 100 : null,
          route: location.pathname,
          scrollW: document.documentElement.scrollWidth,
        }
      })()`)
      if (last.route === '/dashboard' && !last.layer && last.chipOp === 1) break
    }
    console.log(JSON.stringify(last))
    const pass = last && last.route === '/dashboard' && last.layer === false && last.chipOp === 1 && last.scrollW <= last.vw
    console.log(pass ? 'PASS 窄屏：链条跳过、胶囊保持可见、无横向溢出' : 'FAIL 窄屏降级未达预期')
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    child.kill()
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}

main().catch(e => { console.error('窄屏检查失败:', e.message); process.exitCode = 1 })
