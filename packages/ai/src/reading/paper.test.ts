import { describe, expect, it } from "vitest";
import {
  paperIsComplete,
  validateCuration,
  type CandidatePart,
} from "./paper";

function part(over: Partial<CandidatePart> & Pick<CandidatePart, "slot">): CandidatePart {
  return {
    testId: `t${over.slot}`,
    track: "Academic",
    section: "Reading",
    status: "Approved",
    ...over,
  };
}

describe("validateCuration", () => {
  const valid = [part({ slot: 1 }), part({ slot: 2 }), part({ slot: 3 })];

  it("accepts three approved Reading parts of the right track", () => {
    expect(validateCuration("Academic", valid)).toEqual([]);
    expect(paperIsComplete("Academic", valid)).toBe(true);
  });

  it("flags a missing slot", () => {
    const issues = validateCuration("Academic", [
      part({ slot: 1 }),
      part({ slot: 2 }),
    ]);
    expect(issues).toContainEqual({ code: "missing-slot", slot: 3 });
    expect(paperIsComplete("Academic", [part({ slot: 1 })])).toBe(false);
  });

  it("flags a passage reused across two slots", () => {
    const dup = [
      part({ slot: 1, testId: "same" }),
      part({ slot: 2, testId: "same" }),
      part({ slot: 3 }),
    ];
    expect(validateCuration("Academic", dup)).toContainEqual({
      code: "duplicate-test",
      testId: "same",
    });
  });

  it("flags a cross-track passage", () => {
    const mixed = [
      part({ slot: 1 }),
      part({ slot: 2, track: "GeneralTraining" }),
      part({ slot: 3 }),
    ];
    expect(validateCuration("Academic", mixed)).toContainEqual({
      code: "wrong-track",
      testId: "t2",
    });
  });

  it("flags a non-Reading passage", () => {
    const wrong = [
      part({ slot: 1, section: "Listening" }),
      part({ slot: 2 }),
      part({ slot: 3 }),
    ];
    expect(validateCuration("Academic", wrong)).toContainEqual({
      code: "wrong-section",
      testId: "t1",
    });
  });

  it("flags a not-yet-approved passage (Draft paper can't release)", () => {
    const pending = [
      part({ slot: 1 }),
      part({ slot: 2, status: "PendingReview" }),
      part({ slot: 3 }),
    ];
    expect(validateCuration("Academic", pending)).toContainEqual({
      code: "not-approved",
      testId: "t2",
    });
    expect(paperIsComplete("Academic", pending)).toBe(false);
  });

  it("validates a GT paper against its own track", () => {
    const gt = [
      part({ slot: 1, track: "GeneralTraining" }),
      part({ slot: 2, track: "GeneralTraining" }),
      part({ slot: 3, track: "GeneralTraining" }),
    ];
    expect(validateCuration("GeneralTraining", gt)).toEqual([]);
  });
});
