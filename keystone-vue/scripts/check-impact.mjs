/* 撞击与复位检查：P1 星球的压扁/回弹曲线、工牌是否已无头像、握手时头像是否由小放大。
 * 用法：node scripts/check-impact.mjs [base_url]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9355
const BASE = process.argv[2] || 'http://127.0.0.1:5180'
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
  const profile = mkdtempSync(join(tmpdir(), 'ks-impact-'))
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

    // 等欢迎层出现后开始采样星球矩阵
    for (let i = 0; i < 600; i++) { if (await ev(cdp, `!!document.querySelector('.welcome-orb')`)) break; await sleep(25) }
    await ev(cdp, `(() => {
      window.__imp = []
      const tick = () => {
        const orb = document.querySelector('.welcome-orb')
        if (orb) {
          const m = new DOMMatrix(getComputedStyle(orb).transform)
          window.__imp.push([Math.round(m.a * 100) / 100, Math.round(m.d * 100) / 100, Math.round(parseFloat(getComputedStyle(orb).opacity) * 100) / 100])
        }
        if (window.__imp.length < 90) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      return 'ok'
    })()`)

    // 工牌期检查头像是否已移除
    let hasIdcardAvatar = null
    for (let i = 0; i < 400; i++) {
      const st = await ev(cdp, `(() => { const el = document.querySelector('.welcome-idcard'); if (!el) return null; return { avatars: el.querySelectorAll('.avatar').length, op: parseFloat(getComputedStyle(el).opacity) } })()`)
      if (st && st.op > 0.9) { hasIdcardAvatar = st.avatars; break }
      await sleep(25)
    }

    // 握手期检查 chip 头像缩放
    let avatarTrack = []
    for (let i = 0; i < 600; i++) {
      const st = await ev(cdp, `(() => {
        const av = document.querySelector('.user-chip .avatar')
        if (!av) return null
        const m = new DOMMatrix(getComputedStyle(av).transform)
        const chip = document.querySelector('.user-chip')
        return { s: Math.round(m.a * 100) / 100, chipOp: Math.round(parseFloat(getComputedStyle(chip).opacity) * 100) / 100 }
      })()`)
      if (st && st.chipOp > 0.05) {
        avatarTrack.push(st.s)
        if (avatarTrack.length > 24) break
      }
      await sleep(25)
    }

    const imp = await ev(cdp, `window.__imp`)
    const flat = imp.reduce((a, x) => (x[1] < a[1] ? x : a), imp[0] || [1, 1, 0])
    const wide = imp.reduce((a, x) => (x[0] > a[0] ? x : a), imp[0] || [1, 1, 0])
    console.log(`星球撞击：scaleX 峰值 ${wide[0]}，scaleY 谷值 ${flat[1]}（应为 X>1、Y<0.7）`)
    console.log(`工牌内头像数量：${hasIdcardAvatar}（应为 0）`)
    console.log(`握手期头像 scale 序列：${JSON.stringify(avatarTrack.slice(0, 12))}`)
    const ok1 = wide[0] > 1.15 && flat[1] < 0.72
    const ok2 = hasIdcardAvatar === 0
    const ok3 = avatarTrack.length > 2 && Math.min(...avatarTrack) < 0.6
    console.log(`\n${ok1 ? 'PASS' : 'FAIL'} 撞击有压扁与回弹`)
    console.log(`${ok2 ? 'PASS' : 'FAIL'} 工牌无头像`)
    console.log(`${ok3 ? 'PASS' : 'FAIL'} 头像由小放大`)
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    child.kill()
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}

main().catch(e => { console.error('检查失败:', e.message); process.exitCode = 1 })
