import type { NavGroup, NavLeaf } from '@/data'

/* ============================================================
   后端菜单树 → 前端导航树的纯转换逻辑。
   从 auth.ts 抽出，便于单测覆盖多级菜单与异常数据。
   ============================================================ */

/** 后端 /auth/routes 返回的菜单节点（只取转换需要的字段） */
export interface MenuNode {
  id?: number
  name: string
  path?: string
  component?: string
  icon?: string
  children?: MenuNode[]
}

/** 菜单深度上限，对齐后端 sys_menu 的 parent_id 自关联层级；超出部分不再展开，避免异常数据撑爆导航 */
export const MAX_MENU_DEPTH = 6

export interface NavTreeOptions {
  /** 路由名推导：path → 唯一 key */
  routeNameOf: (path: string) => string
  /** 判断组件是否已登记；未登记者不可点击 */
  hasComponent: (component: string) => boolean
  /** 补全前导斜杠 */
  normalizePath: (path?: string) => string
}

function leafOf(item: MenuNode, opt: NavTreeOptions): NavLeaf | null {
  const path = opt.normalizePath(item.path)
  if (!path || !item.component || !opt.hasComponent(item.component)) return null
  return { key: opt.routeNameOf(path), label: item.name, icon: item.icon || 'file', path }
}

/**
 * 递归转换，支持三级及以上：
 * - 当前节点是页面 → 叶子（path 可点击）
 * - 既有页面又有子菜单 → 叶子携带 children，父级本身仍可点击
 * - 纯目录 → 分支（path 为空，仅作展开容器），子项提升一层
 * 未登记组件的节点不产出可点击入口，其子树由祖先承载。
 */
export function toNavNodes(items: MenuNode[], depth: number, opt: NavTreeOptions): NavLeaf[] {
  if (depth > MAX_MENU_DEPTH) return []
  const nodes: NavLeaf[] = []
  for (const item of items) {
    const children = toNavNodes(item.children ?? [], depth + 1, opt)
    const leaf = leafOf(item, opt)
    if (leaf) {
      if (children.length) leaf.children = children
      nodes.push(leaf)
      continue
    }
    if (children.length) {
      nodes.push({
        key: `group-${item.id ?? item.name}-${depth}`,
        label: item.name,
        icon: item.icon || 'layers',
        path: '',
        children,
      })
    }
  }
  return nodes
}

/**
 * 顶层菜单 → 分组。
 * 顶层是纯页面 → single 分组（工作台这样单独飘一个，不带标题）。
 * 顶层是目录 → 目录名作为分组标题，子菜单提升为组内项（摊平一层，不额外包分支节点），
 *   因为分组标题已经承担了「目录」的语义，再包一层会让用户多点一次。
 *   若该目录自身也是页面，它作为组内第一项（既可点击又有子树）。
 */
export function buildNavGroups(tree: MenuNode[], opt: NavTreeOptions): NavGroup[] {
  const groups: NavGroup[] = []
  for (const node of tree) {
    const leaf = leafOf(node, opt)
    const children = toNavNodes(node.children ?? [], 2, opt)

    if (leaf && !children.length) {
      groups.push({ key: leaf.key, label: leaf.label, icon: leaf.icon, single: true, items: [leaf] })
      continue
    }

    const items: NavLeaf[] = []
    if (leaf) {
      // 父级自身是页面：作为组内第一项，并接管子树（子树不再平铺，否则会重复出现）
      leaf.children = children
      items.push(leaf)
    } else {
      // 纯目录：子菜单摊平为组内项，分组标题已承担目录语义
      items.push(...children)
    }

    if (items.length) {
      groups.push({
        key: `group-${node.id ?? node.name}`,
        label: node.name,
        icon: node.icon || 'layers',
        items,
      })
    }
  }
  return groups
}

/** 深度优先展开所有可点击页面，供路由注册、菜单搜索使用 */
export function navLeaves(groups: NavGroup[]): NavLeaf[] {
  const out: NavLeaf[] = []
  const walk = (nodes: NavLeaf[]) => nodes.forEach(node => {
    if (node.path) out.push(node)
    if (node.children?.length) walk(node.children)
  })
  groups.forEach(group => walk(group.items))
  return out
}

/** 分组 key → 其下所有页面的路径，用于路由 meta.group */
export function groupOfPaths(groups: NavGroup[]): Map<string, string> {
  const map = new Map<string, string>()
  groups.forEach(group => {
    const label = group.single ? '' : group.label
    const walk = (nodes: NavLeaf[]) => nodes.forEach(node => {
      if (node.path) map.set(node.path, label)
      if (node.children?.length) walk(node.children)
    })
    walk(group.items)
  })
  return map
}