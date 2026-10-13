<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import NavTreeNode from '@/components/layout/NavTreeNode.vue'
import { navGroups } from '@/composables/auth'
import { appearance } from '@/composables/appearance'
import { collapsedGroups, isCollapsed, syncCollapsed, toggleCollapsed } from '@/composables/navCollapse'
import { slideThumb } from '@/composables/motion'
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
  const chains = navGroups.value.map(group => branchKeysOf(activeKey.value, group.items)).filter((v): v is string[] => Boolean(v))
  const required = chains.flat()
  if (!required.length) return
  const missing = required.filter(key => isCollapsed(key))
  if (!missing.length) return
  missing.forEach(key => toggleCollapsed(key))
}

watch(activeKey, () => { revealActive(); nextTick(() => sync()) })
watch(() => [navGroups.value, appearance.railCollapsed, collapsedGroups.value], () => nextTick(() => sync(true)), { deep: true })

// 菜单结构变化后丢弃失效的折叠键
watch(navGroups, groups => {
  const keys: string[] = []
  const walk = (nodes: NavLeaf[]) => nodes.forEach(node => {
    if (node.children?.length) keys.push(node.key)
    if (node.children?.length) walk(node.children)
  })
  groups.forEach(group => walk(group.items))
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
    </div>

    <nav ref="nav" class="rail-nav">
      <span v-show="hasActive" ref="thumb" class="nav-thumb m-pill" aria-hidden="true" />

      <p v-if="searching && !shownGroups.length" class="nav-empty nav-label">未匹配到菜单</p>

      <div v-for="group in shownGroups" :key="group.key" class="nav-group">
        <div v-if="!group.single" class="nav-group-title">{{ group.label }}</div>
        <NavTreeNode
          :nodes="group.items"
          :depth="0"
          :collapsed="appearance.railCollapsed"
          :force-open="searching"
          @go="go"
          @toggle="toggleBranch"
        />
      </div>
    </nav>

    <div class="rail-foot">
      <span class="nav-label faint" style="font-size: 11px; padding: 0 10px">{{ APP.version }}</span>
    </div>
  </aside>
</template>