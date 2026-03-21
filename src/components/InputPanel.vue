<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import MotionGraph from "./MotionGraph.vue";
import { useTeledong } from "../composables/useTeledong";
import { TeledongState } from "../drivers/teledong-sdk";

const emit = defineEmits<{
  position: [value: number];
}>();

const inputMode = ref<"teledong" | "slider">("teledong");
const teledong = useTeledong();
const sliderPosition = ref(0.5);
const graphRef = ref<InstanceType<typeof MotionGraph> | null>(null);
const showInfo = ref(false);

// Watch position changes and emit + graph
watch(
  () => (inputMode.value === "teledong" ? teledong.position.value : sliderPosition.value),
  (pos) => {
    emit("position", pos);
    graphRef.value?.addInputPoint(pos);
  },
);

defineExpose({
  addInputPoint: (value: number) => graphRef.value?.addInputPoint(value),
  addOutputPoint: (value: number) => graphRef.value?.addOutputPoint(value),
  setSliderPosition: (value: number) => {
    sliderPosition.value = value;
  },
});

const isWebUSBSupported = !!navigator.usb;

const CALIBRATION_DURATION_S = 10;
const calibrationRemaining = ref(0);
let calibrationTimer: ReturnType<typeof setInterval> | null = null;

watch(
  () => teledong.state.value,
  (state) => {
    if (state === TeledongState.Calibrating) {
      calibrationRemaining.value = CALIBRATION_DURATION_S;
      calibrationTimer = setInterval(() => {
        calibrationRemaining.value--;
        if (calibrationRemaining.value <= 0 && calibrationTimer) {
          clearInterval(calibrationTimer);
          calibrationTimer = null;
        }
      }, 1000);
    } else if (calibrationTimer) {
      clearInterval(calibrationTimer);
      calibrationTimer = null;
    }
  },
);

onUnmounted(() => {
  if (calibrationTimer) clearInterval(calibrationTimer);
});

function statusDotClass(): string {
  if (inputMode.value === "slider") return "ok";
  switch (teledong.state.value) {
    case TeledongState.Ok:
      return "ok";
    case TeledongState.Calibrating:
      return "warning";
    case TeledongState.Error:
      return "error";
    default:
      return "off";
  }
}

function statusText(): string {
  if (inputMode.value === "slider") return "Slider input enabled";
  switch (teledong.state.value) {
    case TeledongState.Ok:
      return "Teledong connected, OK";
    case TeledongState.Calibrating:
      return `Calibrating... ${calibrationRemaining.value}s`;
    case TeledongState.Error:
      return "ERROR";
    default:
      return "Not connected";
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

    <div
      v-if="teledong.badCalibrationWarning.value && inputMode === 'teledong'"
      class="text-warning"
      style="margin-bottom: 8px"
    >
      Bad calibration detected. Please recalibrate.
    </div>

    <div class="mode-controls">
      <div class="field-group row" :style="{ visibility: inputMode === 'teledong' ? 'visible' : 'hidden' }">
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
      <div v-if="inputMode === 'slider'" class="slider-hint text-muted">
        Drag the knob on the graph or click anywhere to set position.
      </div>
    </div>

    <MotionGraph
      ref="graphRef"
      :interactive="inputMode === 'slider'"
      :knob-position="sliderPosition"
      @drag="sliderPosition = $event"
    />

    <div style="margin-top: 8px">
      <button class="small secondary" @click="showInfo = !showInfo">
        {{ showInfo ? "Hide" : "Show" }} Debug Info
      </button>
    </div>

    <div v-if="showInfo" class="info-panel">
      <div class="text-muted">
        State: {{ teledong.state.value }}<br />
        Sunlight mode: {{ teledong.sunlightMode.value }}<br />
        Position:
        {{
          inputMode === "teledong" ? teledong.position.value.toFixed(3) : sliderPosition.toFixed(3)
        }}<br />
        <template v-if="teledong.sensorValues.value.length > 0">
          Raw sensors:
          {{
            teledong.sensorValues.value
              .map((v) => v.toString(16).padStart(2, "0").toUpperCase())
              .join(" ")
          }}
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
.mode-controls {
  position: relative;
}

.slider-hint {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  height: 100%;
  font-size: 13px;
}

.info-panel {
  margin-top: 8px;
  padding: 8px;
  background: var(--bg-input);
  border-radius: 6px;
  font-family: monospace;
  font-size: 12px;
}
</style>
