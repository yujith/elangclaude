import { describe, expect, it } from "vitest";
import { parseWritingGrade, writingGradeSchema } from "./schema";

const VALID = {
  band_overall: 6.5,
  criteria: {
    task_achievement: {
      band: 6.5,
      justification:
        "Addresses both parts of the prompt but with uneven development on the second part.",
      evidence: "in the second paragraph: \"some agree, but I think...\"",
    },
    coherence_cohesion: {
      band: 6.0,
      justification:
        "Paragraphing is logical; cohesive devices are present but a few are mechanical.",
      evidence: "\"Furthermore, moreover, in addition\" in successive sentences",
    },
    lexical_resource: {
      band: 7.0,
      justification:
        "Wide vocabulary range with mostly accurate collocations; some less common items.",
      evidence: "\"a marked decline in remote engagement\"",
    },
    grammatical_range: {
      band: 6.0,
      justification:
        "Mix of simple and complex structures; a few subject-verb agreement slips.",
      evidence: "\"The chart show a sharp increase\"",
    },
  },
  strengths: [
    "Wide vocabulary with accurate collocations.",
    "Logical paragraphing with clear topic sentences.",
  ],
  improvements: [
    "Develop the second part of the essay with examples.",
    "Watch subject-verb agreement in long sentences.",
  ],
  next_drill: "task-2-grammar-agreement",
};

describe("writingGradeSchema", () => {
  it("accepts a fully-formed response", () => {
    expect(writingGradeSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects non-half bands", () => {
    const bad = structuredClone(VALID);
    bad.band_overall = 6.3;
    expect(writingGradeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects out-of-range bands", () => {
    const bad = structuredClone(VALID);
    bad.criteria.task_achievement.band = 9.5;
    expect(writingGradeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects missing evidence", () => {
    const bad = structuredClone(VALID);
    bad.criteria.task_achievement.evidence = "";
    expect(writingGradeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects fewer than 2 strengths", () => {
    const bad = structuredClone(VALID);
    bad.strengths = ["only one"];
    expect(writingGradeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects extra top-level keys (strict)", () => {
    const bad = { ...VALID, surprise: "not part of the contract" };
    expect(writingGradeSchema.safeParse(bad).success).toBe(false);
  });
});

describe("parseWritingGrade", () => {
  it("parses a clean JSON response", () => {
    const res = parseWritingGrade(JSON.stringify(VALID));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.grade.band_overall).toBe(6.5);
  });

  it("extracts JSON when the model wraps it in prose", () => {
    const wrapped = `Here is the grade you requested:\n${JSON.stringify(
      VALID,
    )}\n\nLet me know if you need anything else.`;
    const res = parseWritingGrade(wrapped);
    expect(res.ok).toBe(true);
  });

  it("returns an error result on malformed JSON", () => {
    const res = parseWritingGrade("{ not valid json");
    expect(res.ok).toBe(false);
  });

  it("returns an error result on schema violation", () => {
    const res = parseWritingGrade(
      JSON.stringify({ ...VALID, band_overall: 6.3 }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues.length).toBeGreaterThan(0);
    }
  });

  it("returns an error result when no JSON object is present", () => {
    const res = parseWritingGrade("I cannot grade this.");
    expect(res.ok).toBe(false);
  });
});
