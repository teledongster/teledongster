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
    <a
      href="https://github.com/teledongster/teledongster"
      class="github-corner"
      target="_blank"
      aria-label="View on GitHub"
    >
      <svg viewBox="0 0 16 16" width="24" height="24" fill="currentColor">
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
    </a>
    <header class="app-header">
      <h1><img src="/logo.svg" alt="" class="app-logo" /> Teledongster</h1>
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
.github-corner {
  position: fixed;
  top: 12px;
  right: 12px;
  color: var(--text-muted);
  opacity: 0.6;
  transition: opacity 0.2s;
}

.github-corner:hover {
  opacity: 1;
  color: var(--accent-light);
}

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
  display: flex;
  align-items: center;
  gap: 8px;
}

.app-logo {
  height: 28px;
  width: auto;
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
