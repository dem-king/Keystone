# Changelog

## 2026-10-15（登录转场特效：消散 → 曲率穿越 → 星体脱出接管欢迎链）

在闪黑修复（见下节）基础上，把「干巴巴淡出」升级为特效转场。设计文档 `docs/plans/2026-10-15-login-warp-transit-design.md`（附实施计划同名片段文件）。

**改法**
- 新增 `components/welcome/WarpTransit.vue`（挂在 `App.vue`，`v-if=transitActive` 跨路由切换存活，`pointer-events: none`）：对勾收尾后登录页 DOM 消散（粒子按登录页元素矩形采样接续轮廓）→ 天幕（不透明暗色银河底，防闪白/闪黑的根基）拉起 → 曲率光丝加速巡航 → 切路由全程暗场 → 减速 + 脱出星弧线飞抵欢迎链星球起点 → `transitReleased` 放行欢迎链 → 天幕抬起自卸。canvas 走 `lighter` additive。
- `composables/welcome.ts`：新增 `transitActive / transitReleased / transitSwapped / transitAbort` 状态与 `startTransit() / setTransitSwapped()` 驱动函数；`beginHandoff()` 重建启动信号；`finishHandoff()` 统一置 `transitAbort`（特效层随之 0.18s 快速淡出）；`ARRIVE_BUDGET` 3600→4200（欢迎链起跑推迟后的守卫窗口）。
- `composables/motion.ts`：`playLoginExit` 更名 `playLoginDissolve`——只淡出面板，不再动登录页根本色（暗场交给天幕）；`restoreLoginStage` 同步简化。
- `Login.vue`：对勾描完即走（砍掉回弹尾巴省 ~0.5s）→ `startTransit()` → 消散+warm 并行 → 250ms 建立光丝速度 → `markArrived` → `router.replace` → 失败走 abort 还原（含 `succeeded=false` 按钮还原），成功 `setTransitSwapped()`。
- `WelcomeChain.vue`：onMounted 先等 `transitReleased`（兜底 3s 直开）再量标题开播；**浮牌/星球/冲击环/柔光闪在挂载第一帧即 `opacity: 0`**（等 release 的窗口若未隐藏，会以默认位置 (0,0) 露出左上角）。
- `styles/pages.css`：新增 `.transit-layer/.transit-sky/.transit-canvas`（z-80，低于欢迎链 90）；`.welcome-orb/.welcome-shock` 补默认 `opacity: 0`（CSS 兜底 + JS 双保险）。

**验证（真实环境 8090 + 5180，CDP `scripts/verify-warp-transit.mjs` 四场景 30 项断言全绿，`vue-tsc --noEmit` 通过）**
- light/dark：特效层挂载 → 消散中间态 → 切路前 8 帧天幕 opacity>0.9（暗场铺满）→ 欢迎链接管 → 特效层自卸 → 工作台稳定；screencast 全帧亮度无单帧跳变（阈值 120；轨迹 17→29→133→211→232 为低帧率采样下的连续渐亮）。
- reduce：特效层从不挂载，直接进工作台。
- abort（Fetch 拦截 `/auth/routes` 返 500）：导航被守卫驳回（duplicated failure）→ 回登录页、提交按钮还原（DOM 校验 `.login-submit` 在、`.success-orb` 除）、特效层随 abort 卸掉、无 JS 异常。
- 修复过程中发现并解决：WelcomeChain import 漏 `transitReleased`；等 release 窗口暴露 plate（白块）与 orb（绿球）于左上角——提前初始隐藏 + CSS 默认隐藏。

## 2026-10-15（登录转场闪黑修复：退场尾段桥接舞台底 + 落点页 chunk 预取）

用户反馈登录成功跳转首页的动画中间有一拍闪黑、割裂。逐帧复现定位：退场动画播完后，屏幕停在登录页裸底色 `#0f1214` 约 130ms（等落点页懒加载 chunk + 外壳挂载），再硬切到浅色外壳——这一拍全黑就是闪黑。

**根因（两层叠加）**
1. 切换时才解析 `/dashboard` 的懒加载组件，chunk 网络请求全部落在「退场播完 → 外壳首帧」的关键路径上；
2. 退场只淡出了画布/卡片/侧栏三个面板，登录页根本身的深色底没处理——退场终点是「全黑」，与外壳之间没有任何桥接。

**改法**
- `router/index.ts` 新增 `preloadHome()`：resolve 落点路由并调用其懒加载组件函数，把 chunk 提前。`Login.vue` 登录成功后 fire-and-forget（对勾动画的 1.4s 足够加载完），失败不阻塞、切换时照常按需加载。
- `motion.ts playLoginExit`：退场尾段（0.28s 起 0.3s）把登录页根本色 `#0f1214` 同步化到透明，露出 body 的 `--stage` 舞台底——与工作台同源，「深色画布沉走 → 舞台底 → 框体在舞台底上装起」成为连续渐变，不再是黑场硬切。
- `motion.ts restoreLoginStage()` + `Login.vue` 失败分支：导航被取消（会话过期等）仍停在登录页时，还原退到透明态的面板与底色——修复同场景原有的「面板全透明空场」隐患。

**验证（真实环境 8090 + 5180，CDP screencast 全帧亮度分析 `scripts/shot-handoff-flash.mjs`）**
- 修复前：亮/暗主题均在切换前出现 7~8 帧（≈120ms）亮度 17 的全黑帧，随后硬切。
- 修复后：全帧亮度呈 20→27→33→…→222 连续渐变（约 14 帧），无单帧骤降；chunk 请求实测发生在点击后 +167ms（预取生效，不在切换关键路径）。
- 回归 `scripts/verify-welcome.mjs` 四场景（浅/深/减少动态/连点守卫）全部通过；`vue-tsc --noEmit` 通过。

## 2026-10-14（登录页全屏深色沉浸 · 分支 feature/login-dark-immersion）

用户反馈登录页右侧大面积浅灰留白、底部能力条偏小、表单缺细节。确认方案后实施：全屏深色沉浸 + 表单交互细节 + 动效增强 + 三档响应式。

**改法**
- 布局：`Login.vue` + `styles/pages.css` 从「左深右浅双栏」改为单一全屏深色画布（`#0f1214`，明/暗主题下恒定，不进主题切换）；NeuralNet 粒子网络铺满视口并以 scrim 渐变压暗保可读性；左侧文案/表盘限宽在左栏不侵入卡片列。
- 登录卡：深色玻璃质感（白 6% 透明底 + blur 24px + 1px 白边 + 顶部内高光），宽 400px 垂直居中；指针光出深色变体（mix-blend screen）；`m-float` 浅底配方不再用于登录卡。
- 底部能力条：服务健康 + 四项能力合并为通栏玻璃条，title 13.5px / desc 12px，四列一排。
- 表单：TextInput 新增 `#trailing` 插槽，密码框内嵌眼睛图标切换可见性（新增 `eyeOff` 图标）；验证码输入框与验证码图合成一体控件（共享外框、左右圆角）；接口级错误改玻璃警示条（左竖红线），失败时登录卡轻微水平抖动；「记住登录状态」文字改浅色可读。
- 动效：时钟当前秒刻度叠加呼吸光晕（`dial-breathe` 1.6s，`prefers-reduced-motion` 跳过）；`playLoginExit` 无幕交接与开场编排选择器不变，登录成功链路实测未破坏。
- 响应式：≥1280px 完整双区（表盘可见）；<1280px 隐藏表盘；<960px 隐藏左画布、纯深色底 + 居中玻璃卡。

**验证（真实环境 8090 + 5180，CDP 脚本 `scripts/verify-login-dark.mjs`）**
- `vue-tsc --noEmit && vite build` 通过。
- 三档截图：2560 / 1440 / 390 均符合预期（`verify-login-dark-*.png`）；断言 JSON 全绿（`verify-login-dark-checks.json`）。
- 交互：密码可见性切换 password→text→password；错误验证码弹出「验证码错误或已过期」警示条；正确验证码登录成功进 `/dashboard`。
- 设计文档：`docs/plans/2026-10-14-login-dark-immersion-design.md`。

## 2026-10-14（登录日志 IP：本机回退真实网卡 + 代理透传访问者地址）

用户反馈登录日志 IP 全是 `127.0.0.1`，要求记录各电脑自己的真实 IP（本机也一样）。

**根因（两层叠加）**
1. 本机访问（含经 vite 代理）的请求源地址就是回环，`ClientInfoResolver.resolveIp` 原样记 `127.0.0.1`；
2. 后端只监听回环、局域网同事经 vite 代理访问时，若无转发头，后端同样只能看到回环地址。

**改法**
- `ClientInfoResolver`（keystone-framework）：解析链（XFF 首段、跳过 unknown → X-Real-IP → remoteAddr）结果为回环地址时，**回退到本机网卡真实 IPv4**。新增 `localAddress()` 探测：优先「非虚拟适配器的私网 IPv4」（黑名单覆盖 VMware / VirtualBox / Hyper-V / WSL / Docker / OpenVPN TAP-Windows / WinTun / 隧道类），逐级放宽、30s 缓存；探测不到时保留原回环值保底。测试注入点 `setLocalAddressSupplierForTest`。
- `vite.config.ts`：`/api` 代理加 `xfwd: true` —— vite 转发时附加 `X-Forwarded-For/Host/Proto/Port`，后端凭 XFF 记录访问者真实 IP。

**验证（真实环境端到端）**
- 单测 13 项全绿（新增：回环回退 / 探测不到保留回环 / 非回环不回退 / XFF 跳过 unknown / 本机探测可用）。
- 生产代码实测：本机探测返回 `192.168.1.39`（真实网卡），未误选 OpenVPN TAP（10.0.4.250）或 Clash TUN（198.18.0.1）。
- 重启后端（8090）后登录并查库：`sys_login_log` 新记录 `ip=192.168.1.39`、`location=内网`（curl 直连与浏览器经 vite 两条链路均验证）。
- xfwd A/B 实证：临时 vite（新配置）指向 echo 服务器，直连 vs 经代理对比 —— 经代理的请求出现 `x-forwarded-for: 127.0.0.1`（+ host/port/proto）四件套。
- 新增截图脚本 `scripts/shot-login-log-ip.mjs` → `verify-login-log-ip.png`：明细表「来源」列全部显示 `192.168.1.39 / 内网`。

**备注**
- 历史记录（127.0.0.1）保持原样未刷新。
- 5180 上的 vite 为改动前的进程，`xfwd` 于其下次重启生效。

## 2026-10-14（Windows 一键启动脚本）

新增本地开发一键启动脚本，避免每次手工配置环境变量；本机 `8080` 被 VPN 客户端占用，
脚本内后端端口固定为 `8090`，前端代理目标同步指向该端口。

- 新增 `keystone-system/start-backend.bat`：内置 `SERVER_PORT=8090`、`SERVER_ADDRESS`、`JWT_SECRET`、
  全部 `DB_*` 与 `REDIS_*`，用 `start` 在独立窗口启动 jar；jar 缺失时给出明确的构建命令提示。
- 新增 `keystone-vue/start-frontend.bat`：内置 `VITE_API_PROXY_TARGET=http://127.0.0.1:8090`
  与 `VITE_PORT=5180`，`node_modules` 缺失时提示 `npm ci` 及两个平台可选依赖补装命令。
- 两个脚本统一为纯 ASCII 内容（Windows `cmd` 按 GBK 读取，含 UTF-8 中文注释会导致语法错乱、执行失败）。
- 脚本内显式清空 `SERVER__PORT`，避免被环境注入抢占端口。
- README「本地启动」章节补充「Windows 一键启动」小节，并说明端口被占用时需同步修改的两处。

## 2026-10-14（欢迎链丰富化：星野 / 拖尾 / 光束 / 轨道 / 落定确认）

用户反馈：登录成功后的动画「差点意思」，且**只有星球坠落一个效果，在大屏幕上看着单薄**。

**改法：欢迎链从「一颗球的独舞」扩成「一片天空的完整叙事」**，全部沿用青柠/玻璃语言，新增元素都走 canvas（`WelcomeChain.vue` 的 dust 层升级为「天空渲染器」）：

- **星野背景（全程）**：60–110 颗微星（密度随视口面积）散布视口、正弦呼吸各自闪烁，约 1/5 为青柠色；炸开瞬间 `starBoost` 顶到 1、整片星野被「照亮」再缓缓暗下（衰减 1.0/s 约 1 秒见底）。浅色主题基础透明度从 0.2 提到 0.38、星点 0.8–2.4px——之前太淡在大屏幕上看不见。
- **彗星缎带尾（坠落段）**：坠落每帧记轨迹点，相邻点连成**线宽递减的连续缎带**（圆角线帽，随年龄变细变暗）。初版试过描一条轨迹弧航线——用户反馈「球旁边杵一条线」，已撤（用户历史上否过线条类元素）。
- **炸开强化**：爆前 90ms 蓄力压扁（anticipation squash，`scaleX 1.74 / scaleY 1.3`）→ 膨胀消失；新增 **14 道放射光束**（canvas 光线快速伸长、平方衰减）、**柔光闪**（`.welcome-flash` 径向光晕铺光量）、**第二道细冲击环**（慢半拍、更淡）；玻璃牌浮现时**扫过一道光泽**（`.welcome-glass::after` sheen）。
- **打字段**：新增**打字光标**（恒占位只控透明度，避免宽度跳变；steps 闪烁）；**环绕轨道**——一条细椭圆轨道绕浮牌、两颗卫星对角巡航（canvas，alpha 双向缓坡，归位时软收场）；打字期重新居中由 `gsap.set` 改为 0.18s 短补间，消除逐字跳半格的阶梯感。
- **节奏去死拍**：刻度线收窄到一半（260ms）浮牌即起飞，刻度的尾声叠进归位的开头（原 520ms 串行等待）。
- **落定确认（归位末）**：浮牌落定后一次小幅回弹（`scale 1→1.03→1`，back.out(2.6)）+ 落点随牌宽散开一撮慢粒子——从「漂到」变成「落到」。

**验证**
- `vue-tsc --noEmit` 通过。
- `scripts/verify-welcome-chain.mjs` 21 项断言全绿：整句逐字打字、星球右上→中心且翻滚、粒子已绘制、浮牌居中（最正一帧距中心 7px）、文字归位偏差 dx=0/dy=0、真实标题接管、无 JS 异常。
- 分镜截图人工核对：`chain-2-orb-growing.png`（拖尾+航线）、`blast-1-blast.png`（蓄力+光束+星野）、`chain-5-typing.png`（光标+轨道）、`chain-7-falling-home.png`（归位中途星野）。新增一次性抓帧脚本 `scripts/shot-welcome-blast.mjs`（按 flash/shock 真实状态取炸开帧）。

## 2026-10-14（修复：在线用户重复计数 + 登录趋势混入退出记录）

用户反馈工作台「在线用户 · 近 1 小时」显示 62 人，但实际只有自己一个账号在反复登录。

**根因**：`DashboardMapper.countOnlineUsers()` 统计的是 `sys_login_log` 里最近 1 小时的 **status = 1 的记录条数**，有两个失真：
1. 同一账号每次登录写一条、多次登录重复计数（用户实测自己反复登录被算成 62 人）；
2. 「退出登录」也写 `status = 1`（msg='退出登录'），同样被计入。

**改法：在线用户改为基于「有效会话」按账号去重**
- `TokenStore`（keystone-framework）新增 `countOnlineUsers()`：SCAN `auth:token:*`（token 的 TTL 即会话有效期），批量 MGET 取值后**按 username 去重**计数。同一账号多处/多次登录持有多个 token 只算 1 人；退出登录（revoke）或 token 过期后自动减少。
- `DashboardService.stats()` 的 online 值改走 `tokenStore.countOnlineUsers()`，删除 `DashboardMapper` 中两个已失效的 SQL（`countOnlineUsers` / `countOnlineUsers2h`）。
- 卡片副标题 `subText("online")`：「最近 1 小时登录」→「**当前有效会话**」；前端标签「在线用户 · 近 1 小时」→「在线用户 · 实时」，fallback 文案同步。

**顺带修复（同源问题）**：登录脉搏 / 登录趋势系列 SQL（`selectLoginTrend`、`selectLoginTrendByDay`、`countLoginsPrev24h`、`countLoginsPrevDays`）原先未区分事件类型，「退出登录」记录被当成一次「登录」计入。统一加 `COALESCE(msg, '') <> '退出登录'`，只统计登录事件（含失败尝试）。

**验证（真实环境端到端）**
- 连续登录 admin 3 次（Redis token 92→95），`/api/dashboard/summary` 的 online 恒为 **1**；登出 1 个 token 后仍为 1；测试 token 全部登出后 Redis 复原。
- 24h/7d/30d 三档 summary 均 200。
- 新口径核对：近 24h 剔除退出记录 = 179 次（旧口径 203 次，虚高 24 条退出记录），与接口 trend 合计一致。
- 前端截图 `keystone-vue/scripts/verify-online-card{,-zoom}.png`（脚本 `shot-online-card.mjs` 保留复用）：卡片显示「在线用户 · 实时 / 1 人 / 当前有效会话」。

## 2026-10-14（欢迎链 + 首屏骨架：把白屏彻底消掉）

用户反馈两件事：登录成功后要有欢迎动画（**要含用户名，显示完有一条路线回到页面右上角**），以及**首页组件加载有明显延迟，能感觉到先白屏一下再出现组件**。

**白屏的根因是四处「先藏后显」叠在一起**（不是接口慢）
1. `playShellEntrance(strong)` 把整个 `.app-frame` 设为 `opacity: 0`，靠 `is-handoff-enter:not(.is-entrance-ready)` 兜底，还要等 `afterTwoFrames`；
2. `Dashboard.playEntrance` 先 `gsap.set(cards, { opacity: 0 })` 把 8 张卡全藏起来，最早一张也要 `delay: 0.05`；
3. `pageEnter` 又把 `.reveal`（页头）设为 `opacity: 0`；
4. 真实数据 `load()` 在 `onMounted` 才发请求。

三段叠加 ≈ **0.88s 内容区什么都没有**，加上数据在 1s 后才到，就是「白一下再出现」。

**改法：不再靠隐藏表达组装，靠占位**
- **骨架常驻**：新增 `ui/Skeleton.vue`（灰条占位，高度对齐真实读数字号与图表高度）。工作台每张卡的数据区在 `primed`（摘要到手）前渲染灰条，高度与真实内容一致 → **第 0 帧画面就是满的**，数据到达后灰条让位、真实内容淡入，位置不动。
- **外壳不再整框淡入**：`playShellEntrance` 去掉 `set(frame, {opacity:0, y:14})` 与对应的 `to`；舞台底 `--stage` 本来就在，整框再淡一次就是白屏。`layout.css` 的 `.is-handoff-enter` 兜底规则一并删除。
- **卡片组装改为纯位移**：`playEntrance` 不再碰 opacity，改为同步写起始态后 `gsap.to({x, y, scale})`，位移量取中心的 0.42 倍（原来整段跨距），duration 0.72→0.5、stagger 0.05→0.035。首帧不再有「卡片凭空出现」的突变。
- **CSS 兜底分路**：`.page:not(.is-entrance-ready):not(.is-handoff) .bento { opacity: 0 }` —— 交接期加 `.is-handoff`，跳过藏卡片；普通切页行为不变。`pageEnter` 新增 `handoff` 选项，交接期不隐藏页头（欢迎链的铭牌要压在页头位置上，页头隐身会量到 0 宽）。

**欢迎链（`components/welcome/WelcomeChain.vue`）——第五版：坠落中由小变大 + 到中央炸开 + 归位吸附**

三处改动：

**① 坠落途中由小变大**：星球起点缩到 0.08，与下坠共用同一段补间并行涨到 1.5（实测 ×0.07 → ×0.36 → ×2.33）。像一颗正冲过来的天体，越近视角越大——比「大小不变地掉下来」符合直觉。

**② 到中央炸开**：不再有落地回弹。星球抵达中心后急剧膨胀到 3.2 并消失，同时一圈`.welcome-shock`冲击波环从 0.35 扩散到 3.6、粒子放射 56 枚（带重力）+ 向上尘柱 26 枚，浮牌在同一个点上以 `back.out(1.6)` 长出来。

**③ 归位末段「吸附」落定**（用户反馈「快到位那一下闪动不够丝滑」）——
根因找到并修掉了：**早先量标题的时机太早**。`pageEnter` 会把页面从 `scale 0.994` 拉到 1（在 x≈278 处正好差 4px），工作台自己还会把页头从 `y:8` 拉回 0（正好差 8px）。在入场跑完前量到的标题位置是错的，归位落点就跟着错 4px/8px，交叉淡化时看起来就是「文字跳了一下」。现在**先让星球坠落（1.06s > 入场总时长），这段时间过去后再量标题**，量到的是定稿位置——实测偏差 dx=0、dy=0。

缓动也换掉了：`power2.inOut` 在末尾留了一段刹车感，改成 **`expo.out`**——起步极快、末段极慢地被目标吸住，这才是「归位」的手感。交接时**先把玻璃底化掉、只剩文字**，再用同一时长、同一线性缓动做等量交叉（总亮度恒为 1），屏幕上没有任何一帧看得出换了主体。

**顺带修掉一个真 bug**：重构后浮牌的 `opacity: 0` 被挪到了坠落之后，于是坠落那 1 秒里浮牌以 opacity 1 停在页面左上角（会在界面上看到一个小胶囊）。断言「飞行全程不出视口」报出 `top 最小 0px` 才发现。现在在挂载的第一帧就把浮牌藏起来。

**测试脚本**：分镜的帧判定改为按**星球的缩放值**取（原来按坐标取，「大到接近中心」那个窗口几乎不存在，一直抓不到）。新增对齐偏差的输出，归位末段直接打印 dx/dy。

**数据预热**：新增 `prefetchDashboard` / `takeWarmedDashboard` / `clearWarmedDashboard`（`welcome.ts`）。登录退场那 0.5 秒本来就在等网络，顺手把 `dashboard/summary` 打了；工作台 `onMounted` 先取预热结果同步渲染，**首帧即真内容，连淡入都省了**。预热失败不阻塞，照常走骨架路径；切区间/登出时作废。

**坑**
- **GSAP 把 `stroke-dasharray`/`stroke-dashoffset` 写成内联样式**，内联优先级高于 SVG 表现属性，`setAttribute` 会被静默忽略——拖尾一开始完全没生效。飞行段必须写 `path.style.*`。
- 铭牌模板里不能预渲染完整名字：`typeOut` 首帧会 `write('')` 清空，预渲染会先闪一下全名再重打。模板只出 `{{ greeting }}，`。
- **卸载时机不能猜**：最初用 `setTimeout(3200)` 卸载欢迎层，结果把飞行中的亮点掐掉了。改为链条自己 `emit('done')`，`AppShell` 收到才卸载，另有 6s 安全阀兜异常中断。
- `.page-title` 在外壳挂载时还不存在（路由内容后挂），`document.querySelector` 量不到 → 改为轮询等待（`.page-title` 2s / `.user-chip` 0.8s），量不到就放弃播，宁可少播一次也不要把铭牌定位错。

**预算**：`ARRIVE_BUDGET` 1.8s → 3.2s（要覆盖欢迎链全程）。实测（自提交）：切换 ≈ 2.05s、完全落定 ≈ 2.1s（原 3.1s）。

**验证**：`scripts/verify-welcome-chain.mjs`（21 项：无空洞 / 骨架占位 / 逐字打字 / 右上角入场 / 入场带旋转 / 飞行不出视口 / 全屏居中 / 飞回标题位置 / 连续位移 / 标题接管 / 退场收尾 / 无 JS 异常）与 `scripts/shot-welcome-chain.mjs`（按**动画真实状态**取帧，不按固定毫秒猜帧；`--slow-api` 拦截概览接口验证预热未命中的骨架路径）全部通过。

**断言也得测对东西**：`.page-title` 是 `<h1>` 块元素，盒宽大于文字实际宽度，用「盒子中心」比较落点会误判成偏了 39px。归位判定必须比**文字起始边**（左边缘），不是盒中心。原 `verify-welcome.mjs` 的 4 项断言已按新意图重写（原来断言的是「首帧隐藏态」，正是白屏来源），light/dark/reduce/guard 四组回归全通过。`vue-tsc` 与 `vite build` 通过。

## 2026-10-14（登录转场再重做：无幕交接）

「玻璃变形」版被否——「这个登录成功之后还是会显示一个幕布啊」。两版被否的是同一点：**任何全屏覆盖物都会被看成「幕」**。这一版彻底去掉覆盖层，转场发生在页面元素自身：登录页在舞台上退场（深色画布先沉、登录卡殿后），切到工作台后框体自舞台浮现、导航滑入、卡片从中心飞出落位。**全程没有任何全屏层，屏幕中心每一帧都被页面本体覆盖**（已做成硬断言）。

**为什么这次能「无幕」：登录页与工作台共用同一舞台底**
- 两者的容器背景都是 `--stage`——登录页是「舞台上左深右浅的两块面板」，工作台是「舞台上换一个框体」。退场只退台上的面板（`.login-canvas` / `.login-card` / 右侧背景光），**舞台底不动**，所以「面板离台 → 框体上台」视觉上连续，不需要任何东西去盖住切换点。

**时序（先退场 → 预热完成 → 切路 → 组装）**
- 对勾画完：并行预热 `ensureRoutes()`（菜单与权限，路由守卫据此直接放行，不留空窗）→ `beginHandoff()` 开拦截。
- `playLoginExit`：画布下沉淡出（0.3s）→ 登录卡上浮淡出（0.06s 起 0.32s）→ 右侧背景光随尾收净；`Promise.all([退场, 预热])` 齐了才继续。
- push 前一行 `markArrived()`（AppShell 挂载时读到 arriving）：整框自舞台浮现（`playShellEntrance(frame, true)`，框体 0.42s、导航自左滑入、顶栏自上落下）+ 工作台 `playEntrance` 卡片从中心飞出（仅 arriving 时播）。
- arriving 按 `ARRIVE_BUDGET`（1.8s = 组装动画总长）收尾并解除点击拦截。实测（自提交）：切换 ≈ 2.0s、完全落定 ≈ 3.1s。

**结构与取舍**
- `welcome.ts` 从「等就绪再揭幕」的展示层状态机瘦身为薄交接状态机（idle → leaving → arriving），只留状态、点击拦截与预算收尾；`WelcomeMorph.vue` 删除，`--layer-welcome` 令牌删除；点击拦截改为模块内自装自卸（没有组件承载）。
- 交接期 `pageEnter` 跳过 `.bento`（由工作台自己的飞出编排接管，避免双重动画）；Dashboard 原「会话首次飞出」改为「仅交接时飞出」，平时进入由 pageEnter 级联——两条路径互斥。
- 减少动态效果或页面在后台：不起交接，登录页直接切换。

**踩坑（重要）**
- **vite dev 的 CSS 模块缓存**：用工具直接改 CSS 后，vite 的 watcher 可能没失效模块缓存——新页面拿到旧样式（`__vite__css=""`），表现为「新规则不生效」。本次是框体兜底规则没进浏览器，首帧整框闪现 2 帧（验证抓出）。**修复＝改完 CSS `touch` 该文件**再验证；判断页面里实际样式要在页面内查 `document.styleSheets`，别用 `?direct` 请求（它一直是新内容）。
- **无幕转场没有遮罩兜住首帧**，任何「从隐藏态入场」的元素都要两道保险：① `onMounted` 同步段 `gsap.set(目标, { opacity: 0 })`（paused timeline 的 set 与 `gsap.from` 起始态要到下一帧才建立）；② CSS 兜底类（`.app-frame.is-handoff-enter:not(.is-entrance-ready) { opacity: 0 }`）防「JS 就位前」的闪现。

**验证**
- `scripts/verify-welcome.mjs` 重写（四场景 light / dark / reduce / guard，共 56 项断言），两轮全绿。核心断言：转场全程无遮罩组件、**屏幕中心每帧都被页面本体命中**（elementFromPoint 探针，抓任何覆盖层）、退场有中间态且路由在退净后才切、切路后框体与卡片都以隐藏态起步（不闪终态）、卡片飞出有 8 档透明度与 35 档位置中间态、转场中连点放行 0 次。
- 产物 `scripts/verify-handoff-*.png/json`（旧版 `verify-morph-*` 产物随重做清理）。

## 2026-10-14（开屏转场重做：玻璃变形·已被取代）

> 本版又被否——「这个登录成功之后还是会显示一个幕布啊」：玻璃面放大铺满本身仍是一层「幕」。已被同日「无幕交接」取代（见上一条），保留作决策记录。

首版「上卷揭幕」被否——「不要这种开幕的，重新设计一个比较现代的、活泼的效果」。重做为**玻璃变形**：登录卡被点亮后，同一块玻璃面自卡片位置长出来、放大铺满全屏，品牌与问候在其中落定，就绪后化开让位给工作台。经确认：方向＝玻璃变形 / 节奏＝舒展约 1.8s / 读数＝轻快弹跳计数。

**从「幕」到「转场」**
- 旧版是一块独立的全屏幕（从登录页盖起、就绪后上卷）；新版没有幕——玻璃面**从登录卡自身长出**：起始盒取 `.login-card` 的 `getBoundingClientRect()`（left/top/width/height 与圆角正是卡片盒），首帧与卡片严格重合、看不出接缝，随后放大到全屏、圆角收平。视觉上不是「换了一块屏」，而是「这张卡撑成了工作台」。
- `WelcomeSplash.vue` 删除，新增 `WelcomeMorph.vue`；配方换成 `playMorphOpen` / `playMorphDissolve` + `countUp` / `revealCounts`（均在 `motion.ts`）。`--layer-welcome: 300` 沿用；点击穿透守卫（捕获阶段拦 `pointerdown` / `click`）随新组件保留。

**铺满放行（covered 信号）**
- 路由必须等玻璃面**铺满**才能切——切早了底下会露出还没被盖住的旧页面。新增 `whenWelcomeCovered()`：`Login.vue` 在 `beginWelcome()` 后 await 放行；`playMorphOpen` 在时间轴 0.62s 处回调 `markWelcomeCovered()`（expo.out 在 0.62 处已覆盖 99.7%）。兜底 `COVER_TIMEOUT = 1800ms`，`finishWelcome` / `abortWelcome` 也放行，异常路径不会把用户扣在等路由上。

**弹跳计数取代刻度轨**
- `countUp` 用 `back.out(2)` 越过目标再回落（实测 12→11、38→34），落定真值「11 个页面 · 34 项权限」；`.wm-count b` 用等宽字体、`min-width: 2ch` + 右对齐防抖位。
- **让位等计数跳完**：`startCounters()` 返回 Promise，`Promise.all([contentReady, countersDone])` 之后才化开——否则招牌动作刚起跳就被化开盖掉（实测数字可见 ≈ 795ms 才算用足）。

**光斑归属**
- 两枚环境光斑（青柠 / 蓝）在 `prefers-reduced-motion: no-preference` 下由 CSS `@keyframes` 缓慢漂移（9s / 11s）；**transform 归 CSS、GSAP 只碰 opacity**，避免双方同改 transform 打架。

**踩坑（均已修正）**
- GSAP 里 `radius` 不是合法 CSS 属性名（静默忽略），必须写 `borderRadius`；写错表现为起手圆角 0px 而非 24px。
- `watch(welcomeActive, ...)` 默认 flush `pre`：回调执行时面板 DOM 尚未渲染，`panel.value` 为 null 直接 return（玻璃面完全不出现）。须 `await nextTick()` 再起播。
- 断言起始几何时卡片盒必须**同帧**量取——「提交时刻」与「起播时刻」差 16px（登录成功那拍卡片自己动了，y 164→148）。
- 淡入断言取**过程峰值**，末帧在化开时已归零。

**验证**
- `vue-tsc --noEmit` + `vite build` 通过；`npm run test:unit` 32/32。
- `scripts/verify-welcome.mjs` 重写（直连 CDP，四场景 light/dark/reduce/skip，13 项断言），两轮全绿。实测：首帧 420×513@(903,148) 与同帧卡片吻合、起手圆角 24px→0、33 档宽度中间态、切路瞬间覆盖 1424×809（100%）、计数 0/0→…→12/38→11/34；节奏：铺满 711ms → 读数出现 1089ms → 计数落定 1596ms → 化开 1884ms → 移除 2240ms（符合「舒展 1.8s」）。
- 产物 `scripts/verify-morph-*.png/json`（旧版 `verify-welcome-*` 产物随重做清理）。

## 2026-10-14（登录成功后的开屏欢迎动画·上卷版）

> 本版已被同日重做的**玻璃变形**取代（见上一条），保留作决策记录：文中 `WelcomeSplash`、`playWelcomeRise` / `playWelcomeExit`、刻度轨与快进等实现均已不存在；`verify-welcome.mjs` 亦已重写为验证新版。

登录成功到工作台之间有一段绕不开的空窗：路由要拉菜单与权限、落点页面要拉数据，这段时间里界面正从登录页切到外壳，用户看到的是一个「半成品闪一下再补齐」。本次在中间插一层全屏的幕——它在登录页上盖起，把空窗吸收进「正在准备」的读数里，外壳与工作台都就绪之后再上卷揭幕。

**方案（确认后实施）**：揭幕＝上卷 + 光泽扫过；节奏＝标准约 2.2s；幕面＝仪器式（刻度轨、等宽读数、真实数据）。

**跨路由的全局层**
- 幕挂在 `App.vue`（常驻、仅激活期渲染），不属登录页也不属外壳：从登录页升起、到外壳揭幕，全程同一层 DOM，中间的路由切换不再拆掉它。层级新增 `--layer-welcome: 300`（高于弹窗遮罩 `--layer-overlay: 200`，低于提示 `--layer-toast: 400`），深浅两态各有幕面渐变与点阵肌理。

**由就绪信号驱动，不是定时器**
- `composables/welcome.ts` 是纯状态机（idle → rising → holding → exiting），等待全部在组件侧轮询，没有悬空定时器。两个真实信号：`shellReady`（AppShell 挂载，此时路由守卫已先行完成菜单与权限加载）、`expectContent` / `contentReady`（落点页面主体数据，当前由工作台报告）。
- 待命段是弹性的：内容最多多等 0.9s，外壳兜底 4s，超时照揭——异常路径不会把用户扣在幕上。
- 幕面读数全部来自真实状态：刻度轨 18%（幕起）→ 60%（落字完成）→ 85%（外壳就绪）→ 100%（揭幕前），阶段文案「正在准备菜单与权限… → 正在加载工作台数据… → 已加载 11 个页面 · 34 项权限」取自实际菜单与权限数，不是装饰。

**入场对齐：与揭幕重叠，而不是排在后面**
- 新增 `onWelcomeExit(cb)`：外壳入场（`playShellEntrance`）与工作台卡片落位（`playEntrance`）都挂到揭幕那一刻播放，与上卷重叠，总时长不叠加——幕拉开时卡片正好落定。`abortWelcome()` 在导航失败或外壳卸载时立刻放行全部回调，避免外壳被留在「等揭幕」的隐藏态。

**快进与降级**
- 点幕或按任意键快进：落字加速 5 倍并跳过剩余等待窗口，但就绪仍是揭幕前提（不会让用户快进到一个空外壳）；开屏期间 `AppShell` 的全局快捷键让位，避免空格之类误触。
- 减少动态效果或页面在后台（`skipMotion()`，后者 rAF 被节流、补间会停在半路）时不开幕，直接进终态。

**点击穿透（实测发现的缺陷，已修）**
- 揭幕时幕被 `clip-path` 从下往上裁短，**被裁掉的区域不再拦截点击**：用户在揭幕中连点，点击会穿透到刚露出的工作台并误触导航——自动化实测点击落点被带到「角色管理」页。修复：`WelcomeSplash` 在 exiting 期间于 document 捕获阶段 `preventDefault` + `stopPropagation`（`pointerdown` 与 `click` 各一枚守卫）。
- 顺带修掉一处进度回退：外壳先就绪时 `progress` 已被推到 85，幕起的基础位需用 `Math.max` 写入，否则刻度轨会倒退到 18。

**验证**
- `vue-tsc --noEmit` 与 `vite build` 通过（231 modules）。
- 新增 `keystone-vue/scripts/verify-welcome.mjs`（直连 Chromium CDP，四场景：浅色 / 深色 / 减少动态 / 快进回归），两轮连续全绿。实测：幕在屏 ≈ 2.05–2.10s（快进 ≈ 1.2s，均落在确认的「标准 2.2s」内）；问候语逐字落定 0→1→…→6；揭幕有真实中间态（`inset(0% 0% 0.06%)` → `…99.99%`）；卡片落位与揭幕重叠 59 帧；快进场景在「已被卷走」的落点上连点，穿透 0 次且落点仍在工作台。
- 快进回归是非平凡断言：先等幕裁掉 55% 以上、确认落点元素栈里已没有幕（实测 `["empty","bento",…]`），再点击——否则「没穿透」可能只是因为幕还盖在那里。

## 2026-10-14（侧栏展开折叠动效）

侧边栏的分组与分支一直是 `v-show` 瞬切：点开「啪」地出现、收起同样生硬；侧栏收成图标条时，列宽、文字与分组标题也是整块瞬变。本次为这两处补上统一的展开/折叠动效，全部经 `composables/motion.ts` 输出（符合动效规范，侧栏此前未接入）。

**展开与折叠（一级分组、任意层级分支共用同一套）**

- `motion.ts` 新增 `navBodyEnter` / `navBodyLeave` 与 `DUR.expand`（0.44s）/ `DUR.collapse`（0.26s）令牌。展开：容器高度从标题处铺开（expo.out），条目按阅读序逐条落位（0.34s，级联 25ms，像内容被依次加载出来）；收起：条目自末端先退、高度随后收拢，比展开利落。
- **从当前高度续播**：快速连点打断（展开中点击收起、收起中再点开）时从容器当前高度继续，不跳帧。`Sidebar` 与 `NavTreeNode` 的 `v-show` 改为 `<Transition :css="false">` 接入。
- 条目自带 `opacity` 过渡（悬停让位高亮在用），动画期间临时改 `transition: none` 由 GSAP 全权控制，结束 `clearProps` 还原——否则 CSS 过渡与 GSAP 双重缓动，条目透明度级联会明显滞后（实测收起 120ms 时最后一项仍在 0.94 以上）。
- 减少动态效果、页面在后台时不播动画，直接给终态（复用 `skipMotion()`）；结束时清理全部 inline 样式，无残留。

**图标条折叠（侧栏收成 76px）**

- `.app-frame` 的 `grid-template-columns` 增加 0.38s 过渡：收放时列宽平滑滑动，工作区随动。
- 品牌文字与导航标签由 `display: none` 瞬变改为「先淡出、再塌缩宽度」（`max-width` 0↔100% + `opacity`）；展开时反向延迟出现。`.nav-item` / `.rail-brand` 的 `gap`、`padding` 同步过渡，图标滑向并精确停在中心（原先靠 `display: none` 去掉间隙，直接改 `max-width` 会残留 11px 空隙使图标偏左）。
- 分组标题行（`max-height`）、分组间距（`margin/padding`）、分支缩进线同步过渡，消除折叠瞬间的整块跳动；移动端覆盖规则同步改写。

**验证**

- `vue-tsc --noEmit` 与 `vite build` 通过。
- 无后端环境下用 Chromium CDP 对临时预览页实测（30 个演示菜单触发紧凑模式）。开启/收起/三级分支/图标条折叠四个场景均在 t+120ms、t+300ms 采到中间态：高度为 px 中间值、条目透明度呈级联梯度（展开 0.83/0.53，收起 0.68/0.43）；800ms 后 inline 样式全部清理。快速连点「展开→打断→收起→再展开」高度从 110px→85px→0→103px 平滑续播；全程无 JS 异常。
- 真实环境（后端 8090 + 前端 5180，admin 登录）复核「系统管理」收放：收起 t+120ms 时 h=189（278→0 途中）、末项透明度 0.657 呈反向级联；再展开 t+120ms 时 h=243.9（0→278 途中），结束无残留、无 JS 异常。折叠态与展开中截图存 `keystone-vue/scripts/verify-nav-motion-*.png`。
- 既有 `scripts/verify-group-collapse.py`（Playwright，点击后 settle 700ms）经时序核对不受影响：收起 0.26s / 展开 0.44s 均在等待窗口内完成；待后端环境可用时可复跑复核。

## 2026-10-13（修复：登录日志的来源与客户端列为空）

登录日志的「来源」「客户端」两列一直显示「—」。根因在写入端：`sys_login_log` 表本身有 `ip / location / browser / os` 四列，列表查询与前端渲染也一直正常，唯独 `AuthMapper.insertLoginLog` 只写入 `username / status / msg / login_time`，登录、退出、失败尝试三类记录从未采集过请求上下文，四列始终为 NULL。

- 新增 `framework/web/ClientInfoResolver`（登录日志、操作日志共用的客户端信息采集）：IP 取 `X-Forwarded-For` → `X-Real-IP` → 直连地址；浏览器与系统从 `User-Agent` 解析（覆盖 Chrome / Edge / Firefox / Safari / Opera 与微信、QQ 内置浏览器，Windows / macOS / Android / iOS / HarmonyOS / Linux）；地点对回环地址标注「本机」、私有网段标注「内网」（IPv4-mapped IPv6 先归一化），公网地址留空待接地理库。无请求上下文（异步线程、单测）时返回空快照，字段记 NULL，不抛异常。
- `AuthMapper.insertLoginLog` 增加四列写入；`AuthService` 的登录成功、密码错误、账号停用、退出登录四个写入点统一经 `ClientInfoResolver.current()` 采集。
- 消除重复实现：`OperationLogAspect` 的私有 `clientIp()` 与 `JdbcOperationLogRecorder` 的私有 `location()` 改为复用同一工具。地点判断由「非本机即内网」修正为「仅私有网段标注内网」——此前公网 IP 被误标「内网」，现留空。
- 前端无需改动：`LoginLog.vue` 的来源列（IP + 地点副行）与客户端列（浏览器 · 系统）本就按这四列渲染，为空时显示「—」。
- 新增 `ClientInfoResolverTest`：8 个用例覆盖多浏览器 / 系统 UA、代理头优先级、回环与私有网段判定（含 `172.16-31` 边界与 mapped IPv6）。验证：`mvn -pl keystone-framework -am test` 8/8 通过；另建独立校验库启动临时实例实测——登录、退出、密码错误三类登录记录与「修改密码」操作日志的 `ip=127.0.0.1 / location=本机 / browser=Chrome / os=Windows` 均正确落库，且能通过日志列表接口读回，验证后已清理临时库与实例。
- 存量记录仍为 NULL（当时无采集来源，不做回填）；**重启后端后重新登录产生的新记录即有值**。

## 2026-10-13（修复：分组折叠后无法再展开）

侧边栏一级分组点击无反应：折叠过的分组再也展不开，用户困在「看得见标题、点不开内容」的状态。根因是折叠状态有两个列表，而用户展开时只写了其中一个。

- `Sidebar.toggleGroup` 的展开分支只调 `markExpanded()` 记「显式展开」，没有清掉 `keystone.navCollapsed` 里的折叠标记；而 `autoCollapsed()` 的判断顺序是「显式折叠 > 显式展开」，旧标记持续生效 → 点击后没有任何视觉变化。
- 新增 `setGroupOpen(key, open)`：折叠列表与展开列表成对维护、互为反集；`markExpanded` / `unmarkExpanded` 各管一侧，从根上消除「两个列表打架」。
- `groupOpen()` 判断顺序调整为「搜索态 > 用户显式折叠 > 当前页所在分组 > 自动策略」。此前「当前页保护」排在显式折叠之前，在某个分组内点击它的标题同样毫无反应，但仍会写入折叠标记，留给下一次踩坑。
- 移除「当前页所在分组不允许手动收起」的硬拦（它只挡住状态写入，没挡住视觉）。改为 `revealActive()` 在路由变化时清掉当前页所在分组的折叠标记：既不会把用户困住，也不再出现死点击。只清折叠标记、不写「显式展开」，避免破坏紧凑模式的自动收起策略。
- 搜索态下点击分组标题不再写偏好，避免退出搜索后状态突变。
- `scripts/verify-group-collapse.py` 重写为 15 项，补齐本次的真实缺口：**收起 → 再点击展开**、**全部收起 + 刷新后逐个都能展开**、折叠/展开列表互斥、aria 与内容是否同步隐藏（防「箭头变了内容没动」）、搜索期间不写偏好；默认展开策略与折叠收益改为按菜单量自适应，当前 11 项菜单走「未超阈值应全展开」分支。
- 验证：`vue-tsc --noEmit` 无错误，`npm run test:unit` 32 项通过，Playwright 15/15 通过（真实登录，前端 5180 + 后端 8080）。

## 2026-10-13（登录页文案优化）

登录页一屏内出现多处同词重复：眉标「通用后台底座」与主标题「统一的后台底座」重复「底座」；能力卡标题与描述互相重复（权限 / 授权、日志 / 日志、生成 / 生成）；登录卡「账号登录 / 登录 / 使用管理员分配的账号登录系统」三连撞词。本次只改文案，不动结构、样式与交互。

- 左侧主视觉：眉标「通用后台底座」改为「内部管理平台」；主标题「统一的后台底座，专注业务本身。」改为「底座一次搭好，只写你的业务。」；导语补充「代码生成」，并把逗号断句改为分号，明确「内置能力」与「接入成本」两段语义。
- 能力卡四条：`角色与按钮权限` 改为 `角色授权`（描述中的「两级授权」改为「两级控制」以免与标题同词）；`数据权限` 描述补「四档范围」结论；`操作审计` 描述去掉「登录日志与操作日志」的日志重复，改为「自动留痕，支持回溯」；`代码生成` 描述中「生成」重复，改为「产出模块开发骨架」。
- 左侧健康面板眉标「服务状态」改为「服务健康」，避免与下方状态值「运行正常」语义重叠。
- 右侧登录卡：眉标改为「欢迎回来」，标题由「登录」改为「账号登录」，副文案改为「请使用管理员分配的账号进入系统」，三处不再撞词。
- 校验：`npm run build`（含 `vue-tsc --noEmit`）通过。

## 2026-10-13（项目定名 Keystone）

项目英文名由 `scaffold` 改为 **Keystone**（拱心石：拱券最后落下的那块石头，拆掉它整座结构就塌），契合「统一底座、拆不得」的定位。本次先完成全部内容层替换，目录重命名需在 IDE 中手动执行（原因见文末）。

- Maven 坐标：`groupId` 由 `com.scaffold` 改为 `com.keystone`；`artifactId` 由 `scaffold-*` 改为 `keystone-*`（`common` / `framework` / `system` / `generator` / `admin` 及 `keystone-system-parent`）。
- 包前缀：84 个 Java 文件的 `com.scaffold.*` 全部改为 `com.keystone.*`；启动类 `ScaffoldAdminApplication` 改名为 `KeystoneAdminApplication`。
- Spring 配置前缀：`application.yml` 的顶层键 `scaffold:` 改为 `keystone:`，同步修改 `JwtService` 中两处 `@Value("${keystone.jwt.*}")`，避免 JWT 密钥注入失效。
- 应用名与日志包名：`spring.application.name` 改为 `keystone-admin`，`logging.level` 由 `com.scaffold` 改为 `com.keystone`。
- 数据库默认名：`application-dev.yml` 中 `DB_NAME` 默认值由 `scaffold_system` 改为 `keystone_system`。**已存在的本地库不会自动改名**，需自行 `RENAME DATABASE` 或在 `DB_NAME` 中继续指定旧库名。
- 代码生成器：`GeneratorService` 输出 ZIP 内的后端文件路径由 `com/scaffold/` 改为 `com/keystone/`（4 处），与生成的 `package` 声明保持一致，生成结果可直接放进本工程。
- 测试环境变量：`SCAFFOLD_TEST_PASSWORD` 改为 `KEYSTONE_TEST_PASSWORD`，涉及 `scripts/session-regression.py` 读取处与两处文档说明。
- 前端标识：`package.json` 的 `name` 改为 `keystone-vue`；12 处本地存储键前缀由 `scaffold.*` 改为 `keystone.*`（`token` / `user` / `expiresAt` / `appearance` / `recent` / `navCollapsed` / `intro.*` / `view.*` / `login-intro`），含 `index.html` 首屏防闪烁脚本、回归脚本与单测断言。**改名后浏览器中的旧会话数据不会自动迁移，需重新登录一次。**
- 文档：`README.md`（含标题与命名释义）、`PROJECT_MAP.md`、`DESIGN.md`、`AGENTS.md`、`docs/backend-architecture.md`、`docs/frontend-backend-integration.md` 中的目录、模块、包路径与环境变量表述同步更新；历史日志条目按约定保留原样。

**待手动完成**：顶层 `scaffold-system` / `scaffold-vue` 两个目录及其下`common` / `framework` / `system` / `generator` / `admin` 五个 Maven 子模块目录、Java 包目录 `com/scaffold`，以及 MySQL 库名，需在 IDE 中重命名；随后把父 `pom.xml` 的 `<module>` 列表与各文档中的目录路径对齐即可。

## 2026-10-13（一级分组折叠与超阈值自动收起）

- 补上一级分组的折叠能力。此前折叠只作用于「有子菜单的节点」，纯两级菜单（如商城后台每组十几个页面）没有任何可折叠点，项数一多只能整条铺开滚屏。现分组标题改为可点击的折叠头，与子级折叠共用一套状态与持久化。
- 新增**超阈值自动收起**：可见页面总数超过 `AUTO_COLLAPSE_THRESHOLD=20` 时进入紧凑模式，自动收起排在 `KEEP_OPEN_GROUPS=2` 之后的分组；当前页所在分组始终展开，搜索态强制全展开。搜索框下方在紧凑模式下提示「菜单较多，部分分组已收起」，避免用户误以为菜单缺失。
- 用户操作双向覆盖自动策略：手动折叠写入 `keystone.navCollapsed`，手动展开写入 `keystone.navExpanded`。**两者的区分是必需的**——只记录折叠列表时，手动展开后自动策略会立即重新收起，表现为点击无反应。
- 修正两个真实缺陷：`v-show="!group.single || groupOpen(...)"` 条件写反，对非 single 分组恒为真导致**折叠永远不生效**（但 `aria-expanded` 已变更，肉眼只看箭头会误判成功）；`syncCollapsed` 的合法键列表未包含一级分组 key，导致刚写入的分组折叠状态被当成死键清除。
- 折叠头复用 `.nav-group-title` 原有视觉，仅追加箭头与 hover 反馈；`single` 分组（工作台）无标题不参与自动策略计数。
- 新增 `scripts/verify-group-collapse.py`：Playwright 验证 11 项（折叠控件、超阈值自动收起、高频分组保持展开、折叠后高度实测对比、当前页分组保护、手动展开持久化、刷新恢复、搜索强制展开、无运行时错误），需先写入纯两级但总量超阈值的演示菜单。
- 验证：`npm run test:unit` 通过 32 个测试，`npm run build` 与 `vue-tsc --noEmit` 通过；Playwright 11 项全部通过；验证后已清理演示菜单，数据库还原为 38 条菜单。

## 2026-10-13（侧边栏多级菜单与菜单搜索）

- 侧边栏从「只支持两级」升级为**无限层级**。原 `buildNav()` 只取菜单树第一层子节点，第三级及以下直接丢失（商城类后台的「商品 → 商品中心 → 品牌管理」这类结构无法访问）；现改为递归转换，深度上限 6 层（`MAX_MENU_DEPTH`），对齐后端 `sys_menu.parent_id` 自关联层级，异常数据不会撑爆导航。
- 转换逻辑从 `composables/auth.ts` 抽到 `src/utils/navTree.ts`（纯函数，不依赖 Vue 与网络），`auth.ts` 只保留组件登记表与路径规范化策略，便于单测覆盖。
- 新增递归组件 `components/layout/NavTreeNode.vue`，按层级收敛字号与图标尺寸；`Sidebar.vue` 模板不再手写重复的分支/叶子结构。
- 新增**分组折叠**：`composables/navCollapse.ts` 管理折叠状态，持久化到 `sessionStorage` 的 `scaffold.navCollapsed`，遵循 `appearance.ts` 既有的存储不可用容错约定。菜单结构变化后自动清理失效分组键。
- 路由变化时自动展开当前页的所有祖先分支（`revealActive`），避免用户看不到自己在哪；仅在确有折叠项时写入，不产生无谓的存储操作。
- 新增**侧边栏菜单搜索**：跨层级匹配菜单名，命中后临时展开全部分组并显示匹配计数，无结果时显示空态；不再依赖 Ctrl+K 命令面板这一隐藏入口。
- 修正 `hasActive` 只检查第一层的问题：深层页面激活时滑动玻璃块不显示，改为深度查找任意层级。
- 同步修复其他扁平结构消费方：`CommandPalette.vue` 与 `Dashboard.vue` 快捷入口改为深度展开，`router/index.ts` 的 `homePath()` 改为向下取第一个可见页面（分组首项可能是纯目录，原写法会取到空路径）。
- 新增 `src/utils/__tests__/navTree.test.ts`，11 个用例覆盖两级/三级结构、纯目录摊平、页面兼分组、未登记组件的子树保留、深度截断、分组归属与空树。
- 新增 `scaffold-vue/scripts/verify-nav.py`：Playwright 真实浏览器验证 16 项（多级渲染、折叠隔离性、状态持久化、搜索命中与空态、深层路由跳转、高亮、刷新恢复、无运行时错误），需先写入商城演示菜单数据。
- 验证：`npm run test:unit` 通过 32 个测试（新增 11 个），`npm run build` 通过，`vue-tsc --noEmit` 无错误；Playwright 在 `5180` 端口 16 项全部通过；验证完成后已清理演示菜单与登录日志，数据库还原为 38 条菜单。
- 本机环境记录：`npm ci` 后需补装平台可选依赖 `@rollup/rollup-win32-x64-msvc` 与 `@esbuild/win32-x64`，否则 `vite` 无法启动；Vite 默认仅监听 IPv6，浏览器自动化需用 `--host 127.0.0.1`。

## 2026-10-13（局域网访问）

- 前端开发服务器与 `preview` 均改为监听所有网卡，同一局域网的同事可直接在浏览器打开 `http://<本机内网IP>:5180` 查看项目，无需端口转发或在本机安装额外组件；`/api` 代理仍在开发服务器本机转发到后端。
- 前端端口由 `5173` 改为 `5180`（本机 `5173` 已被其他项目占用，实测请求会被该项目接管），预览端口由 `4173` 改为 `4180`；新增 `VITE_PORT`、`VITE_PREVIEW_PORT` 环境变量覆盖，并开启 `strictPort`，端口被占用时直接失败而非静默递增，避免同事按固定端口访问连不上。
- 后端新增 `SERVER_ADDRESS` 配置，默认绑定 `127.0.0.1`，同事无法直连 `8080`，需其他设备直连时显式设为 `0.0.0.0`。
- 新增 `VITE_ALLOWED_HOSTS` 环境变量：Vite 默认放行 IPv4 字面量与 localhost，用 IP 访问无需配置；用计算机名访问时需声明主机名，否则返回 403。
- 同步 `README.md`、前端 `README.md`、`PROJECT_MAP.md` 端口与新增环境变量说明；`scripts/session-regression.py` 默认 base URL 同步为 `5180`。
- 验证：开发服务器在 `0.0.0.0:5180` 监听，以 `Host: 192.168.1.39:5180` 访问首页返回本项目页面（标题「通用后台管理系统」），`/src/main.ts`、`/@vite/client` 均 200，`/api/auth/captcha` 真实返回验证码数据（后端已在运行）；非 IP 主机名 Host 头被 403 拦截，符合预期；本机域/专用/公用三个防火墙配置文件状态均为关闭，无需额外放行规则。

## 2026-10-11（MIT 开源发布）

- 以当前代码建立独立的公开版本快照，采用 MIT License；第三方依赖保留各自许可，README 单独说明 GSAP 许可。
- 开源内容保留前后端源码、测试、初始化 SQL、锁文件、必要开发脚本及当前架构文档；排除宣传视频、旧规划、编辑器配置、依赖、构建产物、缓存、日志、备份和私密配置。
- JWT 密钥改为必填环境变量 `JWT_SECRET`，启动时校验 UTF-8 编码至少 32 字节且不能全为空白；新增无需数据库和 Redis 的密钥边界与签名验证测试。
- 初始化示例电话留空，示例邮箱改用 `example.com`；清理公开文档中的本机绝对路径和已排除目录入口，保留历史日志与人工备注。
- 发布整理仅作用于独立副本，原项目工作区及本地提交历史保留。
- 验证：独立副本 `npm ci`、21 项前端单元测试、含类型检查的前端构建、8 项后端公共模块与 JWT 单元测试、完整后端编译打包均通过；核对必要源码、文档链接和排除规则，敏感信息模式扫描未发现问题。本次未执行数据库集成测试或浏览器业务回归，未操作实际数据库。

## 2026-10-11（宣传视频 v2：45 秒卡点重制）

- 重新设计为约 45 秒的版本：开场用"普通表格 → 高光快剪"制造反差，按 120 BPM 节拍网格剪辑，每个动效都推近并跟拍，深色模式切换放在 drop 上；口播改用 `zh-CN-YunjianNeural`，并改写成短句。
- 清晰度：录屏视口改为 1440×810、DPR 3，加 `--force-device-scale-factor=3` 后 screencast 输出真实的 4320×2430 帧（不加时 headless 只输出 CSS 尺寸）。`clock.js` 把页面时钟和 CSS 动画同步放慢 10 倍再抓帧，内容帧率约 70fps。用 Pillow 亚像素裁切加 Lanczos 渲染推拉镜头，最终只做一次 H.264 CRF 14 编码。
- 声音：`music.py` 用 numpy 合成 BGM 和 8 种音效（无外部采样）；口播出现时 BGM 自动压低，两遍 loudnorm 到 -14 LUFS。
- 竖版改为深色画布：上方是段落标题，中间是 4:5 主画面，并单独设计一套镜头轨迹，不再用模糊背景铺底。
- 产出：`out/v2/` 下横版 2560×1440 和 1920×1080、竖版 1440×2560 和 1080×1920，均为 60fps、47 秒；另有 SRT 字幕、横竖封面、音频预览。v1 脚本保存在 本地历史宣传素材目录，v1 成片保留不动。
- 验证：横版 1440p 码率 12.7 Mbps；响度 -14.1 LUFS，峰值 -1.2 dBFS。在同一界面区域按 1:1 截图对比 1080p 的 v1 与 v2，v2 的文字和图形明显更清晰。抽帧核对了取景、字卡和字幕的时间与位置。

## 2026-10-11（宣传视频清晰度重制）

- 录屏由 JPEG 88 抓帧改为原生 1920×1080 PNG 抓帧，取消将 1080p 图像放大成 2880×1620 的伪高分辨率步骤；素材使用 RGB 无损编码，以毫秒时间基保留动作时序、按记录时长封口并转换为 30fps，在关闭页面前等待抓帧确认完成。
- 合成的中间片段改为 RGB 无损编码，最终只做一次 H.264、CRF 14 压缩，并统一 BT.709 色彩与有限范围；竖版主体采用轻微锐化，上下背景沿用原稿的虚化效果。取景按素材实际尺寸折算，兼容原素材。
- 增加素材与成片目录参数；本次新素材写入 `_clips_hd/`，高清横竖成片、字幕和封面使用 `_hd` 后缀，保留原口播、剪辑场景与原文件；同步录制说明及项目地图。
- 验证：9 个场景完成实际页面录制；横版 1920×1080、竖版 1080×1920，均为 30fps、2158 帧、71.94 秒，两版全片解码通过；核对关键场景的文字、取景和字幕，口播音频与字幕内容和原版一致。片段按累计帧数对齐，避免逐段时长舍入产生累计偏移。

## 2026-10-11（修复：浮层内滑块首帧错位）

- 分段选择器、侧栏选中块、命令面板高亮、代码生成步骤条共用的 `slideThumb` 在祖先处于缩放过渡（弹窗 / 命令面板从触发点展开、页面进场）时量到的是缩放后的包围盒，首次打开菜单编辑弹窗时「菜单类型」滑块偏小错位，切换一次才纠正；现按祖先当前缩放比折算回布局像素。`Segmented` 另监听各选项尺寸（字体加载完成只改选项宽度时也重新对位）。
- 表单字段内的分段选择器不再被纵向 flex 拉伸成整行空槽（`.field > .segmented` 按内容定宽）；部门画布适配视口改用布局尺寸，不受页面进场缩放影响。

## 2026-10-11（图谱舞台回归珍珠玻璃）

- 撤销暗场舞台：删除 `.stage-scope` 深色令牌，改为浅 / 深主题各一套 `--graph-*` RGB 三元组；舞台底改为与外壳一致的浅底点阵 + 环境光，深色只随外观设置切换。
- 视觉隐喻替换：中心光球改为珍珠球（珠光渐变、淡虹彩、缓慢扫描的刻度环与青柠卫星点）；程序化水母神经元改为玻璃刻度表盘，刻度着色比例为真实读数（已分配角色的用户、有持有人的角色、已授权页面）；叠加发光、粒子迸发改为实色细线、18% 光环脉冲与开场细环涟漪。
- 溯源全景：条目改为围绕表盘的整齐刻度弧与放射细线，跨类授权线只在悬停聚焦时出现，名称沿放射方向排开；条目过多时不画名称。台阶、分析栏、问答坞、工具条全部回到珍珠玻璃材质。

## 2026-10-11（设计审查与第三轮重构：暗场舞台、全站中文化、数据口径修正）

- 暗场舞台（已于同日撤销，见上条）：`tokens.css` 新增 `.stage-scope`（舞台底、暗玻璃、`--glow-1~5` 发光色，并在舞台内重新声明文字 / 描边 / 面板令牌，分析栏与问答坞自动换肤）；新增 `composables/neural.ts` Canvas 绘制件（光球、程序化神经元、发光丝、脉冲、迸发、真实数据背景网络、轨道、台阶光柱、地平线）；`RelationGraph` 新增 `variant="stage"`、`network` / `networkFocus` / `networkAlpha` / `orbits`、`slab` 台阶节点与 `hover` 事件、「重播 / 暂停」，删除原随机三角网背景；可点小目标不再漂移。
- 权限溯源重做为三层下钻（全景 → 模块 → 实体），背景网络为全部用户 / 角色 / 菜单真实点位与授权线；菜单星图重做为「导航星系」（三圈刻度轨道、分支扇出、角色 → 页面 → 按钮链路，侧栏预览改为占位不覆盖）；岗位阶梯重做为「能量阶梯」（对角线铺满不裁切、光柱与地平线、脊线脉冲、成员触须，删除右侧大空面板；窄屏横向滚动）。
- 全站文案中文化：`SectionLabel` 去掉英文眉标与编号，`PageHeader` / `ListPage` 去掉 `eyebrow`；工作台日期、读数标签、用户看板（最近登录 / 从未登录）、部门读数、登录页、命令面板、矩阵、泳道等英文标签改为中文；参数面板 `light / dark / auto` 显示为浅色 / 深色 / 跟随系统（取值不变）。`.eyebrow` 改为中文小标签样式。
- 工作台：删除布局重叠且与常用入口重复的「模块网络」卡；数据权限气泡改为横向占比条（删除 `BubblePack`）；删除页头与侧块重复的规格铭牌。操作日志 / 登录日志删除与概览读数重复的页头铭牌。
- 稀疏数据：`TrendChart` 非零点 ≤ 3 时改画茎叶点并标数值；`Swimlane` 默认聚焦到有操作的时段（至少 6 小时），可切全天；`DeltaPill` 新增 `fresh`「新增」态。
- 表格：操作列吸附右侧，用户表在 1440 宽下操作列不再被挤出可视区。
- 后端口径修正：登录成功写入 `sys_user.last_login_time`（最近登录时间，此前从未写入导致看板恒显示「从未登录」）；岗位 / 角色在岗人数与工作台数据权限分布排除已删除用户；`/dashboard/summary` 的 `stats[].fresh`（上一周期为 0、无法计算环比）新增。`AuthApiTest` 补最近登录时间断言。
- 验证：前端 `npm run test:unit` 21 个用例、`npm run build`（含 vue-tsc）通过；后端 `mvn -pl scaffold-admin -am test` 46 个集成测试通过；Playwright 1440 / 390 宽、浅色 / 深色、减少动态效果截图核对三个舞台与工作台、日志、用户页；舞台页无头实测满帧、最差帧约 10ms。

## 2026-10-11（神经网络升级：全模块差异化视图与全局炫技）

> 分工说明：Phase 0–6 公共底座与前六个模块由 Claude 完成；共享视口抽取、Phase 7 岗位阶梯、Phase 8 全局炫技点及文档/验证由 Devin（SWE）完成，条目分别以【Claude】/【SWE】标注。

- 【Claude】公共底座：`composables/motion.ts` 扩展 `spring`、`createFrameLoop`、`revealCascade`、`typeOut`、`bezierAt`、`firstTimeInSession`；新增 `RelationGraph`（BFS 逐层蔓延入场、贝塞尔连线脉冲、扇形触须、悬停邻接高亮、拖拽平移与缩放）、`InsightPanel`、`AskDock` 与本地规则问答引擎 `ask.ts`；`instruments.css` 补 `.rg-*`、`.insight-*`、`.heat-*` 样式；令牌新增 `--thread`、`--thread-active`、`--pulse-halo`、`--node-bg`（浅深两套）。
- 【Claude】权限溯源：`GET /api/system/permissions/graph`（权限 `system:role:list`）返回用户、角色、菜单及用户-角色、角色-菜单两组关联；角色页新增「溯源」视图（三能力岛环绕开场、选中角色扇形展开用户与菜单、`InsightPanel` 读数下钻、底部问答坞），用户页行操作带 `?trace=user:ID` 跳转聚焦。
- 【Claude】登录热力与异常：`GET /api/monitor/login-logs/heatmap?days=`（权限 `monitor:loginlog:list`）返回 7×24 `cells` 与连续失败 `anomalies`；登录日志「02 趋势」可切热力格，对角线波纹点亮、悬停十字高亮、失败占比斜线，「03 异常」卡片点按联动明细筛选。
- 【Claude】参数设置面板：参数页默认「面板」视图（可切表格），按键名前缀分组、按值推断控件行内编辑，改动累积到底部浮条显示「原值 → 新值」一次提交，失败项保留标红。
- 【Claude】菜单星图与导航预览：菜单页新增「星图」（目录 / 菜单 / 按钮三环 radial 布局，按钮显示权限码），有角色权限时叠加角色环，孤立菜单与缺权限码按钮红描边；左侧固定导航预览实时渲染当前树，隐藏 / 停用项虚化。
- 【Claude】代码生成流水线与字典样本册：生成抽屉改三步流水线（表信息 → 字段映射贝塞尔连线 → 代码逐行级联预览）；字典页新增「样本册」视图，真实 `DictTag` 平铺，点卡片 Flip 原地展开编辑（label / tone / 排序 / 默认项金标）。
- 【SWE】共享视口：抽取 `composables/viewport.ts`（`useViewportPan`），组织画布与关系图复用同一套拖拽平移、Ctrl/⌘ + 滚轮缩放、pointer capture 与 reset 逻辑，移除两处重复实现。
- 【SWE】岗位职级阶梯：用户分页、统计与导出接口新增可选 `postId` 参数（经 `sys_user_post` 关联过滤，沿用 `@DataScope` 数据权限）；新增 `PostLadder` 组件，岗位页增加「阶梯」视图——按 `sort` 排成上升台阶，`TickRing` 显示在岗人数，点卡片右侧扇形展开在岗成员触须。
- 【SWE】命令面板「问系统」：输入 `?` 切换问答模式，展示预设问题芯片，提交后打字机 + 答案卡级联，卡片芯片可跳转对应页面；`ask.ts` 新增参数意图（开关参数、登录验证码是否开启、敏感参数值），走 `system:config:list` 权限过滤与 `configs.list` 数据；参数页支持 `?keyword=` 定位。
- 【SWE】登录神经网络背景：新增 `NeuralNet.vue`（Canvas 节点 = 能力模块，连线脉冲往返、节点缓慢呼吸），置于登录页左侧深色画布底层；登录成功时中心迸发短划并收束到对勾，页面隐藏、离屏、reduced-motion 时暂停或静态呈现。
- 【SWE】工作台开场与模块网络：本会话首次进入工作台，卡片从中心弹簧飞出依次落位；新增「模块网络」小卡（用户 / 角色 / 菜单 / 部门节点 + 关联脉冲，点节点跳转对应页面）；`/dashboard/summary` 的 `stats` 新增 `menus`（菜单项总数）与 `depts`（部门数）两项。
- 【SWE】细化动效：部门画布选中节点时根 → 当前节点路径连线高亮并沿曲线走脉冲；用户看板拖拽成功落位与取消回飞改用阻尼弹簧；操作日志详情抽屉与角色授权抽屉内容接入 `revealCascade`（约 70–90ms 级联，reduced-motion 静态呈现）。
- 【SWE】验证：前端 `npm run test:unit` 21 个用例通过，`npm run build`（含 vue-tsc）通过；后端 `mvn -pl scaffold-admin -am test` 45 个集成测试通过（含用户 `postId` 岗位过滤、权限图、登录热力与新增 summary 字段断言）。浏览器实测：登录页网络呼吸与成功迸发、工作台开场弹簧入场与模块网络节点跳转、岗位阶梯台阶与成员触须（含深色）、部门画布选中路径脉冲、命令面板 `?` 问答（预设芯片 + 三类参数意图应答 + 芯片跳转）、操作日志 / 角色抽屉级联、375px 无横向溢出、reduced-motion 静态呈现，全程无控制台错误。后端测试需本地 MySQL 与 Redis，连接信息走 `DB_*` / `REDIS_*` 环境变量。

## 2026-10-11（UI 精致化：仪器化语汇与六种版式）

- 新增仪器化语汇：等宽眉标与编号、显示级读数（逐位滚动、上标单位）、深色规格铭牌、环比胶囊、刻度尺、斜线填充、悬停名片；令牌补充等宽字体、显示字号、刻度、铭牌、5 枚只表示类别的分类色与画布环境光，样式新增 `instruments.css` 一层。
- 新增自绘图表：趋势图（切换时间档时折线形变、准星读数平滑跟随、失败序列与区间斜线）、柱状图、60 刻度成功率环、气泡占比、时间轴泳道（实时「现在」线、失败与慢操作标记）。
- 工作台改为主次布局：登录脉搏主卡（总量、环比、峰值 / 均值）+ 在线与接口侧块 + 近 7 天操作量 / 成功率环 / 数据权限气泡 + 当日操作泳道（有日志权限时）+ 最近登录与常用入口。
- 操作日志、登录日志改为横带分层（概览 → 趋势 / 泳道 → 明细）；点击泳道块按模块过滤明细。部门管理新增组织架构画布（平移缩放、连线先到节点后亮、四角浮动面板）；用户管理新增看板（按部门 / 角色 / 状态分列，按状态可拖拽启停，提供键盘「移动到…」）；角色管理新增菜单 × 角色权限矩阵（十字高亮、级联勾选、底部浮条一次提交，内置角色只读）。视图偏好按页面记在本机。
- 登录页改为全幅深色画布：实时时钟刻度、服务健康与延迟、能力面板；登录卡随指针轻倾，登录成功走「收拢 → 对勾圆环 → 进入」三拍；进入外壳的导航被取消时恢复登录按钮。
- 浮层与外壳：弹窗从触发点展开、列表行生长成详情抽屉并收回原行、批量操作改为底部深色玻璃浮条、命令面板分组为最近访问 / 页面 / 用户 / 动作并以玻璃滑块指示焦点、提示改为可悬停展开的牌堆（悬停暂停计时、倒计时细环）、主按钮涟漪、内容滚动后顶栏凝结、表格中文短字段不再逐字折行。
- 后端新增只读接口：`GET /api/monitor/oper-logs/stats`、`GET /api/monitor/oper-logs/timeline`、`GET /api/monitor/login-logs/stats`（`MonitorStatsService` / `MonitorStatsMapper`）；工作台汇总新增 `trendPrev`（上一周期登录数）与 `dailyOps`（近 7 天按日操作量）。不改表结构。
- 同步 `DESIGN.md`（七层样式、令牌、版式、能量语态表）、`PROJECT_MAP.md`、两份架构 / 接口文档与 UI 方案文档。
- 验证：后端在新建的独立校验库 `scaffold_verify` 上 `scaffold-admin` 41 个集成测试通过（含新增 `MonitorStatsApiTest` 4 个及工作台字段断言）；前端 15 个单测、类型检查与构建通过；会话回归脚本两项通过。浏览器在 1440 / 375 / 320 px 与深色下检查工作台、两个日志页、部门画布、用户看板、角色矩阵、登录页，11 个页面 320 px 无横向溢出、无 Vue 警告；实测泳道、看板拖拽停用与恢复、矩阵授权保存与还原、命令面板用户搜索跳转、行展开抽屉、提示牌堆展开。测试中的临时改动均已还原。浏览器面板处于后台时 rAF 不运行，入场长帧未能实测。

## 2026-10-10（通用后台脚手架整理与验收）

- 移除建筑、工作流模块及 Flowable 依赖，后端保留公共基础、框架、系统管理、代码生成和启动模块；数据库首次初始化收敛为 `V1__init_schema.sql`、`V2__seed_data.sql`。
- 前端采用 Vue 3、GSAP 与自有珍珠玻璃组件，移除 Element Plus 和 three；统一主题、表格密度、列表模板、查询、表单、权限按钮、字典及组织选择组件，重写登录、工作台和 10 个管理页面。
- 修复切换账号时旧路由初始化、旧菜单响应、慢退出请求及旧账号 401 覆盖新会话的问题；退出同步清除路由、权限及字典/部门缓存，未分配菜单的账号显示明确落点。
- 登录 token 增加独立标识，避免同秒重新登录生成相同 token；停用或已删除角色不再授予菜单和权限。用户页面改为按用户操作权限获取必要选项，业务字典选项与管理接口权限分开。
- 超级管理员自动获取全部菜单与权限；用户按部门筛选包含下级部门；工作台 7 天与 30 天趋势包含当天；代码预览返回全部文件，生成菜单 SQL 与当前字段及手动主键结构一致。
- 数据库、Redis 连接读取环境变量；MySQL 时区参数通过连接属性传递，避免 `+08:00` 被 URL 解码为无效值，应用连接与初始化工具统一设置数据库会话时区。
- 修复页面切换空白、减少动态效果与后台标签页关闭浮层的问题；浮层按打开顺序处理层级、焦点和 Escape，下拉层级跟随所在弹窗；长内容抽屉保持底部按钮可见，正文独立滚动。
- 新建根目录 `README.md`、`PROJECT_MAP.md`，重写 `DESIGN.md`、前端说明及三份架构/接口文档，更新 `AGENTS.md`；保留历史规划和日志，移除历史文档中的实际数据库密码，忽略本地缓存、日志和私有环境文件。
- 验证：41 个后端测试通过并完成打包，15 个前端测试通过，类型检查与构建通过。真实浏览器完成会话竞态与低权限验证、字典/菜单增改删与导出、生成器导入/配置/7 文件预览/ZIP 下载；检查 11 页在 320/375px、深色模式及减少动态效果下的显示，以及主题跟随、密度持久化、菜单搜索和嵌套浮层键盘操作。生成菜单 SQL 在集成测试中实际执行并回滚。
- 验证使用独立本地校验库。按确认删除四份旧报告/需求文档，并重建 `scaffold_system`；初始化数据移除不存在的业务表生成配置，生成器从空列表开始。代码生成输出仍是开发骨架，业务 CRUD 和页面接入需在后续项目中实现。

## 2026-06-08 (侧栏动态菜单修复)

- 修复前端侧栏动态菜单跳转：后端返回的 `/system/role`、`/system/dept` 等路径型路由不再被当作 Vue Router `name` 处理，避免点击左侧菜单时报 `No match for {"name":"/system/role"}`。
- 新增导航工具单元测试，覆盖静态菜单路由名和动态菜单路径两种跳转来源。

## 2026-06-07 (最终验收修复)

- 修复后端集成测试登录夹具：新增 `TestAuthClient`，统一按真实契约先调用 `GET /api/auth/captcha` 获取 `captchaUuid` 和验证码，再提交 `POST /api/auth/login`。
- 更新认证、系统管理、监控日志、工作流、代码生成等测试中的旧登录写法，避免验证码校验拦截导致验收测试无法覆盖真实业务接口。
- 更新 `scaffold-vue/README.md`，将“纯前端 Mock、未接后端接口”的历史说明改为当前真实接口接入状态，并补充 `VITE_API_PROXY_TARGET` 代理配置说明。
- 完成最终验收验证：`mvn test` 通过 42 个后端测试，`mvn package -DskipTests` 打包成功，`npm run test:unit` 通过 18 个前端单元测试，`npm run build` 通过；本地启动后端 `18081` 和前端 `5178`，经前端 `/api` 代理完成验证码、登录、当前用户和工作台摘要真实接口冒烟；`admin-redesign` 独立原型 `npm run build` 通过。

## 2026-06-06 (Flowable 工作流闭环)

- 接入真实 Flowable 基础运行时：`scaffold-admin` 显式声明 `flowable-spring-boot-starter-process`，dev 配置开启 Flowable schema 自动更新和 schema 更新锁，并关闭异步执行器。
- 新增 `V3__flowable_workflow.sql`：扩展 `wf_model_meta.bpmn_xml`、`deployment_id`、`process_definition_id`、`version`，新增 `wf_approval_record` 审批记录表，并补充工作流业务索引。
- 重构 `scaffold-workflow`：新增 `WorkflowStatus`、`WorkflowRequests`、`BpmnTemplateService`，模型部署改为 Flowable BPMN 部署，流程定义从部署后的 `processDefinitionId` 绑定。
- 强化工作流完整性和权限：BPMN XML 强制校验可执行 `process id` 与 `modelKey` 一致；审批接口校验当前用户必须是任务处理人、候选用户或候选组成员；撤回动作仅允许流程发起人执行。
- 兼容旧已部署模型：定义列表会自动为 `deployed=1` 但缺少 `process_definition_id` 的旧模型补部署默认 BPMN，并回填 Flowable 部署 ID、流程定义 ID 和版本号。
- 新增流程实例闭环接口：`POST /api/workflow/instances/start` 发起实例、`GET /api/workflow/instances/{processInstanceId}/trace` 查询实例轨迹；待办改为按当前用户和角色候选组读取 Flowable task，审批后完成/终止流程并写入 `wf_approval_record`。
- 流程定义和待办接口改为从 BPMN XML 解析真实节点名称；流程轨迹在完成态补充“归档”结束节点，避免轨迹停留在最后一个人工审批节点。
- 保留旧演示数据兼容：没有 Flowable 历史实例的历史 `wf_business` 待办仍可展示、审批和查看静态轨迹，避免初始化种子数据失效。
- 前端流程模型页新增 BPMN XML 编辑和默认模板生成；流程定义页新增发起流程弹窗并展示真实 BPMN 节点；待办卡片和审批抽屉进度条使用后端返回的真实 BPMN 节点；审批抽屉优先按 `processInstanceId` 加载真实实例轨迹；API 类型支持字符串任务 ID。
- 工作流前端列表改为后端 keyword 查询和分页：流程模型、流程定义、我的待办、我的已办均具备查询、重置、分页、导出；待办页新增 loading 状态，避免接口加载时误显示空任务。
- 优化工作流 UI：隐藏非发起人的“撤回”动作，提交按钮增加提交中禁用，移除侧边栏固定待办角标，修复长业务编号/流程 key/审批意见可能撑破卡片或抽屉的问题。
- 待办接口和前端类型补充 `businessKey` 业务编号，待办页本地搜索同步支持业务编号，避免后端搜索命中后被前端二次过滤隐藏。
- Vite 开发代理新增 `VITE_API_PROXY_TARGET` 环境变量覆盖能力，默认仍指向 `http://localhost:8080`，便于本地端口冲突时验证当前后端实例。
- 更新 `docs/backend-architecture.md` 和 `docs/frontend-backend-integration.md`，补充 Flowable 架构状态、接口和字段中文说明。
- 完成验证：`mvn -pl scaffold-admin -am test` 通过 42 个后端测试；`npm run test:unit` 通过 18 个前端单元测试；`npm run build` 通过；浏览器在 `http://127.0.0.1:5177` 完成流程模型 BPMN 模板、流程定义发起弹窗、待办实例轨迹和审批提交冒烟，当前页面无 console error/warn，UI 烟测数据已清理。

## 2026-06-06 (性能与健壮性修复)

- 修复前端 Vite 代理端口：`vite.config.ts` 代理目标从 `localhost:18080` 改为 `localhost:8080`，与后端实际监听端口一致。
- 修复前端 `http.ts` import 顺序：将 `authSession` 的 import 语句移到模块顶部，修正不规范的 import 位置。
- 修复后端监控日志删除/清空权限标识错误：操作日志和登录日志的 DELETE 接口从错误的 `list` 权限改为正确的 `remove` 权限，防止只有查看权限的用户删除日志。
- 移除安全配置中 `/api/test/**` 的 `permitAll` 放行规则，生产环境不再暴露测试端点；将测试安全配置移入 `TestSecurityConfig` 仅在测试时生效。
- 增强全局异常处理器：新增 `HttpMessageNotReadableException`（JSON 格式错误返回 400）、`MethodArgumentTypeMismatchException`（参数类型错误返回 400）、`IllegalArgumentException`、`HttpRequestMethodNotSupportedException`（返回 405）、`NoResourceFoundException`（返回 404）和通用 `Exception`（返回 500 并记录日志）处理，防止堆栈信息泄露。
- 修复 JWT 解析异常静默丢弃问题：添加 debug 级别日志记录失败的 token 解析。
- 修复 DashboardService 登录趋势统计的潜在 NPE：对数据库返回的 `hourValue` 和 `total` 增加 null 检查。
- 为前端流程模型部署/删除、流程定义挂起/激活、待办审批、代码生成配置保存等异步操作补充 try-catch 错误处理，防止 API 异常导致页面无反馈。
- 继续清理前端残留演示交互：工作台、流程模型、流程定义、我的已办导出改为统一 CSV 下载；工作台待办“审批”跳转到真实待办页，不再伪造审批成功。
- 新增剪贴板工具 `copyText` 并接入代码生成预览弹窗，“复制当前”改为调用浏览器 Clipboard API，失败时给出明确错误提示。
- 参数配置和字典管理的“刷新缓存”类假提示改为真实重新加载列表；登录页“忘记密码”空链接改为“联系管理员重置密码”静态提示。
- 修复待办页流程进度 Vue prop 告警：新增 `normalizeFlowStep` 将后端返回的当前节点名称映射为进度索引，`FlowSteps` 支持数字和节点名称两类输入。
- 修复部门管理删除后的前端状态残留：新增 `removeDeptFromTree` 工具并接入部门删除流程，删除成功后立即从本地部门树剔除软删节点并切回父级/根部门，避免页面继续显示已删除部门。
- 修复监控日志前端关键词过滤健壮性：新增 `includesKeyword` 工具，登录日志过滤兼容空用户名/IP，操作日志过滤兼容空字段并纳入请求参数，避免 Vue update 阶段因 `null.includes` 报错。
- 修复移动端后台外壳样式：小屏侧栏强制图标化，隐藏顶栏搜索和用户姓名，收敛工作台/待办卡片、筛选框和流程进度条的固定宽度，消除移动视口内横向溢出。
- 优化字典管理行操作可见性：字典类型编辑/删除按钮在选中行、悬停和键盘聚焦时保持可操作，避免行操作完全依赖 `display:none` 的 hover 状态。
- 修复操作日志 CSV 导出契约：导出列新增“请求参数”，确保按 `request_params` 命中的日志导出后仍能看到筛选命中字段，并新增回归测试覆盖。
- 完成验证：`npm run test:unit` 通过 16 个前端单元测试，`npm run build` 通过，`mvn -pl scaffold-admin -am test` 通过 35 个后端测试；浏览器抽样验证工作台导出/待办跳转、流程模型/流程定义/我的已办导出、代码生成预览复制和待办页流程进度无当前页面 warn/error。
- 完成浏览器路由冒烟：在 `http://localhost:5175` 逐页打开工作台、系统管理、系统监控、工作流程和代码生成共 15 个主要路由，核心标题均加载成功，当前页面无 warn/error；移动 390px 视口复验工作台和我的待办，`.app-content` 无水平滚动。
- 完成真实浏览器写操作联调：在 `http://localhost:5175` 通过页面完成参数配置新增/编辑/删除、岗位管理新增/编辑/删除、流程模型新建/配置/部署/删除；浏览器控制台无来自当前前端的 warn/error，数据库核查 `sys_config`、`wf_model_meta`、`wf_business` 无测试残留，`sys_post` 无 `deleted = 0` 的有效测试残留。
- 扩展真实浏览器全功能联调：继续覆盖用户新增/编辑/重置密码/删除、角色新增/编辑/权限保存/删除、菜单新增/编辑/显示切换/删除、部门新增/编辑/删除、字典类型和字典数据新增/编辑/删除、操作日志和登录日志筛选/详情/导出/批量删除、代码生成导入表/配置保存/预览复制/下载、流程定义流程图/挂起/激活/导出、待办审批和已办导出；所有测试数据清理后无有效 `ui_smoke` 残留。
- 完成真实 API 写操作烟测：从配置解析 `scaffold_system` 数据库连接并查表结构后，通过 8080 实例完成认证、部门、岗位、角色、用户、菜单、字典、参数、流程模型、流程定义、临时待办审批、操作日志和登录日志共 12 类写操作验证，10 项测试数据清理成功，数据库无活跃 `smoke_` 残留。

## 2026-06-06

- 补齐监控日志写能力：新增操作日志/登录日志按 ID 删除和清空接口，前端批量删除、清空改为真实后端调用，并新增 `MonitorLogWriteApiTest`。
- 补齐监控日志导出：新增 `GET /api/monitor/oper-logs/export` 和 `GET /api/monitor/login-logs/export` CSV 下载接口，前端操作日志/登录日志导出按钮改为真实文件下载，并扩展 `MonitorLogWriteApiTest` 与前端 API 映射测试。
- 补齐用户管理操作接口：新增 `GET /api/system/users/export`、`PUT /api/system/users/{id}/status` 和 `PUT /api/system/users/{id}/password`，前端用户导出、批量启停、重置密码改为真实后端调用，并扩展 `SystemWriteApiTest` 与前端 API 映射测试。
- 修复角色删除校验：角色关联的用户已被软删除时，不再阻塞角色删除，避免角色管理中已无有效用户仍提示“角色已分配用户”。
- 新增统一数据权限能力：增加 `@DataScope` 注解、`DataScopeAspect` 切面、`DataScopeCriteria` 上下文和 `DataScopeResolver` 解析接口，系统模块按当前用户角色合并 `ALL`、`DEPT`、`DEPT_AND_CHILD`、`SELF`、`CUSTOM` 数据范围，并接入用户列表和用户 CSV 导出。
- 新增统一操作日志能力：增加 `@OperLog` 注解、`OperationLogAspect` 切面、`OperationLogRecorder` 记录接口和 JDBC 写入实现，覆盖系统管理、账号改密、工作流和代码生成写接口；操作日志请求参数自动脱敏 `password`、`token`、`secret`、`authorization` 等敏感字段，并支持按请求地址和请求参数检索。
- 补齐代码生成数据库表导入：新增 `GET /api/tool/generator/importable-tables` 和 `POST /api/tool/generator/import`，通过 `information_schema` 导入 `gen_table` 与 `gen_table_column`，前端导入弹窗改为真实接口，并新增 `GeneratorImportApiTest`。
- 补齐代码生成 zip 下载：新增 `GET /api/tool/generator/tables/{id}/download`，生成 Entity、Mapper、Service、Controller、前端 API、Vue 列表页和菜单 SQL 文件压缩包；前端“生成/下载全部”改为真实下载。
- 补齐流程模型写能力：新增模型创建、编辑、删除接口，前端流程模型页新增真实新建/配置/删除弹窗交互，并新增 `WorkflowModelWriteApiTest`。
- 新增当前用户修改密码接口 `PUT /api/auth/password`，校验 `oldPassword` 后加密写入 `sys_user.password`；顶部栏修改密码弹窗改为真实接口，成功后退出重新登录，并扩展 `AuthApiTest` 与前端 API 映射测试。
- 清理顶部栏和登录页残留演示交互：搜索改为真实路由跳转，应用按钮改为快捷入口，通知读取工作台真实待办，个人中心展示当前登录用户信息，登录页文案改为测试账号提示。
- 补齐前端通用 CSV 导出工具：新增 `toCsv`/`downloadCsv`，将角色、岗位、菜单、部门、字典数据、参数配置和代码生成列表的假导出提示改为真实 CSV 文件下载，并新增 CSV 转义单元测试。
- 将 `scaffold-vue/src/data/index.ts` 从历史 Mock 数据文件收敛为类型、侧边栏导航和头像色板定义，页面数据源均走 API。
- 更新 `docs/frontend-backend-integration.md`、`docs/backend-architecture.md` 和后端开发计划状态，补充新增接口字段中文说明。
- 完成验证：`npm run test:unit` 通过 9 个前端单元测试，`npm run build` 通过，`mvn -pl scaffold-admin -am test` 通过 34 个后端测试，`mvn -pl scaffold-admin -am package -DskipTests` 打包成功，并在 `http://127.0.0.1:18080` 完成登录、工作台、工作流、生成器导入候选、生成器 zip 下载、数据权限过滤、软删用户后角色删除、改密错误校验、用户停用登录拦截、用户重置密码登录、用户 CSV 导出、操作日志自动写入与敏感字段脱敏真实接口烟测。

## 2026-06-05

- 初始化 `scaffold-system` 后端 Maven 多模块工程，新增 `scaffold-common`、`scaffold-framework`、`scaffold-system`、`scaffold-generator`、`scaffold-workflow`、`scaffold-admin` 模块。
- 新增 `ScaffoldAdminApplication`、`GET /api/health` 健康检查接口、统一响应模型 `R`、分页模型、业务异常、全局异常处理和 traceId 过滤器。
- 为后端基础能力新增 JUnit 测试，覆盖统一响应、分页参数、分页返回、健康检查、traceId 和业务异常响应，并完成 Maven 测试、打包和本地 jar 启动验证。
- 新增 早期后端开发计划（历史资料），基于现有文档和 `scaffold-vue` 前端 Demo 反推 `scaffold-system` 后端工程结构、数据库、接口、模块开发顺序和验收计划。
- 新增 `scaffold_system` MySQL 数据库初始化脚本 `V1__init_schema.sql` 和 `V2__seed_system_data.sql`，创建系统用户、角色、菜单、部门、岗位、字典、参数、日志、代码生成和工作流元数据等基础表，并写入 BCrypt 密码种子数据。
- 为 `scaffold-admin` dev 环境补充 MySQL 与 Redis 配置，完成表结构、审计字段、种子数据行数和用户数据的数据库校验。
- 实现后端认证接口：`POST /api/auth/login`、`GET /api/auth/me`、`GET /api/auth/routes`、`POST /api/auth/logout`，支持 JWT、Redis token 会话、登录/登出日志和动态菜单路由。
- 新增 `TokenStore` 并让 JWT 过滤器校验 Redis 会话状态，保证登出后的旧 token 无法继续访问受保护接口。
- 扩展认证集成测试，覆盖登录成功、登录失败、未带 token、动态路由、登出和登出后 token 失效；完成 Maven 测试、打包和真实 HTTP 验证。
- 新增系统管理只读接口：用户分页、角色分页、菜单树、部门树、岗位分页、字典类型分页、字典数据、参数配置分页，以及操作日志/登录日志分页查询。
- 新增 `SystemManagementMapper`、`SystemManagementService`、`SystemManagementController` 和 `MonitorController`，通过 SQL 聚合返回前端需要的 `deptName`、`postName`、`roleName`、`userCount` 等展示字段。
- 开启 MyBatis `call-setters-on-nulls`，保证 Map 响应中 `lastLogin` 等空值字段仍保留，稳定前端接口字段契约。
- 新增 `SystemReadApiTest` 集成测试，覆盖系统管理只读接口的分页、树结构、字典、配置和日志响应，并完成 Maven 测试、打包和真实 HTTP 抽样验证。
- 将 dev 环境 `com.scaffold` 日志级别从 `debug` 调整为 `info`，减少接口运行时 SQL 调试日志刷屏。
- 优化 `admin-redesign` 事项详情交互，将全屏模糊遮罩小弹窗改为非阻断右侧详情抽屉，保留主页面可见性并补充事项摘要、处理上下文和流转记录。
- 补全 `admin-redesign` 静态页面所有可见按钮的前端交互：全局搜索、环境切换、用户菜单、顶部导航、数据刷新、台账筛选、事项详情、通过/驳回、侧栏查看全部、审计中心与审计详情。
- 为 `admin-redesign` 新增命令搜索弹层、顶部下拉菜单、详情/列表弹窗和 Toast 反馈，保证按钮点击均有可见结果。
- 新建 `admin-redesign` 独立前端原型目录，从零创建 React + Vite 静态后台管理页面，不复用现有 `scaffold-vue` 代码。
- 按用户确认的高级发散方向实现 `Editorial Control Desk` 风格后台首页，包含顶部编辑式导航、指标条、审批与权限台账、权限风险、流程积压、生成器状态和实时审计日志。
- 为 `admin-redesign` 增加基础交互：导航选中、台账筛选、行选中联动审计事项、刷新时间更新。
- 新增 `admin-redesign/design-qa.md`，记录构建、浏览器可访问性树、视觉方向和交互验证结果。
- 按用户要求删除 `admin-redesign` 前端改造项目及其全部文件，停止对应 Vite 本地服务；保留原始静态 HTML 目录和当前项目其他文件。
- 新增 `admin-redesign` 前端项目，将 本地原型目录 的静态 HTML/CSS/JS 原型转换为 Vue 3 + Vite + TypeScript 架构。
- 将静态原型样式迁入 `admin-redesign/src/styles/prototype`，保留原型视觉语言并通过 Vue 页面复用。
- 新增 `admin-redesign/src/api`、`components`、`directives`、`layouts`、`mock`、`router`、`stores`、`types`、`utils`、`views` 等规划目录。
- 将原型布局转换为 `AdminLayout.vue`，将登录、工作台、系统管理、监控、工作流和代码生成页面按业务域拆分到 `views`。
- 新增 `BaseButton`、`BaseTable`、`SearchForm`、`FormDialog`、`StatusTag`、`PermissionButton`、`DictSelect` 等统一组件。
- 新增 `docs/admin-redesign-architecture.md`，说明静态原型资源到 Vue 规划架构的转换关系和关键字段中文含义。
- 修正 `admin-redesign` 的复刻精度：将图标体系替换为原型自定义 SVG path，按原型结构重写登录页、工作台和用户管理页，并将用户 mock 数据扩展为接近原型的 56 条。
- 为满足一比一复刻要求，新增 `admin-redesign/public/exact-prototype`，完整复制 本地原型目录 静态原型资源，并将 `admin-redesign` 默认入口切换为该原型基准渲染。
- 将 `admin-redesign` 默认入口切回真实 Vue 渲染，按原 HTML 原型的 class、布局和内容结构重做登录页、后台布局、工作台、用户、角色、菜单、部门、字典、参数、日志、工作流和代码生成等页面。
- 新增 早期产品技术规划（历史资料），规划 Spring Boot + Vue 后台管理脚手架的产品定位、技术栈、架构、核心模块、数据库原则、接口原则和迭代路线。
- 新增 `docs/prd.md`，整理后台管理脚手架的用户角色、核心流程、功能需求、页面规划、非功能需求和 MVP 验收标准。
- 新增 `scaffold-vue` 前端 Mock Demo，包含 Dashboard、RBAC + 数据权限管理、Flowable 审批中心等核心页面。
- 新增 早期前端 Demo 实现计划（历史资料），记录前端 Demo 实现计划。
- 将 `scaffold-vue` 前端 Demo 的菜单、页面标题、按钮、表格、工作流和占位模块等用户可见文案统一调整为中文。
- 补齐 `scaffold-vue` 前端 Mock 页面：用户管理、菜单管理、部门管理、字典管理、代码生成、流程模型、流程定义、审计日志、系统设置。
- 为前端 Demo 增加本地点击交互：筛选、重置、新增、编辑、状态切换、角色分配、代码预览、流程部署、审批操作、日志导出和系统设置保存。
- 新增 `scaffold-vue/src/utils/exportCsv.ts` 通用 CSV 导出工具，并为所有表格页面补充导出入口。
- 在产品技术规划和 PRD 中补充通用表格能力，明确所有列表页默认支持导出当前筛选结果。
- 新增项目级 `AGENTS.md`，将统一组件复用、统一设计语言、前后端通用能力复用定义为必须遵守的开发准则。
- 在产品技术规划中补充强制开发准则，明确新增功能优先复用或扩展通用能力。
- 补齐 `admin-redesign` 岗位管理页面、导航、路由、权限标识和 mock 数据，并按静态原型修正岗位数据、表格选择列、排序图标、分页控件与标题栏布局，修正系统管理侧边栏菜单顺序不一致的问题。
- 按静态原型重做 `admin-redesign` 菜单管理页，将扁平表格改为菜单树结构，补齐展开/收起、树形缩进、目录/菜单/按钮标签、显示开关和图标操作列，并按原型菜单树数据恢复可见行顺序。
- 启动逐页逐组件视觉审计，批量生成 Vue 与静态原型截图和 DOM 摘要；按审计结果重做部门管理、操作日志与登录日志的可见结构、文案、表头、筛选区、数据和分页控件。
- 按静态原型区分流程模型与流程定义、我的待办与我的已办页面，补齐流程定义表头、数据、状态与操作按钮，以及我的已办表格、审批结果和分页结构。
- 修正我的已办页多余筛选卡，保持与静态原型一致的单表格卡片搜索结构。
- 机械导出静态原型 `data.jsx` 为 `prototypeData.ts`，让用户、角色、部门、菜单、岗位、字典、参数和代码生成列表复用原型同源数据，避免可见内容漂移。
- 将流程模型和待办/已办页面切换为 `prototypeData` 同源流程数据，修正模型、待办卡片和代码生成等页面的可见数据差异。
- 为参数配置页补齐与原型一致的分页条和每页条数选择器。
- 为 `scaffold-system` 新增后端权限注解能力：`@RequiresPermission`、权限解析器、AOP 拦截器和 403 统一异常响应，实现后端接口级权限校验。
- 补齐系统管理写接口：用户、角色、菜单、部门、岗位、字典类型、字典数据和参数配置的新增、修改、删除接口，复用统一响应、统一分页、JWT 会话和权限注解。
- 为系统管理写接口新增集成测试 `SystemWriteApiTest` 和 `SystemCatalogWriteApiTest`，覆盖低权限用户拒绝访问、用户/岗位 CRUD、角色/部门/菜单/字典/参数配置 CRUD。
- 完成 `scaffold-system` 后端全量验证：`mvn -pl scaffold-admin -am test` 通过 18 个测试，`mvn -pl scaffold-admin -am package` 打包成功，并在 18080 端口完成真实 HTTP 登录、权限拒绝、角色 CRUD 和参数配置 CRUD 冒烟。
- 为 `scaffold-vue` 新增真实后端 API 客户端、认证 API、会话存储工具和系统管理 API 封装，新增 `npm run test:api` Node 原生测试，覆盖统一响应、Bearer token、业务错误、认证接口和系统管理端点映射。
- 将 `scaffold-vue` 登录页从本地 Mock 登录改为真实后端登录、当前用户拉取和退出登录，Vite dev server 新增 `/api` 到 `localhost:18080` 的代理。
- 将 `scaffold-vue` 用户、角色、菜单、部门、岗位、字典、参数配置页面接入真实后端读写接口，并用 Playwright 真实验证用户、角色、菜单、部门、岗位、字典、参数配置 CRUD。
- 将 `scaffold-vue` 操作日志和登录日志页面接入真实后端只读分页接口，并完成浏览器访问验证。
- 新增 `docs/frontend-backend-integration.md`，记录已接入页面、接口字段中文说明和仍使用 Mock 的后续模块。
- 新增 Dashboard 后端真实接口 `GET /api/dashboard/summary`，返回统计卡、24 小时趋势、待办和最近动态。
- 将工作流代码落入 `scaffold-workflow` 模块，新增流程模型、流程定义、待办、已办、审批和审批记录接口，并补充集成测试。
- 将代码生成器代码落入 `scaffold-generator` 模块，新增生成表、字段、预览、配置保存和生成确认接口，并补充集成测试。
- 扩展 `V2__seed_system_data.sql`，补充 `wf_model_meta`、`wf_business`、`gen_table`、`gen_table_column` 示例数据，保证新库初始化后工作流和代码生成页面有真实数据。
- 新增 `scaffold-vue/src/api/portal.ts` 和 API 映射测试，将工作台、工作流、代码生成器页面从前端 Mock 切换为真实接口。
- 新增 `docs/backend-architecture.md`，说明后端 Maven 模块、包类类型、业务边界和主要字段中文含义。
- 完成验证：`npm run test:api` 通过 8 个前端 API 测试，`npm run build` 通过，`mvn -pl scaffold-admin -am test` 通过 21 个后端测试，并完成真实后端与 Vite `/api` 代理接口联调。
