/* 登录 → 首页转场「闪黑」捕捉：screencast 全帧 + 页内结构采样。
 *
 * 直连 Chromium CDP（agent-browser CLI 在本机不可用，见项目记忆）。
 * 原理：登录点击后开 Page.startScreencast 收全帧（PNG），逐帧解码算平均亮度，
 * 找「亮度骤降窗口」（闪黑）；页内 rAF 采样记录结构状态（谁在场上、谁的透明度），
 * 与亮度时间线对齐定位闪黑发生在转场的哪一拍。
 *
 * 用法：node scripts/shot-handoff-flash.mjs [light|dark|both]
 * 前提：后端 8090 与前端 5180 已启动；账号 admin / admin123。
 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9336
const BASE = process.argv[3] || 'http://127.0.0.1:5180'
const WHICH = process.argv[2] || 'both'
const OUT = fileURLToPath(new URL('.', import.meta.url))
const FRAMES = join(OUT, 'handoff-flash-frames')
mkdirSync(FRAMES, { recursive: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ── 极简 CDP 客户端（带事件） ── */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    const listeners = new Map()
    let id = 0
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`))
        else res(msg.result)
      } else if (msg.method) {
        const set = listeners.get(msg.method)
        if (set) set.forEach(fn => fn(msg.params))
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
      on(method, fn) {
        if (!listeners.has(method)) listeners.set(method, new Set())
        listeners.get(method).add(fn)
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
      } catch { /* 继续等待 */ }
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
    try {
      if (await evalJs(cdp, expr)) return true
    } catch { /* 页面跳转中偶发失联，继续轮询 */ }
    await sleep(70)
  }
  return false
}

/* ── PNG 解码（8bit RGB/RGBA、非隔行）+ 平均亮度 ── */
function pngMeanLuma(buf) {
  let pos = 8
  let w = 0, h = 0, bitDepth = 8, colorType = 6
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) return null
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  let sum = 0, n = 0
  let prev = Buffer.alloc(stride)
  let off = 0
  const recon = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[off++]
    const line = raw.subarray(off, off + stride)
    off += stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? recon[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      if (filter === 1) v = (v + a) & 255
      else if (filter === 2) v = (v + b) & 255
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255
      }
      recon[x] = v
    }
    // 每 6 行采样一行，行内每 6 像素采一个，省 CPU
    if (y % 6 === 0) {
      for (let x = 0; x < w; x += 6) {
        const i = x * bpp
        sum += 0.2126 * recon[i] + 0.7152 * recon[i + 1] + 0.0722 * recon[i + 2]
        n++
      }
    }
    prev.set(recon)
  }
  return n ? Math.round(sum / n) : null
}

/* ── 页内结构采样器 ── */
const SAMPLER = `(async () => {
  const q = s => document.querySelector(s)
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const codeEl = q('.captcha-code')
  if (!codeEl || !codeEl.textContent.trim()) return 'no-captcha'
  setVal(q("input[placeholder='请输入账号']"), 'admin')
  setVal(q("input[placeholder='请输入密码']"), 'admin123')
  setVal(q("input[placeholder='请输入右侧字符']"), codeEl.textContent.replace(/\\s+/g, ''))
  window.__t0 = performance.now()
  window.__log = []
  const opOf = el => el ? Math.round(parseFloat(getComputedStyle(el).opacity) * 100) / 100 : -1
  // 命中点的有效背景：从命中元素向上找第一个不透明背景
  const bgAt = (x, y) => {
    let el = document.elementFromPoint(x, y)
    if (!el) return 'none'
    while (el && el !== document.documentElement) {
      const bg = getComputedStyle(el).backgroundColor
      if (bg && !/rgba\\([^)]*,\\s*0\\)/.test(bg)) {
        const short = el.className && typeof el.className === 'string'
          ? '.' + el.className.split(' ').slice(0, 2).join('.')
          : el.tagName.toLowerCase()
        return short + '|' + bg
      }
      el = el.parentElement
    }
    return 'html|' + getComputedStyle(document.documentElement).backgroundColor
  }
  const tick = () => {
    const vw = window.innerWidth, vh = window.innerHeight
    const frame = q('.app-frame')
    const rec = {
      t: Math.round(performance.now() - window.__t0),
      login: !!q('.login'),
      canvasOp: opOf(q('.login-canvas')),
      cardOp: opOf(q('.login-card')),
      sideOp: opOf(q('.login-side')),
      frame: !!frame,
      ready: frame ? (frame.classList.contains('is-entrance-ready') ? 1 : 0) : -1,
      c0: bgAt(vw / 2, vh / 2),
      c1: bgAt(vw * 0.5, vh * 0.25),
      c2: bgAt(vw * 0.75, vh * 0.6),
      c3: bgAt(vw * 0.12, vh * 0.5),
    }
    const last = window.__log[window.__log.length - 1]
    if (!last || JSON.stringify(rec) !== JSON.stringify(last)) window.__log.push(rec)
    requestAnimationFrame(tick)
  }
  tick()
  q("button[type='submit']").click()
  return 'ok'
})()`

async function runScenario(name, { dark = false } = {}) {
  console.log(`\n=== 场景：${name} ===`)
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  const target = await res.json()
  const cdp = await connect(target.webSocketDebuggerUrl)
  const frames = []
  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await cdp.send('Page.navigate', { url: `${BASE}/login` })
    await waitFor(cdp, `document.readyState === 'complete'`, 20000)
    await evalJs(cdp, `(() => {
      localStorage.clear(); sessionStorage.clear();
      ${dark ? `localStorage.setItem('keystone.appearance', JSON.stringify({ theme: 'dark', density: 'regular', railCollapsed: false }));` : ''}
      return 1
    })()`)
    await cdp.send('Page.reload')
    await waitFor(cdp, `document.readyState === 'complete'`, 20000)
    const loginReady = await waitFor(cdp, `!!document.querySelector('.captcha-code') && document.querySelector('.captcha-code').textContent.trim().length >= 4`, 15000)
    if (!loginReady) { console.log('登录页未就绪，放弃'); return }
    console.log(`主题 = ${await evalJs(cdp, `document.documentElement.dataset.theme`)}`)

    // 收帧：每帧都存，事后统一分析
    cdp.on('Page.screencastFrame', (p) => {
      frames.push(p)
      cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {})
    })

    const clicked = await evalJs(cdp, SAMPLER)
    if (clicked !== 'ok') { console.log('提交失败：', clicked); return }

    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    // 等欢迎链播完（ welcoming 层卸载）再停
    const done = await waitFor(cdp, `location.pathname === '/dashboard' && !document.querySelector('.welcome-layer')`, 20000)
    await sleep(400)
    await cdp.send('Page.stopScreencast')
    console.log(`收帧 ${frames.length} 张，欢迎链完成 = ${done}`)

    // 逐帧亮度
    const lum = []
    frames.forEach((f, i) => {
      const buf = Buffer.from(f.data, 'base64')
      const l = pngMeanLuma(buf)
      lum.push({ i, ts: f.metadata?.timestamp ?? 0, luma: l })
      writeFileSync(join(FRAMES, `${name}-${String(i).padStart(4, '0')}.png`), buf)
    })
    writeFileSync(join(OUT, `handoff-flash-${name}-luma.json`), JSON.stringify(lum, null, 1))
    const series = lum.map(r => `${r.i}:${r.luma}`).join(' ')
    console.log(`亮度序列：${series}`)

    // 找闪黑：相邻帧亮度骤降 ≥25 且后续又回升（骤升 ≥15）
    const dips = []
    for (let i = 1; i < lum.length - 1; i++) {
      if (lum[i].luma == null) continue
      const before = lum[i - 1].luma, after = lum[i + 1].luma
      if (before != null && after != null && before - lum[i].luma >= 25 && after - lum[i].luma >= 15) {
        dips.push({ at: i, from: before, to: lum[i].luma, backTo: after })
      }
    }
    if (dips.length) {
      console.log(`发现 ${dips.length} 处亮度骤降：`)
      dips.forEach(d => console.log(`  帧 #${d.at}：${d.from} → ${d.to} → ${d.backTo}`))
    } else {
      console.log('未发现单帧亮度骤降（闪黑）')
    }
    const log = await evalJs(cdp, 'window.__log || []')
    writeFileSync(join(OUT, `handoff-flash-${name}-log.json`), JSON.stringify(log, null, 1))
  } finally {
    try { await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`) } catch { /* 忽略 */ }
    cdp.close()
  }
}

/* ── 主流程 ── */
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu',
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'handoff-flash-'))}`,
  `--remote-debugging-port=${PORT}`, '--window-size=1440,900',
], { stdio: 'ignore' })
let chromePid = chrome.pid
try {
  await probeVersion()
  if (WHICH === 'light' || WHICH === 'both') await runScenario('light', { dark: false })
  if (WHICH === 'dark' || WHICH === 'both') await runScenario('dark', { dark: true })
} finally {
  try { execSync(`taskkill /PID ${chromePid} /T /F`, { stdio: 'ignore' }) } catch { /* 忽略 */ }
}
console.log('\n完成')
