<script setup lang="ts">
import { ref, watch, computed } from "vue";
import type { OutputDeviceEntry } from "../composables/useOutputDevices";
import type { OutputProcessor } from "../drivers/output-processor";

const props = defineProps<{
  device: OutputDeviceEntry;
}>();

const emit = defineEmits<{
  save: [];
}>();

const processor = computed<OutputProcessor>(() => props.device.driver.processor);

const peakMotionMode = ref(processor.value.peakMotionMode);
const filterTimeMs = ref(processor.value.filterTimeMs);
const filterStrength = ref(processor.value.filterStrength);

watch(
  () => props.device.id,
  () => {
    peakMotionMode.value = processor.value.peakMotionMode;
    filterTimeMs.value = processor.value.filterTimeMs;
    filterStrength.value = processor.value.filterStrength;
  },
);

watch(peakMotionMode, (v) => {
  processor.value.peakMotionMode = v;
  emit("save");
});

watch(filterTimeMs, (v) => {
  processor.value.filterTimeMs = v;
  emit("save");
});

watch(filterStrength, (v) => {
  processor.value.filterStrength = v;
  emit("save");
});
</script>

<template>
  <div class="advanced-settings">
    <div class="field-group">
      <label>
        <input type="checkbox" v-model="peakMotionMode" />
        Peak Motion Mode
      </label>
      <div class="text-muted">Only send position on direction change (reduces bandwidth)</div>
    </div>

    <div class="field-group">
      <label>Latency Buffer: {{ filterTimeMs }}ms</label>
      <input type="range" v-model.number="filterTimeMs" min="0" max="1000" step="50" />
    </div>

    <div class="field-group">
      <label>Filter Strength: {{ filterStrength.toFixed(2) }}</label>
      <input type="range" v-model.number="filterStrength" min="0" max="1" step="0.01" />
    </div>
  </div>
</template>

<style scoped>
.advanced-settings {
  padding: 12px;
  background: var(--bg-input);
  border-radius: 8px;
  margin-top: 8px;
}

.advanced-settings label input[type="checkbox"] {
  margin-right: 6px;
  accent-color: var(--accent);
}
</style>
