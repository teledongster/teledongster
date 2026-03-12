<script setup lang="ts">
import { onMounted } from 'vue'
import { useMotionGraph } from '../composables/useMotionGraph'

const graph = useMotionGraph()
const canvasRef = graph.canvasRef

onMounted(() => {
  graph.start()
})

defineExpose({
  addInputPoint: graph.addInputPoint,
  addOutputPoint: graph.addOutputPoint,
})
</script>

<template>
  <div class="motion-graph">
    <canvas ref="canvasRef" class="graph-canvas"></canvas>
  </div>
</template>

<style scoped>
.motion-graph {
  width: 100%;
  height: 120px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
}

.graph-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
