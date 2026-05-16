import { describe, expect, it } from "vitest";
import {
  listeningBandFromPartial,
  listeningBandFromRaw40,
  scaleListeningRawTo40,
} from "./band";

describe("listeningBandFromRaw40", () => {
  it("maps published high-end thresholds", () => {
    expect(listeningBandFromRaw40("Academic", 40)).toBe(9.0);
    expect(listeningBandFromRaw40("Academic", 39)).toBe(9.0);
    expect(listeningBandFromRaw40("Academic", 38)).toBe(8.5);
    expect(listeningBandFromRaw40("Academic", 35)).toBe(8.0);
  });

  it("maps published mid-band thresholds", () => {
    expect(listeningBandFromRaw40("Academic", 30)).toBe(7.0);
    expect(listeningBandFromRaw40("Academic", 26)).toBe(6.5);
    expect(listeningBandFromRaw40("Academic", 23)).toBe(6.0);
  });

  it("returns 0 for very low raw scores", () => {
    expect(listeningBandFromRaw40("Academic", 0)).toBe(0);
  });

  it("clamps out-of-range raw scores rather than throwing", () => {
    expect(listeningBandFromRaw40("Academic", -5)).toBe(0);
    expect(listeningBandFromRaw40("Academic", 99)).toBe(9.0);
  });

  it("uses the same table for GeneralTraining (Listening is shared)", () => {
    expect(listeningBandFromRaw40("GeneralTraining", 30)).toBe(
      listeningBandFromRaw40("Academic", 30),
    );
  });
});

describe("scaleListeningRawTo40 / listeningBandFromPartial", () => {
  it("scales a partial raw to its 40-question equivalent", () => {
    expect(scaleListeningRawTo40(11, 22)).toBe(20); // half = band 5.5
    expect(scaleListeningRawTo40(20, 20)).toBe(40);
  });

  it("returns 0 when total is 0 (no divide by zero)", () => {
    expect(scaleListeningRawTo40(0, 0)).toBe(0);
    expect(listeningBandFromPartial("Academic", 0, 0)).toBe(0);
  });

  it("composes through to band lookup", () => {
    // 26 / 40 directly = 6.5
    expect(listeningBandFromPartial("Academic", 26, 40)).toBe(6.5);
    // 13 / 20 scaled = 26/40 = 6.5
    expect(listeningBandFromPartial("Academic", 13, 20)).toBe(6.5);
  });
});
