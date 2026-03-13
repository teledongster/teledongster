// Handy output driver - HSP (Handy Streaming Protocol)
// Pushes points directly to the device buffer via the HSP v3 API.
// Alternative to the STREAM protocol driver in handy.ts.

import { OutputProcessor, type OutputCallback } from './output-processor'
import type { DiagnosticConfig, DiagnosticDataPoint, DiagnosticResult } from './handy'

export type { DiagnosticConfig, DiagnosticDataPoint, DiagnosticResult }

const HSP_API_URL = 'https://www.handyfeeling.com/api/handy-rest/v3/'
const DEVICE_API_URL = 'https://www.handyfeeling.com/api/handy-rest/v3-next'
const HSP_AUTH_TOKEN = '6TpU0euyxpYGZFoeQ~AimuZl__kU57U~'
const APP_ID = 'Bl4tZ-SEEDFxQMy1.2~GJdv2dAZp3OjW'
const BATCH_SIZE = 100
const THRESHOLD = 20
const PUSH_INTERVAL_MS = 200
const POSITION_DEAD_ZONE = 3

interface HspState {
  stream_id: number
  tail_point_stream_index: number
  tail_point_stream_index_threshold: number
  play_state: number | string
  points: number
  max_points: number
  current_point: number
  current_time: number
}

interface StreamPoint {
  t: number // ms from start
  x: number // 0-100
}

interface SliderState {
  position: number        // 0-1 (can be slightly negative)
  position_absolute: number // mm
  speed_absolute: number  // mm/s
  dir: boolean
  motor_temp: number
}

export class HandyHspDriver {
  connectionKey = ''
  connected = false
  errorMessage: string | null = null
  processor: OutputProcessor

  private outputHandler: OutputCallback
  private statusListeners: Array<() => void> = []

  // HSP state
  private streamId: number | null = null
  private startTime = 0
  private clientServerTimeOffset = 0
  private lastPointX = -1
  private eventSource: EventSource | null = null
  private streamPoints: StreamPoint[] = []
  private pushTimer: ReturnType<typeof setInterval> | null = null
  private isPushing = false
  private tailPointStreamIndex = 0
  private playbackStarted = false
  private pointsAccumulated = 0

  // Derived from processor filterTime -- acts as the buffer-ahead window
  private get millisecondsOffset(): number {
    return this.processor.filterTimeMs
  }

  onStatusChange(listener: () => void): () => void {
    this.statusListeners.push(listener)
    return () => {
      const idx = this.statusListeners.indexOf(listener)
      if (idx >= 0) this.statusListeners.splice(idx, 1)
    }
  }

  private notifyStatusChange() {
    for (const l of this.statusListeners) l()
  }

  constructor() {
    this.processor = new OutputProcessor()
    this.processor.skipFiltering = true
    this.processor.peakMotionMode = false
    this.processor.filterTimeMs = 600
    this.outputHandler = (e) => this.onPoint(e)
    this.processor.onOutput(this.outputHandler)
  }

  // HSP API request (v3 with Bearer token auth)
  private async hspRequest(
    endpoint: string,
    method: 'GET' | 'PUT',
    body?: any,
    quiet = false,
  ): Promise<{ ok: boolean; result?: any; error?: any }> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'Authorization': `Bearer ${HSP_AUTH_TOKEN}`,
      'X-Connection-Key': this.connectionKey,
    }
    const options: RequestInit = { method, headers }
    if (body !== undefined && method !== 'GET') {
      headers['Content-Type'] = 'application/json'
      options.body = JSON.stringify(body)
    }

    try {
      const response = await fetch(`${HSP_API_URL}${endpoint}`, options)
      const text = await response.text()
      const data = text ? JSON.parse(text) : null
      if (!quiet) console.log(`HSP ${method} ${endpoint} -> ${response.status}`, data)
      if (response.ok) {
        const result = data?.result ?? data
        return { ok: true, result }
      }
      return { ok: false, error: data?.error ?? data }
    } catch (e) {
      return { ok: false, error: e }
    }
  }

  // Device REST API request (v3-next with APP_ID, for slider/state polling)
  private async deviceRequest(
    endpoint: string,
    method: 'GET' | 'PUT',
    body?: any,
    quiet = false,
  ): Promise<{ ok: boolean; result?: any; error?: any }> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'X-Connection-Key': this.connectionKey,
      'X-Api-Key': APP_ID,
    }
    const options: RequestInit = { method, headers }
    if (body !== undefined && method !== 'GET') {
      headers['Content-Type'] = 'application/json'
      options.body = JSON.stringify(body)
    }

    try {
      const response = await fetch(`${DEVICE_API_URL}/${endpoint}`, options)
      const text = await response.text()
      const data = text ? JSON.parse(text) : null
      if (!quiet) console.log(`Device ${method} ${endpoint} -> ${response.status}`, data)
      if (response.ok) {
        const result = data?.result ?? data
        return { ok: true, result }
      }
      return { ok: false, error: data?.error ?? data }
    } catch (e) {
      return { ok: false, error: e }
    }
  }

  private async getClientServerTimeOffset(): Promise<number> {
    const numSamples = 10
    let timeoutCount = 5
    let offsetTimeSum = 0

    for (let i = 0; i < numSamples; i++) {
      const t0 = performance.now()
      const resp = await this.hspRequest('servertime', 'GET', undefined, true)
      const roundtripMs = performance.now() - t0

      const serverTime = resp.result?.server_time
      if (!serverTime || serverTime <= 0) {
        if (timeoutCount-- <= 0) throw new Error('Failed to get servertime')
        i--
        continue
      }

      const clientTime = Date.now()
      const estimatedServerReceiveTime = serverTime + roundtripMs / 2
      offsetTimeSum += estimatedServerReceiveTime - clientTime
    }

    const offset = Math.round(offsetTimeSum / numSamples)
    console.log('Client-server offset:', offset, 'ms')
    return offset
  }

  // Called synchronously from OutputProcessor -- buffer point for HSP push.
  // Dead zone filters noise after input-level smoothing.
  private onPoint(e: { position: number; duration: number }) {
    if (!this.connected || this.streamId === null) return

    const now = Date.now()
    if (this.startTime === 0) this.startTime = now

    const x = Math.max(0, Math.min(100, Math.round(e.position * 100)))

    // Dead zone: ignore changes smaller than threshold
    if (this.lastPointX >= 0 && Math.abs(x - this.lastPointX) < POSITION_DEAD_ZONE) return
    this.lastPointX = x

    const t = Math.round(now - this.startTime) + this.millisecondsOffset
    this.streamPoints.push({ t, x })
    this.pointsAccumulated++
  }

  // Push next batch of points from streamPoints to device buffer.
  // Starts from device's tail_point_stream_index.
  private async pushToDevice() {
    if (this.isPushing || this.streamId === null) return
    this.isPushing = true

    try {
      // Determine which points to push based on device's tail index
      const startIdx = this.tailPointStreamIndex
      const endIdx = Math.min(startIdx + BATCH_SIZE, this.streamPoints.length)

      if (startIdx >= this.streamPoints.length) {
        return // nothing to push
      }

      const batch = this.streamPoints.slice(startIdx, endIdx)
      if (batch.length === 0) return

      const resp = await this.hspRequest('hsp/add', 'PUT', {
        points: batch,
        flush: false,
        tail_point_stream_index: startIdx,
      })

      if (resp.ok) {
        const state = resp.result as HspState
        this.tailPointStreamIndex = state.tail_point_stream_index

        // Set threshold for buffer-low notification
        await this.hspRequest('hsp/threshold', 'PUT', {
          tail_point_threshold: THRESHOLD,
        }, true)
      } else {
        console.error('Failed to push points to device:', resp.error)
      }
    } catch (ex) {
      console.error('Failed to push to device:', ex)
    } finally {
      this.isPushing = false
    }
  }

  private startPushTimer() {
    this.stopPushTimer()
    this.pushTimer = setInterval(() => this.pushToDevice(), PUSH_INTERVAL_MS)
  }

  private stopPushTimer() {
    if (this.pushTimer != null) {
      clearInterval(this.pushTimer)
      this.pushTimer = null
    }
  }

  private setupSSE() {
    const url = `${HSP_API_URL}sse?ck=${encodeURIComponent(this.connectionKey)}&apikey=${encodeURIComponent(HSP_AUTH_TOKEN)}&events=hsp_threshold_reached,hsp_starving,hsp_state_changed`
    this.eventSource = new EventSource(url)

    this.eventSource.addEventListener('hsp_threshold_reached', () => {
      console.log('SSE [hsp_threshold_reached] - pushing more data')
      this.pushToDevice()
    })

    this.eventSource.addEventListener('hsp_starving', () => {
      console.warn('SSE [hsp_starving] - device buffer empty, pushing data')
      this.pushToDevice()
    })

    this.eventSource.addEventListener('hsp_state_changed', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        console.log('SSE [hsp_state_changed]', data)
      } catch {}
    })

    this.eventSource.onmessage = (e) => {
      if (e.type !== 'message') return
      console.log('SSE [unknown]', e.data)
    }

    this.eventSource.onerror = () => {
      console.warn('SSE connection error')
    }
  }

  async start(): Promise<void> {
    if (!this.connectionKey) {
      this.errorMessage = 'Please enter a connection key.'
      this.notifyStatusChange()
      return
    }

    try {
      // 1. Sync clocks
      this.clientServerTimeOffset = await this.getClientServerTimeOffset()

      // 2. Clean up local state
      this.stopPushTimer()
      if (this.eventSource) {
        this.eventSource.close()
        this.eventSource = null
      }

      // Stop any existing HSP playback
      if (this.streamId !== null) {
        await this.hspRequest('hsp/stop', 'PUT', undefined, true)
        await this.hspRequest('hsp/flush', 'PUT', undefined, true)
      }

      // 3. Reset state
      this.startTime = 0
      this.lastPointX = -1
      this.playbackStarted = false
      this.streamPoints = []
      this.tailPointStreamIndex = 0
      this.isPushing = false
      this.pointsAccumulated = 0

      // 4. Setup SSE
      this.setupSSE()

      // 5. Setup HSP stream on device
      const streamId = Math.floor(Math.random() * 2147483647)
      const setupResp = await this.hspRequest('hsp/setup', 'PUT', {
        stream_id: streamId,
      })
      if (!setupResp.ok) {
        const err = setupResp.error
        this.errorMessage = 'Failed to setup HSP stream on device.'
        if (err?.code === 1001) {
          this.errorMessage +=
            ' Make sure it is updated to FW4, is online, and the connection key is correct.'
        }
        this.notifyStatusChange()
        return
      }
      this.streamId = streamId

      // 6. Start push timer - playback starts when first input arrives
      this.startPushTimer()

      this.connected = true
      this.errorMessage = null
      console.log('HSP stream ready, waiting for first input to start playback')
    } catch (e) {
      this.errorMessage =
        'Something went wrong: ' + (e instanceof Error ? e.message : String(e))
      await this.cleanup()
    }

    this.notifyStatusChange()
  }

  private async startPlayback() {
    const now = Date.now()
    const resp = await this.hspRequest('hsp/play', 'PUT', {
      startTime: 0,
      serverTime: now + this.clientServerTimeOffset,
      playbackRate: 1.0,
      loop: false,
    })

    if (!resp.ok) {
      this.errorMessage = 'Failed to start HSP playback. Try again.'
      this.notifyStatusChange()
    }
  }

  private async cleanup() {
    this.stopPushTimer()

    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    // Stop playback on device
    if (this.streamId !== null) {
      try {
        await this.hspRequest('hsp/stop', 'PUT')
      } catch {
        // ignore
      }
      try {
        await this.hspRequest('hsp/flush', 'PUT')
      } catch {
        // ignore
      }
    }
    this.streamId = null
  }

  async stop() {
    this.connected = false
    this.errorMessage = null

    try {
      await this.cleanup()
    } catch {
      // ignore
    }

    this.notifyStatusChange()
  }

  private _testPatternRunning = false
  private _testPatternTimer: ReturnType<typeof setInterval> | null = null

  private _diagnosticRunning = false
  private _diagnosticTimer: ReturnType<typeof setTimeout> | null = null
  private _diagnosticSendTimer: ReturnType<typeof setInterval> | null = null
  private _diagnosticPollTimer: ReturnType<typeof setInterval> | null = null
  private _diagnosticResolve: ((result: DiagnosticResult | null) => void) | null = null

  get isTestPatternRunning() {
    return this._testPatternRunning
  }

  get isDiagnosticRunning() {
    return this._diagnosticRunning
  }

  inputPosition(position: number) {
    if (!this.connected || this._testPatternRunning || this._diagnosticRunning) return

    this.onPoint({ position, duration: 0 })

    // After accumulating 3+ points, do initial push + start playback
    if (!this.playbackStarted && this.pointsAccumulated >= 3) {
      this.playbackStarted = true
      this.pushToDevice().then(() => this.startPlayback())
      console.log('HSP playback starting after initial points accumulated')
    }
  }

  get statusText(): string {
    if (this.connected) return `Connected to [${this.connectionKey}] (HSP)`
    return 'Not connected'
  }

  destroy() {
    this.stop()
    this.processor.removeOutput(this.outputHandler)
  }

  // --- Test Pattern ---

  // Runs a triangle wave test pattern on the device.
  // Bypasses OutputProcessor and dead zone -- pre-generates points, pushes to
  // device buffer, then plays back.
  async runTestPattern(onPoint?: (position: number) => void): Promise<void> {
    if (!this.connected || this._testPatternRunning || this._diagnosticRunning) return

    this._testPatternRunning = true
    this.notifyStatusChange()

    // Reset HSP for test pattern
    await this.cleanup()

    this.startTime = 0
    this.lastPointX = -1
    this.playbackStarted = false
    this.streamPoints = []
    this.tailPointStreamIndex = 0
    this.pointsAccumulated = 0

    // Setup SSE and new HSP stream
    this.setupSSE()
    const streamId = Math.floor(Math.random() * 2147483647)
    const setupResp = await this.hspRequest('hsp/setup', 'PUT', {
      stream_id: streamId,
    })
    if (!setupResp.ok) {
      this.errorMessage = 'Failed to setup HSP stream for test pattern.'
      this._testPatternRunning = false
      this.notifyStatusChange()
      return
    }
    this.streamId = streamId

    // Generate test pattern: short bounces at bottom, middle, then top
    const bounceAmp = 15
    const bounceDuration = 400 // ms per up-down
    const transitionMs = 600 // ms to glide between levels
    const levels = [15, 50, 85]
    const bouncesPerLevel = 2
    const testPoints: StreamPoint[] = []
    let t = 0

    const addPoint = (x: number) => {
      testPoints.push({ t: t + this.millisecondsOffset, x: Math.max(0, Math.min(100, x)) })
    }

    for (let li = 0; li < levels.length; li++) {
      const center = levels[li]

      // Transition: single keypoint at destination -- device glides there
      if (li > 0) {
        t += transitionMs
        addPoint(center - bounceAmp)
      }

      // Bounces: just bottom/top keypoints
      for (let b = 0; b < bouncesPerLevel; b++) {
        addPoint(center - bounceAmp)
        t += bounceDuration / 2
        addPoint(center + bounceAmp)
        t += bounceDuration / 2
      }
      addPoint(center - bounceAmp)
    }

    const durationMs = t

    // Hold at final position so the device doesn't drift when buffer runs dry
    const lastX = testPoints[testPoints.length - 1].x
    testPoints.push({ t: t + 30000 + this.millisecondsOffset, x: lastX })

    // Push all points to device buffer in batches
    for (let i = 0; i < testPoints.length; i += BATCH_SIZE) {
      const batch = testPoints.slice(i, i + BATCH_SIZE)
      await this.hspRequest('hsp/add', 'PUT', {
        points: batch,
        flush: false,
        tail_point_stream_index: i,
      }, true)
    }

    // Start playback
    this.startTime = Date.now()
    const now = Date.now()
    const resp = await this.hspRequest('hsp/play', 'PUT', {
      startTime: 0,
      serverTime: now + this.clientServerTimeOffset,
      playbackRate: 1.0,
      loop: false,
    })
    if (!resp.ok) {
      this.errorMessage = 'Failed to start test pattern playback.'
      this._testPatternRunning = false
      this.notifyStatusChange()
      return
    }

    // Display points on graph in real-time
    let pointIndex = 0
    return new Promise<void>((resolve) => {
      this._testPatternTimer = setInterval(() => {
        const elapsed = Date.now() - this.startTime
        // Emit all points up to current time for graph display
        while (pointIndex < testPoints.length) {
          const p = testPoints[pointIndex]
          const pointTime = p.t - this.millisecondsOffset
          if (pointTime > elapsed) break
          onPoint?.(p.x / 100)
          pointIndex++
        }

        if (elapsed >= durationMs + 500 || !this.connected) {
          this.stopTestPattern()
          resolve()
        }
      }, 50)
    })
  }

  stopTestPattern() {
    if (this._testPatternTimer != null) {
      clearInterval(this._testPatternTimer)
      this._testPatternTimer = null
    }
    this._testPatternRunning = false
    this.notifyStatusChange()
  }

  // --- Diagnostic Mode ---

  async getSliderState(): Promise<SliderState | null> {
    const resp = await this.deviceRequest('slider/state', 'GET', undefined, true)
    if (!resp.ok) return null
    return resp.result as SliderState
  }

  // Generate pattern points for diagnostic. Returns array of {t, x} for the full duration.
  // 'bounce' is the default: bounces at top/mid/bottom in a sequence that tests
  // different regions, transitions, and speeds.
  private generateDiagnosticPattern(pattern: DiagnosticConfig['pattern'], durationMs: number, intervalMs: number): { t: number; x: number }[] {
    const points: { t: number; x: number }[] = []

    if (pattern === 'bounce') {
      // Sequence of bounce zones: [center, amplitude, bounceMs, count]
      // Tests different regions, speeds, and stroke sizes
      const zones: [number, number, number, number][] = [
        [50, 45, 600, 2],  // full stroke, slow warmup
        [80, 12, 350, 3],  // top, small fast bounces
        [50, 25, 500, 3],  // middle, medium speed, half stroke
        [20, 12, 350, 3],  // bottom, small fast bounces
        [50, 45, 400, 3],  // full stroke, medium speed
        [80, 10, 250, 4],  // top, tiny fast bounces
        [50, 15, 600, 2],  // middle, small slow bounces
        [20, 10, 250, 4],  // bottom, tiny fast bounces
        [50, 45, 300, 3],  // full stroke, fast
        [80, 12, 400, 2],  // top, small slow
        [50, 25, 350, 3],  // middle, medium fast
        [20, 12, 400, 2],  // bottom, small slow
      ]
      const transitionMs = 500
      let t = 0

      for (let zi = 0; zi < zones.length; zi++) {
        const [center, amp, bounceMs, count] = zones[zi]
        // Transition to zone start
        if (zi > 0) {
          points.push({ t, x: center - amp })
          t += transitionMs
        }
        // Bounces
        for (let b = 0; b < count; b++) {
          points.push({ t, x: center - amp })
          t += bounceMs / 2
          points.push({ t, x: center + amp })
          t += bounceMs / 2
        }
        points.push({ t, x: center - amp })
      }
      return points
    }

    // Other pattern types use computed values at each interval
    const numPoints = Math.floor(durationMs / intervalMs)
    for (let i = 0; i <= numPoints; i++) {
      const t = i * intervalMs
      const progress = Math.min(t / durationMs, 1)
      let x: number
      switch (pattern) {
        case 'ramp': {
          const v = progress < 0.5 ? progress * 2 : 2 - progress * 2
          x = Math.round(v * 80 + 10)
          break
        }
        case 'step': {
          const steps = [10, 30, 50, 70, 90, 70, 50, 30, 10]
          x = steps[Math.min(Math.floor(progress * steps.length), steps.length - 1)]
          break
        }
        case 'sine':
          x = Math.round(50 + 40 * Math.sin(2 * Math.PI * progress * 3))
          break
        case 'triangle':
        default: {
          const cycles = 4
          const phase = (progress * cycles) % 1
          const v = phase < 0.5 ? phase * 2 : 2 - phase * 2
          x = Math.round(v * 80 + 10)
          break
        }
      }
      points.push({ t, x })
    }
    return points
  }

  // Interpolate between keypoints at time t
  private interpolatePattern(keypoints: { t: number; x: number }[], t: number): number | null {
    if (keypoints.length === 0) return null
    if (t <= keypoints[0].t) return keypoints[0].x
    if (t >= keypoints[keypoints.length - 1].t) return keypoints[keypoints.length - 1].x
    for (let i = 1; i < keypoints.length; i++) {
      if (keypoints[i].t >= t) {
        const p = keypoints[i - 1], c = keypoints[i]
        return p.x + (c.x - p.x) * (t - p.t) / (c.t - p.t)
      }
    }
    return null
  }

  // Live diagnostic: feeds pattern through the real input pipeline
  // (onPoint -> streamPoints -> pushToDevice) while polling device position.
  // Requires an active connection -- uses the existing HSP stream, no re-setup.
  async runDiagnostic(
    config: Partial<DiagnosticConfig> = {},
    onSentPoint?: (position: number) => void,
    onActualPoint?: (position: number) => void,
  ): Promise<DiagnosticResult | null> {
    if (!this.connected || this._testPatternRunning || this._diagnosticRunning) return null

    const cfg: DiagnosticConfig = {
      pattern: config.pattern ?? 'bounce',
      durationMs: config.durationMs ?? 15000,
      pushIntervalMs: config.pushIntervalMs ?? 50,
      timestampOffsetMs: config.timestampOffsetMs ?? 150,
      pollIntervalMs: config.pollIntervalMs ?? 50,
    }

    this._diagnosticRunning = true
    this.notifyStatusChange()

    // Generate pattern keypoints
    const keypoints = this.generateDiagnosticPattern(cfg.pattern, cfg.durationMs, cfg.pushIntervalMs)
    const actualDurationMs = keypoints.length > 0 ? keypoints[keypoints.length - 1].t : cfg.durationMs

    console.log(`Diagnostic: live mode, ${keypoints.length} keypoints, ${actualDurationMs}ms duration`)

    // Probe slider state to verify API availability
    const probeState = await this.getSliderState()
    console.log('Diagnostic: slider probe result:', probeState)

    const sentPoints: { t: number; x: number }[] = []
    const actualPoints: { t: number; x: number }[] = []
    const diagnosticStart = Date.now()

    // Pre-feed a few points and start playback before entering the timed loops.
    // Without this, pushToDevice sends data but the device never plays it.
    for (let i = 0; i < 5; i++) {
      const t = i * 30
      const x = this.interpolatePattern(keypoints, t)
      if (x !== null) this.onPoint({ position: x / 100, duration: 0 })
    }
    await this.pushToDevice()
    this.startTime = Date.now()
    await this.startPlayback()
    console.log('HSP diagnostic: playback started')

    return new Promise<DiagnosticResult | null>((resolve) => {
      this._diagnosticResolve = resolve

      // Feed interpolated pattern through the live input path every ~30ms.
      // This simulates continuous input going through
      // onPoint -> dead zone -> streamPoints -> pushToDevice.
      this._diagnosticSendTimer = setInterval(() => {
        if (!this._diagnosticRunning) return
        const elapsed = Date.now() - diagnosticStart
        if (elapsed > actualDurationMs) return

        const x = this.interpolatePattern(keypoints, elapsed)
        if (x === null) return

        // Feed through the real live path
        this.onPoint({ position: x / 100, duration: 0 })
        sentPoints.push({ t: elapsed, x })
        onSentPoint?.(x / 100)
      }, 30)

      // Poll loop: temporarily pause push timer to avoid HTTP connection contention,
      // do the poll, then resume pushes. With 600ms offset buffer, a ~150ms pause is safe.
      let pollInFlight = false
      let pollCount = 0
      this._diagnosticPollTimer = setInterval(async () => {
        if (!this._diagnosticRunning || pollInFlight) return
        pollInFlight = true
        try {
          // Pause pushes so poll gets a clean connection
          this.stopPushTimer()
          const elapsed = Date.now() - diagnosticStart
          const state = await this.getSliderState()
          pollCount++
          if (state) {
            const x = Math.max(0, Math.min(1, state.position)) * 100
            actualPoints.push({ t: elapsed, x })
            onActualPoint?.(Math.max(0, Math.min(1, state.position)))
          }
        } finally {
          // Resume pushes
          if (this._diagnosticRunning) this.startPushTimer()
          pollInFlight = false
        }
      }, 200) // Poll every 200ms -- gives ~90 readings over 18s

      // End after duration + buffer
      this._diagnosticTimer = setTimeout(() => {
        this.finishDiagnostic(sentPoints, actualPoints, cfg)
      }, actualDurationMs + 1000)
    })
  }

  private finishDiagnostic(
    sentPoints: { t: number; x: number }[],
    actualPoints: { t: number; x: number }[],
    config: DiagnosticConfig,
  ) {
    if (this._diagnosticSendTimer) clearInterval(this._diagnosticSendTimer)
    if (this._diagnosticPollTimer) clearInterval(this._diagnosticPollTimer)
    if (this._diagnosticTimer) clearTimeout(this._diagnosticTimer)
    this._diagnosticSendTimer = null
    this._diagnosticPollTimer = null
    this._diagnosticTimer = null

    const result = this.computeDiagnosticResult(sentPoints, actualPoints, config)
    console.log('DIAG_RESULT', JSON.stringify(result))

    this._diagnosticRunning = false
    this.notifyStatusChange()
    this._diagnosticResolve?.(result)
    this._diagnosticResolve = null
  }

  stopDiagnostic() {
    if (!this._diagnosticRunning) return
    if (this._diagnosticSendTimer) clearInterval(this._diagnosticSendTimer)
    if (this._diagnosticPollTimer) clearInterval(this._diagnosticPollTimer)
    if (this._diagnosticTimer) clearTimeout(this._diagnosticTimer)
    this._diagnosticSendTimer = null
    this._diagnosticPollTimer = null
    this._diagnosticTimer = null
    this._diagnosticRunning = false
    this.notifyStatusChange()
    this._diagnosticResolve?.(null)
    this._diagnosticResolve = null
  }

  private computeDiagnosticResult(
    sentPoints: { t: number; x: number }[],
    actualPoints: { t: number; x: number }[],
    config: DiagnosticConfig,
  ): DiagnosticResult {
    const dataPoints: DiagnosticDataPoint[] = []
    for (const s of sentPoints) dataPoints.push({ t: s.t, sentX: s.x, actualX: null })
    for (const a of actualPoints) dataPoints.push({ t: a.t, sentX: null, actualX: a.x })
    dataPoints.sort((a, b) => a.t - b.t)

    if (sentPoints.length === 0 || actualPoints.length === 0) {
      return { latencyMs: 0, maxLatencyMs: 0, accuracyRms: 0, overshoot: 0, dataPoints, config }
    }

    function interp(timeline: { t: number; x: number }[], t: number): number | null {
      if (timeline.length === 0) return null
      if (t <= timeline[0].t) return timeline[0].x
      if (t >= timeline[timeline.length - 1].t) return timeline[timeline.length - 1].x
      for (let i = 1; i < timeline.length; i++) {
        if (timeline[i].t >= t) {
          const p = timeline[i - 1], c = timeline[i]
          return p.x + (c.x - p.x) * (t - p.t) / (c.t - p.t)
        }
      }
      return null
    }

    // Cross-correlation: find lag that minimizes RMS between actual and time-shifted sent
    let bestLag = 0
    let bestRms = Infinity
    for (let lag = 0; lag <= 2000; lag += 10) {
      let sumSq = 0, count = 0
      for (const a of actualPoints) {
        const s = interp(sentPoints, a.t - lag)
        if (s === null) continue
        sumSq += (a.x - s) ** 2
        count++
      }
      if (count > 0) {
        const rms = Math.sqrt(sumSq / count)
        if (rms < bestRms) { bestRms = rms; bestLag = lag }
      }
    }

    // Compute accuracy and overshoot with best lag
    let sumSq = 0, count = 0, maxOvershoot = 0
    for (const a of actualPoints) {
      const s = interp(sentPoints, a.t - bestLag)
      if (s === null) continue
      const err = a.x - s
      sumSq += err ** 2
      count++
      if (Math.abs(err) > maxOvershoot) maxOvershoot = Math.abs(err)
    }

    return {
      latencyMs: bestLag,
      maxLatencyMs: bestLag,
      accuracyRms: count > 0 ? Math.round(Math.sqrt(sumSq / count) * 100) / 100 : 0,
      overshoot: Math.round(maxOvershoot * 100) / 100,
      dataPoints,
      config,
    }
  }
}
