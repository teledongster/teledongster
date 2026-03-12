// Port of OutputProcessor.cs - processes raw positions before sending to output devices

export interface OutputEvent {
  position: number // 0 to 1
  duration: number // milliseconds
}

export type OutputCallback = (event: OutputEvent) => void

const StrokeDirection = {
  None: 0,
  Up: 1,
  Down: 2,
} as const

type StrokeDirection = (typeof StrokeDirection)[keyof typeof StrokeDirection]

interface StrokerPoint {
  position: number
  time: number // ms since reference
}

export class OutputProcessor {
  skipFiltering = false
  filterStrength = 0.0
  filterTimeMs = 0
  peakMotionMode = true

  private outputCallbacks: OutputCallback[] = []
  private inputPointBuffer: StrokerPoint[] = []
  private outputPointBuffer: StrokerPoint[] = []
  private referenceTime = Date.now()
  private lastWriteTime = Date.now()
  private lastWriteTimePeak = Date.now()
  private previousPosition = 0.9
  private currentDirection: StrokeDirection = StrokeDirection.None

  onOutput(cb: OutputCallback) {
    this.outputCallbacks.push(cb)
  }

  removeOutput(cb: OutputCallback) {
    const idx = this.outputCallbacks.indexOf(cb)
    if (idx >= 0) this.outputCallbacks.splice(idx, 1)
  }

  private emit(event: OutputEvent) {
    for (const cb of this.outputCallbacks) {
      cb(event)
    }
  }

  putPositionAndProcessOutput(position: number) {
    const now = Date.now() - this.referenceTime

    if (!this.peakMotionMode) {
      if (this.skipFiltering || this.filterTimeMs === 0 || this.filterStrength === 0) {
        // Raw unfiltered stream of points
        this.outputPointBuffer.push({ position, time: now })
      } else {
        // Filter and queue chunks of input
        this.inputPointBuffer.push({ position, time: now })

        if (this.inputPointBuffer.length > 0 && now - this.inputPointBuffer[0].time > this.filterTimeMs) {
          // Simple decimation filter: reduce points by taking every Nth point
          const reduced = this.reducePoints(this.inputPointBuffer, this.filterStrength)
          for (let i = 1; i < reduced.length; i++) {
            this.outputPointBuffer.push(reduced[i])
          }
          this.inputPointBuffer = []
        }
      }
    } else {
      // Peak motion mode: only emit on direction change
      let shouldSendPosition = false
      const positionDelta = position - this.previousPosition

      if (this.currentDirection === StrokeDirection.Up) {
        if (position <= this.previousPosition || Date.now() - this.lastWriteTimePeak > 800) {
          shouldSendPosition = true
          if (position <= this.previousPosition) this.currentDirection = StrokeDirection.None
        }
      } else if (this.currentDirection === StrokeDirection.Down) {
        if (position >= this.previousPosition || Date.now() - this.lastWriteTimePeak > 800) {
          shouldSendPosition = true
          if (position >= this.previousPosition) this.currentDirection = StrokeDirection.None
        }
      }

      if (shouldSendPosition) {
        if (Date.now() - this.lastWriteTimePeak < 100 && Math.abs(positionDelta) < 0.1) {
          this.lastWriteTimePeak = Date.now()
          shouldSendPosition = false // Debouncing
        }
      }

      if (Math.abs(positionDelta) > 0.05) {
        this.currentDirection = positionDelta > 0 ? StrokeDirection.Up : StrokeDirection.Down
        this.previousPosition = position
      }

      if (this.currentDirection !== StrokeDirection.None) {
        this.previousPosition = position
      }

      if (shouldSendPosition) {
        this.lastWriteTimePeak = Date.now()
        this.outputPointBuffer.push({ position: this.previousPosition, time: now })
      }
    }

    // Process queue and output
    const outputTimeThreshold =
      Date.now() - this.referenceTime - (this.skipFiltering ? 0 : this.filterTimeMs)

    let nextPoint: StrokerPoint | null = null
    let shouldOutput = false

    while (this.outputPointBuffer.length > 0) {
      if (this.outputPointBuffer[0].time <= outputTimeThreshold) {
        nextPoint = this.outputPointBuffer.shift()!
        shouldOutput = true
      } else {
        break
      }
    }

    if (shouldOutput && nextPoint) {
      let writeDuration = Date.now() - this.lastWriteTime - 10
      if (writeDuration > 1000) writeDuration = 500
      this.lastWriteTime = Date.now()

      this.emit({
        position: Math.max(0, Math.min(1, nextPoint.position)),
        duration: writeDuration,
      })
    }
  }

  // Simple point reduction: keep every Nth point based on filter strength
  private reducePoints(points: StrokerPoint[], strength: number): StrokerPoint[] {
    if (points.length <= 2 || strength <= 0) return points.slice()
    const step = Math.max(1, Math.round(1 + strength * 10))
    const result: StrokerPoint[] = [points[0]]
    for (let i = step; i < points.length - 1; i += step) {
      result.push(points[i])
    }
    result.push(points[points.length - 1])
    return result
  }
}
