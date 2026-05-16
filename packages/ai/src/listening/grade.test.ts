import { describe, expect, it } from "vitest";
import {
  gradeListeningAttempt,
  parseListeningGrade,
  type ListeningGradeQuestion,
  type ListeningGradeAnswer,
} from "./grade";
import { sampleListeningQuestions } from "./fixtures";
import type { ListeningMcqMultiPayload } from "./question-types";

// Helper — turn the fixture's ListeningFixtureQuestion[] into the
// grader's ListeningGradeQuestion[] shape (each fixture question already
// carries the parsed correct_answer object; the grader wants it as the
// raw correctAnswerJson).
function gradeQuestionsFromFixture(): ListeningGradeQuestion[] {
  return sampleListeningQuestions.map((q, i) => ({
    id: `q_${i}`,
    type: q.type,
    position: q.position,
    points: q.points,
    prompt: q.prompt,
    correctAnswerJson: q.correct_answer,
  }));
}

function answerOnly(
  questionId: string,
  response: unknown,
): ListeningGradeAnswer {
  return { questionId, responseJson: response };
}

describe("gradeListeningAttempt — empty submission", () => {
  it("yields raw 0 with every question marked 'No answer submitted'", () => {
    const out = gradeListeningAttempt({
      track: "Academic",
      questions: gradeQuestionsFromFixture(),
      answers: [],
    });
    expect(out.raw_correct).toBe(0);
    expect(out.raw_total).toBeGreaterThan(0);
    expect(out.band_overall).toBe(0);
    for (const item of out.breakdown) {
      expect(item.points_earned).toBe(0);
      expect(item.is_correct).toBe(false);
      expect(item.reason).toBe("No answer submitted.");
    }
  });
});

describe("gradeListeningAttempt — full-correct submission", () => {
  function correctResponseFor(
    q: (typeof sampleListeningQuestions)[number],
  ): unknown {
    const payload = q.correct_answer;
    switch (payload.kind) {
      case "listening-mcq-single":
        return { kind: payload.kind, selected: payload.correct };
      case "listening-mcq-multi":
        return { kind: payload.kind, selected: payload.correct };
      case "listening-sentence-completion":
      case "listening-short-answer":
      case "listening-completion-blank":
        return { kind: payload.kind, text: payload.accepted[0]! };
    }
  }

  function pointsPossibleFor(
    q: (typeof sampleListeningQuestions)[number],
  ): number {
    return q.correct_answer.kind === "listening-mcq-multi"
      ? q.correct_answer.pick_count
      : 1;
  }

  it("yields full raw points and the right band", () => {
    const questions = gradeQuestionsFromFixture();
    const answers = sampleListeningQuestions.map((q, i) =>
      answerOnly(`q_${i}`, correctResponseFor(q)),
    );
    const out = gradeListeningAttempt({
      track: "Academic",
      questions,
      answers,
    });
    const expectedTotal = sampleListeningQuestions.reduce(
      (sum, q) => sum + pointsPossibleFor(q),
      0,
    );
    expect(out.raw_total).toBe(expectedTotal);
    expect(out.raw_correct).toBe(expectedTotal);
    expect(out.band_overall).toBeGreaterThanOrEqual(8.5);
    for (const item of out.breakdown) {
      expect(item.is_correct).toBe(true);
      expect(item.reason).toBe("Correct.");
    }
  });
});

describe("gradeListeningAttempt — mcq-multi partial credit", () => {
  // Pull the multi fixture out via a type assertion — the fixture's
  // top-level `type` and `correct_answer.kind` aren't a discriminated pair
  // from TS's perspective, so narrowing across both fields needs an
  // explicit cast.
  const multiFixture = sampleListeningQuestions.find(
    (q) => q.type === "listening-mcq-multi",
  );
  if (!multiFixture) {
    throw new Error("fixture must contain a listening-mcq-multi question");
  }
  // Capture into a non-undefined local so the nested it() callbacks see
  // the narrowed type (function-scope boundaries drop the if-guard
  // narrowing otherwise).
  const multi: typeof multiFixture & object = multiFixture;
  const multiPayload = multi.correct_answer as ListeningMcqMultiPayload;
  const multiQuestionId = "q_partial";

  function singleMultiAttempt(selected: string[]) {
    return gradeListeningAttempt({
      track: "Academic",
      questions: [
        {
          id: multiQuestionId,
          type: multi.type,
          position: multi.position,
          points: multi.points,
          prompt: multi.prompt,
          correctAnswerJson: multiPayload,
        },
      ],
      answers: [
        answerOnly(multiQuestionId, {
          kind: "listening-mcq-multi",
          selected,
        }),
      ],
    });
  }

  it("awards 1 of 2 points when learner picks one correct + one wrong", () => {
    const correct = multiPayload.correct;
    const wrong = multiPayload.options.find(
      (o) => !multiPayload.correct.includes(o.id),
    )!;
    const out = singleMultiAttempt([correct[0]!, wrong.id]);
    const item = out.breakdown[0]!;
    expect(item.points_possible).toBe(2);
    expect(item.points_earned).toBe(1);
    expect(item.is_correct).toBe(false);
    expect(item.reason).toMatch(/You picked 1 of 2/);
  });

  it("awards 0 when none of the picks match", () => {
    const wrongOnly = multiPayload.options.filter(
      (o) => !multiPayload.correct.includes(o.id),
    );
    const out = singleMultiAttempt(wrongOnly.slice(0, 2).map((o) => o.id));
    const item = out.breakdown[0]!;
    expect(item.points_earned).toBe(0);
    expect(item.reason).toMatch(/None of the picks matched/);
  });

  it("awards full 2 of 2 on a perfect pick", () => {
    const out = singleMultiAttempt(multiPayload.correct);
    const item = out.breakdown[0]!;
    expect(item.points_earned).toBe(2);
    expect(item.is_correct).toBe(true);
    expect(item.reason).toBe("Correct.");
  });

  it("caps over-selection at points_possible (defensive grading)", () => {
    // Learner picks 3 options including both correct ones + one wrong.
    // The grader caps at pick_count = 2 even though earned is 2 (the wrong
    // pick doesn't earn anything anyway, but the cap still holds).
    const correct = multiPayload.correct;
    const wrong = multiPayload.options.find(
      (o) => !correct.includes(o.id),
    )!;
    const out = singleMultiAttempt([correct[0]!, correct[1]!, wrong.id]);
    const item = out.breakdown[0]!;
    expect(item.points_earned).toBe(2);
    expect(item.is_correct).toBe(true);
  });
});

describe("gradeListeningAttempt — completion / sentence / short-answer", () => {
  it("flags an over-word-limit answer with the right reason", () => {
    const q = sampleListeningQuestions.find(
      (x) => x.type === "listening-sentence-completion",
    )!;
    if (q.type !== "listening-sentence-completion") {
      throw new Error("missing sentence-completion in fixture");
    }
    const out = gradeListeningAttempt({
      track: "Academic",
      questions: [
        {
          id: "q_x",
          type: q.type,
          position: q.position,
          points: 1,
          prompt: q.prompt,
          correctAnswerJson: q.correct_answer,
        },
      ],
      answers: [
        answerOnly("q_x", {
          kind: q.type,
          text: "this is far too many words to fit the limit",
        }),
      ],
    });
    expect(out.breakdown[0]!.is_correct).toBe(false);
    expect(out.breakdown[0]!.reason).toMatch(/word limit/);
  });
});

describe("parseListeningGrade — round trip", () => {
  it("round-trips a graded result through the parser", () => {
    const questions = gradeQuestionsFromFixture();
    const out = gradeListeningAttempt({
      track: "Academic",
      questions,
      answers: [],
    });
    const cloned = JSON.parse(JSON.stringify(out)) as unknown;
    const parsed = parseListeningGrade(cloned);
    expect(parsed).not.toBeNull();
    expect(parsed?.section).toBe("Listening");
    expect(parsed?.breakdown).toHaveLength(out.breakdown.length);
  });

  it("returns null on a malformed Grade JSON payload", () => {
    expect(parseListeningGrade(null)).toBeNull();
    expect(parseListeningGrade({ section: "Reading" })).toBeNull();
    expect(
      parseListeningGrade({
        schema_version: 1,
        section: "Listening",
        track: "Academic",
        raw_correct: "lots", // wrong type
        raw_total: 20,
        band_overall: 6.5,
        breakdown: [],
      }),
    ).toBeNull();
  });
});
