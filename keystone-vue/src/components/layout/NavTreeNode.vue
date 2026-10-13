<script setup lang="ts">
/**
 * 侧边栏导航树节点：递归渲染任意层级。
 * 由 Sidebar 通过递归组件引用驱动，深度只受后端菜单树限制。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { isCollapsed } from '@/composables/navCollapse'
import type { NavLeaf } from '@/data'

defineOptions({ name: 'NavTreeNode' })

const props = withDefaults(defineProps<{
  nodes: NavLeaf[]
  /** 层级深度，从 0 开始；用于收敛字号与图标尺寸 */
  depth?: number
  /** 折叠侧栏为图标条时隐藏文字 */
  collapsed?: boolean
  /** 菜单搜索态：全部展开且忽略折叠状态 */
  forceOpen?: boolean
}>(), { depth: 0, collapsed: false, forceOpen: false })

const emit = defineEmits<{
  (e: 'go', path: string): void
  (e: 'toggle', node: NavLeaf): void
}>()

const route = useRoute()
const activeKey = computed(() => String(route.name ?? ''))

function open(node: NavLeaf) {
  return props.forceOpen || !isCollapsed(node.key)
}

/** 分支内是否含当前页：用于给父级一个"你在里面"的视觉提示 */
function holdsActive(node: NavLeaf): boolean {
  if (node.key === activeKey.value) return true
  return Boolean(node.children?.some(holdsActive))
}

function size(icon: number) {
  return Math.max(13, icon - props.depth * 2)
}
</script>

<template>
  <div class="nav-level" :class="{ 'nav-level-nested': depth > 0 }">
    <template v-for="node in nodes" :key="node.key">
      <!-- 分支：可展开，同时自身可能是页面 -->
      <div v-if="node.children?.length" class="nav-branch">
        <button
          type="button"
          class="nav-item nav-item-branch"
          :class="{ 'is-active': !node.path && holdsActive(node) }"
          :aria-expanded="open(node)"
          :title="collapsed ? node.label : undefined"
          @click="emit('toggle', node)"
        >
          <Icon class="nav-ico" :name="node.icon" :size="size(18)" />
          <span class="nav-label">{{ node.label }}</span>
          <Icon class="nav-caret" :class="{ 'is-open': open(node) }" name="chevronDown" :size="Math.max(11, 14 - depth)" />
        </button>
        <div v-show="open(node)" class="nav-branch-body">
          <NavTreeNode
            :nodes="node.children"
            :depth="depth + 1"
            :collapsed="collapsed"
            :force-open="forceOpen"
            @go="path => emit('go', path)"
            @toggle="child => emit('toggle', child)"
          />
        </div>
      </div>

      <!-- 叶子：点击跳转 -->
      <button
        v-else
        type="button"
        class="nav-item"
        :class="{ 'is-active': node.key === activeKey }"
        :aria-current="node.key === activeKey ? 'page' : undefined"
        :title="collapsed ? node.label : undefined"
        @click="node.path && emit('go', node.path)"
      >
        <Icon class="nav-ico" :name="node.icon" :size="size(18)" />
        <span class="nav-label">{{ node.label }}</span>
      </button>
    </template>
  </div>
</template>