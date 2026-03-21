<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useMotionGraph } from "../composables/useMotionGraph";

const props = defineProps<{
  interactive?: boolean;
  knobPosition?: number;
}>();

const emit = defineEmits<{
  drag: [value: number];
}>();

const graph = useMotionGraph();
const canvasRef = graph.canvasRef;
const containerRef = ref<HTMLElement | null>(null);
const dragging = ref(false);

onMounted(() => {
  graph.start();
});

watch(
  () => (props.interactive ? (props.knobPosition ?? 0.5) : null),
  (pos) => graph.setGuidePosition(pos),
  { immediate: true },
);

function clampPosition(clientY: number): number {
  const rect = containerRef.value?.getBoundingClientRect();
  if (!rect) return 0.5;
  const ratio = (clientY - rect.top) / rect.height;
  return Math.max(0, Math.min(1, 1 - ratio));
}

function onPointerDown(e: PointerEvent) {
  if (!props.interactive) return;
  dragging.value = true;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  emit("drag", clampPosition(e.clientY));
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return;
  emit("drag", clampPosition(e.clientY));
}

function onPointerUp() {
  dragging.value = false;
}

defineExpose({
  addInputPoint: graph.addInputPoint,
  addOutputPoint: graph.addOutputPoint,
});
</script>

<template>
  <div
    ref="containerRef"
    class="motion-graph"
    :class="{ interactive: props.interactive, dragging }"
    :style="{ touchAction: props.interactive ? 'none' : undefined }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <canvas ref="canvasRef" class="graph-canvas"></canvas>
    <div
      v-if="props.interactive"
      class="knob"
      :style="{ top: `${(1 - (props.knobPosition ?? 0.5)) * 100}%` }"
    ></div>
  </div>
</template>

<style scoped>
.motion-graph {
  position: relative;
  width: 100%;
  height: 120px;
  border-radius: 8px;
  overflow: visible;
  border: 1px solid var(--border);
}

.motion-graph.interactive {
  cursor: pointer;
}

.motion-graph.dragging {
  cursor: grabbing;
}

.graph-canvas {
  width: 100%;
  height: 100%;
  display: block;
  border-radius: 8px;
}

.knob {
  position: absolute;
  right: 0;
  width: 20px;
  height: 20px;
  margin-top: -10px;
  margin-right: -10px;
  background: var(--accent);
  border-radius: 50%;
  cursor: grab;
  opacity: 0.85;
}

.knob:hover,
.dragging .knob {
  opacity: 1;
}

.dragging .knob {
  cursor: grabbing;
}
</style>
