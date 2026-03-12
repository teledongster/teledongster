// Handy output driver - STREAM protocol (v3 API) with SSE + periodic push
// Points are dumped raw into the stream buffer. A periodic timer and SSE events
// both trigger pushes to keep the device buffer full.

import { OutputProcessor, type OutputCallback } from './output-processor'

const DIRECT_API_URL = 'https://www.handyfeeling.com/api/handy-rest/v3/'
// Bypass proxy — go direct to reproduce CORS/OPTIONS behavior
const BASE_API_URL = DIRECT_API_URL
const AUTH_TOKEN = '6TpU0euyxpYGZFoeQ~AimuZl__kU57U~'

const BATCH_SIZE = 100
const THRESHOLD = 20
const PUSH_INTERVAL_MS = 200 // proactively push every 200ms
const POSITION_DEAD_ZONE = 3 // minimum change in 0-100 to count as real movement

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

export class HandyDriver {
  connectionKey = ''
  connected = false
  errorMessage: string | null = null
  processor: OutputProcessor

  private outputHandler: OutputCallback
  private statusListeners: Array<() => void> = []

  // Stream state
  private streamPoints: StreamPoint[] = []
  private startTime = 0
  private streamId = 0
  private deviceState: HspState | null = null
  private eventSource: EventSource | null = null
  private isPushing = false
  private prevPushTime = 0
  private clientServerTimeOffset = 0
  private pushTimer: ReturnType<typeof setInterval> | null = null
  private lastPointX = -1

  // Derived from processor filterTime — acts as the buffer-ahead window
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
    this.processor.filterTimeMs = 150
    this.outputHandler = (e) => this.onPoint(e)
    this.processor.onOutput(this.outputHandler)
  }

  // Called synchronously from OutputProcessor — append to stream.
  // Dead zone filters remaining noise after input-level smoothing.
  private onPoint(e: { position: number; duration: number }) {
    if (!this.connected) return

    const now = Date.now()
    if (this.startTime === 0) this.startTime = now

    const x = Math.max(0, Math.min(100, Math.round(e.position * 100)))

    // Dead zone: ignore changes smaller than threshold
    if (this.lastPointX >= 0 && Math.abs(x - this.lastPointX) < POSITION_DEAD_ZONE) return
    this.lastPointX = x

    const t = Math.round(now - this.startTime) + this.millisecondsOffset
    this.streamPoints.push({ t, x })
  }

  // Push next batch of points to device
  private async pushToDevice() {
    if (this.isPushing || !this.connected || !this.deviceState) return

    const nextStart = this.prevPushTime === 0 ? 0 : this.deviceState.tail_point_stream_index + 1
    const chunk = this.streamPoints.slice(nextStart, nextStart + BATCH_SIZE)

    if (chunk.length === 0) return

    this.isPushing = true
    try {
      const tailIndex = (this.prevPushTime === 0 ? 0 : this.deviceState.tail_point_stream_index) + chunk.length

      const response = await this.apiRequest('hsp/add', 'PUT', {
        points: chunk,
        flush: false,
        tail_point_stream_index: tailIndex,
      })

      if (response.ok && response.result) {
        this.deviceState = response.result

        // Set threshold so device notifies us when it needs more data
        const thresholdIndex = Math.max(0, tailIndex - THRESHOLD)
        const threshResp = await this.apiRequest('hsp/threshold', 'PUT', {
          tail_point_threshold: thresholdIndex,
        })
        if (threshResp.ok && threshResp.result) {
          this.deviceState = threshResp.result
        }

        this.prevPushTime = Date.now()

        if (this.errorMessage != null) {
          this.errorMessage = null
          this.notifyStatusChange()
        }
      } else if (response.error) {
        const err = response.error
        this.errorMessage = 'Failed: ' + (err?.message ?? JSON.stringify(err))
        if (err?.code === 1001) {
          this.errorMessage +=
            '. Make sure it is updated to FW4, is online, and the connection key is correct.'
        }
        this.notifyStatusChange()
      }
    } catch (ex) {
      console.error('Failed to push points:', ex)
    } finally {
      this.isPushing = false
    }
  }

  // Handle SSE events from device
  private onHspThresholdReached(state: HspState) {
    console.debug('HSP threshold reached')
    this.deviceState = state
    this.pushToDevice()
  }

  private onHspStarving(state: HspState) {
    console.debug('HSP starving')
    this.deviceState = state
    this.pushToDevice()
  }

  private onHspStateChanged(state: HspState) {
    console.debug('HSP state changed')
    if (this.deviceState && state.stream_id !== this.deviceState.stream_id) {
      console.warn('Stream ID mismatch, closing')
      this.stop()
      return
    }
    this.deviceState = state
  }

  private setupSSE() {
    // SSE must connect directly to handyfeeling.com (EventSource doesn't use our proxy)
    const params = new URLSearchParams({
      ck: this.connectionKey,
      apikey: AUTH_TOKEN,
      events: 'hsp_threshold_reached,hsp_starving,hsp_state_changed',
    })

    this.eventSource = new EventSource(
      `${DIRECT_API_URL}sse?${params.toString()}`,
      { withCredentials: false }
    )

    this.eventSource.addEventListener('hsp_threshold_reached', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        if (data?.data) this.onHspThresholdReached(data.data)
      } catch {}
    })

    this.eventSource.addEventListener('hsp_starving', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        if (data?.data) this.onHspStarving(data.data)
      } catch {}
    })

    this.eventSource.addEventListener('hsp_state_changed', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data)
        if (data?.data) this.onHspStateChanged(data.data)
      } catch {}
    })

    this.eventSource.onerror = () => {
      console.warn('SSE connection error')
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

  private async getClientServerTimeOffset(): Promise<number> {
    const numSamples = 10
    let timeoutCount = 5
    let offsetTimeSum = 0

    for (let i = 0; i < numSamples; i++) {
      const t0 = performance.now()
      const resp = await this.apiRequest('servertime', 'GET')
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

  // Returns {ok, result, error} normalized response
  private async apiRequest(
    endpoint: string,
    method: 'GET' | 'PUT' | 'POST',
    body?: any
  ): Promise<{ ok: boolean; result?: any; error?: any }> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'X-Connection-Key': this.connectionKey,
      Authorization: 'Bearer ' + AUTH_TOKEN,
    }
    const options: RequestInit = { method, headers }
    if (body !== undefined && method !== 'GET') {
      headers['Content-Type'] = 'application/json'
      options.body = JSON.stringify(body)
    }

    try {
      const response = await fetch(BASE_API_URL + endpoint, options)
      const text = await response.text()
      const data = text ? JSON.parse(text) : null

      console.log(`API ${method} ${endpoint} → ${response.status}`, data)
      if (response.ok) {
        // API may return {result: ...} or the state directly
        const result = data?.result ?? data
        return { ok: true, result }
      }
      return { ok: false, error: data?.error ?? data }
    } catch (e) {
      return { ok: false, error: e }
    }
  }

  async start(): Promise<void> {
    if (!this.connectionKey) {
      this.errorMessage = 'Please enter a connection key.'
      this.notifyStatusChange()
      return
    }

    try {
      // Sync clocks
      this.clientServerTimeOffset = await this.getClientServerTimeOffset()

      // Stop any previous session
      await this.cleanup()

      // Reset state
      this.streamPoints = []
      this.startTime = 0
      this.prevPushTime = 0
      this.isPushing = false
      this.deviceState = null
      this.playbackStarted = false
      this.lastPointX = -1
      this.streamId = Math.floor(Math.random() * 2147483647)

      // Open SSE connection for event-driven buffer management
      this.setupSSE()

      // Setup stream on device via HSP
      const setupResp = await this.apiRequest('hsp/setup', 'PUT', {
        stream_id: this.streamId,
      })
      console.log('HSP setup response:', JSON.stringify(setupResp))

      if (setupResp.ok && setupResp.result) {
        this.deviceState = setupResp.result
        this.connected = true
        this.errorMessage = null
        console.log('HSP setup succeeded, deviceState:', JSON.stringify(this.deviceState))

        // Start periodic push timer to keep buffer full
        this.startPushTimer()
      } else {
        console.error('Setup failed:', setupResp)
        this.errorMessage = 'Failed to setup streaming. Check connection key.'
        this.cleanup()
      }
    } catch (e) {
      this.errorMessage =
        'Something went wrong: ' + (e instanceof Error ? e.message : String(e))
      this.cleanup()
    }

    this.notifyStatusChange()
  }

  // Called when first batch of points is available and device is ready
  private async startPlayback() {
    const now = Date.now()
    const resp = await this.apiRequest('hsp/play', 'PUT', {
      startTime: now - this.startTime,
      serverTime: now + this.clientServerTimeOffset,
      playbackRate: 1.0,
      loop: false,
    })

    if (!resp.ok) {
      this.errorMessage = 'Failed to start playback. Try again.'
      this.notifyStatusChange()
    }
  }

  private async cleanup() {
    this.stopPushTimer()

    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    // Stop + flush on device
    try {
      await this.apiRequest('hsp/stop', 'PUT', undefined)
      await this.apiRequest('hsp/flush', 'PUT', undefined)
    } catch {
      // ignore
    }
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

  private playbackStarted = false
  private _testPatternRunning = false
  private _testPatternTimer: ReturnType<typeof setInterval> | null = null

  get isTestPatternRunning() {
    return this._testPatternRunning
  }

  inputPosition(position: number) {
    if (!this.connected || this._testPatternRunning) return
    this.processor.putPositionAndProcessOutput(position)

    // After accumulating a few points, start playback and do initial push
    if (!this.playbackStarted && this.streamPoints.length >= 3 && this.deviceState) {
      this.playbackStarted = true
      this.pushToDevice().then(() => this.startPlayback())
    }
  }

  // Runs a triangle wave test pattern on the device.
  // Bypasses OutputProcessor and dead zone — pushes clean points directly to stream.
  // onPoint is called with each target position (0-1) for graph display.
  async runTestPattern(onPoint?: (position: number) => void): Promise<void> {
    if (!this.connected || this._testPatternRunning) return

    this._testPatternRunning = true
    this.notifyStatusChange()

    // Reset stream for the test pattern
    this.stopPushTimer()
    await this.cleanup()

    this.streamPoints = []
    this.prevPushTime = 0
    this.isPushing = false
    this.playbackStarted = false
    this.lastPointX = -1
    this.streamId = Math.floor(Math.random() * 2147483647)

    this.setupSSE()
    const setupResp = await this.apiRequest('hsp/setup', 'PUT', {
      stream_id: this.streamId,
    })
    if (!setupResp.ok || !setupResp.result) {
      this.errorMessage = 'Failed to setup test pattern.'
      this._testPatternRunning = false
      this.notifyStatusChange()
      return
    }
    this.deviceState = setupResp.result

    // Pre-generate the full triangle wave pattern
    const durationMs = 9000 // 3 full cycles
    const cycleMs = 3000
    const intervalMs = 50
    const minX = 10
    const maxX = 90

    for (let t = 0; t <= durationMs; t += intervalMs) {
      const cyclePos = (t % cycleMs) / cycleMs
      const tri = cyclePos < 0.5 ? cyclePos * 2 : 2 - cyclePos * 2
      const x = Math.round(minX + tri * (maxX - minX))
      this.streamPoints.push({ t: t + this.millisecondsOffset, x })
    }

    this.startTime = Date.now()

    // Push initial batch and start playback
    await this.pushToDevice()
    await this.startPlayback()
    this.startPushTimer()

    // Display points on graph in real-time
    let pointIndex = 0
    return new Promise<void>((resolve) => {
      this._testPatternTimer = setInterval(() => {
        const elapsed = Date.now() - this.startTime
        // Emit all points up to current time for graph display
        while (pointIndex < this.streamPoints.length) {
          const p = this.streamPoints[pointIndex]
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

  get statusText(): string {
    if (this.connected) return `Connected to [${this.connectionKey}]`
    return 'Not connected'
  }

  destroy() {
    this.stop()
    this.processor.removeOutput(this.outputHandler)
  }
}
