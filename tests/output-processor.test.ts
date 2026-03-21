import { describe, it, expect, vi } from "vitest";
import { OutputProcessor } from "../src/drivers/output-processor";

describe("OutputProcessor", () => {
  it("emits output events in raw mode", () => {
    const processor = new OutputProcessor();
    processor.peakMotionMode = false;
    processor.skipFiltering = true;

    const events: { position: number; duration: number }[] = [];
    processor.onOutput((e) => events.push(e));

    processor.putPositionAndProcessOutput(0.5);
    processor.putPositionAndProcessOutput(0.8);

    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].position).toBeCloseTo(0.8, 1);
  });

  it("clamps output position to 0-1 range", () => {
    const processor = new OutputProcessor();
    processor.peakMotionMode = false;
    processor.skipFiltering = true;

    const events: { position: number; duration: number }[] = [];
    processor.onOutput((e) => events.push(e));

    processor.putPositionAndProcessOutput(1.5);
    processor.putPositionAndProcessOutput(-0.5);

    expect(events.every((e) => e.position >= 0 && e.position <= 1)).toBe(true);
  });

  it("removeOutput stops callback from firing", () => {
    const processor = new OutputProcessor();
    processor.peakMotionMode = false;
    processor.skipFiltering = true;

    const cb = vi.fn();
    processor.onOutput(cb);
    processor.removeOutput(cb);

    processor.putPositionAndProcessOutput(0.5);
    processor.putPositionAndProcessOutput(0.8);

    expect(cb).not.toHaveBeenCalled();
  });
});
