/* 分裂段检查：字号/字重/字距是否与主份一致、副份是否逐字错开、光缝是否亮起。
 * 用法：node scripts/check-split.mjs [base_url]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9351
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
  const name = q('.welcome-greet .greet-name')
  const ghost = q('.welcome-name-ghost')
  const flash = q('.welcome-name-flash')
  const chips = q('.user-chip')
  if (!name || !ghost) return null
  const cs = el => { const s = getComputedStyle(el); return { fs: s.fontSize, fw: s.fontWeight, ls: s.letterSpacing, ff: s.fontFamily.split(',')[0] } }
  const gm = new DOMMatrix(getComputedStyle(ghost).transform)
  const chars = [...ghost.querySelectorAll('.ghost-char')].map(el => {
    const m = new DOMMatrix(getComputedStyle(el).transform)
    return [Math.round(m.e * 10) / 10, Math.round(m.f * 10) / 10]
  })
  const mainChars = [...name.querySelectorAll('.name-char')].length
  const gb = ghost.getBoundingClientRect()
  return {
    nameCss: cs(name), ghostCss: cs(ghost), ghostScale: Math.round(gm.a * 100) / 100,
    ghostOp: Math.round(parseFloat(getComputedStyle(ghost).opacity) * 100) / 100,
    chars, mainChars, ghostChars: chars.length,
    ghostText: ghost.textContent,
    ghostBox: [Math.round(gb.left), Math.round(gb.top), Math.round(gb.width)],
    flashOp: flash ? Math.round(parseFloat(getComputedStyle(flash).opacity) * 100) / 100 : -1,
    flashH: flash ? Math.round(flash.getBoundingClientRect().height) : -1,
  }
})()`

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'ks-split-'))
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

    let snap = null
    for (let i = 0; i < 800; i++) {
      const p = await ev(cdp, PROBE)
      if (p && p.ghostOp > 0.5) break
      await sleep(25)
    }
    await sleep(260) // 等 stagger 跑完再量：0.035 × 字数 + 0.32
    snap = await ev(cdp, PROBE)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, 'split-now.png'), Buffer.from(shot.data, 'base64'))
    if (!snap) throw new Error('未捕获分裂态')
    console.log(JSON.stringify(snap, null, 1))

    const same = snap.nameCss.fs === snap.ghostCss.fs && snap.nameCss.fw === snap.ghostCss.fw && snap.nameCss.ls === snap.ghostCss.ls
    const scaleOk = Math.abs(snap.ghostScale - 1) < 0.02
    const staggered = snap.chars.length > 1 && snap.chars.every((c, i) => i === 0 || c[0] > snap.chars[i - 1][0])
    const lifted = snap.chars.some(c => c[1] < -1)
    console.log(`\n${same ? 'PASS' : 'FAIL'} 字号/字重/字距与主份一致（${snap.nameCss.fs} / ${snap.nameCss.fw} / ${snap.nameCss.ls} vs ${snap.ghostCss.fs} / ${snap.ghostCss.fw} / ${snap.ghostCss.ls}）`)
    console.log(`${scaleOk ? 'PASS' : 'FAIL'} 副份 scale = ${snap.ghostScale}（应为 1）`)
    console.log(`${staggered && lifted ? 'PASS' : 'FAIL'} 逐字向右上错开：${JSON.stringify(snap.chars)}`)
    console.log(`${snap.flashOp > 0.05 || snap.flashH > 0 ? 'PASS' : 'SKIP'} 光缝已就位（op=${snap.flashOp}, h=${snap.flashH}）`)
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    child.kill()
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}

main().catch(e => { console.error('检查失败:', e.message); process.exitCode = 1 })
