/* 归位轨迹采样：分裂完成后按 rAF 记录浮牌的绝对位置，用来检查轨迹/速度是否连续。
 * 输出每 5 帧一条（t, left, top, 位移），以及速度峰值出现的位置。
 * 用法：node scripts/trace-home.mjs [base_url]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9349
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
  const profile = mkdtempSync(join(tmpdir(), 'ks-trace-'))
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
    for (let i = 0; i < 150; i++) { if (await ev(cdp, `!!document.querySelector('.captcha-code')`)) break; await sleep(80) }

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

    // 等分裂出现
    for (let i = 0; i < 800; i++) {
      const g = await ev(cdp, `(() => { const el = document.querySelector('.welcome-name-ghost'); return el ? parseFloat(getComputedStyle(el).opacity) : 0 })()`)
      if (g > 0.6) break
      await sleep(30)
    }

    await ev(cdp, `(() => {
      window.__trace = []
      const tick = () => {
        const el = document.querySelector('.welcome-plate')
        if (el) {
          const r = el.getBoundingClientRect()
          const m = new DOMMatrix(getComputedStyle(el).transform)
          window.__trace.push([Math.round(performance.now()), Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(m.e), Math.round(m.f), Math.round(m.a * 100) / 100])
        }
        if (window.__trace.length < 300) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      return 'ok'
    })()`)

    await sleep(2600)
    const trace = await ev(cdp, `window.__trace`)
    const home = await ev(cdp, `window.__home || []`)
    if (Array.isArray(home) && home.length) {
      console.log('onUpdate 采样：t / 设定x / 设定y / from.x / ctrl.x')
      for (let i = 0; i < Math.min(home.length, 40); i += 4) console.log(JSON.stringify(home[i]))
    }
    if (!Array.isArray(trace) || trace.length < 8) throw new Error('采样不足: ' + JSON.stringify(trace)?.slice(0, 120))

    const t0 = trace[0][0]
    const rows = trace.map(([t, l, tp, w, tx, ty, sc]) => ({ t: t - t0, l, tp, w, tx, ty, sc }))
    const steps = []
    for (let i = 1; i < rows.length; i++) {
      steps.push(Math.round(Math.hypot(rows[i].l - rows[i - 1].l, rows[i].tp - rows[i - 1].tp)))
    }
    const peak = Math.max(...steps)
    const peakAt = steps.indexOf(peak)
    console.log('帧数', rows.length, ' 峰值位移/帧', peak, ' 出现在第', peakAt, '帧')
    console.log('采样（每 4 帧）：t / left / top / 宽 / 本帧位移')
    for (let i = 0; i < rows.length; i += 4) {
      const s = i === 0 ? 0 : steps[i - 1]
      console.log(`${String(rows[i].t).padStart(4)}ms  rect(${String(rows[i].l).padStart(4)},${String(rows[i].tp).padStart(4)})  w=${String(rows[i].w).padStart(3)}  tx=${String(rows[i].tx).padStart(4)}  ty=${String(rows[i].ty).padStart(4)}  scale=${rows[i].sc}  v=${String(s).padStart(3)}`)
    }
    // 速度曲线检查：起飞后 15 帧内不应出现「先降到 0 再回升」
    const head = steps.slice(0, 45)
    let dips = 0
    for (let i = 2; i < head.length - 2; i++) {
      if (!head[i] || !head[i - 1]) continue // 分裂段的静止帧不算塌陷
      if (head[i] < head[i - 1] * 0.35 && head[i + 2] > head[i] * 2.2) dips++
    }
    console.log(dips === 0 ? 'PASS 速度曲线无中途塌陷' : `WARN 检测到 ${dips} 处速度塌陷`)
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    child.kill()
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}

main().catch(e => { console.error('采样失败:', e.message); process.exitCode = 1 })
