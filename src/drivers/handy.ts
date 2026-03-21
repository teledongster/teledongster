// Handy output driver - HDSP (Handy Direct Streaming Protocol)
// Fire-and-forget direct position commands. No buffering on device.
// Recommended by Lars for live sensor data: "just play a few points and forget about them."
//
// Uses PUT hdsp/xat: absolute position (mm) + time (ms to get there).
// Device plays points immediately on receipt, doesn't wait for current movement to finish.
// 5-10 commands/sec is fine; server-side throttling handles rate limiting.

import { OutputProcessor, type OutputCallback } from "./output-processor";

export interface DiagnosticConfig {
  pattern: "bounce" | "ramp" | "step" | "sine" | "triangle";
  durationMs: number;
  pushIntervalMs: number;
  timestampOffsetMs: number;
  pollIntervalMs: number;
}

export interface DiagnosticDataPoint {
  t: number;
  sentX: number | null;
  actualX: number | null;
}

export interface DiagnosticResult {
  latencyMs: number;
  maxLatencyMs: number;
  accuracyRms: number;
  overshoot: number;
  dataPoints: DiagnosticDataPoint[];
  config: DiagnosticConfig;
}

const API_URL = "https://www.handyfeeling.com/api/handy-rest/v3";
const APP_ID = "4p-wcc0RjG~wNyM4GThZ_zqqS-d1nTai";

const SEND_INTERVAL_MS = 100; // ~10 commands/sec
const POSITION_DEAD_ZONE = 1; // minimum change to send

interface SliderState {
  position: number; // 0-1
  position_absolute: number; // mm
  speed_absolute: number; // mm/s
  dir: boolean;
  motor_temp: number;
}

export class HandyDriver {
  connectionKey = "";
  connected = false;
  errorMessage: string | null = null;
  processor: OutputProcessor;

  private outputHandler: OutputCallback;
  private statusListeners: Array<() => void> = [];

  private sendTimer: ReturnType<typeof setInterval> | null = null;
  private currentX = -1; // latest target position 0-100
  private lastSentX = -1;
  private isSending = false;
  private sendCount = 0;
  private lastInputTime = 0;
  private movementStopped = false;

  onStatusChange(listener: () => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      const idx = this.statusListeners.indexOf(listener);
      if (idx >= 0) this.statusListeners.splice(idx, 1);
    };
  }

  private notifyStatusChange() {
    for (const l of this.statusListeners) l();
  }

  constructor() {
    this.processor = new OutputProcessor();
    this.processor.skipFiltering = true;
    this.processor.peakMotionMode = false;
    this.processor.filterTimeMs = 0; // no offset needed for HDSP
    this.outputHandler = (e) => this.onPoint(e);
    this.processor.onOutput(this.outputHandler);
  }

  private onPoint(e: { position: number; duration: number }) {
    if (!this.connected) return;
    const x = Math.max(0, Math.min(100, Math.round(e.position * 100)));
    this.lastInputTime = Date.now();
    // Only resume movement if position changed beyond dead zone
    if (
      this.movementStopped &&
      this.lastSentX >= 0 &&
      Math.abs(x - this.lastSentX) < POSITION_DEAD_ZONE
    ) {
      return; // still within dead zone, stay stopped
    }
    this.currentX = x;
    this.movementStopped = false;
  }

  // v3 API request
  private async apiRequest(
    endpoint: string,
    method: "GET" | "PUT",
    body?: any,
    quiet = false,
  ): Promise<{ ok: boolean; result?: any; error?: any }> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "X-Connection-Key": this.connectionKey,
      "X-Api-Key": APP_ID,
    };
    const options: RequestInit = { method, headers };
    if (body !== undefined && method !== "GET") {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${API_URL}/${endpoint}`, options);
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!quiet) console.log(`Handy ${method} ${endpoint} -> ${response.status}`, data);
      if (response.ok) {
        return { ok: true, result: data?.result ?? data };
      }
      return { ok: false, error: data?.error ?? data };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  async start(): Promise<void> {
    if (!this.connectionKey) {
      this.errorMessage = "Please enter a connection key.";
      this.notifyStatusChange();
      return;
    }

    try {
      // Verify device is reachable by checking server time
      const resp = await this.apiRequest("servertime", "GET");
      if (!resp.ok) {
        this.errorMessage = "Failed to reach Handy server. Check connection key.";
        this.notifyStatusChange();
        return;
      }

      // No setup needed for HDSP — fire-and-forget direct commands, no buffering.
      // Verify device is reachable by sending a test command (move to 10% in 1s).
      const testResp = await this.apiRequest("hdsp/xpt", "PUT", {
        xp: 0.1, // 0=bottom, 1=top — move near bottom on connect
        t: 1000,
        stop_on_target: true,
        immediate_rsp: false, // wait for device response to confirm connectivity
      });
      if (!testResp.ok) {
        const err = testResp.error;
        this.errorMessage = "Failed to send HDSP command to device.";
        if (err?.code === 1001) {
          this.errorMessage +=
            " Make sure it is updated to FW4, is online, and the connection key is correct.";
        }
        console.error("HDSP xat test failed:", testResp.error);
        this.notifyStatusChange();
        return;
      }
      console.log("HDSP test command successful:", testResp.result);

      this.currentX = -1;
      this.lastSentX = -1;
      this.isSending = false;
      this.startSendTimer();

      this.connected = true;
      this.errorMessage = null;
      console.log("HDSP ready, sending commands at", SEND_INTERVAL_MS, "ms interval");
    } catch (e) {
      this.errorMessage = "Something went wrong: " + (e instanceof Error ? e.message : String(e));
    }

    this.notifyStatusChange();
  }

  private async sendCommand() {
    if (!this.connected || this.currentX < 0) return;
    if (this.isSending) return; // previous command still in flight

    // If no new input for 200ms, stop the device and go idle
    if (this.lastInputTime > 0 && Date.now() - this.lastInputTime > 200) {
      if (!this.movementStopped) {
        this.movementStopped = true;
        await this.stopMovement();
      }
      return;
    }

    // Dead zone: ignore small changes from sensor noise, but stop device
    if (this.lastSentX >= 0 && Math.abs(this.currentX - this.lastSentX) < POSITION_DEAD_ZONE) {
      if (!this.movementStopped) {
        this.movementStopped = true;
        await this.stopMovement();
      }
      return;
    }

    this.isSending = true;
    const x = this.currentX;
    this.lastSentX = x;
    this.sendCount++;

    try {
      // Fire-and-forget: immediate_rsp means server returns without waiting for device
      await this.apiRequest(
        "hdsp/xpt",
        "PUT",
        {
          xp: x / 100, // convert 0-100 internal to 0-1 API range
          t: SEND_INTERVAL_MS,
          stop_on_target: false,
          immediate_rsp: true,
        },
        true,
      );
    } finally {
      this.isSending = false;
    }
  }

  private startSendTimer() {
    this.stopSendTimer();
    this.sendTimer = setInterval(() => this.sendCommand(), SEND_INTERVAL_MS);
  }

  private stopSendTimer() {
    if (this.sendTimer != null) {
      clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
  }

  // Send current position with stop_on_target to halt the device
  private async stopMovement() {
    if (this.lastSentX < 0) return;
    await this.apiRequest(
      "hdsp/xpt",
      "PUT",
      {
        xp: this.lastSentX / 100,
        t: 0,
        stop_on_target: true,
        immediate_rsp: true,
      },
      true,
    );
  }

  async stop() {
    this.stopSendTimer();
    await this.stopMovement();
    this.connected = false;
    this.errorMessage = null;
    this.notifyStatusChange();
  }

  inputPosition(position: number) {
    if (!this.connected || this._testPatternRunning || this._diagnosticRunning) return;
    this.onPoint({ position, duration: 0 });
  }

  get statusText(): string {
    if (this.connected) return `Connected to [${this.connectionKey}]`;
    return "Not connected";
  }

  destroy() {
    this.stop();
    this.processor.removeOutput(this.outputHandler);
  }

  // --- Test Pattern ---

  private _testPatternRunning = false;
  private _testPatternTimer: ReturnType<typeof setInterval> | null = null;

  get isTestPatternRunning() {
    return this._testPatternRunning;
  }

  async runTestPattern(onPoint?: (position: number) => void): Promise<void> {
    if (!this.connected || this._testPatternRunning || this._diagnosticRunning) return;

    this._testPatternRunning = true;
    this.notifyStatusChange();

    // Generate test pattern keypoints
    const bounceAmp = 15;
    const bounceDuration = 400;
    const transitionMs = 600;
    const levels = [15, 50, 85];
    const bouncesPerLevel = 2;
    const testPoints: { t: number; x: number }[] = [];
    let t = 0;

    for (let li = 0; li < levels.length; li++) {
      const center = levels[li];
      if (li > 0) {
        t += transitionMs;
        testPoints.push({ t, x: Math.max(0, Math.min(100, center - bounceAmp)) });
      }
      for (let b = 0; b < bouncesPerLevel; b++) {
        testPoints.push({ t, x: Math.max(0, Math.min(100, center - bounceAmp)) });
        t += bounceDuration / 2;
        testPoints.push({ t, x: Math.max(0, Math.min(100, center + bounceAmp)) });
        t += bounceDuration / 2;
      }
      testPoints.push({ t, x: Math.max(0, Math.min(100, center - bounceAmp)) });
    }

    const durationMs = t;
    const startTime = Date.now();

    return new Promise<void>((resolve) => {
      this._testPatternTimer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const x = this.interpolatePattern(testPoints, elapsed);
        if (x !== null) {
          this.currentX = x;
          this.lastInputTime = Date.now();
          this.movementStopped = false;
          onPoint?.(x / 100);
        }

        if (elapsed >= durationMs + 500 || !this.connected) {
          this.stopTestPattern();
          resolve();
        }
      }, 30);
    });
  }

  stopTestPattern() {
    if (this._testPatternTimer != null) {
      clearInterval(this._testPatternTimer);
      this._testPatternTimer = null;
    }
    this._testPatternRunning = false;
    this.notifyStatusChange();
  }

  // --- Diagnostic Mode ---

  private _diagnosticRunning = false;
  private _diagnosticTimer: ReturnType<typeof setTimeout> | null = null;
  private _diagnosticSendTimer: ReturnType<typeof setInterval> | null = null;
  private _diagnosticPollTimer: ReturnType<typeof setInterval> | null = null;
  private _diagnosticResolve: ((result: DiagnosticResult | null) => void) | null = null;

  get isDiagnosticRunning() {
    return this._diagnosticRunning;
  }

  async getSliderState(): Promise<SliderState | null> {
    const resp = await this.apiRequest("slider/state", "GET", undefined, true);
    if (!resp.ok) return null;
    return resp.result as SliderState;
  }

  private generateDiagnosticPattern(
    pattern: DiagnosticConfig["pattern"],
    durationMs: number,
    intervalMs: number,
  ): { t: number; x: number }[] {
    const points: { t: number; x: number }[] = [];

    if (pattern === "bounce") {
      const zones: [number, number, number, number][] = [
        [50, 45, 600, 2],
        [80, 12, 350, 3],
        [50, 25, 500, 3],
        [20, 12, 350, 3],
        [50, 45, 400, 3],
        [80, 10, 250, 4],
        [50, 15, 600, 2],
        [20, 10, 250, 4],
        [50, 45, 300, 3],
        [80, 12, 400, 2],
        [50, 25, 350, 3],
        [20, 12, 400, 2],
      ];
      const transitionMs = 500;
      let t = 0;

      for (let zi = 0; zi < zones.length; zi++) {
        const [center, amp, bounceMs, count] = zones[zi];
        if (zi > 0) {
          points.push({ t, x: center - amp });
          t += transitionMs;
        }
        for (let b = 0; b < count; b++) {
          points.push({ t, x: center - amp });
          t += bounceMs / 2;
          points.push({ t, x: center + amp });
          t += bounceMs / 2;
        }
        points.push({ t, x: center - amp });
      }
      return points;
    }

    const numPoints = Math.floor(durationMs / intervalMs);
    for (let i = 0; i <= numPoints; i++) {
      const t = i * intervalMs;
      const progress = Math.min(t / durationMs, 1);
      let x: number;
      switch (pattern) {
        case "ramp": {
          const v = progress < 0.5 ? progress * 2 : 2 - progress * 2;
          x = Math.round(v * 80 + 10);
          break;
        }
        case "step": {
          const steps = [10, 30, 50, 70, 90, 70, 50, 30, 10];
          x = steps[Math.min(Math.floor(progress * steps.length), steps.length - 1)];
          break;
        }
        case "sine":
          x = Math.round(50 + 40 * Math.sin(2 * Math.PI * progress * 3));
          break;
        case "triangle":
        default: {
          const cycles = 4;
          const phase = (progress * cycles) % 1;
          const v = phase < 0.5 ? phase * 2 : 2 - phase * 2;
          x = Math.round(v * 80 + 10);
          break;
        }
      }
      points.push({ t, x });
    }
    return points;
  }

  private interpolatePattern(keypoints: { t: number; x: number }[], t: number): number | null {
    if (keypoints.length === 0) return null;
    if (t <= keypoints[0].t) return keypoints[0].x;
    if (t >= keypoints[keypoints.length - 1].t) return keypoints[keypoints.length - 1].x;
    for (let i = 1; i < keypoints.length; i++) {
      if (keypoints[i].t >= t) {
        const p = keypoints[i - 1],
          c = keypoints[i];
        return p.x + ((c.x - p.x) * (t - p.t)) / (c.t - p.t);
      }
    }
    return null;
  }

  async runDiagnostic(
    config: Partial<DiagnosticConfig> = {},
    onSentPoint?: (position: number) => void,
    onActualPoint?: (position: number) => void,
  ): Promise<DiagnosticResult | null> {
    if (!this.connected || this._testPatternRunning || this._diagnosticRunning) return null;

    const cfg: DiagnosticConfig = {
      pattern: config.pattern ?? "bounce",
      durationMs: config.durationMs ?? 15000,
      pushIntervalMs: config.pushIntervalMs ?? SEND_INTERVAL_MS,
      timestampOffsetMs: config.timestampOffsetMs ?? 0,
      pollIntervalMs: config.pollIntervalMs ?? 50,
    };

    this._diagnosticRunning = true;
    this.notifyStatusChange();

    const keypoints = this.generateDiagnosticPattern(
      cfg.pattern,
      cfg.durationMs,
      cfg.pushIntervalMs,
    );
    const actualDurationMs =
      keypoints.length > 0 ? keypoints[keypoints.length - 1].t : cfg.durationMs;

    console.log(`HDSP Diagnostic: ${keypoints.length} keypoints, ${actualDurationMs}ms duration`);

    const probeState = await this.getSliderState();
    console.log("HDSP Diagnostic: slider probe result:", probeState);

    const sentPoints: { t: number; x: number }[] = [];
    const actualPoints: { t: number; x: number }[] = [];
    const diagnosticStart = Date.now();

    return new Promise<DiagnosticResult | null>((resolve) => {
      this._diagnosticResolve = resolve;

      // Feed pattern and send HDSP commands directly every ~30ms
      this._diagnosticSendTimer = setInterval(() => {
        if (!this._diagnosticRunning) return;
        const elapsed = Date.now() - diagnosticStart;
        if (elapsed > actualDurationMs) return;

        const x = this.interpolatePattern(keypoints, elapsed);
        if (x === null) return;

        // Set currentX so the send timer picks it up
        this.currentX = x;
        this.lastInputTime = Date.now();
        this.movementStopped = false;
        sentPoints.push({ t: elapsed, x });
        onSentPoint?.(x / 100);
      }, 30);

      // Poll device position. No send-pause for HDSP — with immediate_rsp,
      // responses are tiny so connection contention is minimal.
      this.sendCount = 0;
      let pollInFlight = false;
      this._diagnosticPollTimer = setInterval(async () => {
        if (!this._diagnosticRunning || pollInFlight) return;
        pollInFlight = true;
        try {
          const elapsed = Date.now() - diagnosticStart;
          const state = await this.getSliderState();
          if (state) {
            const x = Math.max(0, Math.min(1, state.position)) * 100;
            actualPoints.push({ t: elapsed, x });
            onActualPoint?.(Math.max(0, Math.min(1, state.position)));
          }
        } finally {
          pollInFlight = false;
        }
      }, 200);

      this._diagnosticTimer = setTimeout(() => {
        this.finishDiagnostic(sentPoints, actualPoints, cfg);
      }, actualDurationMs + 1000);
    });
  }

  private finishDiagnostic(
    sentPoints: { t: number; x: number }[],
    actualPoints: { t: number; x: number }[],
    config: DiagnosticConfig,
  ) {
    if (this._diagnosticSendTimer) clearInterval(this._diagnosticSendTimer);
    if (this._diagnosticPollTimer) clearInterval(this._diagnosticPollTimer);
    if (this._diagnosticTimer) clearTimeout(this._diagnosticTimer);
    this._diagnosticSendTimer = null;
    this._diagnosticPollTimer = null;
    this._diagnosticTimer = null;

    console.log(
      `HDSP Diagnostic done: ${this.sendCount} commands sent, ${actualPoints.length} poll readings`,
    );
    const result = this.computeDiagnosticResult(sentPoints, actualPoints, config);
    console.log("DIAG_RESULT", JSON.stringify(result));

    this._diagnosticRunning = false;
    this.notifyStatusChange();
    this._diagnosticResolve?.(result);
    this._diagnosticResolve = null;
  }

  stopDiagnostic() {
    if (!this._diagnosticRunning) return;
    if (this._diagnosticSendTimer) clearInterval(this._diagnosticSendTimer);
    if (this._diagnosticPollTimer) clearInterval(this._diagnosticPollTimer);
    if (this._diagnosticTimer) clearTimeout(this._diagnosticTimer);
    this._diagnosticSendTimer = null;
    this._diagnosticPollTimer = null;
    this._diagnosticTimer = null;
    this._diagnosticRunning = false;
    this.notifyStatusChange();
    this._diagnosticResolve?.(null);
    this._diagnosticResolve = null;
  }

  private computeDiagnosticResult(
    sentPoints: { t: number; x: number }[],
    actualPoints: { t: number; x: number }[],
    config: DiagnosticConfig,
  ): DiagnosticResult {
    const dataPoints: DiagnosticDataPoint[] = [];
    for (const s of sentPoints) dataPoints.push({ t: s.t, sentX: s.x, actualX: null });
    for (const a of actualPoints) dataPoints.push({ t: a.t, sentX: null, actualX: a.x });
    dataPoints.sort((a, b) => a.t - b.t);

    if (sentPoints.length === 0 || actualPoints.length === 0) {
      return { latencyMs: 0, maxLatencyMs: 0, accuracyRms: 0, overshoot: 0, dataPoints, config };
    }

    function interp(timeline: { t: number; x: number }[], t: number): number | null {
      if (timeline.length === 0) return null;
      if (t <= timeline[0].t) return timeline[0].x;
      if (t >= timeline[timeline.length - 1].t) return timeline[timeline.length - 1].x;
      for (let i = 1; i < timeline.length; i++) {
        if (timeline[i].t >= t) {
          const p = timeline[i - 1],
            c = timeline[i];
          return p.x + ((c.x - p.x) * (t - p.t)) / (c.t - p.t);
        }
      }
      return null;
    }

    let bestLag = 0;
    let bestRms = Infinity;
    for (let lag = 0; lag <= 2000; lag += 10) {
      let sumSq = 0,
        count = 0;
      for (const a of actualPoints) {
        const s = interp(sentPoints, a.t - lag);
        if (s === null) continue;
        sumSq += (a.x - s) ** 2;
        count++;
      }
      if (count > 0) {
        const rms = Math.sqrt(sumSq / count);
        if (rms < bestRms) {
          bestRms = rms;
          bestLag = lag;
        }
      }
    }

    let sumSq = 0,
      count = 0,
      maxOvershoot = 0;
    for (const a of actualPoints) {
      const s = interp(sentPoints, a.t - bestLag);
      if (s === null) continue;
      const err = a.x - s;
      sumSq += err ** 2;
      count++;
      if (Math.abs(err) > maxOvershoot) maxOvershoot = Math.abs(err);
    }

    return {
      latencyMs: bestLag,
      maxLatencyMs: bestLag,
      accuracyRms: count > 0 ? Math.round(Math.sqrt(sumSq / count) * 100) / 100 : 0,
      overshoot: Math.round(maxOvershoot * 100) / 100,
      dataPoints,
      config,
    };
  }
}
