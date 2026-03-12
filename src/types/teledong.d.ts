export declare const TeledongState: {
  readonly NotConnected: 'NotConnected'
  readonly Ok: 'Ok'
  readonly Calibrating: 'Calibrating'
  readonly Error: 'Error'
}

export type TeledongStateValue = (typeof TeledongState)[keyof typeof TeledongState]

export declare const TeledongCommands: {
  readonly GetSensorValues: 0x01
  readonly GetFirmwareVersion: 0x02
  readonly SaveCalibrationValues: 0x03
  readonly LoadCalibrationValues: 0x04
  readonly SaveUserData: 0x05
  readonly ReadUserData: 0x06
  readonly SetSunlightMode: 0x07
  readonly GetSunlightMode: 0x08
  readonly EnterBootloader: 0xfe
}

export declare class Teledong {
  State: TeledongStateValue
  BadCalibrationWarning: boolean
  KeepPositionAtRelease: boolean
  sunlightMode: boolean
  device: USBDevice | null
  calibrationLowValues: number[]
  calibrationHighValues: number[]

  constructor()

  connect(): Promise<boolean>
  getPosition(): Promise<number>
  loadCalibration(): Promise<void>
  calibrate(shouldSave?: boolean, durationSeconds?: number): Promise<void>
  disconnect(): Promise<void>
  getRawSensorValues(normalizeToCalibration?: boolean): Promise<number[]>
  setSunlightMode(enabled: boolean): Promise<void>
  sendCommand(command: number, extraData?: number[]): Promise<Uint8Array>
  parseSensorValuePacket(data: number[]): number[]
}
