<script setup lang="ts">
/* 骨架占位：真实内容未到时占住与真实元素一致的位置，避免数据到达时布局跳动。
   h 给的是高度（px），与真实读数字号或图表高度对齐；w 是宽度百分比。
   灰条只表达"这里将有内容"，不承载任何状态语义。 */
withDefaults(defineProps<{
  h?: number
  w?: number | string
  radius?: number | string
}>(), {
  h: 12,
  w: '100%',
  radius: 8,
})
</script>

<template>
  <span
    class="skeleton-bar"
    aria-hidden="true"
    :style="{ height: `${h}px`, width: typeof w === 'number' ? `${w}%` : w, borderRadius: `${radius}px` }"
  />
</template>