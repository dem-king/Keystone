# 欢迎链 v2 设计方案：把「身份」纳入登录转场

> 状态：**已实施（2026-10-19）**。落点文件 `keystone-vue/src/components/welcome/{WelcomeChain,WarpTransit}.vue`、`composables/{welcome,motion}.ts`、`views/Login.vue`、`styles/pages.css`。
> 实测：点击登录 → 全部落定 ≈ 12.1s（设计稿按「点击」估算为 12s，按「脱出释放」估算 7.9s）。
> 验证脚本：`keystone-vue/scripts/verify-welcome-v2.mjs`（十拍逐帧 + 断言）、`scripts/check-narrow.mjs`（<760 降级）。

## 1. 一句话

星星先落到右上角「你」的位置，绽开成一张工牌亮出**所属部门**；随后收束成流星坠向中央，打出问候语与用户名；名字在中央**一分为二**——主份随问候语归位到页面标题，副份飞回右上角变成用户胶囊。

叙事从「一颗星炸开成一句问候」升级为「**你从哪来、你是谁、你落到哪**」：右上角是身份，左上角是工作，中间是这句话。

## 1.5 上游新增：按钮圆 → 星球（补于 2026-10-19）

**现状断层**：对勾圆随登录页淡出消失，约 0.9s 后 `WarpTransit` 在视口正中凭空点亮一颗 hero 星——两者没有因果关系，用户看到的是「按钮演完了，然后另起一段」。补上这段之后，全程只有**同一颗星**：

```
按钮收拢成圆 → 圆化成星 → 星飞入暗场 → 曲率穿越 → 脱出到 chip（你自己）
```

### 分镜（相对「点击登录」）

| # | 段 | 起 | 时长 | 画面 | 缓动 |
| --- | --- | --- | --- | --- | --- |
| P-3 | 收拢 | 0.00 | 0.42 | 按钮宽 → 46px 圆（现有） | `EASE.swap` |
| P-2 | 描勾 | 0.34 | 0.50 | 圆环描边 + 对勾描出（现有，已与上一段重叠） | `EASE.reveal` / `settle` |
| P-1 | 化星 | 0.84 | 0.34 | 对勾 path 缩成光点并吸入圆心；圆环 stroke 向外扩一圈淡出；**蓝壳褪去**（`--blue` → 白核 + 青柠晕，0.22s）；球体与外发光长出 | `power2.in` → `expo.out` |
| P0 | 起飞 | 1.18 | 0.62 | 星球自按钮位置飞向视口正中（正好是时钟圆心），`scale 1 → 1.35`（46 → 62），向后撒尾迹粒子；天幕同期淡入 0.34s | `expo.out` |
| P0b | 融入 | 1.80 | 0.12 | 抵达中央，缩到 hero 视觉尺寸（≈56px），canvas hero 同点同色点亮，DOM seed 淡出 | `none`（等量交叉） |

之后接原链路：光丝加速 0.55s → 巡航等 swap → 减速 → 脱出到 chip。登录侧总等待增加 **0.39s**（原 `startTransit` 后 0.69s 起加速，现 1.08s）。

### 关键决策

1. **不搬运按钮，让星球从圆里长出来。** `.success-orb` 本体留在登录卡里随页面淡出；`WarpTransit` 在 `startTransit()` 的同一帧量它的位置，创建**同点同尺寸**的 `.transit-seed`，并把本体立刻压到 `opacity: 0`。页面淡出与星球起飞从此互不牵连——否则 `playLoginDissolve` 会把正在起飞的星球一起拖暗。
2. **蓝色必须褪掉。** 按钮的蓝是 UI 语汇，星球是能量语汇（与穿越、脱出、坠落同色）。0.22s 完成 `--blue` → 白核 + 青柠晕，读作「外壳剥落、露出内核」。保留蓝色会让后面整条链突然换色。
3. **落点是时钟圆心。** 登录页正中本来就有一枚发光表盘，星球落在它的圆心等于「接管这颗表盘」；随后整页淡出，星球成为唯一亮体。这不是巧合，是让两个视觉主体交接而不是叠加。
4. **对勾是燃料，不是残留。** 对勾缩成光点被吸进圆心、圆环外扩消散——「结 Crystallize」转「放 Discharge」的过渡，而不是两个动画各自收尾。
5. **切路由时点要重新定。** `Login.vue` 里的 `await wait(250)` 原本是「光丝加速建立速度后再切」，新增 0.96s 前置段后会变成星球还在飞就切页。改为等 `transitIgnited` 信号（`WarpTransit` 在加速段起点置位）+ 250ms 余量，2s 超时兜底。

### 新增信号

```ts
// composables/welcome.ts
export const transitIgnited = ref(false) // 光丝加速段开始（星球已融入中央）
// beginHandoff() 里复位为 false
```

### seed 实现

```html
<div ref="seed" class="transit-seed" />
```

- 样式复用 `.welcome-orb` 的配方（三层径向 + 双层外发光），**另起类名**避免跨组件耦合；基础尺寸 46px。
- 定位：`position: fixed; left: 0; top: 0`，GSAP `x/y` 落在「中心 − 半径」，与现有 `.welcome-orb` 同一套坐标约定。
- 起飞前一帧 `gsap.set(seed, { x: orbCX - 23, y: orbCY - 23, scale: 1, opacity: 1 })`，与 `.success-orb` 像素级重合。
- 尾迹复用 `heroTrail` 的绘制（线宽递减短尾），起点改到按钮，方向沿飞行切线。

### 与欢迎链的关系

这一段不改变 §3 的双归宿设计，只把「星从哪来」补上。欢迎链的 P1 依旧等 `transitReleased`，坐标依旧取 chip 头像中心；`transitReleased` 整体后移约 0.39s，`ARRIVE_BUDGET` 已在 §6 计入。

> 实施备注（与设计稿的差异）：
> 1. 工牌只保留「所属部门 + 部门名」两行，**没有做昵称与 @username**——五行信息会变成名片，而且昵称在上方标题里已经有了。
> 2. 工牌收束点取 chip **头像中心**（不是工牌右缘）：右缘贴着屏幕边，星从那儿冒出来会读成「屏幕发光」而不是「你发光」。
> 3. `playShellEntrance` 不再压 chip 的 opacity，改由 WelcomeChain 在子组件 `onMounted` 里压——外壳若也压一次，窄屏「链条跳过」时就没人把它拉回来。
> 4. 实测「打字 → 分裂」这一段比设计多约 1.4s（`typeOut` 的 ease 让尾字变慢），整体 12.6s；嫌长可先动 §3 的三个旋钮。
> 5. **最终形态是「气泡」，不是横条**（用户反馈横条不够好）。星球从头像滑下、往右下摊开成 190×64 的部门气泡：挂在胶囊正下方 10px、右缘对齐胶囊，带尖角指向头像，内容两行（标签 + 部门名）逐字落下。横条方案作废——它必然盖住搜索框与外观按钮，且与顶栏同高同材质，读作「顶栏被替换了一块」而不是「一张牌子浮起来」。
> 8. **两处撞击都要「压扁 / 冲击环 / 碎屑」三件套。** 星落到胶囊只绽一圈微光环，读作「旁边冒了个圈」；补上压扁与回弹，冲击环才有受力点。副份归位同理：落点要有双环 + 碎屑 + 星野提亮，并且**头像从 0.3 过冲到 1**——用户要的「由小变大显示」就是这一步，`restoreChip` 必须一并清掉头像的 transform。
> 9. 工牌**不放头像**（用户要求）：星球撞击 → 部门气泡，中间不出现人脸；气泡宽度因此从 190 收到 156，尖角改对齐气泡左缘（`bubbleLeft + 12`）而不是头像中心。
> 7. **分裂改成字符级**：整段一起复制读作「多了一份」，逐字错开才是「裂开」。主副两份都拆成 `<span>`，`ghost` 的字号/字重/字距**从主份逐项复制且不加 scale**——早期用 `scale 1.05` + 字距 `.2em`，两份看起来不一样大。字距必须写 `-0.03em` 而不是读 computed 的 `-0.84px`（会被舍成 `-1px`）。光缝高度按字号算（`fontSize × 1.35`），不要用 inline 盒的 rect（会把 line-height 和负字距都算进去，实测 63px）。
> 6. 气泡的展开不是「宽度补间」：`left / top / width / height / border-radius` 五属性同一条 0.54s `power3.out` 补间，轨迹是「向下垂落 + 向右摊开」，端点从 48×48 正圆（与星球同尺寸）变成 190×64 圆角矩形；收束按原路收回成圆、升回头像位置，星再从圆里过冲弹出。

## 2. 链路对比

| | 现链路 | v2 链路 |
| --- | --- | --- |
| 起点 | 脱出星落在视口右上空白处 `(vw-150, 116)` | 脱出星落在 **`.user-chip` 头像中心** |
| 第二段 | 直接坠落中央 | **绽放光环 → 工牌向左展开（部门）→ 收束成星** |
| 中段 | 炸开 → 浮牌 → 打字 → 刻度 | 同左（不变） |
| 归位 | 整块浮牌回标题 | 名字**分裂**：主份回标题，副份回 chip |
| 交接 | 浮牌 ↔ 标题 | 浮牌 ↔ 标题 **＋** 副份 ↔ chip 双向交叉 |
| 运动主体 | 星、浮牌 | 星、工牌、浮牌、名字副份（**依旧不画轨迹线**） |

## 3. 分镜表

时间从 `transitReleased`（脱出星抵达）起算，单位秒。缓动沿用 `composables/motion.ts` 的 `EASE` 语汇。上游泳按钮 → 星球的两拍（P-1 / P0 / P0b）不在本表内，见 §1.5。

| # | 段 | 起 | 时长 | 画面 | 缓动 |
| --- | --- | --- | --- | --- | --- |
| P0 | 待命 | — | — | 隐藏浮牌 / 星球 / 冲击环 / 柔光 / **真实 chip**；等 `transitReleased` | — |
| P1 | 星归·撞击 | 0.00 | 0.72 | 穿越层光点在同点交接（坐标同源），先长到 0.78，落定瞬间**压扁**（`scaleX 1.34 / scaleY 0.56`）再 `back.out(3.2)` 回弹；双冲击环（4.2 / 3 倍）+ 柔光闪 + 26 颗碎屑 + 星野提亮 | `power3.in` → `back.out` |
| P2a | 展开 | 0.62 | 0.34 | 圆点 → 工牌：右边缘锚定 chip 右侧，**向左**展开到自然宽度；圆角 999→15，玻璃底渐显，整体上浮 8px 脱离顶栏平面 | `expo.out` |
| P2b | 部门 | 0.90 | 0.30 | 小标签「所属部门」（10.5px / letter-spacing .1em / soft）+ 部门名（14px / 660）自右向左 clip 显形；玻璃扫一道 sheen | `power3.out` |
| P2c | 昵称 | 1.04 | 0.22 | 第二拍：昵称（15px / 700）+ `@username`（11.5px / soft）淡入，与部门叠 0.08s 形成层次 | `power2.out` |
| P2d | 阅读 | 1.26 | 0.30 | 停住。部门净可见 ≈ 0.62s（P2b 起算），**这段不能省**，否则「先展示部门」看不见 | — |
| P3 | 收束 | 1.56 | 0.24 | 工牌 `scaleX → 0.05` 收成一条竖光；16 颗粒子被**吸入**收束点；orb 在收束点重新点亮成 30px 亮核 | `power3.in` |
| P4 | 坠落 | 1.80 | 0.92 | 从 chip 中心抛物线坠向视口中央（先向外抛 24px 再内收，避免贴顶栏走）；`scale 0.5→1.4`、`rotation -18→8`；canvas 缎带尾 | `power2.in` |
| P5 | 迸溅 | 2.72 | 0.50 | 蓄力压扁 → 炸开：双冲击环 + 14 道放射光束 + 柔光 + 星野照亮；浮牌 `back.out(1.6)` 自爆点长出；玻璃 sheen | 同现状 |
| P5b | 停顿 | 3.22 | 0.12 | 呼吸拍 | — |
| P6 | 打字 | 3.34 | 0.96 | 整句问候语 `typeOut`（非匀速）；每写一字重新居中；轨道双卫星 + 牌底粒子上浮 | `power2.out` |
| P7 | 分裂 | 4.30 | 0.52 | 刻度线正向展开；名字**拆成单字**，奇偶交错上下各颤 3.5px；名字中心亮一道 3px 光缝（白芯 + 双层绿光，`scaleX 1.6→2.4` 张开淡出）；副份逐字向右上错开（`x 3+i*4.5`、`y -2-i*3`、stagger 0.035，`rotation -2.4°`）；分裂点炸 14 颗碎屑 | `back.out(2.6)` / `power2.in` |
| P8 | 双归宿 | 4.68 | 1.08 | 主份：`fallHome`（1.0s，`expo.out` 吸附）；副份：飞向 chip 昵称位（1.08s，两段 keyframes）；两者同帧起飞，副份晚 0.06s 建立主次 | `power2.out` → `expo.out` |
| P9 | 落定·撞击 | 5.76 | 0.65 | 主份 `landPulse`（1.012→1）+ 粒子散开；副份砸进胶囊：双冲击环从胶囊扩散（3.6 / 2.5 倍）+ 26 颗碎屑，chip 0.12s 亮起，**头像从 0.3 过冲到 1**（`back.out(2.8)`） | `back.out` / `none` |
| P10 | 交接 | 6.18 | 0.46 | 玻璃底化掉（0.26s）→ 浮牌与真实标题等量交叉（0.28s，`linear`） | `none` |
| P11 | 收尾 | 6.64 | 0.20 | 撤 canvas、清残余内联值、`emit('done')` | — |

**总时长 ≈ 6.86s**（现 ≈ 5.3s，多 1.5s）。

压缩旋钮（若嫌长，按序启用）：P2d 0.30→0.22、P4 0.92→0.82、P6 0.96→0.86，合计 → **6.5s**。不建议动 P1 与 P2b，那两段是这次改造的语义主体。

## 4. 关键设计决策

1. **落点是 chip 的头像中心，不是 chip 中心。** 头像代表「人」，昵称和部门是注解。星打在头像上才像「找到你了」。
2. **工牌向左展开。** chip 贴右边缘，向右必然出界。右手边锚定、向左生长，视觉上是「从屏幕边缘抽出一张工牌」，也顺手把被截断的部门名完整展示一次（chip 里部门常被 `1080px` 断点隐藏或省略号截断，这是这段动画的信息价值）。
3. **收束成星，不是淡出。** 工牌缩成一条竖光再膨胀成流星弹头，把「身份信息」转成「能量」，坠落才有起因。淡出会让下半段像是另起一段。
4. **分裂必须有语义。** 名字本来就属于两个地方：页面标题里有它（「下午好，爸爸」），右上角胶囊里也有它。分裂是这个事实的可视化，不是装饰。因此主份**不位移**（留在句子里），副份才飞走。
5. **副份不加描边、不加发光。** 浅色主题下发光文字会糊成一团。分裂感靠三件事：字距撑开、主副分离、副份轻微缩小（`1.05 → 1.0` 到落点的 `0.446`）。仍可用极淡的 lime 阴影（`0 0 12px rgba(130,221,45,.18)`）只在浅色主题下跳过。
6. **两条归宿同时起飞。** 先回标题再走副份会让总时长叠加 1s；同帧起飞、副份晚 0.06s，既有主次又不拖。

## 5. 实现拆解

### 5.1 共享锚点（避免两颗星）

`WarpTransit` 的脱出段与 `WelcomeChain` 的起点必须同源，否则会出现「一颗星飞到一半、另一颗星从别处冒出来」。

- `WarpTransit`：`HERO_TO` 由常量改为运行时量取 `.user-chip .avatar`（或 `.user-chip` 左端 + 16）；量不到（未挂载 / 窄屏隐藏）回落现有 `(vw-150, 116)`。
- `WelcomeChain`：P1 起点用同一套量法；量不到用同一回落值。
- 量位时若 chip 仍带壳层入场的 `y` 位移，用 `rect.top - (gsap.getProperty(chip, 'y') || 0)` 反推布局位置，避免落点差 8~10px。

### 5.2 真实 chip 的让位与接管

chip 在 `playShellEntrance` 里属于 `.topbar > *`，会被 stagger 淡入——必须在入场阶段就把它排除，否则会与欢迎链的接管打架（两条 tween 同帧写 `opacity`，表现为抖动）。

```ts
// motion.ts · playShellEntrance
const top = frame.querySelectorAll('.topbar > *:not(.user-chip)')
// strong 且存在 chip：显式压到 0，交给欢迎链拉起
if (strong) gsap.set(frame.querySelectorAll('.user-chip'), { opacity: 0 })
// skipMotion 分支：clearProps('opacity')，保证减少动态时 chip 可见
```

接管与还原都由 `WelcomeChain` 负责（与它已经操作 `.page-title` 的做法一致）：

- 挂载第一帧：`gsap.set(chip, { opacity: 0 })`（同时 CSS `.welcome-chip-hidden` 兜底）
- P9：`gsap.to(chip, { opacity: 1, duration: 0.28, ease: 'none' })` 与 ghost 淡出同步
- `finish()` 与所有提前 return 分支：`gsap.set(chip, { clearProps: 'opacity' })`
- `AppShell.onWelcomeDone` 再补一次（安全阀兜异常）

### 5.3 工牌 DOM 与展开几何

```html
<div ref="idcard" class="welcome-idcard">
  <span ref="idcardGlass" class="welcome-idcard-glass" />
  <Avatar :name="name" :size="34" />
  <span class="welcome-idcard-body">
    <span class="welcome-idcard-label">所属部门</span>
    <span ref="idcardDept" class="welcome-idcard-dept" />
    <span class="welcome-idcard-user" />
  </span>
</div>
```

- 复用 `ui/Avatar.vue`：同一 hash 取色、同一取字规则，保证工牌头像与 chip 头像**同色同字**，交接时无跳色。
- 几何：右边缘 = `chipRect.right - 2`；垂直中心 = `chipRect.top + chipRect.height / 2 - 8`（上浮 8px）；高度 50，圆角 15，`padding: 8px 16px 8px 8px`。
- 展开宽度：先 `opacity: 0` 渲染一次量自然宽（`max-width: 320px`），再 `set width: 40` 播放到测得值。不要补间到 `auto`。
- 部门名溢出：`white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 210px`。部门名过长时仍需保证 `所属部门` 标签完整。
- 兜底文案：`deptName` → `@username`（标签改「当前账号」）→ 「已登录」。三者都空时整段跳过（P1 直接接 P4）。

### 5.4 名字拆分与分裂

**打字阶段就分成两个 span**，不要等分裂时再重排 DOM（会有一帧重排风险，且与打字光标位置打架）。

```html
<span class="welcome-line">
  <span class="welcome-greet">
    <span ref="leadEl" class="greet-lead" />
    <span ref="nameEl" class="greet-name" />
  </span>
  <span class="welcome-caret" />
</span>
```

```ts
const chars = [...line.value]          // 按码点切，兼容 emoji
const nameChars = [...name.value]
const boundary = chars.length - nameChars.length
// typeOut 的 write 回调里按 boundary 分写两个 span
```

- 分界补偿：`.greet-name { margin-left: -0.03em }`（行尾 `letter-spacing` 在 span 边界不再折抵，负值会吃掉最后一字，实测确认后取 ±1px 修正）。
- 分裂：`nameEl` 字距 `letter-spacing: 0 → .14em`（`power2.out` 0.12s），主份 `y: 1`。
- ghost：`.welcome-name-ghost`，`position: fixed`，初始 `left/top` 取 `nameEl` 的 rect，`transform-origin: center`，字号与 `.welcome-greet` 完全一致。
- ghost 动画（P7c）：`x +10 / y -8 / rotation -3.5 / scale 1.05`（`back.out(1.4)` 0.30s），字距同步到 `.22em`。
- 名字为空 / 长度 0：跳过 P7c 与副份，P8 只走主份。

### 5.5 副份飞行与双向交叉

- 终点：`.user-chip .user-name` 的 rect；不可见（`1080px` 以下 `user-meta` 被 CSS 隐藏）时回落到头像中心。
- 缩放比按目标字号实时算：`scaleEnd = 目标字号 / 28`（窄屏 22 起算），**不写死 0.446**。
- 路径两段：`0.36s` 向外（`x +170, y -120`，`power2.out`）→ `0.72s` 吸附落点（`expo.out`）。落点用**中心对齐**（ghost 中心 ↔ 目标文字中心），不用 left/top，避免 baseline 与 padding 造成 1~2px 偏差。
- 交叉：`ghost.opacity 1→0` 与 `chip.opacity 0→1` 同时长（0.28s）同缓动（`none`），总亮度恒 1。
- 若目标不可见：ghost 收到 `scale 0.28` 后淡出（0.2s），chip 淡入同时进行，不做位置级交叉。

### 5.6 canvas 扩展：吸入粒子

现有粒子只有「从点发出」。P3 需要「被吸向点」：

```ts
interface Particle { /* 现有字段 */ pull?: { x: number; y: number; k: number } }
// 每帧：p.vx += (pull.x - p.x) * pull.k * dt
//       p.vy += (pull.y - p.y) * pull.k * dt
```

`sprayIn(cx, cy, n, { radius, k })`：在 `radius` 环带内随机撒点，朝 `(cx, cy)` 加速，末段 `(1-t)²` 淡出。**不复用 `spray`**，方向逻辑相反。

### 5.7 降级矩阵

| 条件 | 处理 |
| --- | --- |
| `prefers-reduced-motion` | `.welcome-layer { display: none }`（现有）→ `finish()`；chip 保持可见 |
| 视口 < 760px | 同上（现有 CSS 已隐藏整层） |
| 760–1080px | 播放，但 `.user-meta` 不存在：工牌仍完整展示部门（独立 DOM），副份落点回落头像中心，缩到 0.28 后淡出 |
| 无 `deptName` | 标签改「当前账号」，正文 `@username` |
| `transitReleased` 3s 兜底超时 | 跳过 P1（把 P1 压到 0.15s），避免与仍在校飞的 hero 双星 |
| 打字中断 / 路由提前切换 | `finish()` 前统一 `clearProps` chip、标题、ghost |

## 6. 参数与预算

| 参数 | 现值 | v2 | 说明 |
| --- | --- | --- | --- |
| `ARRIVE_BUDGET`（`welcome.ts`） | 4200 | **5400** | 到「浮牌浮现完」= swap 后 ≈1.3s（穿越）+ 3.22s（P1–P5）≈ 4.5s，留 0.9s 余量；§1.5 的星球段在前，不占这份预算 |
| `transitIgnited` | — | 新增 | 光丝加速起点置位，`Login.vue` 用它替代裸 `wait(250)` |
| 星球 seed 尺寸 | — | 46 → 62 | 与 `.success-orb`（46）同宽起步，落到中央时 62（`scale 1.35`），与 welcome orb 同族 |
| `CENTER_SCALE` | 1.42 / 1.2 | 不变 | — |
| `FALL` | 1.06 | 0.92（P4） | 起点更远但路径更陡，缩短后不显拖沓 |
| 工牌高度 | — | 50 | 圆角 15 |
| 工牌上浮 | — | 8 | 脱离顶栏平面 |
| 名字字距峰值 | — | .22em | 分裂后回落到 0（主份）/ 保持（ghost 由 transform 缩放吸收） |

## 7. 风险清单

1. **双星 / 坐标错位**：`WarpTransit` 与 `WelcomeChain` 必须共用量位函数（抽到 `welcome.ts` 的 `resolveIdentityAnchor()`），不要各写一份。上游同理：`.success-orb` 的圆心必须由 `WarpTransit` 在 `startTransit` 同帧量取，不能在两处各算一次。
2. **页面淡出吞掉星球**：`playLoginDissolve` 会把 `.login-card` 整体淡出，`.success-orb` 在里面。必须在 dissolve 首帧之前把 seed 建好并把本体压到 0；`playLoginDissolve` 里也应显式跳过 `.success-orb`，双保险。
3. **登录失败 / 导航被取消**：`finishHandoff()` 触发 `transitAbort`，seed 必须随特效层 0.18s 淡出。`.success-orb` 由 `v-if/v-else` 卸载重建，内联样式会自然清掉——不需要额外还原，但要确认重建与 `succeeded = false` 在同一帧完成，避免闪一帧旧圆。
2. **chip 在壳层入场中被打断**：`playShellEntrance` 必须排除 chip；否则两条 tween 同帧写 opacity 会抖。
3. **工牌向右出界**：右边缘锚定 + 向左展开；宽度上限 320，部门名省略号。
4. **名字交接跳动**：字距撑开后必须完全回收（主份 `back.out` 到 0），否则归位时标题文字宽度与浮牌差 1~2px，交叉淡化会「跳一下」。验收时逐帧比对 `nameEl` 与 `.page-title` 的文字起止边。
5. **副份落点偏差**：用中心对齐，不用 left/top；落点每帧在 P8 末尾复测一次（chip 可能因顶栏凝结层变化而位移，虽然概率低）。
6. **总时长变长**：6.86s。`handoffActive` 期间点击被拦截，预算调到 5400 后解锁点仍在浮牌浮现后，不影响操作。若用户觉得拖，按 §3 旋钮压缩。
7. **信息过载**：工牌上同时有头像、标签、部门、昵称、@username 五项，容易变成「名片」。约束：标签 + 部门为主（14px），昵称次（15px 但只一行），@username 最小且可省。

## 8. 改动清单

| 文件 | 改动 |
| --- | --- |
| `components/welcome/WelcomeChain.vue` | 重排主时间轴：新增 P1–P4、P7c–P9；打字机改双 span；新增 ghost 与工牌元素 |
| `styles/pages.css` | 新增 `.welcome-idcard*`、`.welcome-name-ghost`、`.welcome-idcard-glow`、`.transit-seed`；`.welcome-greet` 拆 span 后的字距补偿；`.success-orb.is-star` 化星态 |
| `composables/motion.ts` | `playShellEntrance` 排除 `.user-chip`；skip 分支还原 chip；`playLoginDissolve` 跳过 `.success-orb` |
| `composables/welcome.ts` | `ARRIVE_BUDGET` 4200 → 5400；新增 `resolveIdentityAnchor()`、`identityAnchor`、`transitIgnited`；`beginHandoff` 复位新信号 |
| `views/Login.vue` | `playSuccess` 尾部接 P-1 化星；`wait(250)` 改为等 `transitIgnited` + 250ms（2s 兜底） |
| `components/welcome/WarpTransit.vue` | 新增 seed（诞生 / 起飞 / 融入）；`HERO_TO` 改为运行时量 chip，量不到回落原值；加速段起点置 `transitIgnited` |
| `components/layout/AppShell.vue` | `onWelcomeDone` 兜底还原 chip |
| `DESIGN.md` §动效 | 更新欢迎链描述（现在有「去往右上角」的副份与「按钮化星」的上游，仍不画轨迹线） |
| `changelog.md` | 记一条 |

## 9. 验收

- 帧：P-1 化星 / P0 起飞中 / P0b 融入 / P1 星归 / P2b 工牌展开（部门可读）/ P3 收束 / P4 坠落中 / P7c 分裂 / P8 双宿途中 / P9 双握手。
- 断言：
  - **seed 与 `.success-orb` 交接帧**：两者中心偏差 < 0.5px、外径偏差 < 1px，交叉期间无亮度跳变（逐帧采样按钮区域）。
  - **化星前后**：蓝壳褪去过程中星球区域色相从 `--blue` 平滑过渡到 lime，无「闪一下白」的中间帧（采样 3~4 帧的 RGB 距离单调）。
  - 工牌右边缘 ≤ `innerWidth - 4`，左边缘 ≥ 0（320 宽 + 视口 760 的边界）。
  - ghost 落点中心与 `.user-name` 中心偏差 < 1.5px。
  - 交叉期间 `alpha(ghost) + alpha(chip)` ∈ [0.88, 1.12]（逐帧采样）。
  - 标题交接期间浮牌文字与真实标题的左边缘差 < 1px、文字亮度曲线单调无跳变。
  - 全程无横向滚动、无左上角 `(0,0)` 异物闪帧（沿用现有逐帧亮度 + 位置采样脚本）。
- 四档宽度回归：1440 / 1080 / 900 / 800；浅色、深色、reduced-motion 各一遍。
