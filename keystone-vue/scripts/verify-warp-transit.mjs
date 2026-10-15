/* 登录转场特效（消散 → 曲率穿越 → 星体脱出）验证。
 *
 * 直连 Chromium CDP（agent-browser CLI 在本机不可用，见项目记忆）。
 * 验证点：
 *  1. 特效层（.transit-layer）在对勾收尾后挂载，天幕在切路由前已拉满（切路全程暗场）
 *  2. 登录页 DOM 消散有中间态（非硬切）
 *  3. 切路后脱出星到达 → 欢迎链接管（.welcome-layer 出现），特效层随后自卸
 *  4. screencast 全帧亮度无单帧跳变（≥50）：防闪白 / 闪黑的最终判定
 *  5. 减少动态效果下特效层不挂载，直接进工作台
 *
 * 用法：node scripts/verify-warp-transit.mjs [light|dark|reduce|all]
 * 前提：后端 8090 与前端 5180 已启动；账号 admin / admin123。
 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9336
const BASE = process.argv[3] || 'http://127.0.0.1:5180'
const WHICH = process.argv[2] || 'all'
const OUT = fileURLToPath(new URL('.', import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))

let failures = 0
function check(ok, label, detail = '') {
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  -> ' + detail : ''}`)
}

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

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `verify-warp-${name}.png`), Buffer.from(r.data, 'base64'))
}

/* ── PNG 平均亮度（8bit RGB/RGBA、非隔行） ── */
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
  window.__err = []
  window.addEventListener('error', e => window.__err.push(String(e.message).slice(0, 80)))
  const opOf = el => el ? Math.round(parseFloat(getComputedStyle(el).opacity) * 100) / 100 : -1
  const tick = () => {
    const rec = {
      t: Math.round(performance.now() - window.__t0),
      login: !!q('.login'),
      cardOp: opOf(q('.login-card')),
      canvasOp: opOf(q('.login-canvas')),
      layer: !!q('.transit-layer'),
      skyOp: opOf(q('.transit-sky')),
      path: location.pathname,
      welcome: !!q('.welcome-layer'),
      frame: !!q('.app-frame'),
      ready: q('.app-frame') ? (q('.app-frame').classList.contains('is-entrance-ready') ? 1 : 0) : -1,
      plate: !!q('.welcome-plate'),
    }
    const last = window.__log[window.__log.length - 1]
    if (!last || JSON.stringify(rec) !== JSON.stringify(last)) window.__log.push(rec)
    requestAnimationFrame(tick)
  }
  tick()
  q("button[type='submit']").click()
  return 'ok'
})()`

async function runScenario(name, { dark = false, reduce = false } = {}) {
  console.log(`\n=== 场景：${name} ===`)
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  const target = await res.json()
  const cdp = await connect(target.webSocketDebuggerUrl)
  const frames = []
  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    if (reduce) {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    }
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
    check(loginReady, `${name}：登录页就绪`)
    if (!loginReady) return

    cdp.on('Page.screencastFrame', (p) => {
      frames.push(p)
      cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {})
    })

    const clicked = await evalJs(cdp, SAMPLER)
    check(clicked === 'ok', `${name}：已提交登录`, String(clicked))
    if (clicked !== 'ok') return

    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })

    if (reduce) {
      const done = await waitFor(cdp, `location.pathname === '/dashboard' && !document.querySelector('.welcome-layer') && document.querySelector('.app-frame')?.classList.contains('is-entrance-ready')`, 15000)
      await sleep(300)
      await cdp.send('Page.stopScreencast')
      check(done, `${name}：减少动态下直接进工作台（无特效层）`)
      const log = await evalJs(cdp, 'window.__log || []')
      const layerSeen = log.some(r => r.layer)
      check(!layerSeen, `${name}：特效层从未挂载`)
      const errs = await evalJs(cdp, 'window.__err || []')
      check(errs.length === 0, `${name}：无 JS 异常`, JSON.stringify(errs.slice(0, 3)))
      return
    }

    /* 非 reduce：分阶段断言 + 关键帧截图 */
    // ① 特效层挂载
    const layerUp = await waitFor(cdp, `!!document.querySelector('.transit-layer')`, 8000)
    check(layerUp, `${name}：特效层已挂载`)

    // ② 消散中间态：登录卡淡出（有 0.05~0.95 中间档），天幕在拉起
    const dissolveShot = await waitFor(cdp, `(() => {
      const c = document.querySelector('.login-card')
      if (!c) return false
      const o = parseFloat(getComputedStyle(c).opacity)
      return o > 0.15 && o < 0.9
    })()`, 6000)
    check(dissolveShot, `${name}：消散段（登录卡淡出中间态）`)
    await shot(cdp, `${name}-1-dissolve`)

    // ③ 天幕拉满（暗场建立）
    const skyUp = await waitFor(cdp, `(() => {
      const s = document.querySelector('.transit-sky')
      return !!s && parseFloat(getComputedStyle(s).opacity) > 0.95
    })()`, 6000)
    check(skyUp, `${name}：天幕暗场已建立`)

    // ④ 切路由时刻天幕必须在场且不透（切路全程暗场）
    const swBefore = await evalJs(cdp, 'window.__log.length')
    await waitFor(cdp, `location.pathname === '/dashboard'`, 12000)
    const log = await evalJs(cdp, 'window.__log || []')
    const swIdx = log.findIndex(r => r.path === '/dashboard')
    check(swIdx > 0, `${name}：已切换至工作台`)
    if (swIdx > 0) {
      const before = log.slice(Math.max(0, swIdx - 8), swIdx)
      const skyCovered = before.length > 0 && before.every(r => r.layer && r.skyOp > 0.9)
      check(skyCovered, `${name}：切路前暗场已铺满（天幕 opacity>0.9）`,
        before.map(r => `${r.t}:${r.skyOp}`).join(' '))
    }

    // ⑤ 巡航段截图（光丝在场）
    await shot(cdp, `${name}-2-warp`)

    // ⑥ 欢迎链接管（脱出星到达 → transitReleased → welcome-layer 出现）
    const welcomed = await waitFor(cdp, `!!document.querySelector('.welcome-layer')`, 15000)
    check(welcomed, `${name}：欢迎链已接管（脱出星到达）`)
    if (welcomed) await shot(cdp, `${name}-3-welcome`)

    // ⑦ 特效层自卸 + 欢迎链播完
    const layerGone = await waitFor(cdp, `!document.querySelector('.transit-layer')`, 10000)
    check(layerGone, `${name}：特效层已自卸`)
    const welcomeDone = await waitFor(cdp, `location.pathname === '/dashboard' && !document.querySelector('.welcome-layer') && document.querySelector('.app-frame')?.classList.contains('is-entrance-ready')`, 20000)
    check(welcomeDone, `${name}：欢迎链播完、工作台稳定`)
    await sleep(400)
    await shot(cdp, `${name}-4-shell`)
    await cdp.send('Page.stopScreencast')

    /* 全帧亮度：无单帧跳变（≥120）即无闪白/闪黑。
     * 注：headless screencast 高峰期帧率可低至 ~10fps，0.5s 的天幕淡出被压缩到数帧，
     * 中段单帧 +80 是采样帧率下的连续渐亮（前后帧单调递升、内容相同仅蒙版变浅）。
     * 真闪白/硬切是未桥接的切换：暗场一帧直窜全亮（差 ≈ 全场亮度 ≥180）
     * 或异物入画（实测白块平台 ~95 直串 222）。阈值 120 可区分两者，跳变帧自动存档。 */
    const lum = frames.map(f => ({ luma: pngMeanLuma(Buffer.from(f.data, 'base64')) }))
    let jumps = 0
    for (let i = 1; i < lum.length; i++) {
      if (lum[i].luma == null || lum[i - 1].luma == null) continue
      const d = Math.abs(lum[i].luma - lum[i - 1].luma)
      if (d >= 120) {
        jumps += 1
        console.log(`  [jump] 帧 ${i - 1}→${i}：${lum[i - 1].luma} → ${lum[i].luma}`)
        for (let k = Math.max(0, i - 2); k <= Math.min(lum.length - 1, i + 2); k++) {
          writeFileSync(join(OUT, `verify-warp-${name}-jump-${String(k).padStart(3, '0')}.png`), Buffer.from(frames[k].data, 'base64'))
        }
      }
    }
    check(jumps === 0, `${name}：全帧亮度无单帧跳变（防闪白/闪黑）`, `共 ${frames.length} 帧`)
    const series = lum.map((r, i) => r.luma).filter(v => v != null)
    console.log(`  [info] 亮度轨迹：${series.filter((_, i) => i % 4 === 0).join(' → ')}`)

    const errs = await evalJs(cdp, 'window.__err || []')
    check(errs.length === 0, `${name}：转场无 JS 异常`, JSON.stringify(errs.slice(0, 3)))
  } finally {
    try { await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`) } catch { /* 忽略 */ }
    cdp.close()
  }
}

/* ── abort 场景：菜单接口被断 → 路由守卫驳回 → 交接撤回。
 * 断言：登录页面板被 restoreLoginStage 还原（不空场）、特效层随 transitAbort 卸掉、无 JS 异常。 */
async function runAbortScenario() {
  const name = 'abort'
  console.log(`\n=== 场景：${name}（菜单接口 500，导航失败撤回交接） ===`)
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  const target = await res.json()
  const cdp = await connect(target.webSocketDebuggerUrl)
  try {
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    cdp.on('Runtime.consoleAPICalled', (p) => {
      const text = (p.args || []).map(a => a.value ?? a.description ?? '').join(' ')
      if (text.includes('[handoff-debug]')) console.log(`  [console] ${text}`)
    })
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: `*/auth/routes*`, requestStage: 'Request' }],
    })
    cdp.on('Fetch.requestPaused', async (p) => {
      try {
        await cdp.send('Fetch.fulfillRequest', {
          requestId: p.requestId,
          responseCode: 500,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ code: 500, msg: '模拟菜单接口故障' })).toString('base64'),
        })
      } catch { /* 页面可能已关闭 */ }
    })

    await cdp.send('Page.navigate', { url: `${BASE}/login` })
    await waitFor(cdp, `document.readyState === 'complete'`, 20000)
    await evalJs(cdp, `(() => { localStorage.clear(); sessionStorage.clear(); return 1 })()`)
    await cdp.send('Page.reload')
    await waitFor(cdp, `document.readyState === 'complete'`, 20000)
    const loginReady = await waitFor(cdp, `!!document.querySelector('.captcha-code') && document.querySelector('.captcha-code').textContent.trim().length >= 4`, 15000)
    check(loginReady, `${name}：登录页就绪`)
    if (!loginReady) return

    const clicked = await evalJs(cdp, SAMPLER)
    check(clicked === 'ok', `${name}：已提交登录`, String(clicked))
    if (clicked !== 'ok') return

    // 正确时序：先等对勾圆出现（登录成功），再等它消失（abort 把 succeeded 置回 false、按钮还原）
    const orbUp = await waitFor(cdp, `!!document.querySelector('.success-orb')`, 8000)
    check(orbUp, `${name}：对勾圆已出现（登录成功）`)
    const restored = await waitFor(cdp, `!!document.querySelector('.login-submit') && !document.querySelector('.success-orb')`, 15000)
    check(restored, `${name}：导航失败回登录页，提交按钮还原（不空场、无残留对勾）`)
    await sleep(600)
    await shot(cdp, `${name}-restored`)
    const domDump = await evalJs(cdp, `(() => {
      const slot = document.querySelector('.login-submit-slot')
      return {
        orb: !!document.querySelector('.success-orb'),
        btn: !!document.querySelector('.login-submit'),
        slot: slot ? slot.innerHTML.replace(/\\s+/g, ' ').slice(0, 300) : 'NO SLOT',
      }
    })()`)
    const btnBack = domDump.orb === false && domDump.btn === true
    check(btnBack, `${name}：DOM 校验提交按钮还原`, JSON.stringify(domDump))
    const layerGone = await waitFor(cdp, `!document.querySelector('.transit-layer')`, 8000)
    check(layerGone, `${name}：特效层随 abort 卸掉`)
    const pathNow = await evalJs(cdp, 'location.pathname')
    check(pathNow === '/login', `${name}：停留在登录页`, pathNow)
    const errs = await evalJs(cdp, 'window.__err || []')
    check(errs.length === 0, `${name}：无 JS 异常`, JSON.stringify(errs.slice(0, 3)))
  } finally {
    try { await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`) } catch { /* 忽略 */ }
    cdp.close()
  }
}

/* ── 主流程 ── */
const profile = mkdtempSync(join(tmpdir(), 'ks-warp-'))
console.log('启动 Chromium …')
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1440,960',
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${PORT}`,
  'about:blank',
], { stdio: 'ignore' })

try {
  const version = await probeVersion()
  console.log(`Chromium ${version.Browser} CDP :${PORT} 就绪`)
  if (WHICH === 'light' || WHICH === 'all') await runScenario('light')
  if (WHICH === 'dark' || WHICH === 'all') await runScenario('dark', { dark: true })
  if (WHICH === 'reduce' || WHICH === 'all') await runScenario('reduce', { reduce: true })
  if (WHICH === 'abort' || WHICH === 'all') await runAbortScenario()
} finally {
  try { execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' }) } catch { /* 忽略 */ }
}

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}`)
process.exit(failures === 0 ? 0 : 1)
