<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Sidebar from './Sidebar.vue'
import Topbar from './Topbar.vue'
import WelcomeChain from '@/components/welcome/WelcomeChain.vue'
import CommandPalette from './CommandPalette.vue'
import AppearanceDialog from './AppearanceDialog.vue'
import PasswordDialog from './PasswordDialog.vue'
import { logout } from '@/composables/auth'
import { appearance } from '@/composables/appearance'
import { pageEnter, pageLeave, playShellEntrance } from '@/composables/motion'
import { finishHandoff, handoffActive, handoffPhase } from '@/composables/welcome'
import { confirm } from '@/composables/confirm'

const route = useRoute()
const router = useRouter()
const frame = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const mobile = ref(false)
const mobileOpen = ref(false)
const commandOpen = ref(false)
const appearanceOpen = ref(false)
const passwordOpen = ref(false)
const scrolled = ref(false)

// 内容滚动后顶栏凝结：只切换一层静态玻璃的 opacity，不补间 backdrop-filter
function onContentScroll() {
  const next = (content.value?.scrollTop ?? 0) > 8
  if (next !== scrolled.value) scrolled.value = next
}

const mq = window.matchMedia('(max-width: 820px)')
const syncMobile = () => { mobile.value = mq.matches; if (!mq.matches) mobileOpen.value = false }

const frameClass = computed(() => ({
  'is-collapsed': appearance.railCollapsed && !mobile.value,
  'is-mobile-open': mobile.value && mobileOpen.value,
}))

/** 欢迎链只在「刚登录进来的这一段交接」里播一次：刷新页面、切路由都不播。
 *  卸载时机由链条自己播完来报，不用固定时长去猜。 */
const welcoming = ref(handoffPhase.value === 'arriving')
let welcomeGuard = 0
function onWelcomeDone() {
  welcoming.value = false
  window.clearTimeout(welcomeGuard)
}
// 安全阀：链条若因异常中断没有报 done，兜住这一层不让它常驻
onMounted(() => { if (welcoming.value) welcomeGuard = window.setTimeout(onWelcomeDone, 6000) })

function toggleRail() {
  if (mobile.value) mobileOpen.value = !mobileOpen.value
  else appearance.railCollapsed = !appearance.railCollapsed
}

async function onLogout() {
  const ok = await confirm({ title: '退出登录', message: '确认退出当前账号吗？', confirmText: '退出' })
  if (!ok) return
  const task = logout()
  await router.replace({ name: 'login' })
  await task
}

function onCommandAction(name: 'appearance' | 'password' | 'logout') {
  if (name === 'appearance') appearanceOpen.value = true
  else if (name === 'password') passwordOpen.value = true
  else onLogout()
}

function onGlobalKey(event: KeyboardEvent) {
  if (handoffActive.value) return // 交接期间按键让位给转场，不触发面板
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    commandOpen.value = !commandOpen.value
  }
}

/** 交接期卡片交落点页自己的组装编排（工作台从中心飞出），页头也不隐藏——
 *  欢迎链的铭牌就落在页头标题的位置，页头若隐身铭牌会量到 0 宽。 */
function onPageEnter(el: Element, done: () => void) {
  pageEnter(el, done, { cards: handoffPhase.value !== 'arriving', handoff: handoffPhase.value === 'arriving' })
}

watch(() => route.fullPath, () => { mobileOpen.value = false })

onMounted(() => {
  syncMobile()
  mq.addEventListener('change', syncMobile)
  document.addEventListener('keydown', onGlobalKey)
  // 交接进行中：导航自左滑入、顶栏自上落下；平时进入照常轻淡入。
  // 框体本身不淡入——舞台底一直在，整框淡入就是白屏。
  if (frame.value) playShellEntrance(frame.value, handoffPhase.value === 'arriving')
})
onBeforeUnmount(() => {
  mq.removeEventListener('change', syncMobile)
  document.removeEventListener('keydown', onGlobalKey)
  window.clearTimeout(welcomeGuard)
  finishHandoff() // 外壳卸载（登出、会话过期）时清掉可能未播完的交接
})
</script>

<template>
  <div class="stage">
    <div ref="frame" :class="['app-frame', frameClass]">
      <Sidebar @navigate="mobileOpen = false" />
      <div v-if="mobile && mobileOpen" class="rail-scrim" aria-hidden="true" @click="mobileOpen = false" />
      <div :class="['workspace', { 'is-scrolled': scrolled }]">
        <Topbar
          @toggle-rail="toggleRail"
          @command="commandOpen = true"
          @appearance="appearanceOpen = true"
          @password="passwordOpen = true"
          @logout="onLogout"
        />
        <main ref="content" class="content" tabindex="-1" @scroll.passive="onContentScroll">
          <router-view v-slot="{ Component }">
            <Transition mode="out-in" :css="false" appear @leave="pageLeave" @after-leave="content?.scrollTo({ top: 0 }); scrolled = false" @enter="onPageEnter">
              <component :is="Component" :key="route.path" />
            </Transition>
          </router-view>
        </main>
      </div>
    </div>
    <CommandPalette :open="commandOpen" @close="commandOpen = false" @action="onCommandAction" />
    <WelcomeChain v-if="welcoming" @done="onWelcomeDone" />
    <AppearanceDialog :open="appearanceOpen" @close="appearanceOpen = false" />
    <PasswordDialog :open="passwordOpen" @close="passwordOpen = false" />
  </div>
</template>
