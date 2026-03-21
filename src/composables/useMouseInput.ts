import { ref, readonly, onUnmounted } from "vue";

export function useMouseInput() {
  const position = ref(1.0);
  const enabled = ref(false);
  function onMouseMove(e: MouseEvent) {
    if (!enabled.value) return;
    const delta = e.movementY;
    position.value = Math.max(0, Math.min(1, position.value - delta / 200));
  }

  function enable() {
    enabled.value = true;
    window.addEventListener("mousemove", onMouseMove);
  }

  function disable() {
    enabled.value = false;
    window.removeEventListener("mousemove", onMouseMove);
  }

  onUnmounted(() => {
    disable();
  });

  return {
    position: readonly(position),
    enabled: readonly(enabled),
    enable,
    disable,
  };
}
