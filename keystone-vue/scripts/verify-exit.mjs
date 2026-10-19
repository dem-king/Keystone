/* 退场动效验证：登录 → 等欢迎链结束 → 退出 → 采样全程（路径、天幕、抽名、光点）→ 断言 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9357
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
  const profile = mkdtempSync(join(tmpdir(), 'ks-exit-'))
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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__err=[];window.addEventListener('error',e=>window.__err.push('ERR '+e.message));window.addEventListener('unhandledrejection',e=>window.__err.push('REJ '+String(e.reason&&e.reason.message||e.reason)));`,
    })
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

    // 等欢迎链播完（最长 20s）
    for (let i = 0; i < 800; i++) {
      const ready = await ev(cdp, `location.pathname !== '/login' && !document.querySelector('.welcome-layer') && !!document.querySelector('.page-title')`)
      if (ready) break
      await sleep(30)
    }
    await sleep(400)

    // 打开用户菜单 → 退出登录 → 确认
    await ev(cdp, `document.querySelector('.user-chip').click()`)
    await sleep(260)
    const opened = await ev(cdp, `!!document.querySelector('.menu-pop')`)
    await ev(cdp, `(() => { const items = [...document.querySelectorAll('.menu-pop .menu-item')]; const el = items.find(b => /退出/.test(b.textContent)); el?.click(); return !!el })()`)
    await sleep(320)
    const modal = await ev(cdp, `!!document.querySelector('.modal, .confirm-body')`)

    // 注入采样器，然后点确认
    await ev(cdp, `(() => {
      window.__exit = []
      const tick = () => {
        const sky = document.querySelector('.exit-sky')
        window.__exit.push([
          Math.round(performance.now()),
          location.pathname,
          document.querySelector('.exit-layer') ? 1 : 0,
          sky ? (() => {
            const cp = getComputedStyle(sky).clipPath || ''
            const i = cp.indexOf('circle(')
            const j = cp.indexOf('px', i)
            return i >= 0 && j > i ? Math.round(Number(cp.slice(i + 7, j))) : 0
          })() : 0,
          document.querySelector('.exit-name-fly') ? 1 : 0,
          document.querySelectorAll('.exit-mote').length,
          document.querySelector('.login-card') ? Math.round(parseFloat(getComputedStyle(document.querySelector('.login-card')).opacity) * 100) / 100 : -1,
          document.querySelector('.exit-dim') ? Math.round(parseFloat(getComputedStyle(document.querySelector('.exit-dim')).opacity) * 100) / 100 : 0,
        ])
        if (window.__exit.length < 400) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '退出')
      btn?.click()
      return !!btn
    })()`)

    // 中间帧：抽名刚结束、页面收拢中
    await sleep(980)
    const mid = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, 'exit-mid.png'), Buffer.from(mid.data, 'base64'))

    // 星空三拍：刚入夜 / 渐密 / 满天
    await sleep(760)
    const s1 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, 'exit-stars-1.png'), Buffer.from(s1.data, 'base64'))
    await sleep(520)
    const s2 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, 'exit-stars-2.png'), Buffer.from(s2.data, 'base64'))
    await sleep(420)
    const s3 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, 'exit-stars-3.png'), Buffer.from(s3.data, 'base64'))

    await sleep(1600)
    const trace = await ev(cdp, `window.__exit`)
    const err = await ev(cdp, `window.__err`)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, 'exit-final.png'), Buffer.from(shot.data, 'base64'))

    const hasLayer = trace.some(r => r[2] === 1)
    const hasName = trace.some(r => r[4] === 1)
    const maxSky = Math.max(...trace.map(r => r[3]))
    const skyFullAt = trace.findIndex(r => r[3] > 900)
    const leftAt = trace.findIndex(r => r[1] === '/login')
    const motes = Math.max(...trace.map(r => r[5]))
    const dims = trace.map(r => r[7])
    const dimPeak = Math.max(...dims)
    const dimSteps = new Set(dims.filter(v => v > 0 && v < dimPeak - 0.02)).size
    const finalPath = trace[trace.length - 1][1]
    const finalCard = trace[trace.length - 1][6]

    console.log(`路径首次变化于第 ${leftAt} 帧；天幕首次全黑于第 ${skyFullAt} 帧（应先铺暗场再切页）`)
    console.log(`抽名克隆出现过：${hasName ? '是' : '否'}；碎屑峰值 ${motes} 颗；天幕峰值 ${maxSky}`)
    console.log(`最终路径 ${finalPath}，登录卡 opacity ${finalCard}`)
    console.log(`页面错误：${Array.isArray(err) && err.length ? err.join(' | ') : '无'}`)

    console.log(`\n${hasLayer ? 'PASS' : 'FAIL'} 退场层已挂载`)
    console.log(`${dimPeak > 0.45 && dimSteps >= 4 ? 'PASS' : 'FAIL'} 整页渐暗（峰值 ${dimPeak}，中间值 ${dimSteps} 档）`)
    console.log(`${hasName ? 'PASS' : 'FAIL'} 名字被抽走（克隆出现）`)
    console.log(`${maxSky > 900 ? 'PASS' : 'FAIL'} 天幕从中心炸开（clip 半径峰值 ${maxSky}px）`)
    console.log(`${skyFullAt >= 0 && leftAt > skyFullAt ? 'PASS' : 'FAIL'} 先铺暗场、后切路由`)
    console.log(`${finalPath === '/login' && finalCard > 0.9 ? 'PASS' : 'FAIL'} 登录页已浮现`)
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    child.kill()
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}

main().catch(e => { console.error('验证失败:', e.message); process.exitCode = 1 })
