// Teledong SDK - TypeScript port of teledong.js
// Connects to and reads position data from a Teledong device via WebUSB.
// WebUSB only works in Chromium-based browsers (Chrome, Edge, Opera).

export const TeledongState = {
  NotConnected: "NotConnected",
  Ok: "Ok",
  Calibrating: "Calibrating",
  Error: "Error",
} as const;

export type TeledongStateValue = (typeof TeledongState)[keyof typeof TeledongState];

export const TeledongCommands = {
  GetSensorValues: 0x01,
  GetFirmwareVersion: 0x02,
  SaveCalibrationValues: 0x03,
  LoadCalibrationValues: 0x04,
  SaveUserData: 0x05,
  ReadUserData: 0x06,
  SetSunlightMode: 0x07,
  GetSunlightMode: 0x08,
  EnterBootloader: 0xfe,
} as const;

export class Teledong {
  State: TeledongStateValue = TeledongState.NotConnected;
  BadCalibrationWarning = false;
  KeepPositionAtRelease = false;

  private readonly TELEDONG_PID = 0x8df4;
  private readonly TELEDONG_VID = 0x10c4;
  device: USBDevice | null = null;
  private endpointIn = 1;
  private endpointOut = 1;
  calibrationLowValues: number[] = Array(30).fill(0);
  calibrationHighValues: number[] = Array(30).fill(255);
  sunlightMode = false;
  private previousPositions: number[] = Array(4).fill(0);
  private badCalibrationCounter = 0;
  private badCalibrationThreshold = 200;

  async connect(): Promise<boolean> {
    try {
      this.device = await navigator.usb.requestDevice({
        filters: [{ vendorId: this.TELEDONG_VID, productId: this.TELEDONG_PID }],
      });

      if (!this.device) {
        console.error("Device not found");
        return false;
      }

      await this.device.open();
      await this.device.selectConfiguration(1);
      await this.device.claimInterface(0);

      this.State = TeledongState.Ok;
      this.BadCalibrationWarning = true;

      const buffer = new Uint8Array(0);
      await this.device.controlTransferOut(
        {
          requestType: "vendor",
          recipient: "device",
          request: 2,
          value: 0x0002,
          index: 0,
        },
        buffer,
      );

      console.log("Connected to Teledong");
      await this.loadCalibration();
      return true;
    } catch (error) {
      console.error("Error in connecting to device:", error);
      return false;
    }
  }

  async getPosition(): Promise<number> {
    if (!this.device) throw new Error("Device is not connected.");

    const sensorValues = await this.getRawSensorValues();

    if (sensorValues.length === 0) {
      this.State = TeledongState.Error;
      throw new Error("Unexpected result: 0 sensor values returned.");
    }

    let totalValue = 0;
    let lastDetectionIndex = 0;
    const obscuredThreshold = 0.5;

    for (let i = 0; i < sensorValues.length; i++) {
      let value = sensorValues[sensorValues.length - 1 - i];
      if (this.sunlightMode) value = 1 - value;

      // Smooth with neighbor sensors to mitigate sensor outliers
      if (i === 0) {
        // Top sensor, don't smooth
      } else if (i === 1) {
        let previousValue = sensorValues[sensorValues.length - 1 - i + 1];
        let nextValue = sensorValues[sensorValues.length - 1 - i - 1];
        if (this.sunlightMode) {
          previousValue = 1 - previousValue;
          nextValue = 1 - nextValue;
        }

        let numObscured = 0;
        const isObscured = value > obscuredThreshold;
        if (isObscured) numObscured++;
        if (previousValue > obscuredThreshold) numObscured++;
        if (nextValue > obscuredThreshold) numObscured++;
        if ((isObscured && numObscured <= 1) || (!isObscured && numObscured >= 2))
          value = (value + previousValue + nextValue) / 3.0;
      } else if (i === sensorValues.length - 1) {
        let previousValue1 = sensorValues[sensorValues.length - 1 - i + 1];
        let previousValue2 = sensorValues[sensorValues.length - 1 - i + 2];
        let previousValue3 = sensorValues[sensorValues.length - 1 - i + 3];
        if (this.sunlightMode) {
          previousValue1 = 1 - previousValue1;
          previousValue2 = 1 - previousValue2;
          previousValue3 = 1 - previousValue3;
        }

        let numObscured = 0;
        const isObscured = value > obscuredThreshold;
        if (isObscured) numObscured++;
        if (previousValue1 > obscuredThreshold) numObscured++;
        if (previousValue2 > obscuredThreshold) numObscured++;
        if (previousValue3 > obscuredThreshold) numObscured++;
        if ((isObscured && numObscured <= 2) || (!isObscured && numObscured >= 3))
          value = (value + previousValue1 + previousValue2 + previousValue3) / 4.0;
      } else {
        let previousValue1 = sensorValues[sensorValues.length - 1 - i + 1];
        let previousValue2 = sensorValues[sensorValues.length - 1 - i + 2];
        let nextValue = sensorValues[sensorValues.length - 1 - i - 1];
        if (this.sunlightMode) {
          previousValue1 = 1 - previousValue1;
          previousValue2 = 1 - previousValue2;
          nextValue = 1 - nextValue;
        }

        let numObscured = 0;
        const isObscured = value > obscuredThreshold;
        if (isObscured) numObscured++;
        if (previousValue1 > obscuredThreshold) numObscured++;
        if (previousValue2 > obscuredThreshold) numObscured++;
        if (nextValue > obscuredThreshold) numObscured++;
        if ((isObscured && numObscured <= 2) || (!isObscured && numObscured >= 3))
          value = (value + previousValue1 + previousValue2 + nextValue) / 4.0;
      }

      if (value > obscuredThreshold) {
        totalValue = i;
        lastDetectionIndex = i;
      } else if (i - lastDetectionIndex >= 2) {
        value = 0;
      }

      totalValue += Math.min(Math.max(value, 0), 1);
    }

    const firstEstimate = totalValue / sensorValues.length;
    let position = 1.0 - firstEstimate;

    if (this.KeepPositionAtRelease) {
      const estimatedCurrentPosition =
        this.previousPositions[1] + (this.previousPositions[0] - this.previousPositions[2]);

      if (position > 0.95 && estimatedCurrentPosition < 0.9) {
        position = (this.previousPositions[1] + this.previousPositions[2]) / 2;
      } else {
        for (let i = this.previousPositions.length - 1; i > 0; i--) {
          this.previousPositions[i] = this.previousPositions[i - 1];
        }
        this.previousPositions[0] = position;
        position = (this.previousPositions[0] + this.previousPositions[1]) / 2;
      }
    }

    return position;
  }

  async loadCalibration(): Promise<void> {
    if (!this.device) throw new Error("Device is not connected.");

    this.calibrationLowValues = [];
    this.calibrationHighValues = [];

    let newSunlightMode = this.sunlightMode;

    try {
      const data = await this.sendCommand(TeledongCommands.LoadCalibrationValues);

      if (data && data.length >= 4) {
        newSunlightMode = data[4] === 1;

        for (let i = 0; i < data[3]; i++) {
          this.calibrationLowValues.push(data[5 + i * 2]);
          this.calibrationHighValues.push(data[6 + i * 2]);
        }
      } else {
        console.error("Could not read USB packet.");
      }
    } catch {
      throw new Error("Failed to load calibration values");
    } finally {
      while (this.calibrationLowValues.length < 30) {
        this.calibrationLowValues.push(0);
        this.calibrationHighValues.push(255);
      }
    }

    this.BadCalibrationWarning = false;
    await this.setSunlightMode(newSunlightMode);
  }

  async calibrate(shouldSave = true, durationSeconds = 10): Promise<void> {
    if (this.device == null) throw new Error("Device is not connected.");

    this.State = TeledongState.Calibrating;
    console.log("Calibrating Teledong for number of seconds: " + durationSeconds);

    await new Promise((resolve) => setTimeout(resolve, 30));

    const duration = durationSeconds * 1000;
    const startTime = Date.now();
    let numSensors = 0;

    const lowValuesIndoor: number[] = [];
    const highValuesIndoor: number[] = [];
    const lowValuesSunlight: number[] = [];
    const highValuesSunlight: number[] = [];

    let rawSensorValues = await this.getRawSensorValues(false);

    rawSensorValues.forEach(() => {
      lowValuesIndoor.push(255);
      highValuesIndoor.push(0);
      lowValuesSunlight.push(255);
      highValuesSunlight.push(0);
      numSensors++;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await this.sendCommand(TeledongCommands.SetSunlightMode, [0]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    while (Date.now() - startTime < duration / 2) {
      let i = 0;
      rawSensorValues = await this.getRawSensorValues(false);
      rawSensorValues.forEach((sensorValue) => {
        if (sensorValue < lowValuesIndoor[i]) lowValuesIndoor[i] = sensorValue;
        if (sensorValue > highValuesIndoor[i]) highValuesIndoor[i] = sensorValue;
        i++;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    await this.sendCommand(TeledongCommands.SetSunlightMode, [1]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    while (Date.now() - startTime < duration) {
      let i = 0;
      rawSensorValues = await this.getRawSensorValues(false);
      rawSensorValues.forEach((sensorValue) => {
        if (sensorValue < lowValuesSunlight[i]) lowValuesSunlight[i] = sensorValue;
        if (sensorValue > highValuesSunlight[i]) highValuesSunlight[i] = sensorValue;
        i++;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    this.calibrationLowValues = [];
    this.calibrationHighValues = [];

    let sumSignalStrengthIndoors = 0;
    let sumSignalStrengthSunlight = 0;
    for (let i = 0; i < numSensors; i++) {
      sumSignalStrengthIndoors += highValuesIndoor[i] - lowValuesIndoor[i];
      sumSignalStrengthSunlight += highValuesSunlight[i] - lowValuesSunlight[i];
    }

    console.log(
      `Sunlight diff.: ${sumSignalStrengthSunlight}, indoors diff.: ${sumSignalStrengthIndoors}`,
    );
    if (sumSignalStrengthSunlight > sumSignalStrengthIndoors * 1.3) {
      await this.setSunlightMode(true);
      this.calibrationLowValues = lowValuesSunlight.slice();
      this.calibrationHighValues = highValuesSunlight.slice();
    } else {
      await this.setSunlightMode(false);
      this.calibrationLowValues = lowValuesIndoor.slice();
      this.calibrationHighValues = highValuesIndoor.slice();
    }

    while (this.calibrationLowValues.length < 30) {
      this.calibrationLowValues.push(0);
      this.calibrationHighValues.push(255);
    }

    if (shouldSave) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const commandPayload = [numSensors, this.sunlightMode ? 1 : 0];
      for (let i = 0; i < numSensors; i++) {
        commandPayload.push(this.calibrationLowValues[i]);
        commandPayload.push(this.calibrationHighValues[i]);
      }
      await this.sendCommand(TeledongCommands.SaveCalibrationValues, commandPayload);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
    this.BadCalibrationWarning = false;
    this.State = TeledongState.Ok;
  }

  async disconnect(): Promise<void> {
    try {
      if (this.device) {
        await this.device.close();
      }
      this.device = null;
      this.State = TeledongState.NotConnected;
      console.log("Disconnected from Teledong");
    } catch (error) {
      console.error("Failed to disconnect device:", error);
    }
  }

  async getRawSensorValues(normalizeToCalibration = true): Promise<number[]> {
    if (!this.device) throw new Error("Device is not connected.");

    try {
      await this.device.transferOut(
        this.endpointOut,
        new Uint8Array([0x54, 0x43, TeledongCommands.GetSensorValues]),
      );
      const response = await this.device.transferIn(this.endpointIn, 64);
      const data = Array.from(new Uint8Array(response.data!.buffer));

      if (this.State !== TeledongState.Calibrating) this.State = TeledongState.Ok;

      const sensorValues = this.parseSensorValuePacket(data);

      if (normalizeToCalibration) {
        const calibrated: number[] = [];
        for (let i = 0; i < sensorValues.length; i++) {
          if (this.calibrationHighValues[i] <= this.calibrationLowValues[i]) {
            // Invalid calibration for this sensor (faulty), skip it
            continue;
          }
          const calibratedValue =
            (sensorValues[i] - this.calibrationLowValues[i]) /
            (this.calibrationHighValues[i] - this.calibrationLowValues[i]);
          calibrated.push(Math.min(Math.max(calibratedValue, 0.0), 1.0));
        }
        return calibrated;
      }
      return sensorValues;
    } catch (error) {
      this.State = TeledongState.Error;
      console.error("Error reading sensor values:", error);
      return [];
    }
  }

  async setSunlightMode(enabled: boolean): Promise<void> {
    await this.sendCommand(TeledongCommands.SetSunlightMode, [enabled ? 1 : 0]);
    this.sunlightMode = enabled;
  }

  async sendCommand(command: number, extraData: number[] = []): Promise<Uint8Array> {
    if (!this.device) throw new Error("Device is not connected.");

    const payload = new Uint8Array([0x54, 0x43, command, ...extraData]);
    await this.device.transferOut(this.endpointOut, payload);
    const result = await this.device.transferIn(this.endpointIn, 64);
    const response = new Uint8Array(result.data!.buffer);

    if (
      response.length >= 3 &&
      response[0] === 0x54 &&
      response[1] === 0x52 &&
      response[2] === command
    ) {
      return response;
    } else {
      throw new Error("Unexpected response from USB command.");
    }
  }

  parseSensorValuePacket(data: number[]): number[] {
    const values: number[] = [];
    if (
      data.length > 3 &&
      data[0] === 0x54 &&
      data[1] === 0x52 &&
      data[2] === TeledongCommands.GetSensorValues
    ) {
      const numSensors = data[3];
      for (let i = 0; i < numSensors; i++) {
        if (4 + i >= data.length) break;
        values.push(data[4 + i] - 1);
      }
    }
    return values;
  }
}
