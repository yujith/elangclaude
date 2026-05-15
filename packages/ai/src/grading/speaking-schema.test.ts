import { describe, expect, it } from "vitest";
import { parseSpeakingGrade } from "./speaking-schema";

const VALID = {
  band_overall: 6.5,
  criteria: {
    fluency_coherence: {
      band: 6.5,
      justification:
        "Maintained flow with occasional hesitation around abstract content.",
      evidence:
        "Part 3: 'I think, um, it's important because… how do I say…' — fillers cluster on opinion turns.",
    },
    lexical_resource: {
      band: 6.0,
      justification:
        "Workmanlike vocabulary but limited paraphrase ability across parts.",
      evidence: "Part 1 repeats 'I like it because it's nice' across three sub-topics.",
    },
    grammatical_range: {
      band: 7.0,
      justification:
        "Good range — uses present perfect, conditionals, and complex subordination.",
      evidence:
        "Part 2: 'If I had read it earlier, I would have understood the references.'",
    },
    pronunciation: {
      band: 6.5,
      justification:
        "Intelligible throughout; pause distribution comfortable.",
      evidence: "wpm=128 with 6 pauses ≥500ms in 11 minutes — within comfort range.",
    },
  },
  strengths: [
    "Wide grammatical range with good control of complex structures.",
    "Stayed on topic and developed answers with examples.",
  ],
  improvements: [
    "Build paraphrase vocabulary so Part 1 doesn't lean on repeated phrasing.",
    "Practise abstract-discussion fluency to reduce filler clustering in Part 3.",
  ],
  next_drill: "speaking-part-1-vocabulary",
};

describe("parseSpeakingGrade", () => {
  it("parses a well-formed grade", () => {
    const res = parseSpeakingGrade(JSON.stringify(VALID));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.grade.band_overall).toBe(6.5);
      expect(res.grade.criteria.pronunciation.band).toBe(6.5);
    }
  });

  it("strips provider preamble before the JSON", () => {
    const res = parseSpeakingGrade(`Here is the grade: ${JSON.stringify(VALID)}`);
    expect(res.ok).toBe(true);
  });

  it("rejects a non-half band", () => {
    const res = parseSpeakingGrade(
      JSON.stringify({ ...VALID, band_overall: 6.3 }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects a missing criterion", () => {
    const noPron = {
      ...VALID,
      criteria: {
        fluency_coherence: VALID.criteria.fluency_coherence,
        lexical_resource: VALID.criteria.lexical_resource,
        grammatical_range: VALID.criteria.grammatical_range,
      },
    };
    const res = parseSpeakingGrade(JSON.stringify(noPron));
    expect(res.ok).toBe(false);
  });

  it("rejects justification shorter than 20 chars", () => {
    const v = JSON.parse(JSON.stringify(VALID));
    v.criteria.pronunciation.justification = "Too short.";
    const res = parseSpeakingGrade(JSON.stringify(v));
    expect(res.ok).toBe(false);
  });

  it("rejects empty evidence", () => {
    const v = JSON.parse(JSON.stringify(VALID));
    v.criteria.lexical_resource.evidence = "";
    const res = parseSpeakingGrade(JSON.stringify(v));
    expect(res.ok).toBe(false);
  });

  it("rejects fewer than 2 strengths", () => {
    const res = parseSpeakingGrade(
      JSON.stringify({ ...VALID, strengths: [VALID.strengths[0]] }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects more than 4 improvements", () => {
    const res = parseSpeakingGrade(
      JSON.stringify({
        ...VALID,
        improvements: [
          "Item one in this list of improvements.",
          "Item two in this list of improvements.",
          "Item three in this list of improvements.",
          "Item four in this list of improvements.",
          "Item five in this list of improvements.",
        ],
      }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    const res = parseSpeakingGrade(
      JSON.stringify({ ...VALID, unexpected: "field" }),
    );
    expect(res.ok).toBe(false);
  });

  it("rejects invalid JSON", () => {
    const res = parseSpeakingGrade("{ not valid }");
    expect(res.ok).toBe(false);
  });

  it("rejects a response with no JSON object", () => {
    const res = parseSpeakingGrade("no json here");
    expect(res.ok).toBe(false);
  });
});
