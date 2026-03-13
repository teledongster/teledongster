import { useLocalStorage } from '@vueuse/core'

export interface SavedOutputDevice {
  type: 'handy' | 'funscript'
  handyProtocol?: 'stream' | 'hsp' | 'hdsp'
  connectionKey?: string
  peakMotionMode?: boolean
  filterTimeMs?: number
  filterStrength?: number
}

export interface SavedSettings {
  outputDevices: SavedOutputDevice[]
}

const defaultSettings: SavedSettings = {
  outputDevices: [],
}

export const settings = useLocalStorage<SavedSettings>(
  'teledong-commander-settings',
  defaultSettings,
  { mergeDefaults: true }
)
