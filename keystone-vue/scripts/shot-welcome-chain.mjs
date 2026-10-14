/* 欢迎链分镜截图：在飞行途中抓帧，人工核对线条、亮点与铭牌位置。
 * 附带验证「预热未命中」时骨架层的表现（拦截 dashboard/summary 制造慢接口）。
 *
 * 用法：node scripts/shot-welcome-chain.mjs [base_url] [--slow-api]
 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9339
const BASE = process.argv[2] || 'http://127.0.0.1:5180'
const SLOW = process.argv.includes('--slow-api')
const OUT = fileURLToPath(new URL('.', import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    const handlers = new Map()
    let id = 0
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) rej(new Error(msg.error.message))
        else res(msg.result)
        return
      }
      // CDP 事件没有 id：交给注册的处理器。Fetch 域靠这条路径把
      // Fetch.requestPaused 送进来，不做处理的话请求会永远挂起。
      handlers.get(msg.method)?.(msg.params)
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
      on(method, fn) { handlers.set(method, fn) },
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
      } catch { /* 等待 */ }
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
    try { if (await evalJs(cdp, expr)) return true } catch { /* 跳转中 */ }
    await sleep(60)
  }
  return false
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `chain-${name}.png`), Buffer.from(r.data, 'base64'))
}

const LOGIN = `(async () => {
  const q = s => document.querySelector(s)
  const setVal = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const codeEl = q('.captcha-code')
  if (!codeEl) return 'no-captcha'
  setVal(q("input[placeholder='请输入账号']"), 'admin')
  setVal(q("input[placeholder='请输入密码']"), 'admin123')
  setVal(q("input[placeholder='请输入右侧字符']"), codeEl.textContent.replace(/\\s+/g, ''))
  ;[...document.querySelectorAll('.login-card button')].find(b => /登录/.test(b.textContent))?.click()
  return 'ok'
})()`

/* 帧选择器：按动画的真实状态取帧，而不是按固定毫秒数猜。
   链路的实际耗时受首屏渲染与数据预热影响，猜时间会抓到错位的帧。 */
const STATE = `(() => {
  const q = s => document.querySelector(s)
  const greet = q('.welcome-greet')
  const plate = q('.welcome-plate')
  const title = q('.page-title')
  const orbEl = q('.welcome-orb')
  const gr = greet ? greet.getBoundingClientRect() : null
  const tr = title ? title.getBoundingClientRect() : null
  const orr = orbEl ? orbEl.getBoundingClientRect() : null
  return {
    greetLen: greet ? greet.textContent.replace(/\\s+/g,'').length : 0,
    greetText: greet ? greet.textContent.replace(/\\s+/g,'') : '',
    gr: gr ? Math.round(gr.left) : -1,
    gw: gr ? Math.round(gr.width) : -1,
    gx: gr ? Math.round(gr.left + gr.width / 2) : -1,
    gy: gr ? Math.round(gr.top + gr.height / 2) : -1,
    tl: tr ? Math.round(tr.left) : -1,
    ty: tr ? Math.round(tr.top + tr.height / 2) : -1,
    vp: [window.innerWidth, window.innerHeight],
    plateOp: plate ? Math.round(parseFloat(getComputedStyle(plate).opacity) * 100) / 100 : -1,
    titleOp: title ? Math.round(parseFloat(getComputedStyle(title).opacity) * 100) / 100 : -1,
    orbOp: orbEl ? Math.round(parseFloat(getComputedStyle(orbEl).opacity) * 100) / 100 : -1,
    ox: orr ? Math.round(orr.left + orr.width / 2) : -1,
    // 星球缩放：matrix 的 m11 就是 scaleX。注意排除 rotate（此刻 rotation 很小，误差可忽略）
    osc: (() => {
      if (!orbEl) return -1
      const m = getComputedStyle(orbEl).transform
      if (!m || m === 'none') return -1
      const inner = m.slice(m.indexOf('(') + 1, m.lastIndexOf(')'))
      const a = Number(inner.split(',')[0])
      return Number.isFinite(a) ? Math.round(a * 100) / 100 : -1
    })(),
    oy: orr ? Math.round(orr.top + orr.height / 2) : -1,
    skel: document.querySelectorAll('.skeleton-bar').length,
    heroH: Math.round(q('.bento')?.getBoundingClientRect().height || 0),
    figure: q('.metric-xl')?.innerText.replace(/\\s+/g,'') || '',
  }
})()`

/** 等到状态满足就抓帧；超时返回 false 由调用方报告 */
async function shotWhen(cdp, name, predicate, timeout = 9000) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < timeout) {
    const s = await evalJs(cdp, STATE)
    last = s
    if (predicate(s)) {
      await shot(cdp, name)
      return { ok: true, state: s }
    }
    await sleep(30)
  }
  await shot(cdp, `${name}-timeout`)
  return { ok: false, state: last }
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'ks-shot-'))
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    '--window-size=1600,980', 'about:blank',
  ], { stdio: 'ignore' })

  let cdp
  try {
    const version = await probeVersion()
    const boot = await connect(version.webSocketDebuggerUrl)
    const { targetId } = await boot.send('Target.createTarget', { url: 'about:blank' })
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    cdp = await connect(list.find(t => t.id === targetId).webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    // 页面内错误捕获：链条若中途抛出，这里能看到原因
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__err=[];
        window.addEventListener('error',e=>window.__err.push('ERR '+String(e.message||'').slice(0,200)+' @'+String(e.filename||'').split('/').pop()+':'+e.lineno));
        window.addEventListener('unhandledrejection',e=>window.__err.push('REJ '+String((e.reason&&e.reason.stack)||e.reason||'').slice(0,200)));`,
    })

    if (SLOW) {
      // 拦截概览接口并延迟放行：制造「预热未命中 + 接口慢」，验证骨架 → 真实数据的路径。
      // Fetch.requestPaused 是**事件**（无 id），必须经 on() 处理器继续，
      // 早先只改 send 的写法接不到事件，请求会永远挂起（骨架不消失）。
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*dashboard/summary*', requestStage: 'Request' }] })
      const fake = new URL(BASE).searchParams.get('delay')
      const DELAY = fake ? Number(fake) : 3000
      cdp.on('Fetch.requestPaused', async ({ requestId }) => {
        await sleep(DELAY)
        try { await cdp.send('Fetch.continueRequest', { requestId }) } catch { /* 已放行 */ }
      })
      console.log(`慢接口：概览延迟 ${DELAY}ms 放行`)
    }

    await cdp.send('Page.navigate', { url: `${BASE}/login` })
    await waitFor(cdp, `!!document.querySelector('.captcha-code')`)
    console.log('登录：', await evalJs(cdp, LOGIN))
    await waitFor(cdp, `!!document.querySelector('.welcome-plate')`, 20000)

    const frames = [
      // 星球刚从右上角起坠（很小）
      ['1-orb-launch', s => s.orbOp > 0.3 && s.osc > 0 && s.osc < 0.35],
      // 坠落中段：正在长大，拖着尾迹
      ['2-orb-growing', s => s.orbOp > 0.5 && s.osc >= 0.35 && s.osc < 1.0],
      // 接近中心：已明显变大
      ['3-orb-big', s => s.orbOp > 0.4 && s.osc >= 1.0],
      // 炸开、浮牌显现
      ['4-burst', s => s.plateOp > 0.2 && s.plateOp < 0.95],
      // 打字
      ['5-typing', s => s.plateOp > 0.9 && s.greetLen >= 2 && s.greetLen < 6 && Math.abs(s.gx - s.vp[0] / 2) < 80],
      // 打完
      ['6-typed', s => s.plateOp > 0.9 && s.greetLen >= 6 && Math.abs(s.gx - s.vp[0] / 2) < 80],
      // 回落途中
      ['7-falling-home', s => s.plateOp > 0.5 && s.gx < s.vp[0] * 0.45 && s.gx > s.vp[0] * 0.24],
      // 落回标题
      ['8-landed', s => s.plateOp > 0.5 && Math.abs(s.gr - s.tl) < 6],
      ['9-skeleton', s => s.skel > 0],
    ]
    // 单遍采集：截图本身耗时，逐帧串行等会让后面的帧错过时间窗。
    // 这里在一个循环里按顺序匹配，命中就抓、抓完继续用当前状态匹配下一帧。
    const todo = SLOW ? frames : frames.filter(([n]) => !n.startsWith('9-'))
    const got = new Set()
    const deadline = Date.now() + 18000
    while (got.size < todo.length && Date.now() < deadline) {
      const st = await evalJs(cdp, STATE)
      for (const [name, pred] of todo) {
        if (got.has(name) || !pred(st)) continue
        const t = Date.now()
        await shot(cdp, name)
        got.add(name)
        console.log(`${name}：已抓  星球×${st.osc} (${st.ox},${st.oy})  浮牌${st.plateOp}  打字${st.greetLen}字  骨架${st.skel}（截图 ${Date.now() - t}ms）`)
        break
      }
      await sleep(20)
    }
    for (const [name] of todo) if (!got.has(name)) console.log(`${name}：未捕获（时间窗错过）`)

    await sleep(1400)
    await shot(cdp, '5-settled')
    const end = await evalJs(cdp, STATE)
    console.log('末态：', JSON.stringify({ skel: end.skel, 浮牌: end.plateOp, 标题op: end.titleOp, heroH: end.heroH, figure: end.figure }))
    const errs = await evalJs(cdp, 'window.__err || []')
    if (errs.length) { console.log('页面错误：'); errs.forEach(e => console.log('  -', e)) }
    else console.log('页面错误：无')
  } finally {
    cdp?.close()
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }) } catch { /* 已退出 */ }
  }
}

main().catch(e => { console.error('截图脚本出错：', e.message); process.exit(1) })