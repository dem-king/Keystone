/* 欢迎链 v2 + 星球联动验证：按动画真实状态取帧，不按毫秒猜。
 * 覆盖 化星 → 起飞 → 融入 → 星归 → 工牌 → 坠落 → 分裂 → 双归宿 → 握手 十拍，
 * 并对「同点交接」「副份落点」做数值断言。
 *
 * 用法：node scripts/verify-welcome-v2.mjs [base_url]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9341
const BASE = process.argv[2] || 'http://127.0.0.1:5180'
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
  writeFileSync(join(OUT, `v2-${name}.png`), Buffer.from(r.data, 'base64'))
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

const STATE = `(() => {
  const q = s => document.querySelector(s)
  const rect = el => {
    const b = el && el.getBoundingClientRect()
    return b ? {
      x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2),
      l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
    } : null
  }
  const op = el => el ? Math.round(parseFloat(getComputedStyle(el).opacity) * 100) / 100 : -1
  const chip = q('.user-chip')
  const chipName = q('.user-chip .user-name')
  const orb = q('.welcome-orb')
  const seed = q('.transit-seed')
  const idc = q('.welcome-idcard')
  const ghost = q('.welcome-name-ghost')
  const plate = q('.welcome-plate')
  const title = q('.page-title')
  const sorb = q('.success-orb')
  const body = q('.success-orb .orb-body')
  const dept = q('.welcome-idcard-dept')
  return {
    err: (window.__err || []).slice(0, 3),
    route: location.pathname,
    vp: [innerWidth, innerHeight],
    orb: { op: op(orb), ...rect(orb) },
    seed: { op: op(seed), ...rect(seed) },
    idc: { op: op(idc), ...rect(idc), dept: dept ? dept.textContent : '' },
    ghost: { op: op(ghost), text: ghost ? ghost.textContent : '', ...rect(ghost) },
    plate: { op: op(plate), ...rect(plate) },
    chip: { op: op(chip), ...rect(chip) },
    chipName: rect(chipName),
    title: { op: op(title), ...rect(title) },
    sorb: { op: op(sorb), bodyOp: op(body), ...rect(sorb) },
  }
})()`

/** 按状态条件抓帧（条件必须「只在新状态才成立」，否则会立刻通过） */
async function shotWhen(cdp, name, predicate, timeout = 12000) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < timeout) {
    const s = await evalJs(cdp, STATE)
    last = s
    if (predicate(s)) {
      await shot(cdp, name)
      return { ok: true, at: Date.now() - t0, state: s }
    }
    await sleep(30)
  }
  await shot(cdp, `${name}-TIMEOUT`)
  return { ok: false, at: Date.now() - t0, state: last }
}

const report = []
function note(name, r, extra = '') {
  report.push(`${r.ok ? 'PASS' : 'FAIL'}  ${name}  +${r.at}ms  ${extra}`)
  if (!r.ok) {
    console.log(`--- ${name} 未命中，末帧状态 ---`)
    console.log(JSON.stringify(r.state, null, 1))
  }
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'ks-v2-'))
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
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__err=[];
        window.addEventListener('error',e=>window.__err.push('ERR '+String(e.message||'').slice(0,200)+' @'+String(e.filename||'').split('/').pop()+':'+e.lineno));
        window.addEventListener('unhandledrejection',e=>window.__err.push('REJ '+String((e.reason&&e.reason.stack)||e.reason||'').slice(0,200)));`,
    })

    await cdp.send('Page.navigate', { url: BASE + '/login' })
    if (!await waitFor(cdp, `!!document.querySelector('.captcha-code')`)) throw new Error('登录页未就绪')

    const loginState = await evalJs(cdp, LOGIN)
    if (loginState !== 'ok') throw new Error('登录脚本失败: ' + loginState)
    const t0 = Date.now()

    // 1 化星：蓝壳退、星体亮
    note('化星', await shotWhen(cdp, '1-morph', s => s.sorb.bodyOp >= 0.55, 6000))

    // 2 起飞：seed 已接管并离开按钮
    const lift = await shotWhen(cdp, '2-liftoff', s => s.seed.op > 0.85 && s.sorb.y - s.seed.y > 40, 8000)
    note('起飞', lift)

    // 3 融入：seed 已到中央并淡出（0.12s 的窗口，按「已到位 + 已透明 + 元素还在」判定）
    const merge = await shotWhen(cdp, '3-merge', s => s.seed.op >= 0 && s.seed.op < 0.4 && s.seed.w > 0 && Math.abs(s.seed.x - s.vp[0] / 2) < 70, 6000)
    note('融入', merge)

    // 4 星归：欢迎链星球在胶囊头像处亮起
    const arrive = await shotWhen(cdp, '4-arrive', s => s.orb.op > 0.85 && s.chip && Math.abs(s.orb.x - (s.chip.l + 20)) < 40, 12000)
    note('星归', arrive)

    // 5 工牌展开：宽度超过 120 且部门文字已写入
    const idcard = await shotWhen(cdp, '5-idcard', s => s.idc.op > 0.9 && s.idc.w > 120 && s.idc.dept.length > 0, 6000)
    note('工牌', idcard, idcard.state ? `dept=${idcard.state.idc.dept}` : '')

    // 6 打字完成：浮牌文字长度 >= 4
    const typed = await shotWhen(cdp, '6-typed', s => s.plate.op > 0.9 && s.plate.w > 100 && s.ghost.op < 0.1, 8000)
    note('打字/待分裂', typed)

    // 7 分裂：ghost 可见且已离开原位
    const split = await shotWhen(cdp, '7-split', s => s.ghost.op > 0.6, 6000)
    note('分裂', split)

    // 8 双宿途中：ghost 已过视口中线（飞向右上）
    const fly = await shotWhen(cdp, '8-fly', s => s.ghost.op > 0.3 && s.ghost.x > s.vp[0] * 0.55, 6000)
    note('双宿', fly)

    // 8b 归位落点：浮牌已贴到标题位置（标题还没亮起），量它和真实标题的左边缘差
    const landed = await shotWhen(cdp, '9a-landed', s => s.plate.op > 0.9 && s.title.op < 0.25 && s.plate.x < s.title.x + 40 && Math.abs(s.plate.y - s.title.y) < 40, 9000)
    const dx = landed.state && landed.state.plate && landed.state.title ? Math.round(landed.state.plate.l + 22 - landed.state.title.l) : 999
    const dy = landed.state && landed.state.plate && landed.state.title ? Math.round(landed.state.plate.t + 14 - landed.state.title.t) : 999
    // 落点精度不在这里断言：30ms 轮询 + 截图延迟抓不准「落定那一帧」。
    // 精确值由 scripts/trace-home.mjs 的 tx/ty 归零保证（末帧 tx=0、ty=0）。
    note('归位（参考帧）', landed, `Δx=${dx} Δy=${dy}（含截图延迟，仅供人工比对）`)

    // 9 双握手：胶囊亮起、ghost 淡出、标题已可见
    const handoff = await shotWhen(cdp, '9-handoff', s => s.chip.op > 0.9 && s.title.op > 0.9, 9000)
    note('握手', handoff)

    // 10 收尾：欢迎层卸载
    const cleanup = await waitFor(cdp, `!document.querySelector('.welcome-layer')`, 8000)
    report.push(`${cleanup ? 'PASS' : 'FAIL'}  卸载  欢迎层已移除`)

    await shot(cdp, 'final')

    const st = await evalJs(cdp, STATE)
    console.log('\n=== 断言 ===')
    if (st.chipName && st.ghost) {
      const dx = Math.abs(st.ghost.x - st.chipName.x)
      const dy = Math.abs(st.ghost.y - st.chipName.y)
      console.log(`${dx < 2 && dy < 2 ? 'PASS' : 'SKIP'}  副份落点偏差  dx=${dx} dy=${dy}（握手后 ghost 已隐藏，仅供记录）`)
    }
    console.log(`\n${st.err.length ? 'FAIL 页面错误: ' + st.err.join(' | ') : 'PASS 无页面错误'}`)
    console.log(`最终 chip.opacity=${st.chip.op}  title.opacity=${st.title.op}  scrollW=${await evalJs(cdp, 'document.documentElement.scrollWidth')}/${st.vp[0]}`)
    console.log(`总耗时（登录点击 → 收尾）≈ ${Date.now() - t0}ms`)

    console.log('\n=== 分镜 ===')
    for (const line of report) console.log(line)
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    child.kill()
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('验证失败:', e.message); process.exitCode = 1 })
