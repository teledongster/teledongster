<script setup lang="ts">
import { ref, watch } from 'vue'
import MotionGraph from './MotionGraph.vue'
import { useTeledong } from '../composables/useTeledong'
import { TeledongState } from '../drivers/teledong-sdk'

const emit = defineEmits<{
  position: [value: number]
}>()

const inputMode = ref<'teledong' | 'slider'>('teledong')
const teledong = useTeledong()
const sliderPosition = ref(0.5)
const graphRef = ref<InstanceType<typeof MotionGraph> | null>(null)
const showInfo = ref(false)

// Watch position changes and emit + graph
watch(
  () => (inputMode.value === 'teledong' ? teledong.position.value : sliderPosition.value),
  (pos) => {
    emit('position', pos)
    graphRef.value?.addInputPoint(pos)
  }
)

defineExpose({
  addInputPoint: (value: number) => graphRef.value?.addInputPoint(value),
  addOutputPoint: (value: number) => graphRef.value?.addOutputPoint(value),
  setSliderPosition: (value: number) => { sliderPosition.value = value },
})

const isWebUSBSupported = !!navigator.usb

function statusDotClass(): string {
  if (inputMode.value === 'slider') return 'ok'
  switch (teledong.state.value) {
    case TeledongState.Ok:
      return 'ok'
    case TeledongState.Calibrating:
      return 'warning'
    case TeledongState.Error:
      return 'error'
    default:
      return 'off'
  }
}

function statusText(): string {
  if (inputMode.value === 'slider') return 'Slider input enabled'
  switch (teledong.state.value) {
    case TeledongState.Ok:
      return 'Teledong connected, OK'
    case TeledongState.Calibrating:
      return 'Calibrating...'
    case TeledongState.Error:
      return 'ERROR'
    default:
      return 'Not connected'
  }
}
</script>

<template>
  <div class="panel">
    <div class="panel-title">Input Device</div>

    <div v-if="!isWebUSBSupported" class="chromium-warning">
      WebUSB is not supported in this browser. Use Chrome, Edge, or Opera for Teledong USB
      connection.
    </div>

    <div class="field-group">
      <div class="row" style="margin-bottom: 8px">
        <button
          :class="{ secondary: inputMode !== 'teledong' }"
          class="small"
          @click="inputMode = 'teledong'"
        >
          Teledong
        </button>
        <button
          :class="{ secondary: inputMode !== 'slider' }"
          class="small"
          @click="inputMode = 'slider'"
        >
          Slider
        </button>
      </div>
    </div>

    <div class="field-group">
      <div class="row">
        <span class="status-dot" :class="statusDotClass()"></span>
        <span>{{ statusText() }}</span>
      </div>
    </div>

    <div v-if="teledong.error.value" class="text-error" style="margin-bottom: 8px">
      {{ teledong.error.value }}
    </div>

    <div v-if="teledong.badCalibrationWarning.value && inputMode === 'teledong'" class="text-warning" style="margin-bottom: 8px">
      Bad calibration detected. Please recalibrate.
    </div>

    <div class="field-group row" v-if="inputMode === 'teledong'">
      <button
        @click="teledong.connect()"
        :disabled="!isWebUSBSupported || teledong.state.value !== 'NotConnected'"
      >
        Connect
      </button>
      <button
        @click="teledong.disconnect()"
        class="secondary"
        :disabled="teledong.state.value === 'NotConnected'"
      >
        Disconnect
      </button>
      <button
        @click="teledong.calibrate()"
        class="secondary"
        :disabled="
          teledong.state.value === 'NotConnected' || teledong.state.value === 'Calibrating'
        "
      >
        Calibrate
      </button>
    </div>

    <div v-if="inputMode === 'slider'" class="slider-container">
      <input
        type="range"
        min="0"
        max="1"
        step="0.005"
        v-model.number="sliderPosition"
        class="vertical-slider"
        orient="vertical"
      />
      <span class="text-muted">{{ sliderPosition.toFixed(2) }}</span>
    </div>

    <MotionGraph ref="graphRef" />

    <div style="margin-top: 8px">
      <button class="small secondary" @click="showInfo = !showInfo">
        {{ showInfo ? 'Hide' : 'Show' }} Debug Info
      </button>
    </div>

    <div v-if="showInfo" class="info-panel">
      <div class="text-muted">
        State: {{ teledong.state.value }}<br />
        Sunlight mode: {{ teledong.sunlightMode.value }}<br />
        Position: {{ inputMode === 'teledong' ? teledong.position.value.toFixed(3) : sliderPosition.toFixed(3) }}<br />
        <template v-if="teledong.sensorValues.value.length > 0">
          Raw sensors: {{ teledong.sensorValues.value.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join(' ') }}
        </template>
      </div>
      <button
        v-if="inputMode === 'teledong' && teledong.state.value !== 'NotConnected'"
        class="small secondary"
        style="margin-top: 4px"
        @click="teledong.getRawSensorValues()"
      >
        Read Sensors
      </button>
    </div>
  </div>
</template>

<style scoped>
.info-panel {
  margin-top: 8px;
  padding: 8px;
  background: var(--bg-input);
  border-radius: 6px;
  font-family: monospace;
  font-size: 12px;
}

.slider-container {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
  height: 150px;
}

.vertical-slider {
  writing-mode: vertical-lr;
  direction: rtl;
  height: 100%;
  width: 32px;
  cursor: pointer;
}
</style>
