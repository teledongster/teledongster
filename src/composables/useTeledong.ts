import { ref, readonly, onUnmounted } from 'vue'
import { Teledong, TeledongState } from '../drivers/teledong-sdk'
import type { TeledongStateValue } from '../drivers/teledong-sdk'

const SMOOTHING_ALPHA = 0.35 // EMA: lower = smoother but laggier, higher = more responsive

export function useTeledong() {
  const device = new Teledong()
  const state = ref<TeledongStateValue>(TeledongState.NotConnected)
  const position = ref(1.0)
  const badCalibrationWarning = ref(false)
  const sunlightMode = ref(false)
  const sensorValues = ref<number[]>([])
  const error = ref<string | null>(null)
  const isPolling = ref(false)

  let pollTimer: ReturnType<typeof setInterval> | null = null
  let skipRead = false
  let smoothedPos = -1

  async function connect() {
    error.value = null
    try {
      const result = await device.connect()
      if (result) {
        state.value = device.State
        sunlightMode.value = device.sunlightMode
        badCalibrationWarning.value = device.BadCalibrationWarning
        startPolling()
      } else {
        error.value = "Couldn't connect to Teledong."
      }
    } catch (e) {
      error.value = 'Failed to connect: ' + (e instanceof Error ? e.message : String(e))
    }
  }

  async function disconnect() {
    stopPolling()
    await device.disconnect()
    state.value = TeledongState.NotConnected
    position.value = 1.0
    smoothedPos = -1
    sensorValues.value = []
  }

  async function calibrate() {
    if (state.value === TeledongState.NotConnected) {
      error.value = 'Teledong must be connected before calibrating.'
      return
    }
    error.value = null
    state.value = TeledongState.Calibrating
    try {
      await device.calibrate()
      sunlightMode.value = device.sunlightMode
      badCalibrationWarning.value = device.BadCalibrationWarning
      state.value = device.State
    } catch (e) {
      error.value = 'Calibration failed: ' + (e instanceof Error ? e.message : String(e))
      state.value = TeledongState.Error
    }
  }

  function startPolling() {
    if (pollTimer) return
    isPolling.value = true
    pollTimer = setInterval(async () => {
      if (device.State === TeledongState.NotConnected || device.State === TeledongState.Calibrating)
        return
      try {
        const rawPos = await device.getPosition()
        // EMA smoothing to reduce sensor jitter
        if (smoothedPos < 0) {
          smoothedPos = rawPos
        } else {
          smoothedPos = SMOOTHING_ALPHA * rawPos + (1 - SMOOTHING_ALPHA) * smoothedPos
        }
        position.value = smoothedPos
        state.value = device.State
        badCalibrationWarning.value = device.BadCalibrationWarning
      } catch (e) {
        console.error('Poll error:', e)
      }
    }, 50) // 50ms like the .NET app
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    isPolling.value = false
  }

  async function getRawSensorValues() {
    if (state.value === TeledongState.NotConnected) return
    try {
      sensorValues.value = await device.getRawSensorValues(false)
    } catch (e) {
      // ignore
    }
  }

  onUnmounted(() => {
    stopPolling()
  })

  return {
    state: readonly(state),
    position: readonly(position),
    badCalibrationWarning: readonly(badCalibrationWarning),
    sunlightMode: readonly(sunlightMode),
    sensorValues: readonly(sensorValues),
    error,
    isPolling: readonly(isPolling),
    connect,
    disconnect,
    calibrate,
    getRawSensorValues,
  }
}
