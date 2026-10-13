import { computed, ref } from 'vue'

/* ============================================================
   侧边栏分组折叠状态。
   菜单多到一屏放不下时，需要按分组收起；状态按 key 记忆，
   账号切换与菜单变化后自动清理，避免残留无效分组。
   ============================================================ */

const STORAGE_KEY = 'keystone.navCollapsed'

/** 用户手动展开过的一级分组；紧凑模式下这些分组不被自动收起 */
const EXPANDED_KEY = 'keystone.navExpanded'

function safeStorage(): Storage | null {
  try {
    const probe = '__navCollapsedProbe__'
    window.sessionStorage.setItem(probe, '1')
    window.sessionStorage.removeItem(probe)
    return window.sessionStorage
  } catch {
    return null
  }
}

const storage = safeStorage()

function readList(key: string): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeList(key: string, value: string[]) {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    /* 存储不可用时仅保留内存态 */
  }
}

function load(): string[] {
  return readList(STORAGE_KEY)
}

/** 已折叠的分组 key 集合 */
export const collapsedGroups = ref<string[]>(load())

/** 用户手动展开过的分组 key 集合 */
export const expandedGroups = ref<string[]>(readList(EXPANDED_KEY))

function persist() {
  writeList(STORAGE_KEY, collapsedGroups.value)
}

function persistExpanded() {
  writeList(EXPANDED_KEY, expandedGroups.value)
}

export function isCollapsed(key: string) {
  return collapsedGroups.value.includes(key)
}

export function toggleCollapsed(key: string) {
  collapsedGroups.value = isCollapsed(key)
    ? collapsedGroups.value.filter(k => k !== key)
    : [...collapsedGroups.value, key]
  persist()
}

export function setCollapsed(key: string, value: boolean) {
  const collapsed = isCollapsed(key)
  if (collapsed === value) return
  toggleCollapsed(key)
}

/** 菜单结构变化后丢弃已不存在的分组 key，避免存储里堆积死键 */
export function syncCollapsed(validKeys: string[]) {
  const valid = new Set(validKeys)
  const next = collapsedGroups.value.filter(key => valid.has(key))
  if (next.length !== collapsedGroups.value.length) {
    collapsedGroups.value = next
    persist()
  }
  // 展开列表同样只保留仍存在的分组
  const nextExpanded = expandedGroups.value.filter(key => valid.has(key))
  if (nextExpanded.length !== expandedGroups.value.length) {
    expandedGroups.value = nextExpanded
    persistExpanded()
  }
}

export function clearCollapsed() {
  collapsedGroups.value = []
  expandedGroups.value = []
  persist()
  persistExpanded()
}

/** 批量设置折叠状态；只写入实际发生变化的部分 */
export function setCollapsedMany(entries: Array<{ key: string; collapsed: boolean }>) {
  const next = new Set(collapsedGroups.value)
  let changed = false
  entries.forEach(({ key, collapsed }) => {
    if (collapsed === next.has(key)) return
    if (collapsed) next.add(key)
    else next.delete(key)
    changed = true
  })
  if (!changed) return
  collapsedGroups.value = [...next]
  persist()
}

/* ============================================================
   自动折叠策略。

   纯两级菜单（如商城后台的「商品中心 → 商品列表/分类/品牌…」
   每组都有十几个页面）没有第三层子菜单，但项数一多同样撑爆侧栏。
   这里让一级分组也支持折叠：可见页面总数超过阈值时，
   自动收起「非当前页且非默认展开」的分组，用户手动改过的不受影响。

   用户手动「展开」的分组必须单独记录：只记折叠列表的话，
   手动展开后自动策略会立刻把它重新收起，表现为点击无反应。
   ============================================================ */

/** 可见页面总数超过该值即进入紧凑模式，收起部分分组 */
const AUTO_COLLAPSE_THRESHOLD = 20

/**
 * 紧凑模式下默认保持展开的分组数量。
 * 只统计有标题的分组（single 的工作台不占位，它永远展开）。
 */
const KEEP_OPEN_GROUPS = 2

const visiblePageTotal = ref(0)

/** 紧凑模式：菜单多到一屏放不下，需要主动收起 */
export const compactMode = computed(() => visiblePageTotal.value > AUTO_COLLAPSE_THRESHOLD)

/** 由 Sidebar 在菜单加载后告知当前可见页面总数 */
export function setVisiblePageTotal(total: number) {
  visiblePageTotal.value = total
}

/** 用户手动展开过的分组；这些分组不再受自动策略影响 */
export function isExpanded(key: string) {
  return expandedGroups.value.includes(key)
}

/** 记录一次用户对一级分组的显式展开，使其不再被自动策略收起 */
export function markExpanded(key: string) {
  if (expandedGroups.value.includes(key)) return
  expandedGroups.value = [...expandedGroups.value, key]
  persistExpanded()
}

/** 撤销显式展开标记：用户显式折叠时调用，保证与折叠列表互斥 */
export function unmarkExpanded(key: string) {
  if (!expandedGroups.value.includes(key)) return
  expandedGroups.value = expandedGroups.value.filter(k => k !== key)
  persistExpanded()
}

/**
 * 用户手动设置一级分组的展开状态。
 *
 * 折叠列表与展开列表必须成对维护（互斥）：
 * 只写其中一个时，另一个里的旧标记会继续生效（判断顺序上折叠优先），
 * 表现为「点击分组标题没反应」——一旦折叠过，就再也展不开。
 */
export function setGroupOpen(key: string, open: boolean) {
  setCollapsedMany([{ key, collapsed: !open }])
  if (open) markExpanded(key)
  else unmarkExpanded(key)
}

/**
 * 分组是否被自动策略收起。优先级：用户显式折叠 > 用户显式展开 > 自动策略。
 * 当前页所在分组由 Sidebar 在调用前先行处理（它优先于自动策略、但低于显式折叠）。
 * @param index 分组在「有标题分组」中的序号，用于自动策略保留前 KEEP_OPEN_GROUPS 个
 */
export function autoCollapsed(key: string, index: number): boolean {
  if (isCollapsed(key)) return true
  if (isExpanded(key)) return false
  if (!compactMode.value) return false
  return index >= KEEP_OPEN_GROUPS
}