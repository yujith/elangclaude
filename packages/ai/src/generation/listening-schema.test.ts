import { describe, expect, it } from "vitest";
import {
  generatedListeningSchema,
  parseGeneratedListening,
} from "./listening-schema";

// A minimum-viable valid generation. Used as the happy-path anchor; every
// rejection test mutates a clone of it. Authoring it inline (not from the
// Phase 1 fixture) keeps these tests independent of fixture drift.
function validGeneration(): unknown {
  return {
    track: "Academic",
    difficulty: 3,
    parts: [
      {
        part: 1,
        context: "social",
        title: "Library card application",
        speakers: [
          { id: "narrator", name: "Narrator", role: "narrator", accent: "british" },
          { id: "rec", name: "Receptionist", role: "speaker", accent: "british" },
          { id: "cal", name: "Caller", role: "speaker", accent: "australian" },
        ],
        transcript: [
          { kind: "narration", text: "Now turn to Part 1." },
          {
            kind: "questions-preview",
            seconds: 30,
            question_positions: [0, 1, 2],
          },
          { kind: "speech", speaker_id: "rec", text: "How can I help?" },
          { kind: "speech", speaker_id: "cal", text: "Library card please." },
          {
            kind: "reading-pause",
            seconds: 30,
            instruction: "Check your answers.",
          },
        ],
        question_positions: [0, 1, 2],
        completion_blocks: [
          {
            id: "p1-form",
            layout: "form",
            rows: [
              {
                label: "Surname",
                cells: [[{ kind: "blank", slot_id: "p1-surname" }]],
              },
            ],
          },
        ],
      },
      {
        part: 2,
        context: "social",
        title: "Garden tour",
        speakers: [
          { id: "g", name: "Guide", role: "speaker", accent: "american" },
        ],
        transcript: [
          { kind: "narration", text: "Now turn to Part 2." },
          { kind: "speech", speaker_id: "g", text: "Welcome to the garden." },
        ],
        question_positions: [3, 4, 5],
      },
      {
        part: 3,
        context: "academic",
        title: "Tutorial",
        speakers: [
          { id: "t", name: "Tutor", role: "speaker", accent: "british" },
          { id: "a", name: "Student A", role: "speaker", accent: "canadian" },
        ],
        transcript: [
          { kind: "narration", text: "Now turn to Part 3." },
          { kind: "speech", speaker_id: "t", text: "Let's discuss it." },
          { kind: "speech", speaker_id: "a", text: "Yes, agreed." },
        ],
        question_positions: [6, 7, 8],
      },
      {
        part: 4,
        context: "academic",
        title: "Lecture",
        speakers: [
          { id: "l", name: "Lecturer", role: "speaker", accent: "australian" },
        ],
        transcript: [
          { kind: "narration", text: "Now turn to Part 4." },
          {
            kind: "speech",
            speaker_id: "l",
            text: "Today's topic is mechanical clockmaking.",
          },
        ],
        question_positions: [9, 10, 11],
      },
    ],
    questions: [
      {
        type: "listening-completion-blank",
        position: 0,
        prompt: "Surname",
        points: 1,
        correct_answer: {
          block_id: "p1-form",
          slot_id: "p1-surname",
          word_limit: 2,
          accepted: ["Costa"],
        },
      },
      {
        type: "listening-sentence-completion",
        position: 1,
        prompt: "Complete the sentence.",
        points: 1,
        correct_answer: {
          stem: "The premium membership costs ___ pounds.",
          word_limit: 2,
          accepted: ["28", "twenty-eight"],
        },
      },
      {
        type: "listening-short-answer",
        position: 2,
        prompt: "What did she request?",
        points: 1,
        correct_answer: { word_limit: 3, accepted: ["library card"] },
      },
      {
        type: "listening-mcq-single",
        position: 3,
        prompt: "When was the garden founded?",
        points: 1,
        correct_answer: {
          options: [
            { id: "A", text: "2004" },
            { id: "B", text: "2014" },
            { id: "C", text: "2024" },
          ],
          correct: "B",
        },
      },
      {
        type: "listening-mcq-single",
        position: 4,
        prompt: "How many hives?",
        points: 1,
        correct_answer: {
          options: [
            { id: "A", text: "two" },
            { id: "B", text: "four" },
            { id: "C", text: "six" },
          ],
          correct: "B",
        },
      },
      {
        type: "listening-mcq-multi",
        position: 5,
        prompt: "Choose TWO popular activities.",
        points: 2,
        correct_answer: {
          options: [
            { id: "A", text: "Beekeeping" },
            { id: "B", text: "Composting" },
            { id: "C", text: "Seed-swap" },
            { id: "D", text: "Yoga" },
          ],
          pick_count: 2,
          correct: ["A", "B"],
        },
      },
      {
        type: "listening-mcq-single",
        position: 6,
        prompt: "Which research area concerns the tutor?",
        points: 1,
        correct_answer: {
          options: [
            { id: "A", text: "Methodology" },
            { id: "B", text: "Topic overlap" },
            { id: "C", text: "Geography" },
          ],
          correct: "A",
        },
      },
      {
        type: "listening-mcq-single",
        position: 7,
        prompt: "What does the tutor recommend?",
        points: 1,
        correct_answer: {
          options: [
            { id: "A", text: "Switch topic" },
            { id: "B", text: "Co-supervisor" },
            { id: "C", text: "Postpone" },
          ],
          correct: "B",
        },
      },
      {
        type: "listening-sentence-completion",
        position: 8,
        prompt: "Complete the sentence.",
        points: 1,
        correct_answer: {
          stem: "We will meet again next ___.",
          word_limit: 1,
          accepted: ["week"],
        },
      },
      {
        type: "listening-sentence-completion",
        position: 9,
        prompt: "Complete the sentence.",
        points: 1,
        correct_answer: {
          stem: "Today's topic is ___ clockmaking.",
          word_limit: 1,
          accepted: ["mechanical"],
        },
      },
      {
        type: "listening-short-answer",
        position: 10,
        prompt: "What is the focus of today's lecture?",
        points: 1,
        correct_answer: {
          word_limit: 4,
          accepted: ["mechanical clockmaking", "clockmaking"],
        },
      },
      {
        type: "listening-short-answer",
        position: 11,
        prompt: "Topic of the lecture?",
        points: 1,
        correct_answer: {
          word_limit: 4,
          accepted: ["mechanical clockmaking"],
        },
      },
    ],
  };
}

describe("generatedListeningSchema — happy path", () => {
  it("parses the canonical inline example", () => {
    const parsed = generatedListeningSchema.safeParse(validGeneration());
    if (!parsed.success) {
      throw new Error(
        `expected valid schema parse; got: ${JSON.stringify(parsed.error.issues)}`,
      );
    }
    expect(parsed.data.parts).toHaveLength(4);
    expect(parsed.data.questions).toHaveLength(12);
  });
});

describe("generatedListeningSchema — structural rejections", () => {
  it("rejects fewer than 4 parts", () => {
    const v = validGeneration() as { parts: unknown[] };
    v.parts = v.parts.slice(0, 3);
    expect(generatedListeningSchema.safeParse(v).success).toBe(false);
  });

  it("rejects an unknown accent", () => {
    const v = validGeneration() as {
      parts: { speakers: { accent: string }[] }[];
    };
    v.parts[0]!.speakers[0]!.accent = "irish";
    expect(generatedListeningSchema.safeParse(v).success).toBe(false);
  });

  it("rejects parts out of order", () => {
    const v = validGeneration() as { parts: unknown[] };
    [v.parts[0], v.parts[1]] = [v.parts[1]!, v.parts[0]!];
    expect(generatedListeningSchema.safeParse(v).success).toBe(false);
  });

  it("rejects an mcq-single whose correct id isn't an option", () => {
    const v = validGeneration() as { questions: { correct_answer: { correct: string } }[] };
    v.questions[3]!.correct_answer.correct = "Z";
    expect(generatedListeningSchema.safeParse(v).success).toBe(false);
  });

  it("rejects an mcq-multi pick_count mismatch", () => {
    const v = validGeneration() as {
      questions: { correct_answer: { pick_count?: number } }[];
    };
    v.questions[5]!.correct_answer.pick_count = 3;
    expect(generatedListeningSchema.safeParse(v).success).toBe(false);
  });

  it("rejects a sentence-completion stem without ___", () => {
    const v = validGeneration() as {
      questions: { correct_answer: { stem?: string } }[];
    };
    v.questions[1]!.correct_answer.stem = "No blank here.";
    expect(generatedListeningSchema.safeParse(v).success).toBe(false);
  });

  it("rejects a question whose `type` literal isn't in the supported set", () => {
    const v = validGeneration() as { questions: { type: string }[] };
    v.questions[0]!.type = "listening-matching";
    expect(generatedListeningSchema.safeParse(v).success).toBe(false);
  });

  it("rejects a reading-pause with too-long seconds (real IELTS doesn't pause for 5 minutes)", () => {
    const v = validGeneration() as {
      parts: { transcript: { kind?: string; seconds?: number }[] }[];
    };
    const seg = v.parts[0]!.transcript.find((s) => s.kind === "reading-pause");
    if (!seg) throw new Error("fixture missing reading-pause");
    seg.seconds = 300;
    expect(generatedListeningSchema.safeParse(v).success).toBe(false);
  });
});

describe("generatedListeningSchema — cell coercion", () => {
  it("coerces a bare-string cell entry into the canonical {kind:text} object", () => {
    const v = validGeneration() as {
      parts: {
        completion_blocks?: {
          rows: { cells: unknown[][] }[];
        }[];
      }[];
    };
    // Replace the canonical {kind:text} cell with a bare string —
    // a common LLM JSON-generation shortcut.
    v.parts[0]!.completion_blocks![0]!.rows[0]!.cells = [["Surname"]];
    const parsed = generatedListeningSchema.safeParse(v);
    if (!parsed.success) {
      throw new Error(
        `expected coercion to succeed, got: ${JSON.stringify(parsed.error.issues)}`,
      );
    }
    expect(parsed.data.parts[0]!.completion_blocks![0]!.rows[0]!.cells[0]).toEqual([
      { kind: "text", text: "Surname" },
    ]);
  });

  it("still rejects an object cell missing a discriminator", () => {
    const v = validGeneration() as {
      parts: {
        completion_blocks?: {
          rows: { cells: unknown[][] }[];
        }[];
      }[];
    };
    v.parts[0]!.completion_blocks![0]!.rows[0]!.cells = [[{ text: "no-kind" }]];
    expect(generatedListeningSchema.safeParse(v).success).toBe(false);
  });
});

describe("generatedListeningSchema — segment length caps", () => {
  it("accepts a 5000-character speech segment (full Part 4 lecture as one chunk)", () => {
    const v = validGeneration() as {
      parts: {
        transcript: { kind?: string; text?: string; speaker_id?: string }[];
      }[];
    };
    // Replace a speech segment in Part 4 with a very long monologue —
    // the unchunked worst case the schema must still accept.
    const long = "Today's lecture covers mechanical clockmaking. ".repeat(110); // ~5060 chars
    v.parts[3]!.transcript.push({
      kind: "speech",
      speaker_id: "l",
      text: long,
    });
    const parsed = generatedListeningSchema.safeParse(v);
    if (!parsed.success) {
      throw new Error(
        `expected long segment to pass, got: ${JSON.stringify(parsed.error.issues)}`,
      );
    }
  });

  it("still rejects a segment longer than the 6000-char cap", () => {
    const v = validGeneration() as {
      parts: {
        transcript: { kind?: string; text?: string; speaker_id?: string }[];
      }[];
    };
    const tooLong = "x".repeat(6500);
    v.parts[3]!.transcript.push({
      kind: "speech",
      speaker_id: "l",
      text: tooLong,
    });
    expect(generatedListeningSchema.safeParse(v).success).toBe(false);
  });
});

describe("parseGeneratedListening — string parser", () => {
  it("extracts the first JSON object from a noisy response", () => {
    const json = JSON.stringify(validGeneration());
    const noisy = `Here you go:\n\n${json}\n\nThanks!`;
    const out = parseGeneratedListening(noisy);
    expect(out.ok).toBe(true);
  });

  it("extracts JSON wrapped in a markdown code fence", () => {
    const json = JSON.stringify(validGeneration());
    const fenced = "```json\n" + json + "\n```";
    const out = parseGeneratedListening(fenced);
    expect(out.ok).toBe(true);
  });

  it("returns ok=false with issues when JSON is malformed", () => {
    const out = parseGeneratedListening("not a json");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.issues.length).toBeGreaterThan(0);
  });

  it("returns a TRUNCATION-flavoured issue when the JSON object is unclosed", () => {
    // Simulates the model hitting its output-token cap mid-response: an
    // opening `{` arrives but the matching `}` never does. Operators see
    // a distinct error pointing at the model's output cap rather than a
    // misleading "no JSON object found".
    const truncated =
      "```json\n" +
      JSON.stringify(validGeneration()).slice(0, 200);
    const out = parseGeneratedListening(truncated);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.issues[0]!.message).toMatch(/never closed|truncat/i);
    }
  });

  it("returns ok=false with the issues from the schema when JSON parses but is wrong shape", () => {
    const out = parseGeneratedListening(
      JSON.stringify({ track: "Academic", difficulty: 3, parts: [], questions: [] }),
    );
    expect(out.ok).toBe(false);
  });
});
