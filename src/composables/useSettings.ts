import { useLocalStorage } from "@vueuse/core";

export interface SavedOutputDevice {
  type: "handy" | "funscript";
  connectionKey?: string;
  peakMotionMode?: boolean;
  filterTimeMs?: number;
  filterStrength?: number;
}

export interface SavedSettings {
  outputDevices: SavedOutputDevice[];
}

const defaultSettings: SavedSettings = {
  outputDevices: [],
};

export const settings = useLocalStorage<SavedSettings>("teledongster-settings", defaultSettings, {
  mergeDefaults: true,
});
