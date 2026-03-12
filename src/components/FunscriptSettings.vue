<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { FunscriptDriver } from '../drivers/funscript'

const props = defineProps<{
  driver: FunscriptDriver
}>()

const statusText = ref(props.driver.statusText)
const errorMessage = ref(props.driver.errorMessage)

let unsubscribe: (() => void) | null = null
let updateTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  unsubscribe = props.driver.onStatusChange(() => {
    statusText.value = props.driver.statusText
    errorMessage.value = props.driver.errorMessage
  })
})

onUnmounted(() => {
  unsubscribe?.()
  if (updateTimer) clearInterval(updateTimer)
})

function startRecording() {
  props.driver.start()
  statusText.value = props.driver.statusText
  updateTimer = setInterval(() => {
    statusText.value = props.driver.statusText
  }, 500)
}

function stopRecording() {
  if (updateTimer) {
    clearInterval(updateTimer)
    updateTimer = null
  }
  props.driver.stop()
  statusText.value = props.driver.statusText
}

function download() {
  props.driver.download()
}
</script>

<template>
  <div>
    <div class="field-group row">
      <button @click="startRecording" :disabled="driver.isRecording">Record</button>
      <button @click="stopRecording" class="secondary" :disabled="!driver.isRecording">Stop</button>
      <button @click="download" class="secondary">Download .funscript</button>
    </div>
    <div class="text-muted">{{ statusText }}</div>
    <div v-if="errorMessage" class="text-error">{{ errorMessage }}</div>
  </div>
</template>
