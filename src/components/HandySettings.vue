<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import type { HandyDriver } from '../drivers/handy'

const props = defineProps<{
  driver: HandyDriver
}>()

const emit = defineEmits<{
  save: []
  'test-pattern-point': [position: number]
}>()

const connectionKey = ref(props.driver.connectionKey)
const statusText = ref(props.driver.statusText)
const errorMessage = ref(props.driver.errorMessage)
const testRunning = ref(false)

let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = props.driver.onStatusChange(() => {
    statusText.value = props.driver.statusText
    errorMessage.value = props.driver.errorMessage
    testRunning.value = props.driver.isTestPatternRunning
  })
})

onUnmounted(() => {
  unsubscribe?.()
})

watch(connectionKey, (key) => {
  props.driver.connectionKey = key
  emit('save')
})

async function connect() {
  props.driver.connectionKey = connectionKey.value
  await props.driver.start()
  emit('save')
}

function disconnect() {
  props.driver.stop()
}

let testPatternRunning = false
async function runTestPattern() {
  if (testPatternRunning) return
  testPatternRunning = true
  try {
    await props.driver.runTestPattern((pos) => {
      emit('test-pattern-point', pos)
    })
  } finally {
    testPatternRunning = false
  }
}

function stopTestPattern() {
  props.driver.stopTestPattern()
}
</script>

<template>
  <div>
    <div class="field-group">
      <label>Connection Key</label>
      <input v-model="connectionKey" type="text" placeholder="Enter Handy connection key" />
    </div>
    <div class="field-group row">
      <button @click="connect" :disabled="!connectionKey || driver.connected">Connect</button>
      <button @click="disconnect" class="secondary" :disabled="!driver.connected">Stop</button>
      <button
        v-if="!testRunning"
        @click="runTestPattern"
        class="secondary"
        :disabled="!driver.connected"
      >Test Pattern</button>
      <button
        v-else
        @click="stopTestPattern"
        class="secondary"
      >Stop Test</button>
    </div>
    <div class="text-muted">{{ statusText }}</div>
    <div v-if="testRunning" class="text-muted">Running test pattern... compare purple (target) vs white (sensor) on the graph.</div>
    <div v-if="errorMessage" class="text-error">{{ errorMessage }}</div>
  </div>
</template>
