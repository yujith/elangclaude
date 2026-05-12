// End-to-end of the deterministic Reading grader: feed a mixed-type test
// in, get a ReadingGrade back, assert raw + band + breakdown.

import { describe, expect, it } from "vitest";
import { bandFromPartial, bandFromRaw40, scaleRawTo40 } from "./band";
import {
  gradeReadingAttempt,
  parseReadingGrade,
  type ReadingGradeAnswer,
  type ReadingGradeQuestion,
} from "./grade";

const QUESTIONS: ReadingGradeQuestion[] = [
  {
    id: "q1",
    type: "reading-mcq",
    position: 0,
    correctAnswerJson: {
      options: [
        { id: "A", text: "1990s" },
        { id: "B", text: "1850s" },
        { id: "C", text: "1700s" },
      ],
      correct: "B",
    },
  },
  {
    id: "q2",
    type: "reading-true-false-not-given",
    position: 1,
    correctAnswerJson: { correct: "not given" },
  },
  {
    id: "q3",
    type: "reading-sentence-completion",
    position: 2,
    correctAnswerJson: {
      stem: "The invention spread to ___ within a decade.",
      word_limit: 3,
      accepted: ["northern europe", "europe"],
    },
  },
];

function answer(id: string, payload: unknown): ReadingGradeAnswer {
  return { questionId: id, responseJson: payload };
}

describe("gradeReadingAttempt", () => {
  it("all correct → raw 3/3, band 9", () => {
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: QUESTIONS,
      answers: [
        answer("q1", { kind: "reading-mcq", selected: "B" }),
        answer("q2", { kind: "reading-true-false-not-given", selected: "Not Given" }),
        answer("q3", {
          kind: "reading-sentence-completion",
          text: "The Northern Europe.",
        }),
      ],
    });
    expect(grade.raw_correct).toBe(3);
    expect(grade.raw_total).toBe(3);
    expect(grade.band_overall).toBe(9.0);
    expect(grade.breakdown.every((b) => b.is_correct)).toBe(true);
  });

  it("partial mix produces per-question reasons", () => {
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: QUESTIONS,
      answers: [
        answer("q1", { kind: "reading-mcq", selected: "C" }),
        answer("q2", { kind: "reading-true-false-not-given", selected: null }),
        answer("q3", {
          kind: "reading-sentence-completion",
          text: "a very large area of northern europe",
        }),
      ],
    });
    expect(grade.raw_correct).toBe(0);
    expect(grade.breakdown[0]?.reason).toBe("Incorrect option.");
    expect(grade.breakdown[1]?.reason).toBe("No answer submitted.");
    expect(grade.breakdown[2]?.reason).toMatch(/3-word limit/);
  });

  it("missing answers are graded incorrect, not skipped", () => {
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: QUESTIONS,
      answers: [],
    });
    expect(grade.raw_total).toBe(3);
    expect(grade.raw_correct).toBe(0);
    expect(grade.breakdown).toHaveLength(3);
  });

  it("breakdown is ordered by question position", () => {
    const q0 = QUESTIONS[0]!;
    const q1 = QUESTIONS[1]!;
    const q2 = QUESTIONS[2]!;
    const shuffled: ReadingGradeQuestion[] = [q2, q0, q1];
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: shuffled,
      answers: [],
    });
    expect(grade.breakdown.map((b) => b.position)).toEqual([0, 1, 2]);
  });

  it("malformed payload flagged but still counted", () => {
    const bogus: ReadingGradeQuestion = {
      id: "bad",
      type: "reading-mcq",
      position: 0,
      correctAnswerJson: { options: [], correct: "X" },
    };
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: [bogus],
      answers: [],
    });
    expect(grade.raw_total).toBe(1);
    expect(grade.raw_correct).toBe(0);
    expect(grade.breakdown[0]?.reason).toMatch(/malformed/);
  });
});

describe("band conversion", () => {
  it("scaleRawTo40 rounds the partial-section count", () => {
    expect(scaleRawTo40(13, 13)).toBe(40);
    expect(scaleRawTo40(6, 13)).toBe(18);
    expect(scaleRawTo40(0, 13)).toBe(0);
    expect(scaleRawTo40(5, 0)).toBe(0);
  });

  it("Academic table thresholds (spot check)", () => {
    expect(bandFromRaw40("Academic", 40)).toBe(9.0);
    expect(bandFromRaw40("Academic", 30)).toBe(7.0);
    expect(bandFromRaw40("Academic", 23)).toBe(6.0);
    expect(bandFromRaw40("Academic", 15)).toBe(5.0);
    expect(bandFromRaw40("Academic", 0)).toBe(0.0);
  });

  it("GT thresholds (spot check)", () => {
    expect(bandFromRaw40("GeneralTraining", 40)).toBe(9.0);
    expect(bandFromRaw40("GeneralTraining", 34)).toBe(7.0);
    expect(bandFromRaw40("GeneralTraining", 23)).toBe(5.0);
  });

  it("bandFromPartial scales 8/13 ≈ 25/40 → 6.0 Academic", () => {
    expect(bandFromPartial("Academic", 8, 13)).toBe(6.0);
  });
});

describe("matching question types", () => {
  const matchingQuestions: ReadingGradeQuestion[] = [
    {
      id: "qh1",
      type: "reading-matching-headings",
      position: 0,
      prompt: "Paragraph A",
      correctAnswerJson: { group_id: "headings", correct: "iii" },
    },
    {
      id: "qh2",
      type: "reading-matching-headings",
      position: 1,
      prompt: "Paragraph B",
      correctAnswerJson: { group_id: "headings", correct: "i" },
    },
    {
      id: "qi1",
      type: "reading-matching-information",
      position: 2,
      prompt: "Which paragraph mentions cost estimates?",
      correctAnswerJson: { correct: "B" },
    },
    {
      id: "qf1",
      type: "reading-matching-features",
      position: 3,
      prompt: "Argued that footfall would fall in pedestrianised streets",
      correctAnswerJson: { group_id: "voices", correct: "shopkeepers" },
    },
    {
      id: "qs1",
      type: "reading-matching-sentence-endings",
      position: 4,
      prompt: "The Battle of Talas in 751 CE led to",
      correctAnswerJson: { group_id: "endings", correct: "D" },
    },
  ];

  const passageContext = {
    paragraphLabels: ["A", "B", "C"],
    matchingGroups: [
      {
        id: "headings",
        kind: "headings" as const,
        items: [
          { key: "i", text: "An early experiment" },
          { key: "ii", text: "Decades of failure" },
          { key: "iii", text: "An obvious need" },
          { key: "iv", text: "A surprise breakthrough" },
        ],
      },
      {
        id: "voices",
        kind: "features" as const,
        items: [
          { key: "shopkeepers", text: "Local shopkeepers" },
          { key: "researchers", text: "University researchers" },
          { key: "planners", text: "City planners" },
        ],
      },
      {
        id: "endings",
        kind: "sentence-endings" as const,
        items: [
          { key: "A", text: "the introduction of papyrus." },
          { key: "B", text: "the closure of paper mills in China." },
          { key: "C", text: "a permanent ban on paper-making." },
          { key: "D", text: "the spread of paper-making to the Islamic world." },
        ],
      },
    ],
  };

  it("all correct across the four matching types", () => {
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: matchingQuestions,
      answers: [
        answer("qh1", { kind: "reading-matching-headings", selected: "iii" }),
        answer("qh2", { kind: "reading-matching-headings", selected: "I" }),
        answer("qi1", { kind: "reading-matching-information", selected: "b" }),
        answer("qf1", { kind: "reading-matching-features", selected: "shopkeepers" }),
        answer("qs1", { kind: "reading-matching-sentence-endings", selected: "D" }),
      ],
      passageContext,
    });
    expect(grade.raw_correct).toBe(5);
    expect(grade.raw_total).toBe(5);
    // Breakdown shows the bank-item text where context is provided.
    expect(grade.breakdown[0]?.correct_summary).toMatch(/iii .* An obvious need/);
    expect(grade.breakdown[2]?.correct_summary).toBe("Paragraph B");
    expect(grade.breakdown[3]?.correct_summary).toMatch(/shopkeepers .* Local shopkeepers/);
  });

  it("incorrect + missing reasons surfaced correctly", () => {
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: matchingQuestions,
      answers: [
        answer("qh1", { kind: "reading-matching-headings", selected: "iv" }),
        answer("qh2", { kind: "reading-matching-headings", selected: null }),
        answer("qi1", { kind: "reading-matching-information", selected: "C" }),
        answer("qf1", { kind: "reading-matching-features", selected: "planners" }),
        answer("qs1", { kind: "reading-matching-sentence-endings", selected: "B" }),
      ],
      passageContext,
    });
    expect(grade.raw_correct).toBe(0);
    expect(grade.breakdown[0]?.reason).toBe("Incorrect match.");
    expect(grade.breakdown[1]?.reason).toBe("No answer submitted.");
    expect(grade.breakdown[2]?.reason).toBe("Incorrect match.");
    expect(grade.breakdown[3]?.reason).toBe("Incorrect match.");
    expect(grade.breakdown[4]?.reason).toBe("Incorrect match.");
  });

  it("falls back to the bare key when passageContext is missing", () => {
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: [matchingQuestions[0]!],
      answers: [answer("qh1", { kind: "reading-matching-headings", selected: "iii" })],
    });
    expect(grade.breakdown[0]?.correct_summary).toBe("iii");
  });
});

describe("short-answer and completion-blank", () => {
  const phase4Questions: ReadingGradeQuestion[] = [
    {
      id: "sa1",
      type: "reading-short-answer",
      position: 0,
      prompt: "What two minerals does the article say are now in short supply?",
      correctAnswerJson: {
        word_limit: 3,
        accepted: ["lithium and cobalt", "cobalt and lithium"],
      },
    },
    {
      id: "cb-sum-1",
      type: "reading-completion-blank",
      position: 1,
      prompt: "Summary blank 1",
      correctAnswerJson: {
        block_id: "summary-1",
        slot_id: "summary-1.year",
        word_limit: 1,
        accepted: ["1843"],
      },
    },
    {
      id: "cb-tab-1",
      type: "reading-completion-blank",
      position: 2,
      prompt: "Table blank 1",
      correctAnswerJson: {
        block_id: "table-1",
        slot_id: "table-1.material",
        word_limit: 1,
        accepted: ["wood"],
      },
    },
    {
      id: "cb-flow-1",
      type: "reading-completion-blank",
      position: 3,
      prompt: "Flow-chart blank 1",
      correctAnswerJson: {
        block_id: "flow-1",
        slot_id: "flow-1.step3",
        word_limit: 2,
        accepted: ["uv treatment"],
      },
    },
  ];

  it("all correct across the Phase-4 kinds", () => {
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: phase4Questions,
      answers: [
        answer("sa1", {
          kind: "reading-short-answer",
          text: "Lithium and cobalt.",
        }),
        answer("cb-sum-1", { kind: "reading-completion-blank", text: "1843" }),
        answer("cb-tab-1", { kind: "reading-completion-blank", text: "Wood" }),
        answer("cb-flow-1", {
          kind: "reading-completion-blank",
          text: "UV treatment",
        }),
      ],
    });
    expect(grade.raw_correct).toBe(4);
    expect(grade.raw_total).toBe(4);
    expect(grade.breakdown.every((b) => b.is_correct)).toBe(true);
  });

  it("short-answer over the word limit reports it", () => {
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: [phase4Questions[0]!],
      answers: [
        answer("sa1", {
          kind: "reading-short-answer",
          text: "lithium cobalt and copper as well",
        }),
      ],
    });
    expect(grade.raw_correct).toBe(0);
    expect(grade.breakdown[0]?.reason).toMatch(/3-word limit/);
  });

  it("completion-blank with missing slot answer is incorrect with 'No answer'", () => {
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: [phase4Questions[1]!],
      answers: [],
    });
    expect(grade.raw_correct).toBe(0);
    expect(grade.breakdown[0]?.reason).toBe("No answer submitted.");
  });

  it("completion-blank digit vs word mismatch is incorrect (per normalisation spec)", () => {
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: [
        {
          id: "cb-digits",
          type: "reading-completion-blank",
          position: 0,
          prompt: "How many?",
          correctAnswerJson: {
            block_id: "b",
            slot_id: "b.s",
            word_limit: 1,
            accepted: ["fifteen"],
          },
        },
      ],
      answers: [
        answer("cb-digits", { kind: "reading-completion-blank", text: "15" }),
      ],
    });
    expect(grade.raw_correct).toBe(0);
    expect(grade.breakdown[0]?.reason).toMatch(/match/);
  });
});

describe("parseReadingGrade", () => {
  it("round-trips a freshly-computed grade", () => {
    const grade = gradeReadingAttempt({
      track: "Academic",
      questions: QUESTIONS,
      answers: [answer("q1", { kind: "reading-mcq", selected: "B" })],
    });
    const round = parseReadingGrade(JSON.parse(JSON.stringify(grade)));
    expect(round).not.toBeNull();
    expect(round?.raw_correct).toBe(1);
    expect(round?.breakdown[0]?.is_correct).toBe(true);
  });

  it("rejects malformed JSON shapes", () => {
    expect(parseReadingGrade(null)).toBeNull();
    expect(parseReadingGrade({})).toBeNull();
    expect(
      parseReadingGrade({ schema_version: 1, section: "Writing" }),
    ).toBeNull();
  });
});
