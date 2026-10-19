<script setup lang="ts">
import ToastHost from '@/components/ui/ToastHost.vue'
import ConfirmHost from '@/components/ui/ConfirmHost.vue'
import WarpTransit from '@/components/welcome/WarpTransit.vue'
import ExitChain from '@/components/welcome/ExitChain.vue'
import { transitActive } from '@/composables/welcome'
import { exitActive, finishExit } from '@/composables/exit'

function onTransitDone() { transitActive.value = false }
function onExitDone() { finishExit() }
</script>

<template>
  <router-view />
  <ToastHost />
  <ConfirmHost />
  <WarpTransit v-if="transitActive" @done="onTransitDone" />
  <ExitChain v-if="exitActive" @done="onExitDone" />
  <div class="grain-layer" aria-hidden="true" />
</template>
