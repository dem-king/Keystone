<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import NavTreeNode from '@/components/layout/NavTreeNode.vue'
import { navGroups, navLeaves } from '@/composables/auth'
import { appearance } from '@/composables/appearance'
import {
  autoCollapsed,
  collapsedGroups,
  compactMode,
  isCollapsed,
  setCollapsedMany,
  setGroupOpen,
  setVisiblePageTotal,
  syncCollapsed,
  toggleCollapsed,
} from '@/composables/navCollapse'
import { navBodyEnter, navBodyLeave, slideThumb } from '@/composables/motion'
import { APP } from '@/data'
import type { NavLeaf } from '@/data'

const emit = defineEmits<{ (e: 'navigate'): void }>()

const route = useRoute()
const router = useRouter()
const nav = ref<HTMLElement | null>(null)
const thumb = ref<HTMLElement | null>(null)
const keyword = ref('')
const searchOpen = ref(false)

const activeKey = computed(() => String(route.name ?? ''))

/** 当前页是否在导航树内（任意层级） */
const hasActive = computed(() => navGroups.value.some(g => contains(g.items, activeKey.value)))

/** 深度查找：节点 key 是否出现在树中 */
function contains(nodes: NavLeaf[], key: string): boolean {
  return nodes.some(node => node.key === key || Boolean(node.children?.length && contains(node.children, key)))
}

function go(path: string) {
  if (!path) return
  emit('navigate')
  keyword.value = ''
  searchOpen.value = false
  if (route.path !== path) router.push(path)
}

/* ── 搜索：跨分组深度匹配菜单名，命中后临时展开全部分组 ── */
const searching = computed(() => keyword.value.trim().length > 0)

function matchNode(node: NavLeaf): boolean {
  return node.label.toLowerCase().includes(keyword.value.trim().toLowerCase())
}

/** 节点在搜索态是否显示：自身命中，或任一后代命中 */
function visibleInSearch(node: NavLeaf): boolean {
  if (!searching.value) return true
  if (matchNode(node)) return true
  return Boolean(node.children?.some(visibleInSearch))
}

const shownGroups = computed(() => navGroups.value
  .map(group => ({ ...group, items: group.items.filter(visibleInSearch) }))
  .filter(group => group.items.length > 0))

/** 搜索态下每个分组内的可见叶子，用于结果计数与「无结果」判断 */
function leavesOf(items: NavLeaf[]): NavLeaf[] {
  const out: NavLeaf[] = []
  const walk = (nodes: NavLeaf[]) => nodes.forEach(node => {
    if (node.path && matchNode(node)) out.push(node)
    if (node.children?.length) walk(node.children)
  })
  walk(items)
  return out
}

const resultCount = computed(() => shownGroups.value.reduce((sum, g) => sum + leavesOf(g.items).length, 0))

/* ── 一级分组折叠：菜单全是两级时，靠分组收起控制侧栏长度 ── */

/** 当前账号可见的页面总数，用于判断是否进入紧凑模式 */
const pageTotal = computed(() => navLeaves(navGroups.value).length)

watch(pageTotal, total => setVisiblePageTotal(total), { immediate: true })

/**
 * 当前页所属的一级分组 key。该分组默认展开，路由变化时也会被自动展开，
 * 避免用户看不到自己在哪；用户显式折叠它时仍以用户操作为准（见 groupOpen）。
 */
const activeGroupKey = computed(() => {
  const key = activeKey.value
  return navGroups.value.find(g => contains(g.items, key))?.key ?? null
})

/**
 * 分组在「有标题分组」中的序号，用于自动折叠策略决定保留哪几个。
 * single 分组（工作台）没有标题、永远展开，不参与计数。
 */
function titledIndex(key: string) {
  return navGroups.value.filter(g => !g.single).findIndex(g => g.key === key)
}

/**
 * 分组是否展开。判断顺序即优先级：搜索态 > 用户显式折叠 > 当前页所在分组 > 自动策略。
 * 显式折叠必须排在「当前页所在分组」之前，否则用户在某一分组内折叠它时
 * 会被「当前页保护」抵消，表现为点了没反应。
 */
function groupOpen(groupKey: string) {
  if (searching.value) return true
  if (isCollapsed(groupKey)) return false
  if (groupKey === activeGroupKey.value) return true
  return !autoCollapsed(groupKey, titledIndex(groupKey))
}

/**
 * 分组标题点击：翻转展开状态。
 * 折叠与展开两个列表由 setGroupOpen 成对维护，避免只写一个导致点击无反应。
 */
function toggleGroup(groupKey: string) {
  // 搜索态下分组强制全展开，此时点击不写偏好，避免退出搜索后状态突变
  if (searching.value) return
  setGroupOpen(groupKey, !groupOpen(groupKey))
}

/**
 * 分支节点的点击行为：切换展开 / 收起。
 * 若该节点自身也是页面（path 非空），点击同时跳转到该页，
 * 避免「父级既是分组又是页面」时必须先收起才能进页面。
 */
function toggleBranch(node: NavLeaf) {
  toggleCollapsed(node.key)
  if (node.path) go(node.path)
}

/** 当前页所在的分支 key 集合；路由变化时确保这些祖先分支展开，避免用户看不到自己在哪 */
function branchKeysOf(key: string, nodes: NavLeaf[], acc: string[] = []): string[] | null {
  for (const node of nodes) {
    if (node.key === key) return acc
    if (node.children?.length) {
      const found = branchKeysOf(key, node.children, [...acc, node.key])
      if (found) return found
    }
  }
  return null
}

function sync(instant = false) {
  const target = nav.value?.querySelector<HTMLElement>('.nav-item.is-active') ?? null
  slideThumb(thumb.value, target, 'y', instant)
}

let observer: ResizeObserver | null = null
onMounted(() => {
  revealActive()
  nextTick(() => sync(true))
  observer = new ResizeObserver(() => sync(true))
  if (nav.value) observer.observe(nav.value)
})
onBeforeUnmount(() => observer?.disconnect())

/** 展开当前页的所有祖先分支；仅在需要时改动，避免无谓的存储写入 */
function revealActive() {
  // 当前页所在的一级分组也要可见：用户可能刚把它收起，再经搜索或
  // 工作台快捷入口跳进来。这里只清折叠标记、不写「显式展开」，
  // 免得破坏紧凑模式下「非当前页分组自动收起」的策略。
  if (activeGroupKey.value) setCollapsedMany([{ key: activeGroupKey.value, collapsed: false }])
  const chains = navGroups.value.map(group => branchKeysOf(activeKey.value, group.items)).filter((v): v is string[] => Boolean(v))
  const required = chains.flat()
  if (!required.length) return
  const missing = required.filter(key => isCollapsed(key))
  if (!missing.length) return
  missing.forEach(key => toggleCollapsed(key))
}

watch(activeKey, () => { revealActive(); nextTick(() => sync()) })
watch(() => [navGroups.value, appearance.railCollapsed, collapsedGroups.value], () => nextTick(() => sync(true)), { deep: true })

// 菜单结构变化后丢弃失效的折叠键。
// 一级分组 key 也要计入合法列表，否则刚写入的分组折叠状态会被当成死键清掉。
watch(navGroups, groups => {
  const keys: string[] = []
  const walk = (nodes: NavLeaf[]) => nodes.forEach(node => {
    if (node.children?.length) {
      keys.push(node.key)
      walk(node.children)
    }
  })
  groups.forEach(group => {
    if (!group.single) keys.push(group.key)
    walk(group.items)
  })
  syncCollapsed(keys)
}, { deep: true, immediate: true })
</script>

<template>
  <aside class="rail m-rail" aria-label="主导航">
    <div class="rail-brand">
      <span class="brand-mark" aria-hidden="true"><span class="brand-dot" /></span>
      <div class="brand-text">
        <div class="brand-name">{{ APP.shortName }}</div>
        <div class="brand-sub">{{ APP.subtitle }}</div>
      </div>
    </div>

    <div v-if="!appearance.railCollapsed" class="rail-search">
      <label class="nav-search" :class="{ 'is-open': searchOpen || searching }">
        <Icon class="nav-search-ico" name="search" :size="15" />
        <input
          v-model="keyword"
          class="nav-search-input"
          type="search"
          placeholder="搜索菜单"
          aria-label="搜索菜单"
          @focus="searchOpen = true"
          @blur="searchOpen = false"
        />
        <button v-if="searching" type="button" class="nav-search-clear" aria-label="清除搜索" @mousedown.prevent @click="keyword = ''">
          <Icon name="x" :size="13" />
        </button>
      </label>
      <p v-if="searching" class="nav-search-count nav-label">匹配 {{ resultCount }} 项</p>
      <p v-else-if="compactMode" class="nav-search-count nav-label">菜单较多，部分分组已收起</p>
    </div>

    <nav ref="nav" class="rail-nav">
      <span v-show="hasActive" ref="thumb" class="nav-thumb m-pill" aria-hidden="true" />

      <p v-if="searching && !shownGroups.length" class="nav-empty nav-label">未匹配到菜单</p>

      <div v-for="group in shownGroups" :key="group.key" class="nav-group">
        <button
          v-if="!group.single"
          type="button"
          class="nav-group-title nav-group-toggle"
          :class="{ 'is-open': groupOpen(group.key) }"
          :aria-expanded="groupOpen(group.key)"
          @click="toggleGroup(group.key)"
        >
          <span class="nav-label">{{ group.label }}</span>
          <Icon class="nav-caret" :class="{ 'is-open': groupOpen(group.key) }" name="chevronDown" :size="13" />
        </button>

        <!-- single 分组无标题、始终展开；有标题的分组才受折叠控制 -->
        <Transition :css="false" @enter="navBodyEnter" @leave="navBodyLeave">
          <div v-show="group.single || groupOpen(group.key)" class="nav-group-body">
            <NavTreeNode
              :nodes="group.items"
              :depth="0"
              :collapsed="appearance.railCollapsed"
              :force-open="searching"
              @go="go"
              @toggle="toggleBranch"
            />
          </div>
        </Transition>
      </div>
    </nav>

    <div class="rail-foot">
      <span class="nav-label faint" style="font-size: 11px; padding: 0 10px">{{ APP.version }}</span>
    </div>
  </aside>
</template>