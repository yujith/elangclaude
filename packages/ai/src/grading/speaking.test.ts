// Contract test for the Speaking grader.
//
// Uses recorded fixture responses — no live network. Covers happy path,
// retry on malformed JSON, and GradeShapeError after both attempts fail.

import { describe, expect, it } from "vitest";
import type { OrgContext } from "@elc/db";
import { GradeShapeError } from "../errors";
import type { AudioFeatures } from "../audio/features";
import { createSpeakingGrader } from "./speaking";

const CTX: OrgContext = {
  org_id: "org_1",
  user_id: "user_1",
  role: "Learner",
};

const PROMPT_BODY = "FAKE SPEAKING GRADING PROMPT — inputs: <<INPUTS>>";

const FEATURES: AudioFeatures = {
  duration_sec: 720,
  total_words: 950,
  wpm: 79.2,
  pause_count: 18,
  mean_pause_ms: 720,
  longest_pause_ms: 2200,
  speaking_ratio: 0.68,
};

const GRADE = {
  band_overall: 6.5,
  criteria: {
    fluency_coherence: {
      band: 6.5,
      justification:
        "Maintained flow with occasional hesitation around abstract content.",
      evidence:
        "Part 3 'I think, um, it's important because' — fillers cluster on opinion turns.",
    },
    lexical_resource: {
      band: 6.0,
      justification:
        "Workmanlike vocabulary but limited paraphrase ability across parts.",
      evidence: "Part 1 repeats 'I like it because it's nice' across topics.",
    },
    grammatical_range: {
      band: 7.0,
      justification:
        "Good range — uses present perfect, conditionals, complex subordination.",
      evidence:
        "Part 2: 'If I had read it earlier, I would have understood it.'",
    },
    pronunciation: {
      band: 6.5,
      justification: "Intelligible throughout; pause distribution comfortable.",
      evidence: "wpm=128 with 6 pauses ≥500ms in 11 minutes.",
    },
  },
  strengths: [
    "Wide grammatical range with good control of complex structures.",
    "Stayed on topic and developed answers with examples.",
  ],
  improvements: [
    "Build paraphrase vocabulary so Part 1 doesn't repeat phrasing.",
    "Practise abstract-discussion fluency to reduce filler clustering.",
  ],
  next_drill: "speaking-part-1-vocabulary",
};

type ChatArg = {
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
};

function makeAi(responses: { text: string }[]) {
  let i = 0;
  const recorded: ChatArg[] = [];
  const chat = async (arg: ChatArg) => {
    recorded.push(arg);
    const next = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return {
      text: next.text,
      model: "claude-sonnet-4-5-20250929",
      usage: { input_tokens: 1400, output_tokens: 700 },
    };
  };
  return { chat, recorded, calls: () => i };
}

function loader(): string {
  return PROMPT_BODY;
}

const BASE_REQ = {
  ctx: CTX,
  transcripts: {
    part1: "I live in Colombo. I work as a designer.",
    part2: "The book I want to talk about is...",
    part3: "I think reading habits have changed because...",
  },
  audioFeatures: FEATURES,
  partsCovered: ["part1", "part2", "part3"] as const,
  testContent: {
    part2_cue_card: "Describe a book you recently read and enjoyed.",
    part3_theme: "Reading and society",
  },
};

describe("createSpeakingGrader", () => {
  it("happy path → typed SpeakingGrade", async () => {
    const ai = makeAi([{ text: JSON.stringify(GRADE) }]);
    const grader = createSpeakingGrader({ ai, loadPrompt: loader });
    const result = await grader.grade({ ...BASE_REQ });
    expect(result.attempts).toBe(1);
    expect(result.grade.band_overall).toBe(6.5);
    expect(result.grade.criteria.pronunciation.band).toBe(6.5);
  });

  it("interpolates the inputs JSON into the system prompt", async () => {
    const ai = makeAi([{ text: JSON.stringify(GRADE) }]);
    const grader = createSpeakingGrader({ ai, loadPrompt: loader });
    await grader.grade({ ...BASE_REQ });
    const system = ai.recorded[0]?.system ?? "";
    // The placeholder is replaced with the actual JSON inputs.
    expect(system).not.toContain("<<INPUTS>>");
    expect(system).toContain("Describe a book you recently read");
    expect(system).toContain("wpm");
  });

  it("retries once on malformed JSON, then succeeds", async () => {
    const ai = makeAi([
      { text: "Here is the grade: not actually json" },
      { text: JSON.stringify(GRADE) },
    ]);
    const grader = createSpeakingGrader({ ai, loadPrompt: loader });
    const result = await grader.grade({ ...BASE_REQ });
    expect(result.attempts).toBe(2);
    expect(ai.calls()).toBe(2);
  });

  it("throws GradeShapeError after the retry fails", async () => {
    const ai = makeAi([{ text: "nope" }, { text: "still nope" }]);
    const grader = createSpeakingGrader({ ai, loadPrompt: loader });
    await expect(grader.grade({ ...BASE_REQ })).rejects.toBeInstanceOf(
      GradeShapeError,
    );
  });

  it("flags parts_covered honestly in the prompt payload", async () => {
    const ai = makeAi([{ text: JSON.stringify(GRADE) }]);
    const grader = createSpeakingGrader({ ai, loadPrompt: loader });
    await grader.grade({
      ...BASE_REQ,
      partsCovered: ["part1"],
      transcripts: { part1: "Some words.", part2: "", part3: "" },
    });
    const system = ai.recorded[0]?.system ?? "";
    expect(system).toContain('"parts_covered"');
    expect(system).toContain('"part1"');
    expect(system).not.toContain('"part2",\n    "part3"');
  });
});
