<script setup lang="ts">
import ToastHost from '@/components/ui/ToastHost.vue'
import ConfirmHost from '@/components/ui/ConfirmHost.vue'
import WarpTransit from '@/components/welcome/WarpTransit.vue'
import { transitActive } from '@/composables/welcome'

function onTransitDone() { transitActive.value = false }
</script>

<template>
  <router-view />
  <ToastHost />
  <ConfirmHost />
  <WarpTransit v-if="transitActive" @done="onTransitDone" />
  <div class="grain-layer" aria-hidden="true" />
</template>
