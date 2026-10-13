import { ref } from 'vue'

/* ============================================================
   侧边栏分组折叠状态。
   菜单多到一屏放不下时，需要按分组收起；状态按 key 记忆，
   账号切换与菜单变化后自动清理，避免残留无效分组。
   ============================================================ */

const STORAGE_KEY = 'keystone.navCollapsed'

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

function load(): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/** 已折叠的分组 key 集合 */
export const collapsedGroups = ref<string[]>(load())

function persist() {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(collapsedGroups.value))
  } catch {
    /* 存储不可用时仅保留内存态 */
  }
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
  if (next.length === collapsedGroups.value.length) return
  collapsedGroups.value = next
  persist()
}

export function clearCollapsed() {
  collapsedGroups.value = []
  persist()
}