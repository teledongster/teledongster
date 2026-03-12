<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import OutputDeviceItem from './OutputDeviceItem.vue'
import HandySettings from './HandySettings.vue'
import FunscriptSettings from './FunscriptSettings.vue'
import AdvancedOutputSettings from './AdvancedOutputSettings.vue'
import {
  useOutputDevices,
  type OutputDeviceType,
  type OutputDeviceEntry,
} from '../composables/useOutputDevices'
import { settings, type SavedOutputDevice } from '../composables/useSettings'
import type { HandyDriver } from '../drivers/handy'
import type { FunscriptDriver } from '../drivers/funscript'

const outputDevices = useOutputDevices()
const showAdvanced = ref(false)
const deviceTypeToAdd = ref<OutputDeviceType>('handy')

// --- Persistence ---

function persistToSettings() {
  settings.value.outputDevices = outputDevices.devices.map((d) => {
    const saved: SavedOutputDevice = {
      type: d.type,
      peakMotionMode: d.driver.processor.peakMotionMode,
      filterTimeMs: d.driver.processor.filterTimeMs,
      filterStrength: d.driver.processor.filterStrength,
    }
    if (d.type === 'handy') {
      saved.connectionKey = (d.driver as HandyDriver).connectionKey
    }
    return saved
  })
}

function restoreFromSettings() {
  for (const sd of settings.value.outputDevices) {
    const entry = outputDevices.addDevice(sd.type as OutputDeviceType)
    if (sd.peakMotionMode !== undefined) entry.driver.processor.peakMotionMode = sd.peakMotionMode
    if (sd.filterTimeMs !== undefined) entry.driver.processor.filterTimeMs = sd.filterTimeMs
    if (sd.filterStrength !== undefined) entry.driver.processor.filterStrength = sd.filterStrength
    if (sd.connectionKey && entry.type === 'handy') {
      ;(entry.driver as HandyDriver).connectionKey = sd.connectionKey
    }
  }
}

onMounted(() => {
  if (settings.value.outputDevices.length > 0) {
    restoreFromSettings()
  }
})

// --- Actions ---

function addDevice() {
  outputDevices.addDevice(deviceTypeToAdd.value)
  persistToSettings()
}

function removeDevice(id: number) {
  outputDevices.removeDevice(id)
  persistToSettings()
}

const selectedDevice = computed(() => outputDevices.getSelected())

const emit = defineEmits<{
  'test-pattern-point': [position: number]
}>()

defineExpose({
  inputPosition: (pos: number) => outputDevices.inputPosition(pos),
  persistToSettings,
})
</script>

<template>
  <div class="panel">
    <div class="panel-title">Output Devices</div>

    <div class="field-group row">
      <select v-model="deviceTypeToAdd">
        <option value="handy">The Handy</option>
        <option value="funscript">Funscript Recorder</option>
      </select>
      <button @click="addDevice">Add</button>
    </div>

    <div class="device-list">
      <OutputDeviceItem
        v-for="device in outputDevices.devices"
        :key="device.id"
        :device="device"
        :selected="device.id === outputDevices.selectedDeviceId.value"
        @select="outputDevices.selectedDeviceId.value = device.id"
        @remove="removeDevice(device.id)"
      />
    </div>

    <div v-if="outputDevices.devices.length === 0" class="text-muted" style="margin: 12px 0">
      No output devices added. Add one above.
    </div>

    <template v-if="selectedDevice">
      <div class="selected-device-settings">
        <HandySettings
          v-if="selectedDevice.type === 'handy'"
          :driver="(selectedDevice.driver as HandyDriver)"
          @save="persistToSettings"
          @test-pattern-point="(pos: number) => emit('test-pattern-point', pos)"
        />
        <FunscriptSettings
          v-else-if="selectedDevice.type === 'funscript'"
          :driver="(selectedDevice.driver as FunscriptDriver)"
        />

        <div style="margin-top: 8px">
          <button class="small secondary" @click="showAdvanced = !showAdvanced">
            {{ showAdvanced ? 'Hide' : 'Show' }} Advanced Settings
          </button>
        </div>

        <AdvancedOutputSettings
          v-if="showAdvanced"
          :device="selectedDevice"
          @save="persistToSettings"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.device-list {
  margin: 8px 0;
}

.selected-device-settings {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
</style>
