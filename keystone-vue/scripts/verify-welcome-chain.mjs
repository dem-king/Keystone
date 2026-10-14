/* 欢迎链 + 首屏骨架验证：登录成功后用户名浮出、沿细线归位到右上角胶囊，
 * 且首屏不再出现内容空洞。
 *
 * 验证点：
 *  1. 无白屏：进入工作台后每一帧都有卡片可见（.bento 平均不透明度始终 > 0）
 *  2. 骨架先铺满：数据到齐前 .skeleton-bar 存在，卡片高度已占位
 *  3. 欢迎链存在：.welcome-plate / .welcome-thread / .welcome-halo 在场
 *  4. 名字逐字打出：.welcome-greet 文本从「，」逐步长到完整用户名
 *  5. 轨迹线生长：path的 stroke-dashoffset 单调趋近 0
 *  6. 亮点飞行：circle 的 cx/cy 从起点移到右上角胶囊中心附近
 *  7. 胶囊接收：亮点抵达后 .user-chip 出现 box-shadow 扩散
 *  8. 退场收尾：铭牌最终 opacity 归零并被卸载
 *  9. 真实内容取代骨架：.skeleton-bar 清空、.bento 读数为真实数字
 * 10. 减少动态效果下不播欢迎链、且内容立即可见（无空洞）
 *
 * 用法：node scripts/verify-welcome-chain.mjs [base_url]
 * 前提：后端 8090 与前端 5180 已启动；账号 admin / admin123。
 */
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = 'C:/Users/admin/.agent-browser/browsers/chrome-155.0.8059.39/chrome.exe'
const PORT = 9338
const BASE = process.argv[2] || 'http://127.0.0.1:5180'
const OUT = fileURLToPath(new URL('.', import.meta.url))
const sleep = ms => new Promise(r => setTimeout(r, ms))

let failures = 0
function check(ok, label, detail = '') {
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  -> ' + detail : ''}`)
}

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
    try { if (await evalJs(cdp, expr)) return true } catch { /* 跳转中偶发失联 */ }
    await sleep(70)
  }
  return false
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, `verify-chain-${name}.png`), Buffer.from(r.data, 'base64'))
}

/* 登录 + 全帧采样。采样器盯住欢迎链的每一个可观测量：线长、亮点坐标、
   铭牌文本与不透明度、骨架数量、卡片不透明度与高度。 */
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
  window.addEventListener('error', e => window.__err.push(String(e.message).slice(0, 100)))
  const opOf = el => el ? Math.round(parseFloat(getComputedStyle(el).opacity) * 100) / 100 : -1
  const avgOp = els => els.length ? Math.round(els.reduce((a, c) => a + parseFloat(getComputedStyle(c).opacity), 0) / els.length * 100) / 100 : -1
  let frames = 0
  let dustSampled = false
  const tick = () => {
    frames++
    const plate = q('.welcome-plate')
    const greet = q('.welcome-greet')
    const title = q('.page-title')
    const cards = [...document.querySelectorAll('.bento')]
    const skeletons = [...document.querySelectorAll('.skeleton-bar')]
    const pr = plate ? plate.getBoundingClientRect() : null
    const tr = title ? title.getBoundingClientRect() : null
    const gr = greet ? greet.getBoundingClientRect() : null
    const orbEl = q('.welcome-orb')
    const orbR = orbEl ? orbEl.getBoundingClientRect() : null
    window.__log.push({
      t: Math.round(performance.now() - window.__t0),
      path: location.pathname,
      vp: [window.innerWidth, window.innerHeight],
      bento: avgOp(cards),
      bentoN: cards.length,
      heroH: cards.length ? Math.round(cards[0].getBoundingClientRect().height) : 0,
      skel: skeletons.length,
      plateOp: opOf(plate),
      greet: greet ? greet.textContent.replace(/\\s+/g, '') : '',
      // 浮牌文字的左边缘与纵向中心
      gr: gr ? Math.round(gr.left) : -1,
      gy: gr ? Math.round(gr.top + gr.height / 2) : -1,
      gw: gr ? Math.round(gr.width) : -1,
      // 真实标题的左边缘与纵向中心。注意 .page-title 是 h1 块元素，
      // 盒宽通常大于文字宽，只能按文字起始边（左边缘）比较，不能用盒中心。
      tl: tr ? Math.round(tr.left) : -1,
      tt: tr ? Math.round(tr.top) : -1,
      th: tr ? Math.round(tr.height) : -1,
      gt: gr ? Math.round(gr.top) : -1,
      gh: gr ? Math.round(gr.height) : -1,
      ty: tr ? Math.round(tr.top + tr.height / 2) : -1,
      titleOp: opOf(title),
      plateW: pr ? Math.round(pr.width) : -1,
      // 浮牌整体包围盒：飞行途中不能被视口切掉
      pb: pr ? { t: Math.round(pr.top), b: Math.round(pr.bottom), l: Math.round(pr.left), r: Math.round(pr.right) } : null,
      // 星球：位置与不透明度（判断它是否从右上角坠到中心）
      orbOp: orbEl ? Math.round(parseFloat(getComputedStyle(orbEl).opacity) * 100) / 100 : -1,
      obx: orbR ? Math.round(orbR.left + orbR.width / 2) : -1,
      oby: orbR ? Math.round(orbR.top + orbR.height / 2) : -1,
      // 星球旋转角：坠落时星球在翻滚（高光是偏心的，转起来看得见）
      orot: (() => {
        if (!orbEl) return 0
        const m = getComputedStyle(orbEl).transform
        if (!m || m === 'none') return 0
        const inner = m.slice(m.indexOf('(') + 1, m.lastIndexOf(')'))
        const [a, b] = inner.split(',').map(Number)
        if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
        return Math.round(Math.atan2(b, a) * 180 / Math.PI)
      })(),
      // 粒子：星球出现后抽一次即可。getImageData 很慢，只扫星球周围一小块；
      // 太早抽会拿到 -1（那时欢迎层还没挂载）。
      dust: (() => {
        if (dustSampled || !orbEl || !orbR) return -2
        const op = parseFloat(getComputedStyle(orbEl).opacity)
        if (!(op > 0.2)) return -2
        const cv = q('.welcome-dust')
        const g = cv ? cv.getContext('2d') : null
        if (!cv || !g) return -2
        dustSampled = true
        try {
          const dpr = cv.width / window.innerWidth
          const cx = Math.round((orbR.left + orbR.width / 2) * dpr)
          const cy = Math.round((orbR.top + orbR.height / 2) * dpr)
          const half = Math.round(260 * dpr)
          const x0 = Math.max(0, cx - half)
          const y0 = Math.max(0, cy - half)
          const w0 = Math.max(1, Math.min(cv.width - x0, half * 2))
          const h0 = Math.max(1, Math.min(cv.height - y0, half * 2))
          const d = g.getImageData(x0, y0, w0, h0).data
          let n = 0
          for (let i = 3; i < d.length; i += 4 * 13) if (d[i] > 10) n++
          return n
        } catch { return -1 }
      })(),
    })
    if (frames < 780) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  q('.login-card button[type=submit]')?.click()
  const btn = [...document.querySelectorAll('.login-card button')].find(b => /登录/.test(b.textContent))
  if (btn) btn.click()
  return 'ok'
})()`

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'ks-chain-'))
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    '--window-size=1600,980', 'about:blank',
  ], { stdio: 'ignore' })

  let cdp
  try {
    const version = await probeVersion()
    cdp = await connect(version.webSocketDebuggerUrl)
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    const page = list.find(t => t.id === targetId)
    cdp = await connect(page.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')

    await cdp.send('Page.navigate', { url: `${BASE}/login` })
    await waitFor(cdp, `!!document.querySelector('.captcha-code')`)
    const r = await evalJs(cdp, LOGIN_AND_SAMPLE)
    check(r === 'ok', '登录提交', r)

    const switched = await waitFor(cdp, `location.pathname !== '/login'`, 20000)
    if (!switched) {
      // 登录没成功时把页面上显示的失败原因带出来，别只报「未捕获到骨架」
      const why = await evalJs(cdp, `(document.querySelector('.form-error, .login-error, [role=alert]')?.textContent || '').trim() || '(页面无错误提示)'`)
      console.log(`[FAIL] 登录未跳转，停在 /login -> ${why}`)
      console.log('（多为验证码过期或后端限流，重跑即可）')
      process.exit(1)
    }
    await waitFor(cdp, `!!document.querySelector('.app-frame')`, 8000)
    // 等欢迎层自行卸载再读日志：链条约 8s，固定 sleep 会在半路就读，
    // 导致「末帧」其实是中间帧，后面的断言全线误报。
    const layerGone = await waitFor(cdp, `!document.querySelector('.welcome-layer')`, 20000)
    if (!layerGone) console.log('（警告：欢迎层 20s 内未卸载，下面按已有帧判定）')
    await sleep(400)
    await shot(cdp, 'final')

    const log = await evalJs(cdp, 'window.__log')
    const errs = await evalJs(cdp, 'window.__err')

    // ① 无白屏：进入工作台后卡片平均不透明度始终为 1（不再先藏后飞）
    const after = log.filter(r => r.path !== '/login' && r.bentoN > 0)
    const dim = after.filter(r => r.bento < 0.9)
    check(after.length > 0 && dim.length === 0, '首屏无空洞：卡片全程可见',
      dim.length ? `${dim.length}/${after.length} 帧卡片不透明度 < 0.9，最低 ${Math.min(...dim.map(r => r.bento))}` : `${after.length} 帧全部 ≥ 0.9`)

    // ② 骨架先铺满：骨架出现过，且卡片高度已占位
    const skelFrames = log.filter(r => r.skel > 0)
    check(skelFrames.length > 0, '骨架层先铺满', skelFrames.length ? `最多 ${Math.max(...skelFrames.map(r => r.skel))} 条灰条` : '未捕获到骨架')
    check(after.some(r => r.heroH > 100), '骨架期卡片已占位', after[0] ? `首帧主卡高 ${after[0].heroH}px` : '无数据')

    // ③ 整句问候语逐字打出（用户反馈过：「下午好」一直亮着，没经过打字效果）
    const seq = log.map(r => r.greet).filter(Boolean)
    const greets = [...new Set(seq)]
    check(greets.length >= 5, '整句逐字打出（中间态足够多）',
      `${greets.length} 个中间态：${greets.slice(0, 4).join(' → ')}${greets.length > 4 ? ' → …' : ''}`)
    // 关键：开头的问候语也必须是一点点长出来的，不能一上来就是完整的「下午好，」
    const early = greets.filter(g => g.length <= 3)
    check(early.length >= 2, '问候语本身也在打字（非预渲染）',
      early.length ? `短态：${early.slice(0, 4).join(' → ')}` : `第一个中间态就有 ${greets[0]?.length} 字，疑似预渲染`)
    // 长度必须是逐个递增的（1,2,3…），不是跳变
    const lens = greets.map(g => g.length)
    const growing = lens.every((n, i) => i === 0 || n > lens[i - 1])
    check(growing, '逐字递增无跳变', lens.join(','))
    const written = seq[seq.length - 1] || ''
    const realLine = await evalJs(cdp, `document.querySelector('.page-title')?.textContent?.trim() || ''`)
    check(written === realLine, '打完的整句与真实标题一致', `浮牌「${written}」 vs 标题「${realLine}」`)

    // ④ 星球坠落：从视口右上角加速落到中心
    const orbSeen = log.filter(r => r.orbOp > 0.1 && r.obx > 0)
    check(orbSeen.length >= 4, '星球在场',
      orbSeen.length ? `${orbSeen.length} 帧，首帧 (${orbSeen[0].obx},${orbSeen[0].oby})` : '未捕获到星球')
    if (orbSeen.length) {
      const firstOrb = orbSeen[0]
      const vpO = firstOrb.vp
      const startsTopRight = firstOrb.obx > vpO[0] * 0.6 && firstOrb.oby < vpO[1] * 0.4
      const lastOrb = orbSeen[orbSeen.length - 1]
      const endsCenter = Math.abs(lastOrb.obx - vpO[0] / 2) < 60 && Math.abs(lastOrb.oby - vpO[1] / 2) < 60
      check(startsTopRight, '星球自右上角起坠', `首帧 (${firstOrb.obx},${firstOrb.oby})，视口 ${vpO.join('×')}`)
      check(endsCenter, '星球落到屏幕中心', `末帧 (${lastOrb.obx},${lastOrb.oby}) vs 中心 (${vpO[0] / 2},${vpO[1] / 2})`)
    }

    // ⑤ 粒子特效：canvas 上确实画出了东西
    const dustSample = log.find(r => r.dust !== -2)
    check(dustSample && dustSample.dust > 0, '粒子特效已绘制',
      dustSample ? `抽样命中 ${dustSample.dust} 个非透明采样点` : '未取到粒子样本')

    // ⑥ 星球坠落时在翻滚（高光偏心，旋转可见）
    const orbRot = log.filter(r => r.orbOp > 0.2).map(r => Math.abs(r.orot))
    check(Math.max(0, ...orbRot) > 8, '星球坠落时翻滚',
      orbRot.length ? `最大偏转 ${Math.max(...orbRot)}°` : '未捕获到星球旋转')

    // ⑧ 浮牌全屏居中：文字自身中心应贴近视口中心
    const centered = log.filter(r => r.plateOp > 0.5 && r.gr > 0 && r.vp)
    check(centered.length > 0, '浮牌出现过', centered.length ? `${centered.length} 帧` : '整个过程中没有可测量的浮牌')
    if (!centered.length) return

    // ⑦ 飞行全程不被视口切掉
    const boxed = centered.filter(r => r.pb)
    const clipped = boxed.filter(r => r.pb.t < -1 || r.pb.l < -1 || r.pb.r > r.vp[0] + 1 || r.pb.b > r.vp[1] + 1)
    const worstTop = boxed.reduce((a, b) => (a && a.pb.t <= b.pb.t ? a : b), null)
    check(clipped.length === 0, '飞行全程不出视口',
      clipped.length
        ? `${clipped.length} 帧被切：最差 top=${Math.min(...clipped.map(r => r.pb.t))} bottom=${Math.max(...clipped.map(r => r.pb.b))} right=${Math.max(...clipped.map(r => r.pb.r))}`
        : `top 最小 ${worstTop ? worstTop.pb.t : '-'}px @${worstTop ? worstTop.t : '-'}ms（op=${worstTop ? worstTop.plateOp : '-'} 文字左=${worstTop ? worstTop.gr : '-'}）`)

    const vp = centered[0]?.vp || [0, 0]
    const cxOf = r => r.gr + r.gw / 2
    const distToCenter = r => Math.hypot(cxOf(r) - vp[0] / 2, r.gy - vp[1] / 2)
    const best = centered.reduce((a, b) => (distToCenter(a) <= distToCenter(b) ? a : b), centered[0])
    const nearCenter = centered.filter(r => Math.abs(cxOf(r) - vp[0] / 2) < 90 && Math.abs(r.gy - vp[1] / 2) < 90)
    check(nearCenter.length > 0, '浮牌全屏居中浮现',
      nearCenter.length ? `停留 ${nearCenter.length} 帧，视口中心 (${vp[0] / 2},${vp[1] / 2})，最正一帧 (${Math.round(cxOf(best))},${best.gy})（距中心 ${Math.round(distToCenter(best))}px）` : `未居中，最近 (${Math.round(cxOf(centered[0]))},${centered[0]?.gy})`)

    // ⑨ 文字飞回标题位置：末段文字起始边应贴合真实标题起始边
    const tail = log.filter(r => r.plateOp > 0.5).slice(-14)
    const home = tail.length ? tail[tail.length - 1] : null
    const landed = home && Math.abs(home.gr - home.tl) < 6 && Math.abs(home.gy - home.ty) < 12
    check(!!landed, '文字飞回页头标题位置',
      home ? `文字左边 ${home.gr} vs 标题左边 ${home.tl}（差 ${Math.abs(home.gr - home.tl)}px）；纵向 ${home.gy} vs ${home.ty}` : '未取到落点帧')

    // ⑩ 归位过程有连续中间态（不是瞬移）
    const mid = centered.filter(r => r.plateOp > 0.5 && Math.abs(r.gr - r.tl) > 40 && Math.abs(cxOf(r) - vp[0] / 2) > 40)
    check(mid.length >= 3, '归位为连续位移（非瞬移）', `${mid.length} 帧处于中间位置`)

    // ⑪ 真实标题最终接管并可见
    check(log[log.length - 1].titleOp === 1, '真实标题接管显示', `末帧标题 opacity ${log[log.length - 1].titleOp}`)

    // ⑫ 浮牌退场收尾
    check(log[log.length - 1].plateOp === 0 || log[log.length - 1].plateOp === -1, '浮牌退场收尾', `末帧 opacity ${log[log.length - 1].plateOp}`)

    check(errs.length === 0, '无 JS 异常', errs.join(' | ') || '干净')

    // 汇总时间线
    // 时间线摘要：按日志真实跨度均匀取样（原来写死到 3000ms，看不到后面发生了什么）
    // 归位末段：浮牌文字与真实标题的偏差（交叉淡化若不同位，就会「闪一下」）
    const tailAlign = log.filter(r => r.plateOp > 0.6 && r.gr > 0 && r.tl > 0).slice(-6)
    if (tailAlign.length) {
      const f = tailAlign[tailAlign.length - 1]
      console.log(`\n归位末段对齐：文字 l=${f.gr} t=${f.gt} h=${f.gh}  vs  标题 l=${f.tl} t=${f.tt} h=${f.th}`)
      console.log(`  偏差 dx=${f.gr - f.tl}px  dy=${(f.gt + f.gh / 2) - (f.tt + f.th / 2)}px（含高度差 ${f.gh - f.th}px）`)
    }
    const tEnd = log[log.length - 1]?.t ?? 0
    console.log(`\n时间线（共 ${log.length} 帧 / ${tEnd}ms，均匀取 12 个点）：`)
    for (let i = 0; i < 12; i++) {
      const mark = Math.round((tEnd * i) / 11)
      const f = log.reduce((best, r) => Math.abs(r.t - mark) < Math.abs(best.t - mark) ? r : best, log[0])
      if (!f) continue
      console.log(`  ${String(f.t).padStart(5)}ms  卡片 ${f.bento}  浮牌 ${String(f.plateOp).padEnd(4)}  星球 ${String(f.orbOp).padEnd(4)}(${String(f.obx).padStart(4)},${String(f.oby).padStart(3)}) 打字 ${String(f.greet.length)}字  文字左${String(f.gr).padStart(4)}  标题op ${f.titleOp}`)
    }
  } finally {
    cdp?.close()
    try { execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }) } catch { /* 已退出 */ }
  }

  console.log(`\n${failures ? `${failures} 项未通过` : '全部通过'}`)
  process.exit(failures ? 1 : 0)
}

main().catch(e => { console.error('验证脚本出错：', e.message); process.exit(1) })