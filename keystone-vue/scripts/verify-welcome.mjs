/* 登录转场（无幕交接）验证：浅色 / 深色 / 减少动态效果 / 连点守卫四组场景。
 *
 * 直连 Chromium CDP（agent-browser CLI 在本机不可用，见项目记忆）。
 * 验证点：
 *  1. 转场全程无幕：旧遮罩组件不存在；屏幕中心始终被页面本体命中（无覆盖层）
 *  2. 登录卡与深色画布淡出退场（有中间态），路由在退净之后才切
 *  3. 切路后骨架已铺满（无空洞），卡片自中心落位、框体不做整体淡入
 *  4. 转场期间点击不放行到页面（连点不误导航、无 JS 异常）
 *  5. 减少动态效果下不起退场动画，直接进工作台
 *
 * 用法：node scripts/verify-welcome.mjs [base_url]
 * 前提：后端 8090 与前端 5180 已启动；账号 admin / admin123。
 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9336
const BASE = process.argv[2] || 'http://127.0.0.1:5180'
const OUT = fileURLToPath(new URL('.', import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))

let failures = 0
function check(ok, label, detail = '') {
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  -> ' + detail : ''}`)
}

/* ── 极简 CDP 客户端 ── */
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
        if (msg.error) rej(new Error(`${msg.error.message} (${msg.error.code})`))
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

async function shot(cdp, name, suffix) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `verify-handoff-${name}-${suffix}.png`), Buffer.from(r.data, 'base64'))
}

async function clickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

/* ── 页面内：填表 + 点登录 + 全帧采样器 ── */
const LOGIN_AND_SAMPLE = `(async () => {
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
  window.__taps = []
  window.addEventListener('error', e => window.__err.push(String(e.message).slice(0, 80)))
  // 点击探针（冒泡）：转场期间被拦截的点击不会到达 window
  window.addEventListener('click', e => {
    const t = e.target
    window.__taps.push({ t: Math.round(performance.now() - window.__t0), tag: String((t && t.className) || (t && t.tagName) || '?').slice(0, 40) })
  })
  const opOf = el => el ? Math.round(parseFloat(getComputedStyle(el).opacity) * 100) / 100 : -1
  const avgOp = els => els.length ? Math.round(els.reduce((a, c) => a + parseFloat(getComputedStyle(c).opacity), 0) / els.length * 100) / 100 : -1
  let lastKey = ''
  const tick = () => {
    const card = q('.login-card')
    const canvas = q('.login-canvas')
    const side = q('.login-side')
    const frame = q('.app-frame')
    const cards = [...document.querySelectorAll('.bento')]
    const reveals = [...document.querySelectorAll('.reveal')]
    // 屏幕中心命中：被拦住的点击防不到"覆盖物"，这里直接检查页面本体是否始终覆盖中心
    const at = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    const firstRect = cards.length ? cards[0].getBoundingClientRect() : null
    const rec = {
      t: Math.round(performance.now() - window.__t0),
      cardOp: opOf(card),
      canvasOp: opOf(canvas),
      sideOp: opOf(side),
      path: location.pathname,
      bento: avgOp(cards),
      bentoN: cards.length,
      rect: firstRect ? [Math.round(firstRect.left), Math.round(firstRect.top)] : null,
      reveal: avgOp(reveals),
      frameOp: opOf(frame),
      ready: frame ? (frame.classList.contains('is-entrance-ready') ? 1 : 0) : -1,
      morph: document.querySelectorAll('.welcome-morph, .wm-panel').length,
      inPage: at ? (at.closest('.login, .stage') ? 1 : 0) : 0,
      hidden: document.hidden ? 1 : 0,
    }
    const key = JSON.stringify([rec.cardOp, rec.canvasOp, rec.sideOp, rec.path, rec.bento, rec.bentoN, rec.rect, rec.reveal, rec.frameOp, rec.ready, rec.morph, rec.inPage, rec.hidden])
    if (key !== lastKey) { lastKey = key; window.__log.push(rec) }
    requestAnimationFrame(tick)
  }
  tick()
  q("button[type='submit']").click()
  window.__taps.length = 0   // 提交自身的那次点击不计入守卫窗口（拦截自登录成功后才开启）
  return 'ok'
})()`

/* ── 单场景 ── */
async function runScenario(name, { dark = false, reduce = false, tap = false } = {}) {
  console.log(`\n=== 场景：${name} ===`)
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  const target = await res.json()
  const cdp = await connect(target.webSocketDebuggerUrl)
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
    check(loginReady, `${name}：登录页就绪（验证码已加载）`)
    if (!loginReady) return

    const themeNow = await evalJs(cdp, `document.documentElement.dataset.theme`)
    check(themeNow === (dark ? 'dark' : 'light'), `${name}：主题为 ${themeNow}`)

    const clicked = await evalJs(cdp, LOGIN_AND_SAMPLE)
    check(clicked === 'ok', `${name}：已提交登录`, String(clicked))

    if (tap) {
      // 连点守卫：对勾期 / 退场期 / 组装期各点几处——若拦截失效，侧栏与内容区的点击会误导航
      await sleep(450)
      await clickAt(cdp, 420, 480)
      await sleep(650)
      await clickAt(cdp, 1100, 500)
      await sleep(700)
      await clickAt(cdp, 120, 300)
      await sleep(350)
      await clickAt(cdp, 760, 430)
    }

    // 截图：退场中（画布淡到一半）
    if (!reduce) {
      await waitFor(cdp, `(() => {
        const c = document.querySelector('.login-canvas')
        if (!c) return false
        const o = parseFloat(getComputedStyle(c).opacity)
        return o > 0.25 && o < 0.85
      })()`, 8000)
      await shot(cdp, name, 'exit')
    }

    const switched = await waitFor(cdp, `location.pathname === '/dashboard'`, 12000)
    check(switched, `${name}：已切换至工作台`)
    // 截图：组装中（卡片未全部落定）
    if (!reduce) {
      await waitFor(cdp, `(() => {
        const cards = [...document.querySelectorAll('.bento')]
        if (!cards.length) return false
        const avg = cards.reduce((a, c) => a + parseFloat(getComputedStyle(c).opacity), 0) / cards.length
        return avg > 0.15 && avg < 0.85
      })()`, 8000)
      await shot(cdp, name, 'assemble')
    }

    const settled = await waitFor(cdp, `(() => {
      const frame = document.querySelector('.app-frame')
      const cards = [...document.querySelectorAll('.bento')]
      return !!frame && frame.classList.contains('is-entrance-ready') && cards.length > 0 && cards.every(c => parseFloat(getComputedStyle(c).opacity) > 0.98)
    })()`, 12000)
    check(settled, `${name}：工作台组装完成（卡片全部落定）`)
    await sleep(700)
    await shot(cdp, name, 'shell')

    const log = await evalJs(cdp, 'window.__log || []')
    const errs = await evalJs(cdp, 'window.__err || []')
    const taps = await evalJs(cdp, 'window.__taps || []')
    const pathAfter = await evalJs(cdp, 'location.pathname')
    writeFileSync(join(OUT, `verify-handoff-${name}.json`), JSON.stringify(log, null, 1))
    return analyze(name, log, { reduce, tap, pathAfter, errs, taps })
  } finally {
    try { await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`) } catch { /* 忽略 */ }
    cdp.close()
  }
}

function analyze(name, log, { reduce, tap, pathAfter, errs, taps }) {
  // ① 无幕：旧遮罩组件不存在；屏幕中心始终被页面本体命中（页面没有被覆盖）
  const morphFrames = log.filter(r => r.morph > 0)
  check(morphFrames.length === 0, `${name}：转场全程无幕（遮罩组件不存在）`, morphFrames.length ? `${morphFrames.length} 帧` : '')
  const outFrames = log.filter(r => r.inPage === 0)
  check(outFrames.length === 0, `${name}：屏幕中心始终被页面本体命中（无覆盖层）`,
    outFrames.length ? `${outFrames.length} 帧：t = ${outFrames.slice(0, 4).map(r => r.t).join(', ')}` : '')

  if (reduce) {
    const cardOps = [...new Set(log.map(r => r.cardOp).filter(v => v >= 0))]
    const mids = cardOps.filter(v => v > 0.05 && v < 0.95)
    check(mids.length === 0, `${name}：减少动态效果下不做退场动画`, `中间态 ${mids.join(', ') || '无'}`)
    const done = log.some(r => r.path === '/dashboard' && r.bento === 1)
    check(done, `${name}：直接进入工作台且卡片正常显示`)
    return
  }

  // ② 退场：登录卡与深色画布淡出（有中间态，不是硬切）
  const cardOps = [...new Set(log.map(r => r.cardOp).filter(v => v >= 0))].sort((a, b) => b - a)
  const canvasOps = [...new Set(log.map(r => r.canvasOp).filter(v => v >= 0))].sort((a, b) => b - a)
  const cardMid = cardOps.filter(v => v > 0.05 && v < 0.95)
  const canvasMid = canvasOps.filter(v => v > 0.05 && v < 0.95)
  check(cardMid.length >= 2, `${name}：登录卡淡出退场（有中间态）`, cardOps.slice(0, 6).join(' → '))
  check(canvasMid.length >= 2, `${name}：深色画布淡出退场（有中间态）`, canvasOps.slice(0, 6).join(' → '))

  // ③ 先退净，再切路由
  const swIdx = log.findIndex(r => r.path === '/dashboard')
  if (swIdx < 0) { check(false, `${name}：未观察到路由切换`); return }
  const before = log.slice(0, swIdx).filter(r => r.cardOp >= 0)
  const lastCardOp = before.length ? before[before.length - 1].cardOp : -1
  check(lastCardOp >= 0 && lastCardOp < 0.2, `${name}：路由在登录页退净后才切`, `切路前最后一帧卡片透明度 ${lastCardOp}`)

  // ④ 切路后骨架已铺满（无空洞）→ 组装：卡片自中心落位、页头级联
  //    注：这里不再断言「首帧隐藏态」。旧实现靠先藏后飞来避免闪终态，
  //    但那 0.88s 的真空期正是白屏的来源；现在改为骨架常驻、只做位移。
  const after = log.slice(swIdx)
  const withCards = after.filter(r => r.bentoN > 0)
  check(withCards.length > 0, `${name}：工作台卡片已渲染`)
  if (!withCards.length) return
  const firstFew = withCards.slice(0, 3)
  check(firstFew.every(r => r.bento >= 0.9), `${name}：切路后卡片立即可见（无空洞）`, `首帧 ${firstFew.map(r => r.bento).join(', ')}`)
  // 框体全程不参与淡入：舞台底一直在，整框淡入就是白屏
  const frameFirst = withCards.filter(r => r.frameOp >= 0).slice(0, 3)
  check(frameFirst.length > 0 && frameFirst.every(r => r.frameOp > 0.9), `${name}：框体自首帧即完整（不整体淡入）`, frameFirst.map(r => r.frameOp).join(', '))
  // 组装改由位置与缩放表达，卡片透明度应始终为 1
  const bentoMid = [...new Set(withCards.map(r => r.bento))].filter(v => v > 0.05 && v < 0.95)
  check(bentoMid.length === 0, `${name}：卡片透明度全程不参与组装`, bentoMid.length ? `出现 ${bentoMid.length} 档中间态` : '始终为 1')
  const rects = [...new Set(withCards.map(r => (r.rect || []).join(',')))].filter(s => s && s !== ',')
  check(rects.length >= 3, `${name}：卡片自中心落位（位置有中间态）`, `${rects.length} 档位置`)
  const frameOps = [...new Set(withCards.map(r => r.frameOp).filter(v => v >= 0))]
  check(frameOps.every(v => v > 0.9), `${name}：工作台框体无整体淡入`, frameOps.slice(0, 6).join(' → '))
  const revealMid = [...new Set(after.map(r => r.reveal).filter(v => v > 0.05 && v < 0.95))]
  check(revealMid.length >= 1, `${name}：页头随交接级联落位`, revealMid.slice(0, 4).join(', '))
  const settledFrame = withCards.find(r => r.bento === 1 && r.ready === 1)
  check(Boolean(settledFrame), `${name}：工作台最终稳定（卡片全显、入场完成）`, settledFrame ? `t = ${settledFrame.t}ms` : '')

  // ⑤ 节奏（信息）
  const tSwitch = log[swIdx].t
  const tSettle = settledFrame ? settledFrame.t : -1
  console.log(`  [info] ${name}：切换 ${tSwitch}ms，稳定 ${tSettle}ms（自提交）`)

  if (tap) {
    check(pathAfter === '/dashboard', `${name}：转场中连点未误导航`, pathAfter)
    const inWindow = (taps || []).filter(x => x.t <= (tSettle > 0 ? tSettle + 150 : 4000))
    check(inWindow.length === 0, `${name}：转场期间点击未放行到页面`, `放行 ${inWindow.length} 次 ${JSON.stringify(inWindow.slice(0, 3))}`)
    check((errs || []).length === 0, `${name}：转场无 JS 异常`, JSON.stringify((errs || []).slice(0, 3)))
  }
}

/* ── 主流程 ── */
const profile = mkdtempSync(join(tmpdir(), 'ks-handoff-'))
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
  await runScenario('light')
  await runScenario('dark', { dark: true })
  await runScenario('reduce', { reduce: true })
  // 回归：转场中连点，点击不得放行到页面
  await runScenario('guard', { tap: true })
} finally {
  try { execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' }) } catch { /* 忽略 */ }
}

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}`)
process.exit(failures === 0 ? 0 : 1)
