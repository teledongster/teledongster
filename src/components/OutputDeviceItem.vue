<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { OutputDeviceEntry } from '../composables/useOutputDevices'

const props = defineProps<{
  device: OutputDeviceEntry
  selected: boolean
}>()

const emit = defineEmits<{
  select: []
  remove: []
}>()

const title = props.device.type === 'handy' ? 'The Handy' : 'Funscript Recorder'

const statusText = ref(props.device.driver.statusText)
const isConnected = ref(props.device.driver.connected)
const hasError = ref(!!props.device.driver.errorMessage)

let unsubscribe: (() => void) | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

function syncStatus() {
  statusText.value = props.device.driver.statusText
  isConnected.value = props.device.driver.connected
  hasError.value = !!props.device.driver.errorMessage
}

onMounted(() => {
  unsubscribe = props.device.driver.onStatusChange(syncStatus)
  pollTimer = setInterval(syncStatus, 500)
})

onUnmounted(() => {
  unsubscribe?.()
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="device-item" :class="{ selected }" @click="emit('select')">
    <div class="device-header">
      <span
        class="status-dot"
        :class="hasError ? 'error' : isConnected ? 'ok' : 'off'"
      ></span>
      <span class="device-title">{{ title }}</span>
      <button class="small danger remove-btn" @click.stop="emit('remove')">X</button>
    </div>
    <div class="device-subtitle text-muted">{{ statusText }}</div>
  </div>
</template>

<style scoped>
.device-item {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
  margin-bottom: 6px;
}

.device-item:hover {
  border-color: var(--accent);
}

.device-item.selected {
  border-color: var(--accent);
  background: rgba(155, 89, 182, 0.1);
}

.device-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.device-title {
  flex: 1;
  font-weight: 500;
}

.remove-btn {
  padding: 2px 8px;
  font-size: 11px;
}

.device-subtitle {
  margin-top: 2px;
  font-size: 12px;
  padding-left: 14px;
}
</style>
