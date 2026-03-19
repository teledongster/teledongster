// Funscript recorder driver
// Port of FunscriptRecorder.cs

import { saveAs } from 'file-saver'
import { OutputProcessor, type OutputCallback } from './output-processor'

interface FunscriptPoint {
  position: number // 0 to 1
  time: number // ms since start
}

export class FunscriptDriver {
  isRecording = false
  errorMessage: string | null = null
  processor: OutputProcessor

  private startTime = 0
  private points: FunscriptPoint[] = []
  private outputHandler: OutputCallback

  private statusListeners: Array<() => void> = []

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
    this.processor.peakMotionMode = true
    this.outputHandler = (e) => this.handleOutput(e)
    this.processor.onOutput(this.outputHandler)
  }

  private handleOutput(e: { position: number; duration: number }) {
    if (!this.isRecording) return
    this.points.push({
      position: e.position,
      time: Date.now() - this.startTime,
    })
  }

  get recordingDuration(): number {
    if (!this.isRecording) return 0
    return Date.now() - this.startTime
  }

  start() {
    this.points = []
    this.startTime = Date.now()
    this.isRecording = true
    this.errorMessage = null
    this.notifyStatusChange()
  }

  stop() {
    this.isRecording = false
    this.notifyStatusChange()
  }

  download() {
    if (this.points.length === 0) return

    const actions = this.points.map((p) => ({
      pos: Math.round(p.position * 99),
      at: Math.round(p.time),
    }))

    const funscript = {
      version: '1.0',
      metadata: {
        title: 'Teledong script',
        duration: actions[actions.length - 1].at,
        range: 100,
      },
      actions,
    }

    const json = JSON.stringify(funscript, null, 2)
    const now = new Date()
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`
    const blob = new Blob([json], { type: 'application/json' })
    saveAs(blob, `teledong_${ts}.funscript`)
  }

  inputPosition(position: number) {
    if (!this.isRecording) return
    this.processor.putPositionAndProcessOutput(position)
  }

  get statusText(): string {
    if (this.isRecording) {
      const elapsed = this.recordingDuration
      const mins = Math.floor(elapsed / 60000)
      const secs = Math.floor((elapsed % 60000) / 1000)
      return `Recording: ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    }
    return 'Not recording'
  }

  get connected(): boolean {
    return this.isRecording
  }

  destroy() {
    this.stop()
    this.processor.removeOutput(this.outputHandler)
  }
}
