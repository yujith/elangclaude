import {
  generatedReadingSchema,
  isReadingQuestionKind,
  parseReadingPassage,
  parseReadingQuestionPayload,
  validateGeneratedReading,
  type GeneratedReading,
} from "@elc/ai";

type Track = "Academic" | "GeneralTraining";

type ReviewQuestion = {
  type: string;
  position: number;
  prompt: string;
  correct_answer: unknown;
};

export type ReadingReviewRecord = {
  track: Track;
  difficulty: number;
  body_json: unknown;
  questions: ReviewQuestion[];
};

export type ReadingReviewValidationResult =
  | { ok: true; generated: GeneratedReading }
  | {
      ok: false;
      reason: "schema" | "validation" | "passage" | "question-payload";
      issueCodes: string[];
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueIssueCodes(codes: string[]): string[] {
  return codes.filter((code, index, arr) => arr.indexOf(code) === index);
}

function readPassageField(raw: unknown, key: string): unknown {
  if (!isObject(raw)) return undefined;
  return raw[key];
}

function buildGeneratedReadingCandidate(
  record: ReadingReviewRecord,
): unknown | null {
  const questions: {
    type: string;
    position: number;
    prompt: string;
    correct_answer: unknown;
  }[] = [];

  for (const question of record.questions) {
    if (!isReadingQuestionKind(question.type)) return null;
    questions.push({
      type: question.type,
      position: question.position,
      prompt: question.prompt,
      correct_answer: question.correct_answer,
    });
  }

  return {
    track: record.track,
    difficulty: record.difficulty,
    passage: {
      title: readPassageField(record.body_json, "title"),
      paragraphs: readPassageField(record.body_json, "paragraphs"),
      gt_context: readPassageField(record.body_json, "gt_context"),
    },
    questions,
  };
}

export function validateReadingReviewRecord(
  record: ReadingReviewRecord,
): ReadingReviewValidationResult {
  const candidate = buildGeneratedReadingCandidate(record);
  if (!candidate) {
    return {
      ok: false,
      reason: "schema",
      issueCodes: ["schema.invalid-generated-reading"],
    };
  }

  const parsed = generatedReadingSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "schema",
      issueCodes: ["schema.invalid-generated-reading"],
    };
  }

  const validation = validateGeneratedReading(parsed.data);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "validation",
      issueCodes: uniqueIssueCodes(validation.issues.map((issue) => issue.code)),
    };
  }

  if (parseReadingPassage(record.body_json) === null) {
    return {
      ok: false,
      reason: "passage",
      issueCodes: ["passage.unparseable-reading-passage"],
    };
  }

  for (const question of record.questions) {
    if (!isReadingQuestionKind(question.type)) {
      return {
        ok: false,
        reason: "schema",
        issueCodes: ["schema.invalid-generated-reading"],
      };
    }
    if (
      parseReadingQuestionPayload(question.type, question.correct_answer) ===
      null
    ) {
      return {
        ok: false,
        reason: "question-payload",
        issueCodes: ["question.payload-unparseable"],
      };
    }
  }

  return { ok: true, generated: parsed.data };
}

export function serializeReadingIssueCodes(issueCodes: string[]): string {
  return uniqueIssueCodes(issueCodes).join(",");
}

export function parseReadingIssueCodes(raw: string | undefined): string[] {
  if (!raw) return [];
  return uniqueIssueCodes(
    raw
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code.length > 0),
  );
}
