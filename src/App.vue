<script setup lang="ts">
import { ref } from "vue";
import InputPanel from "./components/InputPanel.vue";
import OutputPanel from "./components/OutputPanel.vue";

const inputPanelRef = ref<InstanceType<typeof InputPanel> | null>(null);
const outputPanelRef = ref<InstanceType<typeof OutputPanel> | null>(null);

function onPosition(value: number) {
  outputPanelRef.value?.inputPosition(value);
}

function onTestPatternPoint(position: number) {
  inputPanelRef.value?.addOutputPoint(position);
  inputPanelRef.value?.setSliderPosition(position);
}

function onDiagnosticSentPoint(position: number) {
  inputPanelRef.value?.addInputPoint(position);
}

function onDiagnosticActualPoint(position: number) {
  inputPanelRef.value?.addOutputPoint(position);
}
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <h1>Teledongster</h1>
    </header>
    <main class="app-main">
      <div class="panel-column">
        <InputPanel ref="inputPanelRef" @position="onPosition" />
      </div>
      <div class="panel-column">
        <OutputPanel
          ref="outputPanelRef"
          @test-pattern-point="onTestPatternPoint"
          @diagnostic-sent-point="onDiagnosticSentPoint"
          @diagnostic-actual-point="onDiagnosticActualPoint"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 16px;
}

.app-header {
  margin-bottom: 16px;
}

.app-header h1 {
  font-size: 22px;
  font-weight: 600;
  color: var(--accent-light);
}

.version {
  font-size: 14px;
  color: var(--text-muted);
  font-weight: 400;
}

.app-main {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

@media (max-width: 768px) {
  .app-main {
    grid-template-columns: 1fr;
  }
}

.panel-column {
  min-width: 0;
}
</style>
