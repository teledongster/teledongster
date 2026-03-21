import { ref, onUnmounted } from "vue";

interface GraphPoint {
  time: number; // ms
  value: number; // 0-1
}

export function useMotionGraph() {
  const canvasRef = ref<HTMLCanvasElement | null>(null);

  const inputPoints: GraphPoint[] = [];
  const outputPoints: GraphPoint[] = [];
  const windowMs = 10_000; // 10 second window
  let animFrame = 0;
  let startTime = Date.now();

  const MIN_INTERVAL_MS = 16; // ~60Hz max input rate
  let lastInputTime = 0;
  let lastOutputTime = 0;

  function addInputPoint(value: number) {
    const now = Date.now() - startTime;
    // Throttle: skip points that arrive faster than MIN_INTERVAL_MS
    if (now - lastInputTime < MIN_INTERVAL_MS) return;
    lastInputTime = now;
    inputPoints.push({ time: now, value });
    // Prune old points
    const cutoff = now - windowMs - 2000;
    while (inputPoints.length > 0 && inputPoints[0].time < cutoff) {
      inputPoints.shift();
    }
  }

  function addOutputPoint(value: number) {
    const now = Date.now() - startTime;
    if (now - lastOutputTime < MIN_INTERVAL_MS) return;
    lastOutputTime = now;
    outputPoints.push({ time: now, value });
    const cutoff = now - windowMs - 2000;
    while (outputPoints.length > 0 && outputPoints[0].time < cutoff) {
      outputPoints.shift();
    }
  }

  function render() {
    const canvas = canvasRef.value;
    if (!canvas) {
      animFrame = requestAnimationFrame(render);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      animFrame = requestAnimationFrame(render);
      return;
    }

    // Handle DPI scaling
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    }

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = "#0a0a1a";
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = "#1a1a3e";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const now = Date.now() - startTime;
    const windowStart = now - windowMs;

    function drawLine(points: GraphPoint[], color: string, lineWidth: number) {
      if (points.length < 2) return;
      ctx!.strokeStyle = color;
      ctx!.lineWidth = lineWidth * dpr;
      ctx!.beginPath();

      const GAP_THRESHOLD_MS = 200;
      let prevTime = -Infinity;
      for (const p of points) {
        if (p.time < windowStart) continue;
        const x = ((p.time - windowStart) / windowMs) * w;
        const y = (1 - p.value) * h; // 0 (fully in) at bottom, 1 (fully out) at top
        if (p.time - prevTime > GAP_THRESHOLD_MS) {
          ctx!.moveTo(x, y);
        } else {
          ctx!.lineTo(x, y);
        }
        prevTime = p.time;
      }

      ctx!.stroke();
    }

    drawLine(inputPoints, "#ffffff", 2);
    drawLine(outputPoints, "#9b59b6", 1.5);

    animFrame = requestAnimationFrame(render);
  }

  function start() {
    startTime = Date.now();
    inputPoints.length = 0;
    outputPoints.length = 0;
    animFrame = requestAnimationFrame(render);
  }

  function stop() {
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = 0;
    }
  }

  onUnmounted(() => {
    stop();
  });

  return {
    canvasRef,
    addInputPoint,
    addOutputPoint,
    start,
    stop,
  };
}
