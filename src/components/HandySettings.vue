<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { HandyDriver } from "../drivers/handy";
import type { DiagnosticResult } from "../drivers/handy";

const props = defineProps<{
  driver: HandyDriver;
}>();

const emit = defineEmits<{
  save: [];
  "test-pattern-point": [position: number];
  "diagnostic-sent-point": [position: number];
  "diagnostic-actual-point": [position: number];
}>();

const connectionKey = ref(props.driver.connectionKey);
const statusText = ref(props.driver.statusText);
const errorMessage = ref(props.driver.errorMessage);
const testRunning = ref(false);
const diagnosticRunning = ref(false);
const diagnosticResult = ref<DiagnosticResult | null>(null);

let unsubscribe: (() => void) | null = null;

function subscribeDriver() {
  unsubscribe?.();
  unsubscribe = props.driver.onStatusChange(() => {
    statusText.value = props.driver.statusText;
    errorMessage.value = props.driver.errorMessage;
    testRunning.value = props.driver.isTestPatternRunning;
    diagnosticRunning.value = props.driver.isDiagnosticRunning;
  });
  // Sync initial state
  connectionKey.value = props.driver.connectionKey;
  statusText.value = props.driver.statusText;
  errorMessage.value = props.driver.errorMessage;
}

onMounted(() => subscribeDriver());
onUnmounted(() => unsubscribe?.());

// Re-subscribe when driver changes
watch(
  () => props.driver,
  () => {
    subscribeDriver();
  },
);

watch(connectionKey, (key) => {
  props.driver.connectionKey = key;
  emit("save");
});

async function connect() {
  props.driver.connectionKey = connectionKey.value;
  await props.driver.start();
  emit("save");
}

function disconnect() {
  props.driver.stop();
}

let testPatternRunning = false;
async function runTestPattern() {
  if (testPatternRunning) return;
  testPatternRunning = true;
  try {
    await props.driver.runTestPattern((pos) => {
      emit("test-pattern-point", pos);
    });
  } finally {
    testPatternRunning = false;
  }
}

function stopTestPattern() {
  props.driver.stopTestPattern();
}

async function runDiagnostic() {
  diagnosticResult.value = null;
  const result = await props.driver.runDiagnostic(
    {},
    (pos) => emit("diagnostic-sent-point", pos),
    (pos) => emit("diagnostic-actual-point", pos),
  );
  diagnosticResult.value = result;
}

function stopDiagnostic() {
  props.driver.stopDiagnostic();
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
        :disabled="!driver.connected || diagnosticRunning"
      >
        Test Pattern
      </button>
      <button v-else @click="stopTestPattern" class="secondary">Stop Test</button>
      <button
        v-if="!diagnosticRunning"
        @click="runDiagnostic"
        class="secondary"
        :disabled="!driver.connected || testRunning"
      >
        Diagnostic
      </button>
      <button v-else @click="stopDiagnostic" class="secondary">Stop Diag</button>
    </div>
    <div class="text-muted">{{ statusText }}</div>
    <div v-if="testRunning" class="text-muted">
      Running test pattern... compare purple (target) vs white (sensor) on the graph.
    </div>
    <div v-if="diagnosticRunning" class="text-muted">
      Running diagnostic... white = sent pattern, purple = actual device position.
    </div>
    <div v-if="errorMessage" class="text-error">{{ errorMessage }}</div>
    <div v-if="diagnosticResult" class="diag-results">
      <div class="text-muted"><strong>Diagnostic Results:</strong></div>
      <div class="text-muted">
        Latency: {{ diagnosticResult.latencyMs }}ms | RMS Error:
        {{ diagnosticResult.accuracyRms }} | Overshoot: {{ diagnosticResult.overshoot }} | Points:
        {{ diagnosticResult.dataPoints.length }}
      </div>
    </div>
  </div>
</template>
