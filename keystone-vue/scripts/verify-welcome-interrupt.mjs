/* 登录成功动画「可打断」验证。
 *
 * 需求：登录成功后的欢迎动画期间，用户点菜单 / 点按钮 / 按键，动画必须**立刻**收场，
 *      页面与数据立刻恢复常态（标题可见、右上角头像可见、不再被输入拦截）。
 *
 * 直连 Chromium CDP（agent-browser CLI 在本机不可用，见项目记忆）。
 * 三个场景：
 *   menu    —— 动画进行中（浮牌已浮现）用真实鼠标点导航项：图层立刻卸载 + 成功切页
 *   transit —— 刚切到工作台、天幕还盖着时点导航：特效层快速退场，页面即刻可用
 *   key     —— 动画进行中按键盘：图层立刻卸载，停留原页且页头/头像还原
 *
 * 用法：node scripts/verify-welcome-interrupt.mjs [menu|transit|key|all]
 * 前提：后端 8090 与前端 5180 已启动；账号 admin / admin123。
 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9338
const BASE = process.argv[3] || 'http://127.0.0.1:5180'
const WHICH = process.argv[2] || 'all'
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
    await sleep(50)
  }
  return false
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `verify-interrupt-${name}.png`), Buffer.from(r.data, 'base64'))
}

/* ── 登录：填表 + 提交，并常驻采样（层级在场 / 浮牌与页头透明度 / 路径） ── */
const LOGIN = `(async () => {
  const q = s => document.querySelector(s)
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const codeEl = q('.captcha-code')
  if (!codeEl || !codeEl.textContent.trim()) return 'no-captcha'
  window.__err = []
  window.addEventListener('error', e => window.__err.push(String(e.message).slice(0, 80)))
  setVal(q("input[placeholder='请输入账号']"), 'admin')
  setVal(q("input[placeholder='请输入密码']"), 'admin123')
  setVal(q("input[placeholder='请输入右侧字符']"), codeEl.textContent.replace(/\\s+/g, ''))
  q("button[type='submit']").click()
  return 'ok'
})()`

/** 页面状态快照：标题 / 头像 / 图层 / 特效层 / 数据区 */
const SNAPSHOT = `(() => {
  const op = s => { const el = document.querySelector(s); return el ? Math.round(parseFloat(getComputedStyle(el).opacity) * 1000) / 1000 : -1 }
  const title = document.querySelector('.page-title')
  const body = document.querySelector('.page')
  return {
    path: location.pathname,
    titleOp: title ? Math.round(parseFloat(getComputedStyle(title).opacity) * 1000) / 1000 : -1,
    titleText: title ? title.textContent.trim().slice(0, 40) : '',
    chipOp: op('.user-chip'),
    avatarTransform: (() => { const a = document.querySelector('.user-chip .avatar'); return a ? getComputedStyle(a).transform : 'none' })(),
    welcome: !!document.querySelector('.welcome-layer'),
    transit: !!document.querySelector('.transit-layer'),
    skyOp: op('.transit-sky'),
    plateOp: op('.welcome-plate'),
    pageOp: body ? Math.round(parseFloat(getComputedStyle(body).opacity) * 1000) / 1000 : -1,
    bentoCount: document.querySelectorAll('.bento').length,
    rowCount: document.querySelectorAll('tr.data-row').length,
    hasTable: !!document.querySelector('.table-wrap'),
  }
})()`

async function prepare(cdp) {
  await cdp.send('Page.navigate', { url: `${BASE}/login` })
  await waitFor(cdp, `document.readyState === 'complete'`, 20000)
  await evalJs(cdp, `(() => { localStorage.clear(); sessionStorage.clear(); return 1 })()`)
  await cdp.send('Page.reload')
  await waitFor(cdp, `document.readyState === 'complete'`, 20000)
  return waitFor(cdp, `!!document.querySelector('.captcha-code') && document.querySelector('.captcha-code').textContent.trim().length >= 4`, 15000)
}

/** 找一个当前可点、且不是当前页的导航叶子节点，返回它的视口中心 */
const PICK_NAV = `(() => {
  const items = [...document.querySelectorAll('.nav-item:not(.nav-item-branch)')]
  const el = items.find(b => {
    const r = b.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && r.top > 90 && r.bottom < innerHeight - 24 && !b.classList.contains('is-active')
  })
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), label: el.textContent.trim() }
})()`

async function clickAt(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 })
  await sleep(30)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 })
}

/** 打断后必须在「一帧级」时间内收场：给 400ms 余量（含 Vue 下一轮渲染 + 路由） */
async function assertRecovered(cdp, name, { samePage = false } = {}) {
  const gone = await waitFor(cdp, `!document.querySelector('.welcome-layer') && !document.querySelector('.transit-layer')`, 2000)
  check(gone, `${name}：欢迎层与特效层已卸载`)
  await sleep(260) // 路由过场（pageLeave 0.18s）+ 一次渲染
  const s = await evalJs(cdp, SNAPSHOT)
  check(s.titleOp === 1 && s.titleText.length > 0, `${name}：页头标题可见`, `op=${s.titleOp} "${s.titleText}"`)
  check(s.chipOp === 1, `${name}：右上角头像可见`, `op=${s.chipOp}`)
  check(s.pageOp === 1 && (s.bentoCount > 0 || s.hasTable), `${name}：数据区正常显示`, `pageOp=${s.pageOp} bento=${s.bentoCount} table=${s.hasTable}`)
  // 数据本身也要真的落位（列表行 / 概览卡片），而不是一直挂着骨架
  const dataOn = await waitFor(cdp, `document.querySelectorAll('tr.data-row').length > 0 || document.querySelectorAll('.bento').length > 0`, 6000)
  check(dataOn, `${name}：数据已渲染（行/卡片就位）`, `rows=${(await evalJs(cdp, SNAPSHOT)).rowCount}`)
  if (samePage) check(s.path === '/dashboard', `${name}：停留在原页`, s.path)
  else check(s.path !== '/dashboard', `${name}：已切到点击的菜单`, s.path)
  const errs = await evalJs(cdp, 'window.__err || []')
  check(errs.length === 0, `${name}：无 JS 异常`, JSON.stringify(errs.slice(0, 3)))
  return s
}

async function newPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
  const target = await res.json()
  const cdp = await connect(target.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  return { target, cdp }
}

/* ── 场景 1：动画进行中（浮牌已浮现）点导航 ── */
async function runMenu() {
  const name = 'menu'
  console.log(`\n=== 场景：${name}（打字/浮牌阶段点菜单） ===`)
  const { target, cdp } = await newPage()
  try {
    const ready = await prepare(cdp)
    check(ready, `${name}：登录页就绪`)
    if (!ready) return
    const submitted = await evalJs(cdp, LOGIN)
    check(submitted === 'ok', `${name}：已提交登录`, String(submitted))
    if (submitted !== 'ok') return

    const plateUp = await waitFor(cdp, `(() => {
      const p = document.querySelector('.welcome-plate')
      return !!p && parseFloat(getComputedStyle(p).opacity) > 0.9
    })()`, 15000)
    check(plateUp, `${name}：欢迎链进行中（浮牌已浮现）`)
    const before = await evalJs(cdp, SNAPSHOT)
    check(before.titleOp < 0.2, `${name}：此刻真实标题被浮牌接管（op→0）`, `op=${before.titleOp}`)
    await shot(cdp, `${name}-1-running`)

    const nav = await evalJs(cdp, PICK_NAV)
    check(!!nav, `${name}：找到可点导航项`, JSON.stringify(nav))
    if (!nav) return
    const t0 = await evalJs(cdp, 'performance.now()')
    await clickAt(cdp, nav.x, nav.y)
    const goneMs = await (async () => {
      const ok = await waitFor(cdp, `!document.querySelector('.welcome-layer')`, 3000)
      const t1 = await evalJs(cdp, 'performance.now()')
      return ok ? Math.round(t1 - t0) : -1
    })()
    check(goneMs >= 0, `${name}：点击即打断（欢迎层在同一轮内卸掉）`, `${goneMs}ms`)
    check(goneMs >= 0 && goneMs < 400, `${name}：打断延迟 < 400ms`, `${goneMs}ms`)

    const moved = await waitFor(cdp, `location.pathname !== '/dashboard'`, 5000)
    check(moved, `${name}：点击照常生效、已切页`, await evalJs(cdp, 'location.pathname'))
    await assertRecovered(cdp, name)
    await shot(cdp, `${name}-2-recovered`)
    await sleep(1000)
    await shot(cdp, `${name}-3-settled`)
  } finally {
    try { await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`) } catch { /* 忽略 */ }
    cdp.close()
  }
}

/* ── 场景 2：刚切到工作台、天幕还盖着时点导航（打断穿越层） ── */
async function runTransit() {
  const name = 'transit'
  console.log(`\n=== 场景：${name}（天幕盖着时点菜单） ===`)
  const { target, cdp } = await newPage()
  try {
    const ready = await prepare(cdp)
    check(ready, `${name}：登录页就绪`)
    if (!ready) return
    const submitted = await evalJs(cdp, LOGIN)
    check(submitted === 'ok', `${name}：已提交登录`, String(submitted))
    if (submitted !== 'ok') return

    // 切到工作台、导航已渲染、天幕仍不透明 —— 就是「穿越还没结束」的窗口
    const inTransit = await waitFor(cdp, `location.pathname === '/dashboard' && !!document.querySelector('.nav-item') && (() => {
      const s = document.querySelector('.transit-sky')
      return !!s && parseFloat(getComputedStyle(s).opacity) > 0.5
    })()`, 12000)
    check(inTransit, `${name}：已进入工作台且天幕未退（转场进行中）`)
    const nav = await evalJs(cdp, PICK_NAV)
    if (!inTransit || !nav) return
    const t0 = await evalJs(cdp, 'performance.now()')
    await clickAt(cdp, nav.x, nav.y)
    const skyGone = await (async () => {
      const ok = await waitFor(cdp, `(() => {
        const s = document.querySelector('.transit-sky')
        return !s || parseFloat(getComputedStyle(s).opacity) < 0.02
      })()`, 3000)
      const t1 = await evalJs(cdp, 'performance.now()')
      return ok ? Math.round(t1 - t0) : -1
    })()
    check(skyGone >= 0 && skyGone < 600, `${name}：天幕快速退场`, `${skyGone}ms`)
    const moved = await waitFor(cdp, `location.pathname !== '/dashboard'`, 5000)
    check(moved, `${name}：点击照常生效、已切页`, await evalJs(cdp, 'location.pathname'))
    await assertRecovered(cdp, name)
    await shot(cdp, `${name}-recovered`)
    await sleep(1000)
    await shot(cdp, `${name}-settled`)
  } finally {
    try { await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`) } catch { /* 忽略 */ }
    cdp.close()
  }
}

/* ── 场景 3：动画进行中按键盘 ── */
async function runKey() {
  const name = 'key'
  console.log(`\n=== 场景：${name}（按键打断） ===`)
  const { target, cdp } = await newPage()
  try {
    const ready = await prepare(cdp)
    check(ready, `${name}：登录页就绪`)
    if (!ready) return
    const submitted = await evalJs(cdp, LOGIN)
    check(submitted === 'ok', `${name}：已提交登录`, String(submitted))
    if (submitted !== 'ok') return

    const plateUp = await waitFor(cdp, `(() => {
      const p = document.querySelector('.welcome-plate')
      return !!p && parseFloat(getComputedStyle(p).opacity) > 0.9
    })()`, 15000)
    check(plateUp, `${name}：欢迎链进行中（浮牌已浮现）`)
    const t0 = await evalJs(cdp, 'performance.now()')
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75, text: 'k' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, nativeVirtualKeyCode: 75 })
    const goneMs = await (async () => {
      const ok = await waitFor(cdp, `!document.querySelector('.welcome-layer')`, 3000)
      const t1 = await evalJs(cdp, 'performance.now()')
      return ok ? Math.round(t1 - t0) : -1
    })()
    check(goneMs >= 0 && goneMs < 400, `${name}：按键即打断（< 400ms）`, `${goneMs}ms`)
    await assertRecovered(cdp, name, { samePage: true })
    await shot(cdp, `${name}-recovered`)
    await sleep(1000)
    await shot(cdp, `${name}-settled`)
  } finally {
    try { await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`) } catch { /* 忽略 */ }
    cdp.close()
  }
}

/* ── 主流程 ── */
const profile = mkdtempSync(join(tmpdir(), 'ks-int-'))
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
  if (WHICH === 'menu' || WHICH === 'all') await runMenu()
  if (WHICH === 'transit' || WHICH === 'all') await runTransit()
  if (WHICH === 'key' || WHICH === 'all') await runKey()
} finally {
  try { execSync(`taskkill /PID ${chrome.pid} /T /F`, { stdio: 'ignore' }) } catch { /* 忽略 */ }
}

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}`)
process.exit(failures === 0 ? 0 : 1)
