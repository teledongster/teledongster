import { ref, shallowReactive } from "vue";
import { HandyDriver } from "../drivers/handy";
import { FunscriptDriver } from "../drivers/funscript";

export type OutputDeviceType = "handy" | "funscript";

export interface OutputDeviceEntry {
  id: number;
  type: OutputDeviceType;
  driver: HandyDriver | FunscriptDriver;
}

let nextId = 1;

export function useOutputDevices() {
  const devices = shallowReactive<OutputDeviceEntry[]>([]);
  const selectedDeviceId = ref<number | null>(null);

  function addDevice(type: OutputDeviceType): OutputDeviceEntry {
    let driver: HandyDriver | FunscriptDriver;
    if (type === "handy") {
      driver = new HandyDriver();
    } else {
      driver = new FunscriptDriver();
    }

    const entry: OutputDeviceEntry = {
      id: nextId++,
      type,
      driver,
    };
    devices.push(entry);
    selectedDeviceId.value = entry.id;
    return entry;
  }

  function removeDevice(id: number) {
    const idx = devices.findIndex((d) => d.id === id);
    if (idx >= 0) {
      devices[idx].driver.destroy();
      devices.splice(idx, 1);
      if (selectedDeviceId.value === id) {
        selectedDeviceId.value = devices.length > 0 ? devices[0].id : null;
      }
    }
  }

  function inputPosition(position: number) {
    for (const device of devices) {
      device.driver.inputPosition(position);
    }
  }

  function getSelected(): OutputDeviceEntry | undefined {
    return devices.find((d) => d.id === selectedDeviceId.value);
  }

  return {
    devices,
    selectedDeviceId,
    addDevice,
    removeDevice,
    inputPosition,
    getSelected,
  };
}
