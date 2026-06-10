// Pure tests for the automation scheduling policy (ADR-0024). No DB.
//
// Sydney DST anchors (Australia/Sydney):
//   2026-04-05 03:00 AEDT → clocks back to 02:00 AEST (UTC+11 → UTC+10)
//   2026-10-04 02:00 AEST → clocks forward to 03:00 AEDT (UTC+10 → UTC+11)

import { describe, expect, it } from "vitest";
import {
  isScheduleDue,
  isValidTimeZone,
  localDateKey,
  localDateTimeToUtc,
  localParts,
  type DueCheckSchedule,
} from "./automation-schedule";

const SYDNEY = "Australia/Sydney";

function recurring(over: Partial<DueCheckSchedule>): DueCheckSchedule {
  return {
    enabled: true,
    mode: "Recurring",
    timezone: SYDNEY,
    run_at: null,
    frequency: "Daily",
    weekday: null,
    run_hour: 9,
    last_run_at: null,
    ...over,
  };
}

function oneOff(over: Partial<DueCheckSchedule>): DueCheckSchedule {
  return {
    enabled: true,
    mode: "OneOff",
    timezone: SYDNEY,
    run_at: null,
    frequency: null,
    weekday: null,
    run_hour: null,
    last_run_at: null,
    ...over,
  };
}

describe("localParts / localDateKey", () => {
  it("reads Sydney wall clocks in summer (AEDT, UTC+11)", () => {
    // 2026-01-15 22:30 UTC = 2026-01-16 09:30 AEDT.
    const p = localParts(new Date("2026-01-15T22:30:00Z"), SYDNEY);
    expect(p).toMatchObject({ year: 2026, month: 1, day: 16, hour: 9, minute: 30 });
    expect(localDateKey(new Date("2026-01-15T22:30:00Z"), SYDNEY)).toBe("2026-01-16");
  });

  it("reads Sydney wall clocks in winter (AEST, UTC+10)", () => {
    // 2026-06-15 23:30 UTC = 2026-06-16 09:30 AEST.
    const p = localParts(new Date("2026-06-15T23:30:00Z"), SYDNEY);
    expect(p).toMatchObject({ year: 2026, month: 6, day: 16, hour: 9, minute: 30 });
  });

  it("maps weekday with Sunday=0", () => {
    // 2026-06-14 is a Sunday in Sydney (and UTC).
    expect(localParts(new Date("2026-06-14T02:00:00Z"), SYDNEY).weekday).toBe(0);
  });
});

describe("localDateTimeToUtc", () => {
  it("converts a summer (AEDT) wall time", () => {
    const utc = localDateTimeToUtc({ year: 2026, month: 1, day: 16, hour: 9 }, SYDNEY);
    expect(utc.toISOString()).toBe("2026-01-15T22:00:00.000Z");
  });

  it("converts a winter (AEST) wall time", () => {
    const utc = localDateTimeToUtc({ year: 2026, month: 6, day: 16, hour: 9 }, SYDNEY);
    expect(utc.toISOString()).toBe("2026-06-15T23:00:00.000Z");
  });

  it("handles the day clocks go back (2026-04-05): 09:00 is unambiguous AEST", () => {
    const utc = localDateTimeToUtc({ year: 2026, month: 4, day: 5, hour: 9 }, SYDNEY);
    // After the 03:00→02:00 fallback Sydney is UTC+10.
    expect(utc.toISOString()).toBe("2026-04-04T23:00:00.000Z");
  });

  it("handles the day clocks go forward (2026-10-04): 09:00 is AEDT", () => {
    const utc = localDateTimeToUtc({ year: 2026, month: 10, day: 4, hour: 9 }, SYDNEY);
    expect(utc.toISOString()).toBe("2026-10-03T22:00:00.000Z");
  });

  it("round-trips through localParts", () => {
    const utc = localDateTimeToUtc({ year: 2026, month: 7, day: 1, hour: 17, minute: 30 }, SYDNEY);
    expect(localParts(utc, SYDNEY)).toMatchObject({ hour: 17, minute: 30, day: 1, month: 7 });
  });
});

describe("isScheduleDue — OneOff", () => {
  it("due once run_at passes and never ran", () => {
    const s = oneOff({ run_at: new Date("2026-06-15T23:00:00Z") });
    expect(isScheduleDue(s, new Date("2026-06-15T22:59:00Z"))).toBe(false);
    expect(isScheduleDue(s, new Date("2026-06-15T23:00:00Z"))).toBe(true);
    expect(isScheduleDue(s, new Date("2026-06-17T10:00:00Z"))).toBe(true); // catch-up
  });

  it("never due again after running", () => {
    const s = oneOff({
      run_at: new Date("2026-06-15T23:00:00Z"),
      last_run_at: new Date("2026-06-15T23:05:00Z"),
    });
    expect(isScheduleDue(s, new Date("2026-06-16T23:00:00Z"))).toBe(false);
  });

  it("disabled wins", () => {
    const s = oneOff({ enabled: false, run_at: new Date("2026-06-15T23:00:00Z") });
    expect(isScheduleDue(s, new Date("2026-06-16T00:00:00Z"))).toBe(false);
  });
});

describe("isScheduleDue — Recurring Daily (9am Sydney)", () => {
  it("not due before 9am local, due from 9am", () => {
    const s = recurring({});
    // 2026-06-16 08:30 AEST = 22:30Z on the 15th.
    expect(isScheduleDue(s, new Date("2026-06-15T22:30:00Z"))).toBe(false);
    // 09:30 AEST.
    expect(isScheduleDue(s, new Date("2026-06-15T23:30:00Z"))).toBe(true);
  });

  it("catches up later the same local day if the 9am tick was missed", () => {
    const s = recurring({});
    // 16:00 AEST on 2026-06-16.
    expect(isScheduleDue(s, new Date("2026-06-16T06:00:00Z"))).toBe(true);
  });

  it("does not run twice in one local day", () => {
    const s = recurring({
      // Ran at 09:02 AEST on 2026-06-16.
      last_run_at: new Date("2026-06-15T23:02:00Z"),
    });
    // 16:00 AEST same local day → not due.
    expect(isScheduleDue(s, new Date("2026-06-16T06:00:00Z"))).toBe(false);
    // 09:30 AEST next local day → due.
    expect(isScheduleDue(s, new Date("2026-06-16T23:30:00Z"))).toBe(true);
  });

  it("UTC date rollover does not confuse local-day identity", () => {
    // 9am AEDT (summer) is 22:00Z the PREVIOUS UTC day. Ran 2026-01-15
    // 22:05Z (= Jan 16 09:05 AEDT); at 23:30Z (Jan 16 10:30 AEDT) it must
    // not be due even though the UTC date hasn't changed since the run.
    const s = recurring({ last_run_at: new Date("2026-01-15T22:05:00Z") });
    expect(isScheduleDue(s, new Date("2026-01-15T23:30:00Z"))).toBe(false);
  });
});

describe("isScheduleDue — Recurring Weekly", () => {
  it("only due on the configured local weekday", () => {
    // Monday 9am Sydney. 2026-06-15 is a Monday.
    const s = recurring({ frequency: "Weekly", weekday: 1 });
    // Mon 09:30 AEST = 2026-06-14T23:30Z.
    expect(isScheduleDue(s, new Date("2026-06-14T23:30:00Z"))).toBe(true);
    // Tue 09:30 AEST.
    expect(isScheduleDue(s, new Date("2026-06-15T23:30:00Z"))).toBe(false);
  });

  it("does not refire the same local day, fires next week", () => {
    const s = recurring({
      frequency: "Weekly",
      weekday: 1,
      last_run_at: new Date("2026-06-14T23:05:00Z"), // Mon 09:05 AEST
    });
    expect(isScheduleDue(s, new Date("2026-06-15T05:00:00Z"))).toBe(false); // Mon 15:00
    expect(isScheduleDue(s, new Date("2026-06-21T23:30:00Z"))).toBe(true); // next Mon 09:30
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects junk", () => {
    expect(isValidTimeZone("Australia/Sydney")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Sydney/Australia")).toBe(false);
    expect(isValidTimeZone("not-a-zone")).toBe(false);
  });
});
