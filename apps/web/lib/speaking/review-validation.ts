import {
  generatedSpeakingSchema,
  validateGeneratedSpeaking,
  type GeneratedSpeaking,
} from "@elc/ai";
import {
  SPEAKING_PART_TYPES,
  parseSpeakingContent,
} from "@/lib/speaking/content";

type Track = "Academic" | "GeneralTraining";

type ReviewQuestion = {
  type: string;
  prompt: string;
  position: number;
};

export type SpeakingReviewRecord = {
  track: Track;
  difficulty: number;
  body_json: unknown;
  questions: ReviewQuestion[];
};

export type SpeakingReviewValidationResult =
  | { ok: true; generated: GeneratedSpeaking }
  | {
      ok: false;
      reason: "schema" | "validation" | "content" | "anchors";
      issueCodes: string[];
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueIssueCodes(codes: string[]): string[] {
  return codes.filter((code, index, arr) => arr.indexOf(code) === index);
}

function readField(raw: unknown, key: string): unknown {
  if (!isObject(raw)) return undefined;
  return raw[key];
}

function buildGeneratedSpeakingCandidate(
  record: SpeakingReviewRecord,
): unknown {
  return {
    section: "speaking",
    track: record.track,
    difficulty: record.difficulty,
    topic_domain: readField(record.body_json, "topic_domain"),
    part1: readField(record.body_json, "part1"),
    part2: readField(record.body_json, "part2"),
    part3: readField(record.body_json, "part3"),
  };
}

function validateSpeakingAnchors(
  questions: ReviewQuestion[],
): string[] {
  if (questions.length !== SPEAKING_PART_TYPES.length) {
    return ["anchors.missing-speaking-part-rows"];
  }

  for (let i = 0; i < SPEAKING_PART_TYPES.length; i++) {
    const question = questions[i];
    const expectedType = SPEAKING_PART_TYPES[i];
    if (
      !question ||
      question.type !== expectedType ||
      question.position !== i ||
      question.prompt.trim().length === 0
    ) {
      return ["anchors.invalid-speaking-part-order"];
    }
  }

  return [];
}

export function validateSpeakingReviewRecord(
  record: SpeakingReviewRecord,
): SpeakingReviewValidationResult {
  const parsed = generatedSpeakingSchema.safeParse(
    buildGeneratedSpeakingCandidate(record),
  );
  if (!parsed.success) {
    return {
      ok: false,
      reason: "schema",
      issueCodes: ["schema.invalid-generated-speaking"],
    };
  }

  const validation = validateGeneratedSpeaking(parsed.data);
  if (!validation.ok) {
    return {
      ok: false,
      reason: "validation",
      issueCodes: uniqueIssueCodes(validation.issues.map((issue) => issue.code)),
    };
  }

  if (parseSpeakingContent(record.body_json) === null) {
    return {
      ok: false,
      reason: "content",
      issueCodes: ["content.unparseable-speaking-script"],
    };
  }

  const anchorIssues = validateSpeakingAnchors(record.questions);
  if (anchorIssues.length > 0) {
    return {
      ok: false,
      reason: "anchors",
      issueCodes: anchorIssues,
    };
  }

  return { ok: true, generated: parsed.data };
}

export function serializeSpeakingIssueCodes(issueCodes: string[]): string {
  return uniqueIssueCodes(issueCodes).join(",");
}

export function parseSpeakingIssueCodes(raw: string | undefined): string[] {
  if (!raw) return [];
  return uniqueIssueCodes(
    raw
      .split(",")
      .map((code) => code.trim())
      .filter((code) => code.length > 0),
  );
}
