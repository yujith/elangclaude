// Shared fixtures for the listening generation tests. Not loaded by any
// production code path — every export here exists to keep the test files
// short and to share a known-good baseline that both the schema test and
// the generator test can mutate.
//
// Filename intentionally has no `.test.ts` suffix so vitest doesn't try
// to execute it as a test file.

import {
  generatedListeningSchema,
  type GeneratedListening,
} from "./listening-schema";

// Returns a fully grounded, schema-and-validator-clean GeneratedListening
// — 12 questions across the 4 parts, every accepted answer literally in
// its part's transcript, every reference resolves. Use as the anchor for
// negative tests by cloning and mutating one field at a time.
export function validatorCleanGeneration(): GeneratedListening {
  const raw = {
    track: "Academic" as const,
    difficulty: 3,
    parts: [
      {
        part: 1 as const,
        context: "social" as const,
        title: "Library card application",
        speakers: [
          {
            id: "narrator",
            name: "Narrator",
            role: "narrator" as const,
            accent: "british" as const,
          },
          {
            id: "rec",
            name: "Receptionist",
            role: "speaker" as const,
            accent: "british" as const,
          },
          {
            id: "cal",
            name: "Caller",
            role: "speaker" as const,
            accent: "australian" as const,
          },
        ],
        transcript: [
          { kind: "narration" as const, text: "Now turn to Part 1." },
          {
            kind: "questions-preview" as const,
            seconds: 30,
            question_positions: [0, 1, 2],
          },
          {
            kind: "speech" as const,
            speaker_id: "rec",
            text: "Library card please. Your surname is Costa, correct? The premium membership is 28 pounds.",
          },
        ],
        question_positions: [0, 1, 2],
        completion_blocks: [
          {
            id: "p1-form",
            layout: "form" as const,
            rows: [
              {
                label: "Surname",
                cells: [
                  [{ kind: "blank" as const, slot_id: "p1-surname" }],
                ],
              },
            ],
          },
        ],
      },
      {
        part: 2 as const,
        context: "social" as const,
        title: "Garden tour",
        speakers: [
          {
            id: "g",
            name: "Guide",
            role: "speaker" as const,
            accent: "american" as const,
          },
        ],
        transcript: [
          { kind: "narration" as const, text: "Now turn to Part 2." },
          {
            kind: "speech" as const,
            speaker_id: "g",
            text: "Welcome to the garden, founded in 2014. Beekeeping is very popular, as is composting and seed-swap evenings.",
          },
        ],
        question_positions: [3, 4],
      },
      {
        part: 3 as const,
        context: "academic" as const,
        title: "Tutorial",
        speakers: [
          {
            id: "t",
            name: "Tutor",
            role: "speaker" as const,
            accent: "british" as const,
          },
          {
            id: "a",
            name: "Student A",
            role: "speaker" as const,
            accent: "canadian" as const,
          },
        ],
        transcript: [
          { kind: "narration" as const, text: "Now turn to Part 3." },
          {
            kind: "speech" as const,
            speaker_id: "t",
            text: "Methodology is the issue. The dataset is restricted.",
          },
          {
            kind: "speech" as const,
            speaker_id: "a",
            text: "Yes, agreed.",
          },
        ],
        question_positions: [5, 6],
      },
      {
        part: 4 as const,
        context: "academic" as const,
        title: "Lecture",
        speakers: [
          {
            id: "l",
            name: "Lecturer",
            role: "speaker" as const,
            accent: "australian" as const,
          },
        ],
        transcript: [
          { kind: "narration" as const, text: "Now turn to Part 4." },
          {
            kind: "speech" as const,
            speaker_id: "l",
            text: "Today's topic is mechanical clockmaking and the escapement.",
          },
        ],
        question_positions: [7, 8, 9, 10, 11, 12],
      },
    ],
    questions: [
      {
        type: "listening-completion-blank" as const,
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
        type: "listening-sentence-completion" as const,
        position: 1,
        prompt: "Complete the sentence.",
        points: 1,
        correct_answer: {
          stem: "The premium membership is ___ pounds.",
          word_limit: 2,
          accepted: ["28", "twenty-eight"],
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 2,
        prompt: "What did she request?",
        points: 1,
        correct_answer: { word_limit: 3, accepted: ["library card"] },
      },
      {
        type: "listening-mcq-single" as const,
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
        type: "listening-mcq-multi" as const,
        position: 4,
        prompt: "Choose TWO activities.",
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
        type: "listening-mcq-single" as const,
        position: 5,
        prompt: "What concerns the tutor?",
        points: 1,
        correct_answer: {
          options: [
            { id: "A", text: "Methodology" },
            { id: "B", text: "Overlap" },
            { id: "C", text: "Geography" },
          ],
          correct: "A",
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 6,
        prompt: "What is restricted?",
        points: 1,
        correct_answer: { word_limit: 2, accepted: ["dataset"] },
      },
      {
        type: "listening-sentence-completion" as const,
        position: 7,
        prompt: "Complete the sentence.",
        points: 1,
        correct_answer: {
          stem: "Today's topic is ___ clockmaking.",
          word_limit: 1,
          accepted: ["mechanical"],
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 8,
        prompt: "Topic of the lecture?",
        points: 1,
        correct_answer: {
          word_limit: 4,
          accepted: ["mechanical clockmaking", "clockmaking"],
        },
      },
      {
        type: "listening-short-answer" as const,
        position: 9,
        prompt: "What innovation is mentioned?",
        points: 1,
        correct_answer: { word_limit: 4, accepted: ["escapement"] },
      },
      {
        type: "listening-short-answer" as const,
        position: 10,
        prompt: "What is the lecture about?",
        points: 1,
        correct_answer: { word_limit: 4, accepted: ["clockmaking"] },
      },
      {
        type: "listening-short-answer" as const,
        position: 11,
        prompt: "Lecture topic again?",
        points: 1,
        correct_answer: { word_limit: 4, accepted: ["mechanical clockmaking"] },
      },
      {
        type: "listening-short-answer" as const,
        position: 12,
        prompt: "Mechanism that regulates energy?",
        points: 1,
        correct_answer: { word_limit: 3, accepted: ["escapement"] },
      },
    ],
  };
  const parsed = generatedListeningSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `validatorCleanGeneration failed schema: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return parsed.data;
}
